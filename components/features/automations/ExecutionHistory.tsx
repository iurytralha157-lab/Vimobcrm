import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertTriangle, ChevronDown, ChevronUp, StopCircle } from 'lucide-react';
import {
  useAutomationExecutions,
  useAutomationExecutionSteps,
  useCancelExecution,
  useAutomations,
  type AutomationExecution,
} from '@/hooks/use-automations';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
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

interface ExecutionHistoryProps {
  automationId?: string;
  canManage?: boolean;
}

function normalizeExecutionStatus(status: string) {
  if (status === 'canceled') return 'cancelled';
  if (status === 'replied') return 'completed';
  if (status === 'succeeded') return 'completed';
  return status;
}

const getStatusConfig = (status: string) => {
  switch (normalizeExecutionStatus(status)) {
    case 'completed':
      return {
        label: 'Concluído',
        badgeClass: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      };
    case 'running':
      return {
        label: 'Executando',
        badgeClass: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
      };
    case 'queued':
      return {
        label: 'Na fila',
        badgeClass: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
      };
    case 'waiting':
      return {
        label: 'Aguardando',
        badgeClass: 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
      };
    case 'failed':
      return {
        label: 'Falhou',
        badgeClass: 'bg-red-500/10 text-red-700 dark:text-red-300',
      };
    case 'cancelled':
      return {
        label: 'Cancelado',
        badgeClass: 'bg-muted text-muted-foreground',
      };
    default:
      return {
        label: status,
        badgeClass: 'bg-muted text-muted-foreground',
      };
  }
};

function translateError(error: string): string {
  if (error === 'automation_queue_destination_unavailable') return 'A fila de distribuição não está mais disponível.';
  if (error === 'automation_queue_protected') return 'O lead está protegido ou já pertence a outra fila. O responsável foi mantido.';
  if (error === 'automation_queue_same_owner') return 'A fila não atribuiu um novo responsável. O responsável foi mantido.';
  if (error === 'automation_queue_unavailable') return 'A fila não pôde atribuir o lead neste momento. O responsável foi mantido.';
  if (error === 'automation_actor_forbidden') return 'O autor do fluxo não tem permissão para executar esta ação no lead.';
  if (error === 'automation_command_unavailable') return 'O serviço de ações de CRM está indisponível.';
  const reason = error.split(':').find((part) => part.startsWith('automation_whatsapp_'));
  if (reason === 'automation_whatsapp_attendance_required') return 'Esta execução foi bloqueada pela regra anterior de atendimento do WhatsApp.';
  if (reason === 'automation_whatsapp_session_access_denied') return 'A versão publicada do fluxo não tem permissão para enviar pelo WhatsApp configurado.';
  if (error.includes("exists") && error.includes("false")) return "Número WhatsApp inválido ou não cadastrado";
  if (error.includes("Connection refused") || error.includes("ECONNREFUSED")) return "Falha na conexão com WhatsApp";
  if (error.includes("timeout") || error.includes("ETIMEDOUT")) return "Tempo limite excedido";
  if (error.includes("not connected")) return "Sessão WhatsApp desconectada";
  if (error.includes("Node not found")) return "Nó de automação não encontrado";
  if (error.includes("Failed to send WhatsApp")) {
    const match = error.match(/Failed to send WhatsApp: (.+)/);
    if (match) {
      try {
        const details = JSON.parse(match[1]);
        if (details.status === "error" && details.message) return `Erro WhatsApp: ${details.message}`;
      } catch {
        if (error.includes("exists")) return "Número WhatsApp inválido ou não cadastrado";
      }
    }
    return "Falha ao enviar mensagem WhatsApp";
  }
  return error;
}

const EXECUTION_STEP_LABELS: Record<string, string> = {
  send_whatsapp: 'Enviar mensagem no WhatsApp',
  send_image: 'Enviar imagem',
  send_audio: 'Enviar áudio',
  send_video: 'Enviar vídeo',
  webhook: 'Chamar webhook',
  add_tag: 'Adicionar tag',
  remove_tag: 'Remover tag',
  move_lead: 'Mover lead de etapa',
  assign_user: 'Alterar responsável',
  distribute_lead: 'Enviar para distribuição',
  set_variable: 'Atualizar dado do lead',
  trigger: 'Gatilho',
  condition: 'Condição',
  delay: 'Espera',
};

