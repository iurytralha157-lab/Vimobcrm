import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
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
  useDeleteAutomation,
  useDuplicateAutomation,
  useToggleAutomation,
} from '@/hooks/use-automations';
import { usePipelines, useStages } from '@/hooks/use-stages';
import { useTags } from '@/hooks/use-tags';
import { format } from 'date-fns';

interface AutomationListProps {
  onEdit: (automationId: string) => void;
  onViewHistory?: (automationId: string) => void;
  canManage?: boolean;
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

export function AutomationList({ onEdit, onViewHistory, canManage = true }: AutomationListProps) {
  const { data: automations, isLoading } = useAutomations();
  const { data: executions } = useAutomationExecutions();
  const deleteAutomation = useDeleteAutomation();
  const toggleAutomation = useToggleAutomation();
  const duplicateAutomation = useDuplicateAutomation();

  const getExecutionStats = (automationId: string) => {
    const automationExecutions = executions?.filter((execution) => execution.automation_id === automationId) || [];
    return {
      running: automationExecutions.filter((execution) => execution.status === 'running' || execution.status === 'waiting').length,
      completed: automationExecutions.filter((execution) => execution.status === 'completed').length,
      failed: automationExecutions.filter((execution) => execution.status === 'failed').length,
    };
  };

  const handleDuplicate = (automation: Automation, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!canManage) return;
    duplicateAutomation.mutate(automation.id);
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
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 rounded-xl bg-primary/15 p-4">
          <Zap className="h-10 w-10 text-primary" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Nenhuma automacao criada</h3>
        <p className="text-muted-foreground text-sm max-w-sm">
          Va para a aba Modelos para criar sua primeira automacao a partir de templates prontos
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {automations.map((automation) => {
        const stats = getExecutionStats(automation.id);
        const hasStats = stats.running > 0 || stats.completed > 0 || stats.failed > 0;

        return (
          <div
            key={automation.id}
            className={`group app-card card-hover relative flex aspect-[4/3] cursor-pointer items-center justify-center overflow-hidden rounded-lg transition-all duration-200 hover:border-primary/70 hover:bg-primary/90 ${
              !automation.is_active ? 'opacity-50' : ''
            }`}
            onClick={() => (canManage ? onEdit(automation.id) : onViewHistory?.(automation.id))}
          >
            <div className="flex flex-col items-center justify-center p-4 text-center w-full relative z-10">
              <div className="relative mb-2">
                <div className={`rounded-lg p-2.5 transition-all duration-200 group-hover:scale-110 group-hover:bg-white/20 ${automation.is_active ? 'bg-primary/15' : 'bg-white/[0.055]'}`}>
                  <Zap className={`h-6 w-6 group-hover:text-white ${automation.is_active ? 'text-primary' : 'text-muted-foreground'}`} />
                </div>
                {stats.running > 0 && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-primary rounded-full animate-pulse" />
                )}
              </div>

              <h3 className="font-semibold text-xs mb-0.5 truncate max-w-full text-foreground group-hover:text-white">{automation.name}</h3>

              <span className="text-[10px] text-muted-foreground group-hover:text-white/70 mb-0.5">
                {TRIGGER_TYPE_LABELS[automation.trigger_type as TriggerType] || automation.trigger_type}
              </span>

              {hasStats && (
                <div className="flex items-center gap-1.5 text-[10px] mb-0.5">
                  {stats.completed > 0 && (
                    <span className="flex items-center gap-0.5 text-muted-foreground group-hover:text-white/80">
                      <CheckCircle2 className="h-2.5 w-2.5 text-green-400 group-hover:text-white/80" />
                      {stats.completed}
                    </span>
                  )}
                  {stats.running > 0 && (
                    <span className="flex items-center gap-0.5 text-primary group-hover:text-white/80">
                      <AlertCircle className="h-2.5 w-2.5" />
                      {stats.running}
                    </span>
                  )}
                  {stats.failed > 0 && (
                    <span className="flex items-center gap-0.5 text-red-400 group-hover:text-white/80">
                      <XCircle className="h-2.5 w-2.5" />
                      {stats.failed}
                    </span>
                  )}
                </div>
              )}

              {automation.created_at && (
                <span className="text-[9px] text-muted-foreground/60 group-hover:text-white/50">
                  {format(new Date(automation.created_at), 'dd/MM/yyyy')}
                </span>
              )}
            </div>

            {canManage && (
              <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-20" onClick={(event) => event.stopPropagation()}>
                <Switch
                  checked={automation.is_active}
                  onCheckedChange={(checked) => toggleAutomation.mutate({ id: automation.id, is_active: checked })}
                  className="scale-75 data-[state=checked]:bg-green-500"
                  onClick={(event) => event.stopPropagation()}
                  title={automation.is_active ? 'Desativar' : 'Ativar'}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-white/80 hover:text-white hover:bg-white/20"
                  onClick={(event) => handleDuplicate(automation, event)}
                  title="Duplicar"
                >
                  <Copy className="h-3 w-3" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-white/80 hover:text-white hover:bg-white/20">
                      <Trash2 className="h-3 w-3" />
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
              </div>
            )}

            <Badge
              className={`absolute top-1.5 left-1.5 text-[10px] px-2 py-0.5 font-medium border-0 ${
                automation.is_active
                  ? 'bg-green-500 text-white'
                  : 'bg-white/[0.055] text-muted-foreground group-hover:bg-white/20 group-hover:text-white'
              }`}
            >
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${automation.is_active ? 'bg-white' : 'bg-muted-foreground'}`} />
              {automation.is_active ? 'Ativo' : 'Inativo'}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}
