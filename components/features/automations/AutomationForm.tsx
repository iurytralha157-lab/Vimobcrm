import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateStageAutomation, useUpdateStageAutomation, useStageAutomations, AutomationType, AUTOMATION_TYPE_LABELS, AUTOMATION_TYPE_DESCRIPTIONS, DEAL_STATUS_LABELS, StageAutomation, isInactivityAutomationType, type CreateAutomationData } from "@/hooks/use-stage-automations";
import { useOrganizationUsers } from "@/hooks/use-users";
import { useRoundRobins } from '@/hooks/use-round-robins';
import { User, Trophy, XCircle, Circle } from "lucide-react";
import { getStructuredErrorMessage } from '@/lib/api/vimob-error';
import { useStageInactivityAutomation } from '@/hooks/use-stage-inactivity-automation';
import { StageSettingsActions } from '@/components/features/pipelines/stage-settings-footer';
import { StageInactivityScopeField } from '@/components/features/pipelines/StageInactivityScopeField';
import type { StageInactivityStartMode } from '@/lib/validation/stage-inactivity';

export type StageMoveTarget = { id: string; name: string };

interface AutomationFormProps {
  stageId: string;
  pipelineId: string;
  automation?: StageAutomation | null;
  onSuccess?: () => void;
  onCancel?: () => void;
  terminalStatus?: 'won' | 'lost' | null;
  onEditorStateChange?: (state: { isDirty: boolean; isSaving: boolean }) => void;
  /** Open columns of the same pipeline (never this one, Won or Lost). */
  moveTargets?: readonly StageMoveTarget[];
  moveTargetsLoading?: boolean;
  canManageDistribution?: boolean;
}

const CREATABLE_TYPES: AutomationType[] = ['change_assignee_on_enter', 'change_deal_status_on_enter', 'move_stage_on_inactivity', 'redistribute_on_inactivity'];

export function AutomationForm(props: AutomationFormProps) {
  const inactivityMutation = useStageInactivityAutomation(props.stageId);
  return <AutomationFormEditor key={`${inactivityMutation.scopeKey}:${props.stageId}:${props.automation?.id || 'new'}`} {...props} inactivityMutation={inactivityMutation} />;
}

