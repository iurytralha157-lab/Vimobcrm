import type { MouseEvent } from 'react';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Automation,
  TriggerType,
  TRIGGER_TYPE_LABELS,
  useAutomationExecutions,
  useAutomations,
  useCancelExecution,
  useDeleteAutomation,
  useDuplicateAutomation,
  useToggleAutomation,
} from '@/hooks/use-automations';
import { usePipelines, useStages } from '@/hooks/use-stages';
import { useTags } from '@/hooks/use-tags';
import { useIsMobile } from '@/hooks/use-mobile';
import { format } from 'date-fns';

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
  const { data: automations, isLoading } = useAutomations();
  const { data: executions } = useAutomationExecutions();
  const deleteAutomation = useDeleteAutomation();
  const toggleAutomation = useToggleAutomation();
  const duplicateAutomation = useDuplicateAutomation();
  const cancelExecution = useCancelExecution();
  const canOpenEditor = canManage && allowEditing && !isMobile;
  const showCreateAction = canCreate && canOpenEditor && onCreate;

  const getExecutionStats = (automationId: string) => {
    const automationExecutions = executions?.filter((execution) => execution.automation_id === automationId) || [];
    return {
      running: automationExecutions.filter((execution) => execution.status === 'running' || execution.status === 'waiting').length,
      completed: automationExecutions.filter((execution) => execution.status === 'completed').length,
      failed: automationExecutions.filter((execution) => execution.status === 'failed').length,
    };
  };

  const getActiveExecutions = (automationId: string) =>
    executions?.filter(
      (execution) =>
        execution.automation_id === automationId &&
        (execution.status === 'running' || execution.status === 'waiting'),
    ) || [];

  const handleDuplicate = (automation: Automation, event: MouseEvent) => {
    event.stopPropagation();
    if (!canOpenEditor) return;
    duplicateAutomation.mutate(automation.id);
  };

  const handleStop = (automationId: string, event: MouseEvent) => {
    event.stopPropagation();
    if (!canManage) return;
    getActiveExecutions(automationId).forEach((execution) => {
      cancelExecution.mutate(execution.id);
    });
  };

  const handleOpenCard = (automationId: string) => {
    if (canOpenEditor) {
      onEdit(automationId);
      return;
    }

    if (!isMobile) onViewHistory?.(automationId);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!automations || automations.length === 0) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface)] px-6 py-16 text-center">
        <div className="mb-4 rounded-[8px] bg-primary/15 p-4">
          <Zap className="h-10 w-10 text-primary" />
        </div>
        <h3 className="mb-2 text-base font-semibold">Nenhuma automacao criada</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Crie um fluxo de follow-up para testar mensagens, esperas, condicoes e acoes automaticas.
        </p>
        {showCreateAction && (
          <Button className="mt-5 gap-2" onClick={onCreate}>
            <Plus className="h-4 w-4" />
            Nova automacao
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {automations.map((automation) => {
        const stats = getExecutionStats(automation.id);
        const hasStats = stats.running > 0 || stats.completed > 0 || stats.failed > 0;
        const activeExecutions = getActiveExecutions(automation.id);
        const isClickable = canOpenEditor || (!isMobile && !!onViewHistory);

        return (
          <div
            key={automation.id}
            className={`group relative flex min-h-[184px] overflow-hidden rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface)] shadow-[0_14px_32px_rgb(0_0_0/0.08)] transition-all duration-200 ${
              isClickable ? 'cursor-pointer hover:border-primary/60 hover:bg-[var(--app-surface-hover)]' : ''
            } ${
              !automation.is_active ? 'opacity-50' : ''
            }`}
            onClick={() => handleOpenCard(automation.id)}
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-orange-400 to-transparent opacity-80" />

            <div className="relative z-10 flex w-full flex-col justify-between p-4">
              <div className="flex items-start justify-between gap-3">
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
                  <h3 className="truncate text-sm font-semibold text-foreground">{automation.name}</h3>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {TRIGGER_TYPE_LABELS[automation.trigger_type as TriggerType] || automation.trigger_type}
                  </span>
                </div>

                <div className="rounded-[8px] bg-primary/12 p-2.5 text-primary">
                  <Zap className="h-5 w-5" />
                </div>
              </div>

              <div className="space-y-3">
                {hasStats && (
                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      {stats.completed}
                    </span>
                    <span className="flex items-center gap-1 text-primary">
                      <AlertCircle className="h-3 w-3" />
                      {stats.running}
                    </span>
                    <span className="flex items-center gap-1 text-red-500">
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
                        className="scale-75 data-[state=checked]:bg-green-500"
                  onClick={(event) => event.stopPropagation()}
                  title={automation.is_active ? 'Desativar' : 'Ativar'}
                />
                      {activeExecutions.length > 0 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                          onClick={(event) => handleStop(automation.id, event)}
                          disabled={cancelExecution.isPending}
                          title="Interromper"
                        >
                          <Square className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {!isMobile && onViewHistory && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:bg-[var(--app-surface-hover)] hover:text-foreground"
                          onClick={(event) => {
                            event.stopPropagation();
                            onViewHistory(automation.id);
                          }}
                          title="Historico"
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
                >
                            <Copy className="h-3.5 w-3.5" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-red-500/10 hover:text-red-500">
                                <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Excluir automacao?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta acao nao pode ser desfeita. A automacao &quot;{automation.name}&quot; sera excluida permanentemente.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteAutomation.mutate(automation.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Excluir
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
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
  );
}
