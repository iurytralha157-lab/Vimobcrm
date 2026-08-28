import { useState, type MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  History,
  Loader2,
  Plus,
  Square,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Automation,
  TriggerType,
  TRIGGER_TYPE_LABELS,
  useAutomationExecutionSummaries,
  useAutomations,
  useCancelAutomationExecutions,
  useDeleteAutomation,
  useDuplicateAutomation,
  useToggleAutomation,
} from '@/hooks/use-automations';
import { usePipelines, useStages } from '@/hooks/use-stages';
import { useTags } from '@/hooks/use-tags';
import { useIsMobile } from '@/hooks/use-mobile';
import { format } from 'date-fns';
import { VimobAPIError } from '@/lib/api/vimob-client';

interface AutomationListProps {
  onEdit: (automationId: string) => void;
  onCreate?: () => void;
  onViewHistory?: (automationId: string) => void;
  canManage?: boolean;
  canCreate?: boolean;
  allowEditing?: boolean;
}

function TriggerContext({ automation }: { automation: Automation }) {
  const config = (automation.trigger_config as Record<string, unknown>) || {};
  const triggerType = automation.trigger_type as TriggerType;
  const pipelineId = config.pipeline_id as string | undefined;
  const stageId = config.to_stage_id as string | undefined;
  const tagId = config.tag_id as string | undefined;
  const { data: pipelines } = usePipelines();
  const { data: stages } = useStages(pipelineId);
  const { data: tags } = useTags();

  if (triggerType === 'lead_stage_changed' && pipelineId) {
    const pipeline = pipelines?.find((p) => p.id === pipelineId);
    const stage = stageId ? stages?.find((s) => s.id === stageId) : null;
    if (!pipeline && !stage) return null;
    return (
      <span className="text-xs text-muted-foreground">
        {pipeline?.name || '-'}{stage ? ` -> ${stage.name}` : ''}
      </span>
    );
  }

  if (triggerType === 'tag_added' && tagId) {
    const tag = tags?.find((item) => item.id === tagId);
    if (!tag) return null;
    return (
      <span
        className="px-1.5 py-0.5 rounded-full text-xs font-medium"
        style={{ backgroundColor: tag.color ? `${tag.color}22` : undefined, color: tag.color || undefined }}
      >
        {tag.name}
      </span>
    );
  }

  return null;
}
void TriggerContext;

