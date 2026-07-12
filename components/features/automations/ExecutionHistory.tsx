import { useState, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CheckCircle2, XCircle, Clock, Play, AlertTriangle, ChevronDown, ChevronUp, StopCircle, Filter } from 'lucide-react';
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
        icon: CheckCircle2,
        dotColor: 'bg-emerald-500',
        badgeClass: 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/10',
      };
    case 'running':
      return {
        label: 'Executando',
        icon: Play,
        dotColor: 'bg-sky-500',
        badgeClass: 'bg-sky-500/10 text-sky-500 border border-sky-500/20 hover:bg-sky-500/10',
      };
    case 'queued':
      return {
        label: 'Na fila',
        icon: Clock,
        dotColor: 'bg-sky-500',
        badgeClass: 'bg-sky-500/10 text-sky-500 border border-sky-500/20 hover:bg-sky-500/10',
      };
    case 'waiting':
      return {
        label: 'Aguardando',
        icon: Clock,
        dotColor: 'bg-amber-500',
        badgeClass: 'bg-amber-500/10 text-amber-500 border border-amber-500/20 hover:bg-amber-500/10',
      };
    case 'failed':
      return {
        label: 'Falhou',
        icon: XCircle,
        dotColor: 'bg-red-500',
        badgeClass: 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/10',
      };
    case 'cancelled':
      return {
        label: 'Cancelado',
        icon: StopCircle,
        dotColor: 'bg-neutral-500',
        badgeClass: 'bg-neutral-500/10 text-neutral-500 border border-neutral-500/20 hover:bg-neutral-500/10',
      };
    default:
      return {
        label: status,
        icon: AlertTriangle,
        dotColor: 'bg-neutral-500',
        badgeClass: 'bg-neutral-500/10 text-neutral-500 border border-neutral-500/20 hover:bg-neutral-500/10',
      };
  }
};

