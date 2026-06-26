import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CheckCircle2, XCircle, Clock, Play, AlertTriangle, ChevronDown, ChevronUp, StopCircle, Filter } from 'lucide-react';
import { useAutomationExecutions, useCancelExecution, useAutomations, AutomationExecution } from '@/hooks/use-automations';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
}

const getStatusConfig = (status: string) => {
  switch (status) {
    case 'completed':
      return { label: 'Concluído', icon: CheckCircle2, variant: 'default' as const, dotColor: 'bg-orange-500', badgeClass: 'bg-orange-500 text-white border-0 hover:bg-orange-500' };
    case 'replied':
      return { label: 'Concluído', icon: CheckCircle2, variant: 'default' as const, dotColor: 'bg-green-500', badgeClass: 'bg-green-500 text-white border-0 hover:bg-green-500' };
    case 'running':
      return { label: 'Executando', icon: Play, variant: 'default' as const, dotColor: 'bg-accent', badgeClass: 'bg-primary text-primary-foreground border-0' };
    case 'waiting':
      return { label: 'Aguardando', icon: Clock, variant: 'secondary' as const, dotColor: 'bg-white/[0.07]', badgeClass: '' };
    case 'failed':
      return { label: 'Falhou', icon: XCircle, variant: 'destructive' as const, dotColor: 'bg-destructive', badgeClass: '' };
    case 'cancelled':
      return { label: 'Cancelado', icon: StopCircle, variant: 'default' as const, dotColor: 'bg-red-500', badgeClass: 'bg-red-500 text-white border-0 hover:bg-red-500' };
    default:
      return { label: status, icon: AlertTriangle, variant: 'outline' as const, dotColor: 'bg-white/[0.07]', badgeClass: '' };
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

export function ExecutionHistory({ automationId: initialAutomationId }: ExecutionHistoryProps) {
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | undefined>(initialAutomationId);
  const effectiveId = selectedAutomationId || initialAutomationId;
  const { data: executions, isLoading } = useAutomationExecutions(effectiveId);
  const { data: automations } = useAutomations();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const filterSelect = (
    automations && automations.length > 0 ? (
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select
          value={selectedAutomationId || '__all__'}
          onValueChange={(v) => setSelectedAutomationId(v === '__all__' ? undefined : v)}
        >
          <SelectTrigger className="w-[260px]">
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
      <div className="space-y-4">
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

  const runningExecutions = executions.filter(e => e.status === 'running' || e.status === 'waiting');
  const completedExecutions = executions.filter(e => e.status === 'completed' || e.status === 'replied');
  const failedExecutions = executions.filter(e => e.status === 'failed' || e.status === 'cancelled');

  return (
    <div className="space-y-6">
      {filterSelect}

      {/* Stats */}
      <div className="grid gap-3 grid-cols-3">
        <Card className="app-card">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{runningExecutions.length}</p>
            <p className="text-xs text-muted-foreground">Em andamento</p>
          </CardContent>
        </Card>
        <Card className="app-card">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-primary">{completedExecutions.length}</p>
            <p className="text-xs text-muted-foreground">Concluídas</p>
          </CardContent>
        </Card>
        <Card className="app-card">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-destructive">{failedExecutions.length}</p>
            <p className="text-xs text-muted-foreground">Com erro</p>
          </CardContent>
        </Card>
      </div>

      {/* Timeline */}
      <Card className="app-card">
        <CardHeader>
          <CardTitle className="text-base">Histórico de Execuções</CardTitle>
          <CardDescription>Últimas 100 execuções • Atualiza automaticamente</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[400px]">
            <div className="relative px-6 pb-4">
              {/* Vertical timeline line */}
              <div className="absolute left-[30px] top-0 bottom-0 w-px bg-white/[0.045]" />

              {executions.map((execution) => (
                <ExecutionTimelineItem key={execution.id} execution={execution} />
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function ExecutionTimelineItem({ execution }: { execution: AutomationExecution }) {
  const [isOpen, setIsOpen] = useState(false);
  const cancelExecution = useCancelExecution();
  const statusConfig = getStatusConfig(execution.status);

  const leadName = execution.lead?.name || 'Lead desconhecido';
  const automationName = execution.automation?.name || 'Automação';
  const hasError = !!execution.error_message;
  const translatedError = execution.error_message ? translateError(execution.error_message) : '';
  const canCancel = execution.status === 'running' || execution.status === 'waiting';

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="relative flex gap-4 py-3">
        {/* Timeline dot */}
        <div className={`relative z-10 w-3 h-3 rounded-full mt-1.5 shrink-0 ${statusConfig.dotColor} ${execution.status === 'running' ? 'animate-pulse' : ''}`} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium truncate">{leadName}</span>
                <Badge variant={statusConfig.variant} className={`text-[10px] px-1.5 py-0 ${statusConfig.badgeClass || ''}`}>
                  {statusConfig.label}
                </Badge>
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
                      className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                      disabled={cancelExecution.isPending}
                    >
                      <StopCircle className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Interromper automação?</AlertDialogTitle>
                      <AlertDialogDescription>
                        As mensagens pendentes não serão enviadas.
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

              {hasError && (
                <CollapsibleTrigger asChild>
                  <button className="rounded p-1 hover:bg-white/[0.055]">
                    {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
              )}
            </div>
          </div>

          {hasError && (
            <CollapsibleContent>
              <div className="mt-2 bg-destructive/10 border border-destructive/20 rounded-xl p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                  <div className="space-y-1 min-w-0">
                    <p className="text-xs font-medium text-destructive">{translatedError}</p>
                    {execution.error_message !== translatedError && (
                      <details className="text-[10px] text-muted-foreground">
                        <summary className="cursor-pointer hover:text-foreground">Detalhes técnicos</summary>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-white/[0.055] p-2 text-[10px]">
                          {execution.error_message}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          )}
        </div>
      </div>
    </Collapsible>
  );
}
