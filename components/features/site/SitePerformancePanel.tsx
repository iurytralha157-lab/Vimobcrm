'use client'

import { Clock3, Gauge, Loader2, Monitor, Smartphone } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useSitePerformance } from '@/hooks/site'
import type { SitePerformanceResult } from '@/lib/api/site-performance'
import { cn } from '@/lib/utils'

type SitePerformancePanelProps = {
  publicUrl: string | null
  isPublished: boolean
}

function getScoreColor(score: number) {
  if (score >= 90) return '#10b981'
  if (score >= 50) return '#f59e0b'
  return '#ef4444'
}

function getScoreLabel(score: number) {
  if (score >= 90) return 'Bom'
  if (score >= 50) return 'Pode melhorar'
  return 'Precisa de atenção'
}

function PerformanceScore({
  icon: Icon,
  label,
  result,
}: {
  icon: typeof Monitor
  label: string
  result?: SitePerformanceResult
}) {
  const score = result?.score
  const color = score === undefined ? 'var(--app-border-strong)' : getScoreColor(score)

  return (
    <div className="flex min-w-0 flex-1 items-center gap-4 rounded-[8px] bg-[var(--app-surface-soft)] p-4">
      <div
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full p-[5px]"
        style={{
          background:
            score === undefined
              ? 'var(--app-surface-hover)'
              : `conic-gradient(${color} ${score * 3.6}deg, var(--app-surface-hover) 0deg)`,
        }}
      >
        <div className="flex h-full w-full items-center justify-center rounded-full bg-[var(--app-surface-solid)]">
          {score === undefined ? (
            <Icon className="h-5 w-5 text-muted-foreground" />
          ) : (
            <span className="text-lg font-semibold tabular-nums">{score}</span>
          )}
        </div>
      </div>

      <div className="min-w-0">
        <p className="font-medium">{label}</p>
        <p className={cn('mt-1 text-xs', score === undefined ? 'text-muted-foreground' : '')} style={score === undefined ? undefined : { color }}>
          {score === undefined ? 'Ainda não escaneado' : getScoreLabel(score)}
        </p>
        {result && (
          <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock3 className="h-3 w-3" />
            {new Date(result.measuredAt).toLocaleString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}
      </div>
    </div>
  )
}

export function SitePerformancePanel({
  publicUrl,
  isPublished,
}: SitePerformancePanelProps) {
  const performance = useSitePerformance()
  const canRun = Boolean(publicUrl && isPublished)

  return (
    <section className="app-card p-5 md:p-6" aria-labelledby="site-performance-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" />
            <h2 id="site-performance-title" className="text-base font-semibold">Desempenho</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Teste de laboratório do endereço público com Lighthouse.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 border-0 bg-[var(--app-surface-soft)] shadow-none hover:bg-[var(--app-surface-hover)]"
          disabled={!canRun || performance.isPending}
          onClick={() => publicUrl && performance.mutate(publicUrl)}
        >
          {performance.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Gauge className="mr-2 h-4 w-4" />
          )}
          {performance.data ? 'Executar novamente' : 'Executar teste'}
        </Button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <PerformanceScore icon={Monitor} label="Computador" result={performance.data?.desktop} />
        <PerformanceScore icon={Smartphone} label="Celular" result={performance.data?.mobile} />
      </div>

      {!canRun && (
        <p className="mt-4 rounded-[8px] bg-[var(--app-surface-soft)] px-3 py-2 text-xs text-muted-foreground">
          Publique o site e defina um slug para liberar o teste. O domínio próprio não é obrigatório.
        </p>
      )}
    </section>
  )
}