function translateError(error: string): string {
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
  const { data: executions, isLoading, isFetching, error, refetch } = useAutomationExecutions(selectedAutomationId, limit);
  const { data: automations, error: automationsError, refetch: refetchAutomations } = useAutomations();

  const filteredExecutions = useMemo(() => {
    if (!executions) return [];
    return executions.filter((e) => {
      const status = normalizeExecutionStatus(e.status);
      if (statusFilter === 'running') {
        return status === 'queued' || status === 'running' || status === 'waiting';
      }
      if (statusFilter === 'completed') {
        return status === 'completed';
      }
      if (statusFilter === 'failed') {
        return status === 'failed';
      }
      if (statusFilter === 'cancelled') {
        return status === 'cancelled';
      }
      return true;
    });
  }, [executions, statusFilter]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || automationsError) {
    const message = error instanceof Error
      ? error.message
      : automationsError instanceof Error ? automationsError.message : 'Tente novamente em alguns instantes.';
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center rounded-[8px] bg-[var(--app-surface)] px-6 text-center" role="alert">
        <AlertTriangle className="mb-3 h-9 w-9 text-destructive" aria-hidden="true" />
        <h3 className="text-base font-semibold">Não foi possível carregar o histórico</h3>
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

  const filterSelect = (
    automations && automations.length > 0 ? (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Select
          value={selectedAutomationId || '__all__'}
          onValueChange={(v) => setSelectedAutomationId(v === '__all__' ? undefined : v)}
        >
          <SelectTrigger className="min-w-0 flex-1 sm:w-[260px] sm:flex-none" aria-label="Filtrar por automação">
            <SelectValue placeholder="Todas as automações" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas as automações</SelectItem>
            {automations.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedAutomationId && (
          <Button variant="ghost" size="sm" onClick={() => setSelectedAutomationId(undefined)}>
            Limpar
          </Button>
        )}
      </div>
    ) : null
  );

  if (!executions || executions.length === 0) {
    return (
      <div className="space-y-4 animate-in">
        {filterSelect}
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 rounded-xl bg-white/[0.055] p-4">
            <Clock className="h-10 w-10 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Nenhuma execução ainda</h3>
          <p className="text-muted-foreground text-sm">
            As execuções aparecerão aqui quando as automações forem disparadas
          </p>
        </div>
      </div>
    );
  }

  const runningExecutions = executions.filter((execution) => ['queued', 'running', 'waiting'].includes(normalizeExecutionStatus(execution.status)));
  const completedExecutions = executions.filter((execution) => normalizeExecutionStatus(execution.status) === 'completed');
  const cancelledExecutions = executions.filter((execution) => normalizeExecutionStatus(execution.status) === 'cancelled');
  const failedOnlyExecutions = executions.filter((execution) => normalizeExecutionStatus(execution.status) === 'failed');

  return (
    <div className="space-y-6 animate-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {filterSelect}

        <div className="flex flex-wrap items-center gap-2 self-start sm:justify-end">
          <Select value={String(limit)} onValueChange={(value) => setLimit(Number(value))}>
            <SelectTrigger className="h-9 w-[150px]" aria-label="Quantidade de execuções">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="50">Últimas 50</SelectItem>
              <SelectItem value="100">Últimas 100</SelectItem>
              <SelectItem value="200">Últimas 200</SelectItem>
            </SelectContent>
          </Select>

          {/* Segmented status filters */}
          <div className="flex max-w-full flex-wrap items-center gap-1 rounded-[8px] bg-[var(--app-surface-soft)] p-1">
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
                onClick={() => setStatusFilter(key)}
                className={cn(
                  "h-8 rounded-[6px] px-3 text-xs font-medium transition-all",
                  isActive
                    ? "bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] shadow-none"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            );
          })}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="overflow-hidden rounded-[8px] border border-transparent bg-[var(--app-surface)] shadow-none">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{runningExecutions.length}</p>
            <p className="text-xs text-muted-foreground">Em andamento</p>
          </CardContent>
        </Card>
        <Card className="overflow-hidden rounded-[8px] border border-transparent bg-[var(--app-surface)] shadow-none">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-primary">{completedExecutions.length}</p>
            <p className="text-xs text-muted-foreground">Concluídas</p>
          </CardContent>
        </Card>
        <Card className="overflow-hidden rounded-[8px] border border-transparent bg-[var(--app-surface)] shadow-none">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-destructive">{failedOnlyExecutions.length}</p>
            <p className="text-xs text-muted-foreground">Falhas</p>
          </CardContent>
        </Card>
        <Card className="overflow-hidden rounded-[8px] border border-transparent bg-[var(--app-surface)] shadow-none">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-muted-foreground">{cancelledExecutions.length}</p>
            <p className="text-xs text-muted-foreground">Canceladas</p>
          </CardContent>
        </Card>
      </div>

      {/* Timeline */}
      <Card className="overflow-hidden rounded-[8px] border border-transparent bg-[var(--app-surface)] shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Histórico de Execuções</CardTitle>
          <CardDescription>
            Até {limit} execuções mais recentes {isFetching ? '• atualizando...' : '• atualização automática enquanto houver execuções ativas'}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[400px]">
            <div className="relative px-6 pb-4">
              {/* Vertical timeline line */}
              <div className="absolute left-[30px] top-0 bottom-0 w-px bg-[var(--app-border)]" />

              {filteredExecutions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <p className="text-sm text-muted-foreground">Nenhuma execução correspondente ao filtro selecionado.</p>
                </div>
              ) : (
                filteredExecutions.map((execution) => (
                  <ExecutionTimelineItem key={execution.id} execution={execution} canManage={canManage} />
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function ExecutionTimelineItem({ execution, canManage }: { execution: AutomationExecution; canManage: boolean }) {
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
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="relative flex gap-4 py-3">
        {/* Timeline dot */}
        <div className={cn(
          "relative z-10 w-3 h-3 rounded-full mt-1.5 shrink-0",
          statusConfig.dotColor,
          execution.status === 'running' && "animate-pulse"
        )} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium truncate">{leadName}</span>
                <span className={`inline-flex items-center gap-1 rounded-[4px] px-2 py-0.5 text-[10px] font-medium leading-none ${statusConfig.badgeClass}`}>
                  {statusConfig.label}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{automationName}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {formatDistanceToNow(new Date(execution.started_at), { addSuffix: true, locale: ptBR })}
                {execution.next_execution_at && execution.status === 'waiting' && (
                  <span className="ml-2 text-accent-foreground">
                    • Próximo: {formatDistanceToNow(new Date(execution.next_execution_at), { addSuffix: true, locale: ptBR })}
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
                      className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10 animate-pulse"
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
                <button
                  type="button"
                  className="rounded p-1 hover:bg-white/[0.055]"
                  aria-label={`${isOpen ? 'Ocultar' : 'Mostrar'} passos da execução de ${leadName}`}
                  aria-expanded={isOpen}
                >
                  {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>
              </CollapsibleTrigger>
            </div>
          </div>

          <CollapsibleContent>
            <div className="mt-2 rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface-soft)] p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold">Passos executados</p>
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
        </div>
      </div>
    </Collapsible>
  );
}