export function AutomationList({
  onEdit,
  onCreate,
  onViewHistory,
  canManage = true,
  canCreate = canManage,
  allowEditing = true,
}: AutomationListProps) {
  const isMobile = useIsMobile();
  const { data: automations, isLoading, error, refetch } = useAutomations();
  const {
    data: executionSummaries,
    error: summariesError,
    isFetching: summariesFetching,
    refetch: refetchSummaries,
  } = useAutomationExecutionSummaries();
  const deleteAutomation = useDeleteAutomation();
  const toggleAutomation = useToggleAutomation();
  const duplicateAutomation = useDuplicateAutomation();
  const cancelExecutions = useCancelAutomationExecutions();
  const canOpenEditor = canManage && allowEditing && !isMobile;
  const showCreateAction = canCreate && canOpenEditor && onCreate;
  const [stopTarget, setStopTarget] = useState<{
    id: string;
    name: string;
    running: number;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const getExecutionStats = (automationId: string) => {
    const summary = executionSummaries?.find((item) => item.automationId === automationId);
    return {
      running: (summary?.queued ?? 0) + (summary?.running ?? 0) + (summary?.waiting ?? 0),
      completed: summary?.completed ?? 0,
      failed: summary?.failed ?? 0,
      total: summary?.total ?? 0,
    };
  };

  const handleDuplicate = (automation: Automation, event: MouseEvent) => {
    event.stopPropagation();
    if (!canOpenEditor) return;
    duplicateAutomation.mutate(automation.id);
  };

  const handleStop = (automation: Automation, event: MouseEvent) => {
    event.stopPropagation();
    if (!canManage || cancelExecutions.isPending) return;
    const stats = getExecutionStats(automation.id);
    if (stats.running === 0) return;
    setStopTarget({ id: automation.id, name: automation.name, running: stats.running });
  };

  const confirmStop = async () => {
    if (!canManage || !stopTarget || cancelExecutions.isPending) return;
    try {
      await cancelExecutions.mutateAsync(stopTarget.id);
      setStopTarget(null);
    } catch {
      // The mutation reports the error. Keep the dialog open for retry/cancel.
    }
  };

  const confirmDelete = async () => {
    if (!canOpenEditor || !deleteTarget || deleteAutomation.isPending) return;
    try {
      await deleteAutomation.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      // The mutation reports the error. Keep the dialog open for retry/cancel.
    }
  };

  const handleOpenCard = (automationId: string) => {
    if (canOpenEditor) {
      onEdit(automationId);
      return;
    }

    onViewHistory?.(automationId);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center gap-2 text-[12px] font-light text-[var(--app-text-tertiary)]" role="status" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
        Carregando automações...
      </div>
    );
  }

  if (error) {
    const moduleUnavailable = error instanceof VimobAPIError
      && error.status === 403
      && error.code === 'module_unavailable';
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface)] px-6 text-center" role="alert">
        <AlertCircle className="mb-3 h-9 w-9 text-destructive" aria-hidden="true" />
        <h3 className="text-[14px] font-normal">
          {moduleUnavailable ? 'Módulo de automações indisponível' : 'Não foi possível carregar as automações'}
        </h3>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {moduleUnavailable
            ? 'A organização selecionada não possui acesso a este módulo.'
            : error instanceof Error ? error.message : 'Tente novamente em alguns instantes.'}
        </p>
        {!moduleUnavailable && (
          <Button type="button" variant="outline" className="mt-4" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        )}
      </div>
    );
  }

  if (!automations || automations.length === 0) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface)] px-6 py-16 text-center">
        <div className="mb-4 rounded-[8px] bg-primary/15 p-4">
          <Zap className="h-10 w-10 text-primary" />
        </div>
        <h3 className="mb-2 text-[14px] font-normal">Nenhuma automação criada</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Crie um fluxo de follow-up para testar mensagens, esperas, condições e ações automáticas.
        </p>
        {showCreateAction && (
          <Button className="mt-5 gap-2" onClick={onCreate}>
            <Plus className="h-4 w-4" />
            Nova automação
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {summariesError && (
        <div className="flex flex-col gap-2 rounded-[8px] border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between" role="alert">
          <span>As automações foram carregadas, mas as métricas de execução estão indisponíveis.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetchSummaries()} disabled={summariesFetching}>
            {summariesFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Tentar novamente
          </Button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {automations.map((automation) => {
        const stats = getExecutionStats(automation.id);
        const hasStats = stats.total > 0;
        const isClickable = canOpenEditor || !!onViewHistory;

        return (
          <div
            key={automation.id}
            className={`group relative flex min-h-[184px] overflow-hidden rounded-[8px] border border-transparent bg-[var(--app-surface)] shadow-none transition-all duration-200 ${
              isClickable ? 'cursor-pointer hover:bg-[var(--app-surface-hover)]' : ''
            } ${
              !automation.is_active ? 'opacity-50' : ''
            }`}
          >

            <div className="relative z-10 flex w-full flex-col justify-between p-4">
              <button
                type="button"
                className="flex w-full items-start justify-between gap-3 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default"
                onClick={() => handleOpenCard(automation.id)}
                disabled={!isClickable}
                aria-label={isClickable ? `${canOpenEditor ? 'Editar' : 'Ver histórico de'} ${automation.name}` : undefined}
              >
                <div className="min-w-0">
                  <Badge
                    className={`mb-3 border-0 px-2 py-0.5 text-[10px] font-medium ${
                      automation.is_active
                        ? 'bg-green-500/15 text-green-500'
                        : 'bg-[var(--app-surface-muted)] text-muted-foreground'
                    }`}
                  >
                    <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${automation.is_active ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                    {automation.is_active ? 'Ativa' : 'Inativa'}
                  </Badge>
                  <h3 className="truncate text-[14px] font-normal text-foreground">{automation.name}</h3>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {TRIGGER_TYPE_LABELS[automation.trigger_type as TriggerType] || automation.trigger_type}
                  </span>
                </div>

                <div className="rounded-[8px] bg-primary/12 p-2.5 text-primary">
                  <Zap className="h-5 w-5" />
                </div>
              </button>

              <div className="space-y-3">
                {hasStats && (
                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <span className="flex items-center gap-1 text-muted-foreground" aria-label={`${stats.completed} concluidas`}>
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      {stats.completed}
                    </span>
                    <span className="flex items-center gap-1 text-primary" aria-label={`${stats.running} em andamento`}>
                      <AlertCircle className="h-3 w-3" />
                      {stats.running}
                    </span>
                    <span className="flex items-center gap-1 text-red-500" aria-label={`${stats.failed} com erro`}>
                      <XCircle className="h-3 w-3" />
                      {stats.failed}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 border-t border-[var(--app-border)] pt-3">
                  <span className="text-[11px] text-muted-foreground">
                    {automation.created_at ? format(new Date(automation.created_at), 'dd/MM/yyyy') : 'Sem data'}
                  </span>
                  {canManage && (
                    <div className="flex items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
                <Switch
                  checked={automation.is_active}
                  onCheckedChange={(checked) => toggleAutomation.mutate({ id: automation.id, is_active: checked })}
                  disabled={toggleAutomation.isPending}
                  className="scale-75 data-[state=checked]:bg-green-500"
                  onClick={(event) => event.stopPropagation()}
                  title={automation.is_active ? 'Desativar' : 'Ativar'}
                  aria-label={`${automation.is_active ? 'Desativar' : 'Ativar'} automação ${automation.name}`}
                />
                      {stats.running > 0 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                          onClick={(event) => handleStop(automation, event)}
                          disabled={cancelExecutions.isPending}
                          title="Interromper"
                          aria-label={`Interromper execucoes de ${automation.name}`}
                        >
                          <Square className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {onViewHistory && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:bg-[var(--app-surface-hover)] hover:text-foreground"
                          onClick={(event) => {
                            event.stopPropagation();
                            onViewHistory(automation.id);
                          }}
                          title="Histórico"
                          aria-label={`Ver histórico de ${automation.name}`}
                        >
                          <History className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {canOpenEditor && (
                        <>
                <Button
                  variant="ghost"
                  size="icon"
                            className="h-7 w-7 text-muted-foreground hover:bg-[var(--app-surface-hover)] hover:text-foreground"
                  onClick={(event) => handleDuplicate(automation, event)}
                  title="Duplicar"
                  aria-label={`Duplicar automação ${automation.name}`}
                  disabled={duplicateAutomation.isPending}
                >
                            <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                  aria-label={`Excluir automação ${automation.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!deleteAutomation.isPending) {
                      setDeleteTarget({ id: automation.id, name: automation.name });
                    }
                  }}
                  disabled={deleteAutomation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
      </div>

      <AlertDialog
        open={stopTarget !== null}
        onOpenChange={(open) => {
          if (!open && !cancelExecutions.isPending) setStopTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-[440px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-5 shadow-none">
          <AlertDialogHeader className="space-y-1.5 text-left">
            <AlertDialogTitle className="text-[14px] font-medium text-[var(--app-text-primary)]">
              Interromper execuções?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
              {stopTarget
                ? `${stopTarget.running} execução(ões) ativa(s) de “${stopTarget.name}” serão interrompidas. Um envio que já começou ainda pode ser concluído.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2 sm:gap-2">
            <AlertDialogCancel disabled={cancelExecutions.isPending} className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelExecutions.isPending}
              className="h-9 rounded-[6px] bg-destructive px-3 text-[12px] font-light text-destructive-foreground shadow-none hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void confirmStop();
              }}
            >
              {cancelExecutions.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {cancelExecutions.isPending ? 'Interrompendo...' : 'Interromper execuções'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteAutomation.isPending) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-[440px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-5 shadow-none">
          <AlertDialogHeader className="space-y-1.5 text-left">
            <AlertDialogTitle className="text-[14px] font-medium text-[var(--app-text-primary)]">
              Excluir automação?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
              {deleteTarget
                ? `A automação “${deleteTarget.name}” será excluída permanentemente. Esta ação não pode ser desfeita.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2 sm:gap-2">
            <AlertDialogCancel disabled={deleteAutomation.isPending} className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteAutomation.isPending}
              className="h-9 rounded-[6px] bg-destructive px-3 text-[12px] font-light text-destructive-foreground shadow-none hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {deleteAutomation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {deleteAutomation.isPending ? 'Excluindo...' : 'Excluir automação'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
