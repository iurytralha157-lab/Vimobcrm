'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
      <p className={`mt-2 text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

export function AutomationRuntimeHealth({ canManage }: { canManage: boolean }) {
  const [page, setPage] = useState(0);
  const issuesQuery = useAutomationRuntimeIssues(page * PAGE_SIZE, PAGE_SIZE);
  const retryIssue = useRetryAutomationRuntimeIssue();
  const data = issuesQuery.data;
  const issues = data?.issues ?? [];
  const summary = data?.summary;

  const handleRetry = (issue: AutomationRuntimeIssue) => {
    const confirmed = window.confirm(
      'Reprocessar este item pode executar ações do fluxo e enviar mensagens. Deseja continuar?',
    );
    if (!confirmed) return;
    retryIssue.mutate({ kind: issue.kind, id: issue.id });
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
            <h2 className="font-semibold">Alertas do runtime</h2>
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
                    <p className="text-sm font-semibold">{ISSUE_LABELS[issue.kind]}</p>
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
                    {retryIssue.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    Reprocessar
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
    </div>
  );
}