function getExecutionStepLabel(nodeType: string, actionType: string | null) {
  return EXECUTION_STEP_LABELS[actionType || nodeType] || actionType || nodeType;
}

function getStepStatusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: 'Na fila',
    running: 'Executando',
    waiting: 'Aguardando',
    completed: 'Concluído',
    failed: 'Falhou',
    skipped: 'Ignorado',
    cancelled: 'Cancelado',
    canceled: 'Cancelado',
  };
  const normalized = normalizeExecutionStatus(status);
  return labels[normalized] || normalized;
}

function getStepStatusClass(status: string) {
  const normalized = normalizeExecutionStatus(status);
  if (normalized === 'completed') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (normalized === 'failed') return 'bg-destructive/10 text-destructive';
  if (normalized === 'running' || normalized === 'queued') return 'bg-sky-500/10 text-sky-600 dark:text-sky-400';
  if (normalized === 'waiting') return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
  return 'bg-muted text-muted-foreground';
}

export function ExecutionHistory({ automationId: initialAutomationId, canManage = false }: ExecutionHistoryProps) {
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | undefined>(initialAutomationId);
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'completed' | 'failed' | 'cancelled'>('all');
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const invalidRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const { data: executions = [], isLoading, isFetching, error, refetch } = useAutomationExecutions(selectedAutomationId, limit, {
    status: statusFilter === 'all' ? undefined : statusFilter,
    offset,
    dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
    dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999`).toISOString() : undefined,
    enabled: !invalidRange,
  });
  const { data: automations, error: automationsError, refetch: refetchAutomations } = useAutomations();

  if (error || automationsError) {
    const message = error instanceof Error
      ? error.message
      : automationsError instanceof Error ? automationsError.message : 'Tente novamente em alguns instantes.';
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center rounded-[8px] bg-[var(--app-surface)] px-6 text-center" role="alert">
        <AlertTriangle className="mb-3 h-9 w-9 text-destructive" aria-hidden="true" />
        <h3 className="text-[14px] font-normal">Não foi possível carregar o histórico</h3>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{message}</p>
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          onClick={() => void Promise.all([refetch(), refetchAutomations()])}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  const runningExecutions = executions.filter((execution) => ['queued', 'running', 'waiting'].includes(normalizeExecutionStatus(execution.status)));
  const completedExecutions = executions.filter((execution) => normalizeExecutionStatus(execution.status) === 'completed');
  const cancelledExecutions = executions.filter((execution) => normalizeExecutionStatus(execution.status) === 'cancelled');
  const failedOnlyExecutions = executions.filter((execution) => normalizeExecutionStatus(execution.status) === 'failed');
  const page = Math.floor(offset / limit) + 1;
  const filtersApplied = Boolean(selectedAutomationId || dateFrom || dateTo || statusFilter !== 'all');

  return (
    <section aria-labelledby="automation-executions-title" className="@container overflow-hidden rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface)]">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3 p-4 sm:p-5">
        <div className="flex min-h-9 basis-full items-center gap-2 @min-[1200px]:shrink-0 @min-[1200px]:basis-auto">
          <h2 id="automation-executions-title" className="text-base font-medium">Histórico de execuções</h2>
          {isFetching && !isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Atualizando execuções" />}
        </div>

        <div role="group" aria-label="Filtros de execuções" className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
          <div className="grid basis-full grid-cols-2 gap-2 @min-[570px]:basis-auto @min-[570px]:grid-flow-col @min-[570px]:grid-cols-none @min-[570px]:items-end">
            {automations && automations.length > 0 && (
              <div className="col-span-2 min-w-0 @min-[570px]:col-span-1 @min-[570px]:w-52">
                <label htmlFor="automation-history-flow" className="mb-1 block text-xs font-medium text-muted-foreground">Automação</label>
                <Select value={selectedAutomationId || '__all__'} onValueChange={(value) => { setSelectedAutomationId(value === '__all__' ? undefined : value); setOffset(0); }}>
                  <SelectTrigger id="automation-history-flow" className="h-9 w-full" aria-label="Filtrar por automação">
                    <SelectValue placeholder="Todas as automações" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todas as automações</SelectItem>
                    {automations.map((automation) => <SelectItem key={automation.id} value={automation.id}>{automation.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <label className="min-w-0 text-xs font-medium text-muted-foreground @min-[570px]:w-36">
              De
              <Input type="date" aria-label="Início do período de execuções" value={dateFrom} max={dateTo || undefined} onChange={event => { setDateFrom(event.target.value); setOffset(0); }} className="mt-1 h-9 min-w-0 px-3 py-0" />
            </label>
            <label className="min-w-0 text-xs font-medium text-muted-foreground @min-[570px]:w-36">
              Até
              <Input type="date" aria-label="Fim do período de execuções" value={dateTo} min={dateFrom || undefined} onChange={event => { setDateTo(event.target.value); setOffset(0); }} className="mt-1 h-9 min-w-0 px-3 py-0" />
            </label>
          </div>

          <div role="group" aria-label="Status das execuções" className="flex w-fit max-w-full flex-wrap gap-1 rounded-[8px] bg-[var(--app-surface-soft)] px-1 py-0.5">
            {([
              ['all', 'Todas'],
              ['running', 'Em execução'],
              ['completed', 'Concluídas'],
              ['failed', 'Falhas'],
              ['cancelled', 'Canceladas'],
            ] as const).map(([key, label]) => {
              const isActive = statusFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setStatusFilter(key); setOffset(0); }}
                  aria-pressed={isActive}
                  className={cn(
                    "h-8 rounded-[6px] px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground",
                    isActive
                      ? "bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {filtersApplied && (
            <Button variant="ghost" size="sm" onClick={() => { setSelectedAutomationId(undefined); setDateFrom(''); setDateTo(''); setStatusFilter('all'); setOffset(0); }}>
              Limpar filtros
            </Button>
          )}
        </div>
        {invalidRange && <p role="alert" className="basis-full text-xs text-destructive">A data final deve ser igual ou posterior à inicial.</p>}
      </div>

      {!invalidRange && (isLoading ? (
        <div role="status" className="flex items-center justify-center gap-2 border-t border-[var(--app-border)] px-4 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Carregando execuções...
        </div>
      ) : (
        <>
          <dl aria-label="Resumo desta página" className="grid grid-cols-2 gap-3 border-y border-[var(--app-border)] bg-[var(--app-surface-soft)] px-4 py-3 sm:grid-cols-4 sm:px-5">
            {[
              ['Em andamento', runningExecutions.length],
              ['Concluídas', completedExecutions.length],
              ['Falhas', failedOnlyExecutions.length],
              ['Canceladas', cancelledExecutions.length],
            ].map(([label, count]) => (
              <div key={label} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-semibold tabular-nums">{count}</dd>
              </div>
            ))}
          </dl>

          {executions.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              {filtersApplied ? 'Nenhuma execução encontrada com esses filtros.' : 'Nenhuma execução registrada.'}
            </p>
          ) : (
            <ScrollArea className="h-[400px]">
              <ul className="divide-y divide-[var(--app-border)]">
                {executions.map((execution) => (
                  <li key={execution.id}>
                    <ExecutionRow execution={execution} canManage={canManage && !isFetching} />
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--app-border)] p-4 sm:px-5">
            <p className="text-xs text-muted-foreground">Página {page} · {executions.length} {executions.length === 1 ? 'execução' : 'execuções'}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={String(limit)} onValueChange={(value) => { setLimit(Number(value)); setOffset(0); }}>
                <SelectTrigger className="h-8 w-[128px] text-xs" aria-label="Quantidade de execuções">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">50 por página</SelectItem>
                  <SelectItem value="100">100 por página</SelectItem>
                  <SelectItem value="200">200 por página</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" disabled={offset === 0 || isFetching} onClick={() => setOffset(value => Math.max(0, value - limit))}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={executions.length < limit || isFetching || offset + limit > 100000} onClick={() => setOffset(value => value + limit)}>Próxima</Button>
            </div>
          </div>
        </>
      ))}
    </section>
  );
}

function ExecutionRow({ execution, canManage }: { execution: AutomationExecution; canManage: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [stepPage, setStepPage] = useState(0);
  const cancelExecution = useCancelExecution();
  const statusConfig = getStatusConfig(execution.status);

  const leadName = execution.lead?.name || 'Lead desconhecido';
  const automationName = execution.automation?.name || 'Automação';
  const hasError = !!execution.error_message;
  const translatedError = execution.error_message ? translateError(execution.error_message) : '';
  const normalizedStatus = normalizeExecutionStatus(execution.status);
  const isExecutionActive = normalizedStatus === 'queued' || normalizedStatus === 'running' || normalizedStatus === 'waiting';
  const canCancel = canManage && isExecutionActive;
  const stepPageSize = 50;
  const stepsQuery = useAutomationExecutionSteps(execution.id, {
    enabled: isOpen,
    limit: stepPageSize,
    offset: stepPage * stepPageSize,
    isExecutionActive,
  });

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="px-4 py-3 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{leadName}</span>
            <span className={cn('rounded-[4px] px-2 py-0.5 text-xs font-medium leading-tight', statusConfig.badgeClass)}>
              {statusConfig.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{automationName}</p>
          <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            <time dateTime={execution.started_at}>{formatDistanceToNow(new Date(execution.started_at), { addSuffix: true, locale: ptBR })}</time>
            {execution.next_execution_at && normalizedStatus === 'waiting' && (
              <span>
                Próximo passo <time dateTime={execution.next_execution_at}>{formatDistanceToNow(new Date(execution.next_execution_at), { addSuffix: true, locale: ptBR })}</time>
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {canCancel && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={cancelExecution.isPending}
                  aria-label={`Interromper automação para ${leadName}`}
                >
                  <StopCircle className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="vimob-dialog-content">
                <AlertDialogHeader>
                  <AlertDialogTitle>Interromper automação?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Novas etapas serão interrompidas. Um envio que já esteja em andamento ainda pode ser concluído.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => cancelExecution.mutate(execution.id)}
                    className="bg-destructive hover:bg-destructive/90"
                  >
                    Confirmar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={`${isOpen ? 'Ocultar' : 'Mostrar'} passos da execução de ${leadName}`}
            >
              {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </Button>
          </CollapsibleTrigger>
        </div>
      </div>

      <CollapsibleContent>
        <div className="mt-2 rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface-soft)] p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] font-normal">Passos executados</p>
            {stepsQuery.isFetching && !stepsQuery.isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Atualizando passos" />}
          </div>
          {stepsQuery.isLoading ? (
            <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando passos...
            </div>
          ) : stepsQuery.error ? (
            <div className="py-3 text-xs text-destructive" role="alert">
              <p>{stepsQuery.error.message}</p>
              <Button type="button" size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => void stepsQuery.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : !stepsQuery.data || stepsQuery.data.length === 0 ? (
            <p className="py-4 text-xs text-muted-foreground">
              {stepPage === 0 ? 'Nenhum passo registrado para esta execução.' : 'Não há mais passos nesta página.'}
            </p>
          ) : (
            <ol className="mt-3 space-y-2">
              {stepsQuery.data.map((step) => (
                <li key={step.id} className="rounded-md bg-background/70 p-2.5 text-xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{getExecutionStepLabel(step.node_type, step.action_type)}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(step.started_at), { addSuffix: true, locale: ptBR })}
                        {step.attempt > 1 ? ` • tentativa ${step.attempt}` : ''}
                      </p>
                    </div>
                    <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', getStepStatusClass(step.status))}>
                      {getStepStatusLabel(step.status)}
                    </span>
                  </div>
                  {step.error_message && <p className="mt-2 break-words text-[11px] text-destructive">{translateError(step.error_message)}</p>}
                </li>
              ))}
            </ol>
          )}
          {(stepPage > 0 || (stepsQuery.data?.length ?? 0) === stepPageSize) && (
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--app-border)] pt-2">
              <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={stepPage === 0} onClick={() => setStepPage((page) => Math.max(0, page - 1))}>
                Anterior
              </Button>
              <span className="text-[10px] text-muted-foreground">Página {stepPage + 1}</span>
              <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={(stepsQuery.data?.length ?? 0) < stepPageSize} onClick={() => setStepPage((page) => page + 1)}>
                Próxima
              </Button>
            </div>
          )}
        </div>

        {hasError && (
          <div className="mt-2 bg-red-500/10 border border-red-500/20 rounded-[8px] p-3 text-left">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
              <div className="space-y-1 min-w-0">
                <p className="text-xs font-medium text-red-600 dark:text-red-400">{translatedError}</p>
                {execution.error_message !== translatedError && (
                  <details className="text-[10px] text-muted-foreground mt-1">
                    <summary className="cursor-pointer hover:text-foreground outline-none">Detalhes técnicos</summary>
                    <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all rounded-[6px] bg-[var(--app-surface-soft)] p-2 text-[10px] text-muted-foreground border border-[var(--app-border)]">
                      {execution.error_message}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
