import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useStageAutomations, useDeleteStageAutomation, useToggleStageAutomation, AUTOMATION_TYPE_LABELS, DEAL_STATUS_LABELS, StageAutomation, type DeleteAutomationData } from "@/hooks/use-stage-automations";
import { useOrganizationUsers } from "@/hooks/use-users";
import { Pencil, Trash2, Zap, Clock, Bell, User, Trophy, XCircle, Circle, Loader2 } from "lucide-react";
import { getStructuredErrorMessage } from '@/lib/api/vimob-error';
import { useStageInactivityAutomation } from '@/hooks/use-stage-inactivity-automation';

interface AutomationsListProps {
  stageId: string;
  pipelineId?: string;
  canEdit?: boolean;
  onEdit?: (automation: StageAutomation) => void;
  onSavingChange?: (saving: boolean) => void;
}

export function AutomationsList(props: AutomationsListProps) {
  const inactivityMutation = useStageInactivityAutomation(props.stageId);
  return <AutomationsListEditor key={`${inactivityMutation.scopeKey}:${props.stageId}`} {...props} inactivityMutation={inactivityMutation} />;
}

function AutomationsListEditor({ stageId, canEdit = false, onEdit, onSavingChange, inactivityMutation }: AutomationsListProps & { inactivityMutation: ReturnType<typeof useStageInactivityAutomation> }) {
  const query = useStageAutomations(stageId);
  const { data: automations, isLoading } = query;
  const { data: users } = useOrganizationUsers();
  const deleteAutomation = useDeleteStageAutomation();
  const toggleAutomation = useToggleStageAutomation();
  const [deletingAutomation, setDeletingAutomation] = useState<DeleteAutomationData | null>(null);
  const deletion = useRef<DeleteAutomationData | null>(null);
  const [deleteConflict, setDeleteConflict] = useState(false);
  const [pendingAutomationId, setPendingAutomationId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const mutationInFlight = useRef(false);
  const mounted = useRef(true);
  const [needsVersionRefresh, setNeedsVersionRefresh] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const isSaving = pendingAutomationId !== null;
  useEffect(() => { onSavingChange?.(isSaving); }, [isSaving, onSavingChange]);

  const runMutation = async (id: string, action: () => Promise<unknown>, afterSuccess?: () => void) => {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    onSavingChange?.(true);
    setPendingAutomationId(id);
    setMutationError(null);
    try {
      await action();
      if (!mounted.current) return;
      afterSuccess?.();
      await query.refetch();
    } catch (error) {
      if (!mounted.current) return;
      if (typeof error === 'object' && error !== null && 'status' in error && error.status === 409) setNeedsVersionRefresh(true);
      setMutationError(typeof error === 'object' && error !== null && 'code' in error && error.code === 'stage_automation_changed'
        ? deletingAutomation
          ? 'Esta automação foi atualizada em outra sessão. Feche esta confirmação, atualize a lista e confira antes de excluir.'
          : 'Esta automação foi atualizada em outra sessão. Carregue a versão atual e confira antes de ativar ou desativar.'
        : getStructuredErrorMessage(error) || 'Não foi possível atualizar a automação. Tente novamente.');
      if (deletingAutomation && typeof error === 'object' && error !== null && 'status' in error && error.status === 409) {
        deleteAutomation.discard(deletingAutomation);
        setDeleteConflict(true);
      }
    } finally {
      if (mounted.current) {
        mutationInFlight.current = false;
        setPendingAutomationId(null);
        onSavingChange?.(false);
      }
    }
  };

  const closeDeletion = (candidate: DeleteAutomationData | null) => {
    if (deletion.current !== candidate) return;
    if (candidate) deleteAutomation.discard(candidate);
    deletion.current = null;
    setDeletingAutomation(null);
    setDeleteConflict(false);
  };

  const openDeletion = (automation: StageAutomation) => {
    if (!canEdit || isSaving || query.isError || needsVersionRefresh) return;
    if (!automation.updated_at) {
      setNeedsVersionRefresh(true);
      setMutationError('Não foi possível confirmar a versão desta regra. Atualize a lista antes de excluir.');
      return;
    }
    try {
      const captured = deleteAutomation.capture({ id: automation.id, expected_updated_at: automation.updated_at });
      if (deletion.current) deleteAutomation.discard(deletion.current);
      deletion.current = captured;
      setDeletingAutomation(captured);
      setDeleteConflict(false);
      setMutationError(null);
    } catch (error) {
      setMutationError(getStructuredErrorMessage(error));
    }
  };

  const confirmDeletion = (candidate: DeleteAutomationData | null) => {
    if (!canEdit || !candidate || deletion.current !== candidate || deleteConflict || !deleteAutomation.isCurrent(candidate)) return;
    void runMutation(candidate.id, () => deleteAutomation.mutateAsync(candidate), () => closeDeletion(candidate));
  };

  const refreshVersion = async () => {
    const result = await query.refetch();
    if (!mounted.current) return;
    if (result.error) { setMutationError('Não foi possível carregar a versão atual. Tente novamente antes de alterar a automação.'); return; }
    setNeedsVersionRefresh(false);
    setMutationError(null);
  };

  const toggleCommon = (automation: StageAutomation, checked: boolean) => {
    if (!canEdit || needsVersionRefresh || query.isError || mutationInFlight.current) return;
    if (!automation.updated_at) {
      setNeedsVersionRefresh(true);
      setMutationError('Não foi possível confirmar a versão desta regra. Atualize a lista antes de ativar ou desativar.');
      return;
    }
    const expectedUpdatedAt = automation.updated_at;
    void runMutation(automation.id, () => toggleAutomation.mutateAsync({ id: automation.id, is_active: checked, expected_updated_at: expectedUpdatedAt }));
  };

  const toggleInactivity = (automation: StageAutomation, checked: boolean) => {
    const policy = automation.inactivity_policy;
    if (checked && (!policy || policy.clock !== 'last_interaction' || policy.start_mode !== 'activation')) {
      setMutationError('Configure esta regra antes de ativar. Salvar a configuração não envia alertas.');
      onEdit?.(automation);
      return;
    }
    if (!automation.updated_at || !automation.trigger_days) {
      setMutationError('Atualize e configure o prazo desta regra antes de continuar.');
      return;
    }
    void runMutation(automation.id, () => inactivityMutation.mutateAsync({
      id: automation.id,
      input: { trigger_days: automation.trigger_days!, alert_message: automation.alert_message || '', is_enabled: checked,
        clock: 'last_interaction', start_mode: 'activation', expected_updated_at: automation.updated_at!, expected_policy_revision: policy?.revision ?? 0 },
      runtimeAvailable: automation.inactivity_runtime_available === true || policy?.runtime_available === true,
    }));
  };

  const getAutomationIcon = (type: string | null) => {
    switch (type) {
      case 'alert_on_inactivity':
        return <Bell className="h-4 w-4" />;
      case 'change_assignee_on_enter':
        return <User className="h-4 w-4" />;
      case 'change_deal_status_on_enter':
        return <Trophy className="h-4 w-4" />;
      default:
        return <Zap className="h-4 w-4" />;
    }
  };
  const getUserName = (userId: string | null) => {
    if (!userId || !users) return null;
    const user = users.find(u => u.id === userId);
    return user?.name || 'Usuário desconhecido';
  };

  const getDealStatusIcon = (status: string) => {
    switch (status) {
      case 'won': return <Trophy className="h-3 w-3 text-green-500" />;
      case 'lost': return <XCircle className="h-3 w-3 text-red-500" />;
      default: return <Circle className="h-3 w-3 text-blue-500" />;
    }
  };

  const getAutomationDescription = (automation: StageAutomation) => {
    const config = automation.action_config as Record<string, unknown> || {};

    switch (automation.automation_type) {
      case 'alert_on_inactivity':
        return (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Clock className="h-3 w-3" />
            {automation.trigger_days} dias - {automation.alert_message}
          </span>
        );
      case 'change_assignee_on_enter':
        return (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <User className="h-3 w-3" />
            → {getUserName(config.target_user_id as string) || 'Não definido'}
          </span>
        );
      case 'change_deal_status_on_enter': {
        const status = config.deal_status as string || 'open';
        return (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            {getDealStatusIcon(status)}
            → {DEAL_STATUS_LABELS[status] || status}
          </span>
        );
      }
      default:
        return null;
    }
  };

  if (isLoading) {
    return <div role="status" aria-live="polite" className="text-center py-4 text-muted-foreground">Carregando automações...</div>;
  }

  if (query.isError && !automations?.length) {
    return <div role="alert" className="space-y-3 rounded-[8px] bg-destructive/10 p-4 text-sm">
      <p>Não foi possível carregar as automações desta coluna. Nenhuma configuração foi tratada como ausente.</p>
      <Button type="button" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>Tentar novamente</Button>
    </div>;
  }

  if (!automations || automations.length === 0) {
    return (
      <div role="status" className="text-center py-8 text-muted-foreground">
        <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>Nenhuma automação configurada</p>
        {canEdit && <p className="text-sm">Adicione uma automação para este estágio</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {query.isError && <div role="alert" className="space-y-2 rounded-[8px] bg-amber-500/10 p-3 text-xs">
        <p>As automações exibidas podem estar desatualizadas. Atualize antes de editar.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>Tentar novamente</Button>
      </div>}
      {mutationError && <p role="alert" className="rounded-[6px] bg-destructive/10 p-3 text-xs text-destructive">{mutationError}</p>}
      {needsVersionRefresh && <Button type="button" variant="outline" onClick={() => void refreshVersion()} disabled={query.isFetching || isSaving}>Atualizar automações antes de continuar</Button>}
      {automations.filter((item) => item.automation_type === 'change_assignee_on_enter' && item.is_active === true).length > 1 && (
        <p role="alert" className="rounded-[6px] bg-amber-500/10 p-3 text-xs">Há várias automações ativas de responsável. A última criada, com desempate pelo identificador, prevalece. Desative as demais; novos salvamentos e ativações permitem apenas uma.</p>
      )}
      {automations.map((automation) => {
        const automationType = automation.automation_type as keyof typeof AUTOMATION_TYPE_LABELS | null;
        const isInactivity = automationType === 'alert_on_inactivity';
        const policy = automation.inactivity_policy;
        const runtimeAvailable = automation.inactivity_runtime_available === true || policy?.runtime_available === true;
        const effectiveActive = isInactivity ? policy?.effective_enabled === true && runtimeAvailable : automation.is_active === true;

        return (
        <Card key={automation.id} className={!effectiveActive ? 'opacity-60' : ''} aria-busy={pendingAutomationId === automation.id}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="p-1.5 rounded-md bg-primary/10 text-primary shrink-0">
                  {getAutomationIcon(automation.automation_type)}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-xs leading-tight truncate">
                    {automationType ? AUTOMATION_TYPE_LABELS[automationType] || automationType : 'Automação'}
                  </h4>
                  <div className="break-words [&_span]:flex-wrap [&_span]:text-xs">{getAutomationDescription(automation)}</div>
                  {isInactivity && <p className="mt-1 text-xs text-muted-foreground">{!policy ? 'Não configurada: configure antes de ativar.' : !runtimeAvailable ? 'Alertas indisponíveis neste ambiente.' : effectiveActive ? 'Ativada: conta a última interação humana após a ativação.' : 'Desativada: configurar não envia alertas.'}</p>}
                </div>
              </div>

              {canEdit && <div className="flex items-center gap-1 shrink-0">
                <Switch
                  checked={effectiveActive}
                  aria-label={`Ativar ${automationType ? AUTOMATION_TYPE_LABELS[automationType] : 'automação'}`}
                  disabled={isSaving || query.isError || needsVersionRefresh || (isInactivity && Boolean(policy) && !runtimeAvailable)}
                  onCheckedChange={(checked) =>
                    isInactivity ? toggleInactivity(automation, checked) : toggleCommon(automation, checked)
                  }
                />
                {isInactivity && policy?.is_enabled === true && !effectiveActive && <Button type="button" variant="outline" size="sm" disabled={isSaving || query.isError || needsVersionRefresh} onClick={() => toggleInactivity(automation, false)}>Desativar regra</Button>}

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 sm:h-8 sm:w-8"
                  aria-label="Editar automação"
                  disabled={isSaving || query.isError || needsVersionRefresh}
                  onClick={() => onEdit?.(automation)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>

                <AlertDialog open={deletingAutomation?.id === automation.id} onOpenChange={(open) => { if (!open && !isSaving) closeDeletion(deletingAutomation); }}>
                    <Button type="button" variant="ghost" size="icon" className="h-10 w-10 sm:h-8 sm:w-8" aria-label="Excluir automação" disabled={isSaving || query.isError || needsVersionRefresh} onClick={() => openDeletion(automation)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Excluir automação?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta ação não pode ser desfeita. A automação será permanentemente removida.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      {mutationError && <p role="alert" className="text-xs text-destructive">{mutationError}</p>}
                      <AlertDialogCancel disabled={isSaving}>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(event) => {
                          event.preventDefault();
                          confirmDeletion(deletingAutomation);
                        }}
                        disabled={isSaving || deleteConflict}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                        {isSaving ? 'Excluindo...' : 'Excluir'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>}
            </div>
          </CardContent>
        </Card>
        );
      })}
    </div>
  );
}
