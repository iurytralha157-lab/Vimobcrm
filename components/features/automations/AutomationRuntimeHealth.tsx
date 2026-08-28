'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  useAutomationRuntimeIssues,
  useRetryAutomationRuntimeIssue,
} from '@/hooks/use-automations';
import type { AutomationRuntimeIssue, AutomationRuntimeIssueKind } from '@/lib/api/automations';

const PAGE_SIZE = 50;

const ISSUE_LABELS: Record<AutomationRuntimeIssueKind, string> = {
  dead_letter: 'Gatilho esgotado',
  failed_event: 'Gatilho com falha',
  failed_effect: 'Mensagem automatica nao entregue',
  circuit_decision: 'Circuito interrompido',
  duplicate_decision: 'Execução duplicada evitada',
  ambiguous_effect: 'Efeito externo ambíguo',
  circuit_open: 'Circuito aberto',
};

function formatOccurredAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function summaryValue(label: string, value: number, tone: 'default' | 'warning' | 'danger' = 'default') {
  const toneClass = tone === 'danger'
    ? 'text-destructive'
    : tone === 'warning'
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-foreground';

  return (
    <div className="rounded-lg border border-border/60 bg-[var(--app-surface)] p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-2 text-[20px] font-normal ${toneClass}`}>{value}</p>
    </div>
  );
}

export function AutomationRuntimeHealth({ canManage }: { canManage: boolean }) {
  const [page, setPage] = useState(0);
  const [retryTarget, setRetryTarget] = useState<AutomationRuntimeIssue | null>(null);
  const issuesQuery = useAutomationRuntimeIssues(page * PAGE_SIZE, PAGE_SIZE);
  const retryIssue = useRetryAutomationRuntimeIssue();
  const data = issuesQuery.data;
  const issues = data?.issues ?? [];
  const summary = data?.summary;

  const handleRetry = (issue: AutomationRuntimeIssue) => {
    if (!canManage || retryIssue.isPending) return;
    setRetryTarget(issue);
  };

  const confirmRetry = async () => {
    if (!retryTarget || retryIssue.isPending || !canManage) return;
    try {
      await retryIssue.mutateAsync({ kind: retryTarget.kind, id: retryTarget.id });
      setRetryTarget(null);
    } catch {
      // The mutation reports the error. Keep the dialog open for retry/cancel.
    }
  };

  if (issuesQuery.isLoading) {
    return (
      <div className="app-card flex min-h-[260px] items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" /> Verificando a saúde das automações...
      </div>
    );
  }

  if (issuesQuery.error) {
    return (
      <div className="app-card flex min-h-[260px] flex-col items-center justify-center gap-3 px-5 text-center" role="alert">
        <ShieldAlert className="h-8 w-8 text-destructive" aria-hidden="true" />
        <p className="text-sm font-medium">Não foi possível consultar os alertas operacionais.</p>
        <p className="max-w-md text-xs text-muted-foreground">
          {issuesQuery.error instanceof Error
            ? issuesQuery.error.message
            : 'Tente novamente em alguns instantes.'}
        </p>
        <Button type="button" size="sm" variant="outline" onClick={() => void issuesQuery.refetch()}>
          <RefreshCw className="h-4 w-4" /> Tentar novamente
        </Button>
      </div>
    );
  }

  const criticalCount = (summary?.deadLetters ?? 0)
    + (summary?.failedEvents ?? 0)
    + (summary?.failedEffects ?? 0)
    + (summary?.unknownEffects ?? 0)
    + (summary?.staleSendingEffects ?? 0);

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumo operacional">
        {summaryValue('Falhas que exigem atenção', criticalCount, criticalCount > 0 ? 'danger' : 'default')}
        {summaryValue('Circuitos abertos', summary?.openCircuits ?? 0, (summary?.openCircuits ?? 0) > 0 ? 'warning' : 'default')}
        {summaryValue('Duplicidades evitadas', summary?.duplicateDecisions ?? 0)}
        {summaryValue('Efeitos externos ambíguos', summary?.unknownEffects ?? 0, (summary?.unknownEffects ?? 0) > 0 ? 'danger' : 'default')}
      </section>

      <section className="app-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[14px] font-normal">Alertas do runtime</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Reprocessamento automático fica bloqueado quando existe risco de duplicar um envio externo.
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => void issuesQuery.refetch()} disabled={issuesQuery.isFetching}>
            <RefreshCw className={issuesQuery.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> Atualizar
          </Button>
        </div>

        {issues.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center px-4 text-center">
            <CheckCircle2 className="mb-3 h-9 w-9 text-emerald-500" aria-hidden="true" />
            <p className="text-sm font-medium">Nenhum alerta operacional pendente.</p>
            <p className="mt-1 text-xs text-muted-foreground">Filas, circuitos e efeitos externos estão sem ocorrências visíveis.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {issues.map((issue) => (
              <article key={`${issue.kind}:${issue.id}`} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <AlertTriangle className={issue.severity === 'error' ? 'h-4 w-4 text-destructive' : 'h-4 w-4 text-amber-500'} aria-hidden="true" />
                    <p className="text-[12px] font-normal">{ISSUE_LABELS[issue.kind]}</p>
                    <Badge variant={issue.severity === 'error' ? 'destructive' : 'secondary'}>{issue.status}</Badge>
                    {!issue.retryable && <Badge variant="outline">Revisão manual</Badge>}
                  </div>
                  <p className="mt-2 break-words text-sm text-muted-foreground">
                    {issue.message || 'Ocorrência operacional sem mensagem adicional.'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {issue.automationName || 'Automação não identificada'} · {formatOccurredAt(issue.occurredAt)}
                  </p>
                </div>

                {issue.retryable && canManage && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleRetry(issue)}
                    disabled={retryIssue.isPending}
                    className="shrink-0"
                  >
                    {retryIssue.isPending && retryIssue.variables?.kind === issue.kind && retryIssue.variables.id === issue.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <RotateCcw className="h-4 w-4" />}
                    {retryIssue.isPending && retryIssue.variables?.kind === issue.kind && retryIssue.variables.id === issue.id
                      ? 'Reprocessando...'
                      : 'Reprocessar'}
                  </Button>
                )}
              </article>
            ))}
          </div>
        )}

        {(page > 0 || issues.length === PAGE_SIZE) && (
          <div className="flex items-center justify-between border-t border-border/60 p-3">
            <Button type="button" size="sm" variant="ghost" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}>
              Anterior
            </Button>
            <span className="text-xs text-muted-foreground">Página {page + 1}</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPage((value) => value + 1)} disabled={issues.length < PAGE_SIZE}>
              Próxima
            </Button>
          </div>
        )}
      </section>

      <AlertDialog
        open={retryTarget !== null}
        onOpenChange={(open) => {
          if (!open && !retryIssue.isPending) setRetryTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-[440px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-5 shadow-none">
          <AlertDialogHeader className="space-y-1.5 text-left">
            <AlertDialogTitle className="text-[14px] font-medium text-[var(--app-text-primary)]">
              Reprocessar alerta?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
              {retryTarget
                ? `${ISSUE_LABELS[retryTarget.kind]}. O reprocessamento pode executar ações do fluxo e enviar mensagens. Continue somente após conferir o contexto.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2 sm:gap-2">
            <AlertDialogCancel disabled={retryIssue.isPending} className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={retryIssue.isPending}
              className="h-9 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
              onClick={(event) => {
                event.preventDefault();
                void confirmRetry();
              }}
            >
              {retryIssue.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {retryIssue.isPending ? 'Reprocessando...' : 'Reprocessar item'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
