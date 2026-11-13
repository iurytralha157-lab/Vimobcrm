import { useState } from 'react';
import { AlertCircle, BellRing, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { RulesExtraEditor } from '@/components/features/cadences';
import { managedInactivityAlert, useStageAutomations, type StageAutomation } from '@/hooks/use-stage-automations';
import { useStageInactivityAutomation } from '@/hooks/use-stage-inactivity-automation';
import { getPublicErrorMessage, VimobAPIError } from '@/lib/api/vimob-error';
import { isLocalReadOnlyMode } from '@/lib/local-read-only';
import type { StageInactivityStartMode } from '@/lib/validation/stage-inactivity';
import { StageInactivityScopeField } from '@/components/features/pipelines/StageInactivityScopeField';

type AlertDraft = { enabled: boolean; days: number; message: string; startMode: StageInactivityStartMode };
type AlertRevision = Pick<StageAutomation, 'id' | 'updated_at' | 'inactivity_policy' | 'inactivity_runtime_available'>;

const DEFAULT_DAYS = 3;
const UNAVAILABLE = 'O serviço de avisos de inatividade não está disponível neste ambiente. O aviso foi mantido desativado.';

function sameDraft(a: AlertDraft, b: AlertDraft) {
  return a.enabled === b.enabled && a.days === b.days && a.message.trim() === b.message.trim() && a.startMode === b.startMode;
}

function daysLabel(days: number) {
  return `${days} ${days === 1 ? 'dia' : 'dias'}`;
}

/**
 * "Avisar quando o lead ficar parado": the stage inactivity alert, edited with
 * the stage rules and saved by the same Salvar regras action. It keeps its own
 * revision and is enabled only after the rule exists (creation is disabled).
 */
export function useStageInactivityAlertEditor({
  stageId,
  enabled,
  canEdit,
}: {
  stageId: string;
  /** Requires the automations module and permission to view automations. */
  enabled: boolean;
  canEdit: boolean;
}): RulesExtraEditor | undefined {
  const query = useStageAutomations(stageId);
  const mutation = useStageInactivityAutomation(stageId);
  const managed = managedInactivityAlert(query.data);
  const others = (query.data ?? []).filter((item) => item.automation_type === 'alert_on_inactivity' && item.id !== managed?.id).length;
  const runtimeAvailable = managed?.inactivity_runtime_available === true || managed?.inactivity_policy?.runtime_available === true;
  const base: AlertDraft = {
    enabled: managed?.inactivity_policy?.is_enabled === true,
    days: managed?.trigger_days || DEFAULT_DAYS,
    message: managed?.alert_message || '',
    startMode: managed && managed.inactivity_policy?.start_mode !== 'new_stage_entries' ? 'activation' : 'new_stage_entries',
  };
  const baseKey = managed ? `${managed.id}:${managed.updated_at}:${managed.inactivity_policy?.revision ?? 0}` : 'none';
  const [draft, setDraft] = useState<AlertDraft | null>(null);
  // After a save the draft is kept until the refetched rule replaces this key.
  const [savedFrom, setSavedFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (!enabled) return undefined;

  const following = draft === null || (savedFrom !== null && savedFrom !== baseKey);
  const current = following ? base : draft;
  const isDirty = savedFrom === null && draft !== null && !sameDraft(draft, base);
  const localReadOnly = isLocalReadOnlyMode();
  const canSave = canEdit && !localReadOnly;
  const editable = canSave && !isSaving && !query.isPending && !query.isError;
  const update = (patch: Partial<AlertDraft>) => {
    if (!editable) return;
    setSavedFrom(null);
    setError(null);
    setDraft({ ...current, ...patch });
  };

  const save = async () => {
    if (!editable || !isDirty) return !isDirty;
    if (!Number.isInteger(current.days) || current.days < 1 || current.days > 3650) {
      setError('Informe um prazo entre 1 e 3650 dias.');
      return false;
    }
    if (current.message.trim().length > 1000) {
      setError('A mensagem do aviso deve ter até 1000 caracteres.');
      return false;
    }
    const input = { trigger_days: current.days, alert_message: current.message.trim(), clock: 'last_interaction' as const, start_mode: current.startMode };
    const saveExisting = (rule: AlertRevision, isEnabled: boolean) => {
      if (!rule.updated_at) throw new Error('Não foi possível confirmar a versão do aviso. Recarregue a página antes de salvar.');
      return mutation.mutateAsync({
        id: rule.id,
        input: { ...input, is_enabled: isEnabled, expected_updated_at: rule.updated_at, expected_policy_revision: rule.inactivity_policy?.revision ?? 0 },
        runtimeAvailable: rule.inactivity_runtime_available === true || rule.inactivity_policy?.runtime_available === true,
      });
    };
    const isCurrent = mutation.captureScopeGuard();
    let preparedDisabled = false;
    setIsSaving(true);
    setError(null);
    try {
      let rule: AlertRevision | null = managed;
      if (current.enabled && managed && !runtimeAvailable) {
        setError('O serviço de avisos de inatividade está indisponível neste ambiente.');
        return false;
      }
      if (current.enabled && !rule) {
        rule = await mutation.mutateAsync({ input: { ...input, stage_id: stageId, is_enabled: false } });
        preparedDisabled = true;
      } else if (current.enabled && rule && rule.inactivity_policy?.clock !== 'last_interaction') {
        // Legacy rules need a committed last-interaction policy before activation.
        rule = await saveExisting(rule, false);
        preparedDisabled = true;
      }
      if (!isCurrent()) return false;
      if (rule && current.enabled && !(rule.inactivity_runtime_available || rule.inactivity_policy?.runtime_available)) {
        setDraft({ ...current, enabled: false });
        setSavedFrom(baseKey);
        setError(UNAVAILABLE);
        return false;
      }
      if (rule) await saveExisting(rule, current.enabled);
      if (!isCurrent()) return false;
      setSavedFrom(baseKey);
      return true;
    } catch (failure) {
      if (!isCurrent()) return false;
      if (preparedDisabled) await query.refetch();
      if (!isCurrent()) return false;
      const conflict = failure instanceof VimobAPIError && failure.code === 'stage_inactivity_changed';
      const unavailable = failure instanceof VimobAPIError && ['stage_inactivity_unavailable', 'inactivity_runtime_unavailable'].includes(failure.code);
      const reference = failure instanceof VimobAPIError && failure.requestId ? ` Referência: ${failure.requestId}.` : '';
      const fallback = 'Não foi possível salvar o aviso de inatividade. Tente novamente.';
      const message = conflict
        ? 'O aviso de inatividade foi alterado em outra sessão. Recarregue a página para ver a versão atual.'
        : unavailable
          ? 'O serviço de avisos de inatividade está indisponível neste ambiente.'
          : getPublicErrorMessage(failure, fallback);
      setError(`${preparedDisabled ? 'O aviso foi salvo desativado. ' : ''}${message}${reference}`);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const summary = current.enabled
    ? `Sem atividade por ${daysLabel(current.days)}, o responsável recebe um aviso${current.message.trim() ? `: “${current.message.trim()}”` : ''}.${managed && !runtimeAvailable ? ' O serviço de avisos está indisponível neste ambiente.' : ''}`
    : null;

  const node = (
    <div className="rounded-[8px] bg-[var(--app-surface-solid)] p-3" aria-busy={isSaving}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
            <BellRing className="h-3.5 w-3.5" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <Label htmlFor={`stage-inactivity-alert-${stageId}`} className="text-xs font-light text-[var(--app-text-primary)]">
              Avisar quando o lead ficar parado
            </Label>
            <p className="mt-0.5 text-[12px] font-light leading-[17px] text-[var(--app-text-tertiary)]">
              Avisa o responsável no CRM após o prazo sem atividade registrada.
            </p>
          </div>
        </div>
        {query.isPending ? (
          <Loader2 className="mt-1 h-3.5 w-3.5 animate-spin text-[var(--app-text-tertiary)]" aria-label="Carregando aviso" />
        ) : (
          <Switch
            id={`stage-inactivity-alert-${stageId}`}
            checked={current.enabled}
            disabled={!editable}
            onCheckedChange={(checked) => update({ enabled: checked })}
            aria-label={`${current.enabled ? 'Desativar' : 'Ativar'} aviso de lead parado`}
          />
        )}
      </div>

      {query.isError ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 pl-0 text-[12px] font-light text-destructive sm:pl-9">
          <span>Não foi possível carregar o aviso desta coluna.</span>
          <Button type="button" variant="ghost" size="sm" className="h-7 rounded-[6px] bg-[var(--app-surface-soft)] px-2 text-xs font-light" onClick={() => void query.refetch()} disabled={query.isFetching}>
            Tentar novamente
          </Button>
        </div>
      ) : null}

      {current.enabled && !query.isError ? (
        <div className="mt-3 grid gap-3 pl-0 sm:grid-cols-[140px_minmax(0,1fr)] sm:pl-9">
          <div className="space-y-1.5">
            <Label htmlFor={`stage-inactivity-alert-days-${stageId}`} className="text-[12px] font-light text-[var(--app-text-secondary)]">
              Dias sem atividade
            </Label>
            <Input
              id={`stage-inactivity-alert-days-${stageId}`}
              type="number"
              min={1}
              max={3650}
              value={current.days}
              disabled={!editable}
              onChange={(event) => update({ days: Math.max(1, Math.min(3650, Number.parseInt(event.target.value, 10) || 1)) })}
              className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`stage-inactivity-alert-message-${stageId}`} className="text-[12px] font-light text-[var(--app-text-secondary)]">
              Mensagem do aviso (opcional)
            </Label>
            <Input
              id={`stage-inactivity-alert-message-${stageId}`}
              value={current.message}
              maxLength={1000}
              disabled={!editable}
              placeholder="Retome o contato com este lead"
              onChange={(event) => update({ message: event.target.value })}
              className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light"
            />
          </div>
          <div className="sm:col-span-2">
            <StageInactivityScopeField id={`stage-inactivity-alert-scope-${stageId}`} value={current.startMode}
              onChange={(startMode) => update({ startMode })} disabled={!editable} />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">Feedback, mensagens de atendimento e tarefas concluídas reiniciam o prazo.</p>
        </div>
      ) : null}

      {managed && !runtimeAvailable && !query.isError ? (
        <p role="status" className="mt-2 pl-0 text-[10px] font-light leading-[15px] text-[var(--app-text-tertiary)] sm:pl-9">
          O serviço de avisos de inatividade está indisponível neste ambiente; a regra pode ser configurada, mas não envia avisos.
        </p>
      ) : null}
      {others > 0 ? (
        <p className="mt-2 pl-0 text-[10px] font-light leading-[15px] text-[var(--app-text-tertiary)] sm:pl-9">
          Esta coluna tem {others === 1 ? 'outro aviso antigo' : `outros ${others} avisos antigos`} de inatividade, listados em Automações.
        </p>
      ) : null}
      {!canEdit && !localReadOnly ? (
        <p className="mt-2 pl-0 text-[10px] font-light leading-[15px] text-[var(--app-text-tertiary)] sm:pl-9">
          Somente quem gerencia automações pode alterar este aviso.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-[6px] bg-destructive/10 px-3 py-2 text-[12px] font-light leading-[17px] text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );

  return { node, summary, isDirty, isSaving, save };
}