function AutomationFormEditor({ stageId, automation, onSuccess, onCancel, terminalStatus, onEditorStateChange, inactivityMutation, moveTargets, moveTargetsLoading, canManageDistribution }: AutomationFormProps & { inactivityMutation: ReturnType<typeof useStageInactivityAutomation> }) {
  // Every automation type keeps the editor's original revision until explicit review.
  const [automationSnapshot, setAutomationSnapshot] = useState(automation);
  const config = automationSnapshot?.action_config as Record<string, unknown> | null;
  const [automationType, setAutomationType] = useState<AutomationType>((automationSnapshot?.automation_type as AutomationType) || 'change_assignee_on_enter');
  const [targetStageId, setTargetStageId] = useState<string>(automationSnapshot?.target_stage_id || automationSnapshot?.inactivity_policy?.target_stage_id || '');
  const [queueId, setQueueId] = useState(automationSnapshot?.inactivity_policy?.target_round_robin_id || '');
  const [startMode, setStartMode] = useState<StageInactivityStartMode>(automationSnapshot && automationSnapshot.inactivity_policy?.start_mode !== 'new_stage_entries' ? 'activation' : 'new_stage_entries');
  const [triggerDays, setTriggerDays] = useState<number>(automationSnapshot?.trigger_days || 7);
  const [alertMessage, setAlertMessage] = useState<string>(automationSnapshot?.alert_message || '');
  const [targetUserId, setTargetUserId] = useState<string>((config?.target_user_id as string) || '');
  const [dealStatus, setDealStatus] = useState<'open' | 'won' | 'lost'>((config?.deal_status as 'open' | 'won' | 'lost') || terminalStatus || 'won');
  const [formError, setFormError] = useState<string | null>(null);
  const saveInFlight = useRef(false);
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [needsVersionRefresh, setNeedsVersionRefresh] = useState(false);
  const [versionReview, setVersionReview] = useState<StageAutomation | null>(null);
  const [isRefreshingVersion, setIsRefreshingVersion] = useState(false);
  const fingerprint = JSON.stringify([automationType, triggerDays, alertMessage, targetUserId, dealStatus, targetStageId, queueId, startMode]);
  const [initialFingerprint] = useState(fingerprint);
  const isDirty = fingerprint !== initialFingerprint;

  const usersQuery = useOrganizationUsers();
  const { data: users } = usersQuery;
  const automationsQuery = useStageAutomations(stageId);
  const createAutomation = useCreateStageAutomation();
  const updateAutomation = useUpdateStageAutomation();

  const isEditing = !!automationSnapshot;
  const editingInactivity = isEditing && isInactivityAutomationType(automationSnapshot?.automation_type);
  const isMoveRule = automationType === 'move_stage_on_inactivity';
  const isRedistribution = automationType === 'redistribute_on_inactivity';
  const countsInactivity = isInactivityAutomationType(automationType);
  const queueQuery = useRoundRobins({ enabled: Boolean(isRedistribution && canManageDistribution) });
  const queues = queueQuery.data?.filter((queue) => queue.is_active === true) ?? [];
  const selectedQueue = queues.find((queue) => queue.id === queueId);
  // Inactivity rules keep their type. On-enter rules use a different save path.
  const typeOptions: AutomationType[] = editingInactivity
    ? [automationSnapshot!.automation_type as AutomationType]
    : CREATABLE_TYPES.filter((type) => !(isInactivityAutomationType(type) && (isEditing || terminalStatus)) && (type !== 'redistribute_on_inactivity' || canManageDistribution));
  const targetName = moveTargets?.find((target) => target.id === targetStageId)?.name;
  const formId = `stage-automation-form-${stageId}`;
  const isLoading = createAutomation.isPending || updateAutomation.isPending || inactivityMutation.isPending || isRefreshingVersion;


  useEffect(() => { onEditorStateChange?.({ isDirty, isSaving: isLoading }); }, [isDirty, isLoading, onEditorStateChange]);
  const hasOtherAssignee = automationsQuery.data?.some((item) => item.id !== automationSnapshot?.id && item.is_active === true && item.automation_type === 'change_assignee_on_enter') ?? false;
  const assigneeConflict = automationType === 'change_assignee_on_enter' && automationSnapshot?.is_active !== false && hasOtherAssignee;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isCurrent = createAutomation.captureScopeGuard();
    if (!mounted.current || !isCurrent()) return;
    if (isLoading || saveInFlight.current) return;
    if (needsVersionRefresh) { setFormError('Atualize a versão da regra antes de salvar. Seu rascunho será mantido.'); return; }
    if (isEditing && !automationSnapshot?.updated_at) {
      setNeedsVersionRefresh(true);
      setFormError('Não foi possível confirmar a versão desta regra. Carregue a versão atual para revisar; seu rascunho foi mantido.');
      return;
    }
    if (countsInactivity && (!Number.isInteger(triggerDays) || triggerDays < 1 || triggerDays > 3650)) {
      setFormError('Informe um prazo entre 1 e 3650 dias.');
      return;
    }
    if (automationType === 'alert_on_inactivity' && alertMessage.trim().length > 1000) {
      setFormError('A mensagem do alerta deve ter até 1000 caracteres.');
      return;
    }
    if (isMoveRule && !targetStageId) {
      setFormError('Escolha para qual coluna o lead será movido.');
      return;
    }
    if (isMoveRule && moveTargets && !targetName) {
      setFormError('A coluna de destino não está mais disponível. Escolha outra coluna aberta desta pipeline.');
      return;
    }
    if (isRedistribution && (!canManageDistribution || !selectedQueue || queueQuery.isError)) {
      setFormError('Escolha uma distribuição ativa antes de salvar.');
      return;
    }
    if (automationType === 'change_assignee_on_enter' && !targetUserId) {
      setFormError('Selecione um responsável antes de salvar.');
      return;
    }
    if (assigneeConflict) { setFormError('Desative a outra automação ativa de responsável antes de salvar esta.'); return; }
    if (automationType === 'change_deal_status_on_enter' && terminalStatus && dealStatus !== terminalStatus) {
      setFormError('Escolha o status de Ganho ou Perdido correspondente à configuração desta coluna.');
      return;
    }

    const data: CreateAutomationData = {
      stage_id: stageId,
      automation_type: automationType,
      trigger_days: automationType === 'alert_on_inactivity' ? triggerDays : null,
      target_stage_id: null,
      whatsapp_template: null,
      alert_message: automationType === 'alert_on_inactivity' ? alertMessage : null,
      // Pass direct values - hook will build action_config
      deal_status: automationType === 'change_deal_status_on_enter' ? dealStatus : undefined,
      target_user_id: automationType === 'change_assignee_on_enter' ? targetUserId : undefined,
    };

    saveInFlight.current = true;
    onEditorStateChange?.({ isDirty, isSaving: true });
    setFormError(null);
    let saved = false;
    try {
      if (countsInactivity) {
        const input = {
          trigger_days: triggerDays,
          alert_message: automationType === 'alert_on_inactivity' ? alertMessage : '',
          clock: 'last_interaction' as const,
          start_mode: startMode,
          ...(isMoveRule ? { action: 'move_stage' as const, target_stage_id: targetStageId } : {}),
          ...(isRedistribution ? { action: 'redistribute' as const, target_round_robin_id: queueId } : {}),
        };
        if (isEditing && automationSnapshot) {
          if (!automationSnapshot.updated_at) throw new Error('Atualize a versão da regra antes de salvar.');
          await inactivityMutation.mutateAsync({
            id: automationSnapshot.id,
            input: { ...input, is_enabled: automationSnapshot.inactivity_policy?.is_enabled === true, expected_updated_at: automationSnapshot.updated_at, expected_policy_revision: automationSnapshot.inactivity_policy?.revision ?? 0 },
            runtimeAvailable: automationSnapshot.inactivity_runtime_available === true || automationSnapshot.inactivity_policy?.runtime_available === true,
          });
        } else await inactivityMutation.mutateAsync({ input: { ...input, stage_id: stageId, is_enabled: false } });
      }
      else if (isEditing && automationSnapshot?.updated_at) await updateAutomation.mutateAsync({ id: automationSnapshot.id, ...data, expected_updated_at: automationSnapshot.updated_at });
      else await createAutomation.mutateAsync(data);
      if (!mounted.current || !isCurrent()) return;
      saved = true;
      onSuccess?.();
    } catch (error) {
      if (!mounted.current || !isCurrent()) return;
      const conflict = typeof error === 'object' && error !== null && 'status' in error && error.status === 409 &&
        (countsInactivity || ('code' in error && error.code === 'stage_automation_changed'));
      if (conflict) setNeedsVersionRefresh(true);
      setFormError(conflict
        ? 'Esta regra foi atualizada em outra sessão. Seu rascunho foi preservado. Carregue a versão atual e revise antes de salvar novamente.'
        : getStructuredErrorMessage(error) || 'Não foi possível salvar a automação. Seu rascunho foi preservado.');
    } finally {
      if (mounted.current && isCurrent()) {
        saveInFlight.current = false;
        onEditorStateChange?.({ isDirty: saved ? false : isDirty, isSaving: false });
      }
    }
  };

  const refreshAutomationVersion = async () => {
    const isCurrent = createAutomation.captureScopeGuard();
    if (!mounted.current || !isCurrent()) return;
    if (isLoading || saveInFlight.current || !automationSnapshot) return;
    setIsRefreshingVersion(true);
    try {
      const result = await automationsQuery.refetch();
      if (!mounted.current || !isCurrent()) return;
      if (result.error) throw result.error;
      const latest = result.data?.find((item) => item.id === automationSnapshot.id && item.stage_id === stageId);
      const inactivityType = (type: string | null) => isInactivityAutomationType(type) ? type : null;
      if (!latest?.updated_at || inactivityType(latest.automation_type) !== inactivityType(automationSnapshot.automation_type)) throw new Error('Esta regra foi removida ou mudou de configuração. Reabra a lista de automações.');
      setAutomationSnapshot(latest);
      setVersionReview(latest);
      setNeedsVersionRefresh(false);
      setFormError(null);
    } catch (error) {
      if (mounted.current && isCurrent()) setFormError(getStructuredErrorMessage(error) || 'Não foi possível atualizar a versão. Seu rascunho foi preservado.');
    } finally { if (mounted.current && isCurrent()) setIsRefreshingVersion(false); }
  };

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-4" aria-busy={isLoading}>
      <fieldset disabled={isLoading} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="stage-automation-type">Tipo de Automação</Label>
        <Select value={automationType} onValueChange={(v) => setAutomationType(v as AutomationType)} disabled={editingInactivity}>
          <SelectTrigger id="stage-automation-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {typeOptions.map(type => (
              <SelectItem key={type} value={type}>
                {AUTOMATION_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{AUTOMATION_TYPE_DESCRIPTIONS[automationType]}</p>
      </div>

      {/* Alert Message */}
      {automationType === 'alert_on_inactivity' && (
        <div className="space-y-2">
          <Label htmlFor="stage-automation-message">Mensagem do Alerta</Label>
          <Input
            value={alertMessage}
            id="stage-automation-message"
            onChange={(e) => setAlertMessage(e.target.value)}
            placeholder="Lead está há X dias sem atendimento"
            maxLength={1000}
          />
        </div>
      )}

      {countsInactivity && (
        <div className="space-y-4">
          <div className="grid items-end gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
            <div className="space-y-2">
              <Label htmlFor="stage-automation-days">Dias sem atividade</Label>
              <Input
                type="number"
                id="stage-automation-days"
                min={1}
                max={3650}
                value={triggerDays}
                className="h-10"
                onChange={(e) => setTriggerDays(parseInt(e.target.value) || 1)}
              />
            </div>
            {isMoveRule && <div className="space-y-2">
              <Label htmlFor="stage-automation-target">Mover para a coluna</Label>
              <Select value={targetStageId} onValueChange={setTargetStageId} disabled={moveTargetsLoading || !moveTargets?.length}>
                <SelectTrigger id="stage-automation-target">
                  <SelectValue placeholder={moveTargetsLoading ? 'Carregando colunas...' : 'Selecione a coluna'} />
                </SelectTrigger>
                <SelectContent>
                  {moveTargets?.map(target => (
                    <SelectItem key={target.id} value={target.id}>{target.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>}
            {isRedistribution && <div className="space-y-2">
              <Label htmlFor="stage-automation-queue">Distribuição</Label>
              <Select value={queueId} onValueChange={setQueueId} disabled={!canManageDistribution || queueQuery.isPending || queueQuery.isError || !queues.length}>
                <SelectTrigger id="stage-automation-queue" className="w-full">
                  <SelectValue placeholder={queueQuery.isPending ? 'Carregando distribuições…' : 'Selecione uma distribuição'} />
                </SelectTrigger>
                <SelectContent>
                  {queues.map(queue => <SelectItem key={queue.id} value={queue.id}>{queue.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>}
          </div>
          {isMoveRule && !moveTargetsLoading && moveTargets && !moveTargets.length && <p role="status" className="text-xs text-muted-foreground">Este pipeline precisa de outra coluna aberta para receber os leads.</p>}
          {isRedistribution && queueQuery.isError && <div role="alert" className="flex items-center gap-2 text-xs">Falha ao carregar distribuições. <Button type="button" variant="outline" size="sm" onClick={() => void queueQuery.refetch()}>Tentar novamente</Button></div>}
          {isRedistribution && queueQuery.isSuccess && !queues.length && <p role="status" className="text-xs text-muted-foreground">Ative uma distribuição para usar esta automação.</p>}
          {isRedistribution && selectedQueue?.target_stage && <p className="text-xs text-muted-foreground">A distribuição também envia o lead para {selectedQueue.target_stage.name}.</p>}
          <StageInactivityScopeField id="stage-automation-scope" value={startMode} onChange={setStartMode} disabled={isLoading} />
          <p className="text-xs text-muted-foreground">Atividades registradas, como feedback, mensagens de atendimento e tarefas concluídas, reiniciam o prazo.</p>
          {!isEditing && <p className="text-xs text-muted-foreground">A regra fica desativada até você ligá-la na lista.</p>}
          {isEditing && automationSnapshot?.inactivity_runtime_available !== true && automationSnapshot?.inactivity_policy?.runtime_available !== true && <p role="status" className="text-xs text-muted-foreground">O serviço de inatividade está indisponível neste ambiente.</p>}
        </div>
      )}

      {/* Target User - for change assignee automation */}
      {automationType === 'change_assignee_on_enter' && (
        <div className="space-y-2">
          <Label htmlFor="stage-automation-assignee" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Novo Responsável
          </Label>
          <Select value={targetUserId} onValueChange={setTargetUserId} disabled={usersQuery.isPending || usersQuery.isError}>
            <SelectTrigger id="stage-automation-assignee">
              <SelectValue placeholder="Selecione o Responsável" />
            </SelectTrigger>
            <SelectContent>
              {users?.map(user => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            O lead será atribuído a este usuário ao entrar na coluna. Apenas uma automação de responsável pode ficar ativa por coluna. Reabrir na mesma coluna não repete esta ação.
          </p>
          {usersQuery.isPending && <p role="status" className="text-xs">Carregando responsáveis...</p>}
          {usersQuery.isError && <div role="alert" className="text-xs"><p>Não foi possível carregar os responsáveis.</p><Button type="button" variant="outline" onClick={() => void usersQuery.refetch()}>Tentar novamente</Button></div>}
          {assigneeConflict && <p role="alert" className="text-xs text-destructive">Já existe outra automação ativa de responsável nesta coluna. Desative-a antes de salvar esta.</p>}
        </div>
      )}

      {/* Deal Status - for change status automation */}
      {automationType === 'change_deal_status_on_enter' && (
        <div className="space-y-2">
          <Label htmlFor="stage-automation-status">Novo status do lead</Label>
          <Select value={dealStatus} onValueChange={(v) => setDealStatus(v as 'open' | 'won' | 'lost')}>
            <SelectTrigger id="stage-automation-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open" disabled={Boolean(terminalStatus)}>
                <div className="flex items-center gap-2">
                  <Circle className="h-4 w-4 text-blue-500" />
                  Aberto
                </div>
              </SelectItem>
              <SelectItem value="won" disabled={terminalStatus === 'lost'}>
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-green-500" />
                  Ganho
                </div>
              </SelectItem>
              <SelectItem value="lost" disabled={terminalStatus === 'won'}>
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-500" />
                  Perdido
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            O status será alterado ao entrar nesta coluna. Reabrir sem mudar de coluna não repete esta ação.{terminalStatus ? ' Esta coluna possui resultado final fixo; a automação deve respeitá-lo.' : ''}
          </p>
        </div>
      )}

      </fieldset>
      {formError && <p role="alert" className="rounded-[6px] bg-destructive/10 p-3 text-xs text-destructive">{formError}</p>}
      {needsVersionRefresh && <Button type="button" variant="outline" onClick={() => void refreshAutomationVersion()} disabled={isLoading}>Carregar versão atual e revisar rascunho</Button>}
      {versionReview && !needsVersionRefresh && <p role="status" className="rounded-[6px] bg-muted p-3 text-xs">
        Versão atual carregada: {AUTOMATION_TYPE_LABELS[versionReview.automation_type as AutomationType] || versionReview.automation_type} ({versionReview.is_active ? 'ativa' : 'desativada'}).
        {' '}{versionReview.automation_type === 'change_assignee_on_enter'
          ? `Responsável: ${users?.find(user => user.id === versionReview.action_config?.target_user_id)?.name || 'Usuário não disponível'}.`
          : versionReview.automation_type === 'change_deal_status_on_enter' ? `Status: ${DEAL_STATUS_LABELS[String(versionReview.action_config?.deal_status || 'open')] || 'Não definido'}.`
          : versionReview.automation_type === 'move_stage_on_inactivity' ? `Prazo: ${versionReview.trigger_days} dias. Destino: ${moveTargets?.find((target) => target.id === (versionReview.target_stage_id || versionReview.inactivity_policy?.target_stage_id))?.name || 'coluna indisponível'}.`
          : versionReview.automation_type === 'redistribute_on_inactivity' ? `Prazo: ${versionReview.trigger_days} dias. Distribuição: ${queues.find((queue) => queue.id === versionReview.inactivity_policy?.target_round_robin_id)?.name || 'indisponível'}.`
          : `Prazo: ${versionReview.trigger_days} dias. Mensagem: ${versionReview.alert_message || 'Sem mensagem'}.`}
        {' '}Seu rascunho foi mantido. Confira as diferenças antes de salvar.
      </p>}
      <StageSettingsActions
        onCancel={onCancel}
        cancelDisabled={isLoading}
        primary={{
          label: isEditing ? 'Salvar' : 'Criar Automação',
          form: formId,
          loading: isLoading,
          disabled: isLoading || needsVersionRefresh || assigneeConflict || (automationType === 'change_assignee_on_enter' && (usersQuery.isPending || usersQuery.isError)) || (isMoveRule && (moveTargetsLoading || !targetStageId)) || (isRedistribution && (!canManageDistribution || !selectedQueue || queueQuery.isError)),
        }}
      />
    </form>
  );
}
