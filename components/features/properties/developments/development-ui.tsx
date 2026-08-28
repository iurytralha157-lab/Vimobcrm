import type { LucideIcon } from 'lucide-react'
import { Building2, CircleDashed } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export const DEVELOPMENT_STATUS_LABELS: Record<string, string> = {
  planning: 'Planejamento',
  pre_launch: 'Pré-lançamento',
  launched: 'Lançado',
  under_construction: 'Em obras',
  ready: 'Pronto',
  delivered: 'Entregue',
  suspended: 'Suspenso',
  cancelled: 'Cancelado',
  archived: 'Arquivado',
}

export const COMMERCIAL_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  active: 'Comercial ativo',
  paused: 'Comercial pausado',
  sold_out: 'Esgotado',
  closed: 'Encerrado',
}

export const UNIT_STATUS_LABELS: Record<string, string> = {
  available: 'Disponível',
  negotiation: 'Em negociação',
  reserved: 'Reservada',
  sold: 'Vendida',
  blocked: 'Bloqueada',
  unavailable: 'Indisponível',
  withdrawn: 'Retirada',
}

export const PHASE_STATUS_LABELS: Record<string, string> = {
  planned: 'Planejada',
  pre_launch: 'Pré-lançamento',
  launched: 'Lançada',
  under_construction: 'Em obras',
  delivered: 'Entregue',
  suspended: 'Suspensa',
  cancelled: 'Cancelada',
}

export const BUILDING_TYPE_LABELS: Record<string, string> = {
  tower: 'Torre',
  block: 'Bloco',
  quadra: 'Quadra',
  sector: 'Setor',
  street: 'Rua',
}

export const DEVELOPMENT_TYPE_LABELS: Record<string, string> = {
  vertical: 'Vertical',
  horizontal: 'Horizontal',
  mixed_use: 'Uso misto',
  land_subdivision: 'Loteamento',
  commercial: 'Comercial',
}

export const PRICE_TABLE_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  approved: 'Aprovada',
  active: 'Ativa',
  expired: 'Expirada',
  archived: 'Arquivada',
}

export function isSafeDevelopmentImageUrl(value?: string | null): value is string {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function formatDevelopmentCurrency(value?: number | null, currency = 'BRL') {
  if (value == null) return '—'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatDevelopmentDate(value?: string | null, withTime = false) {
  if (!value) return 'Não informado'
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', withTime
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { dateStyle: 'short' }).format(date)
}

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'primary',
}: {
  label: string
  value: string | number
  hint?: string
  icon: LucideIcon
  tone?: 'primary' | 'success' | 'warning' | 'muted'
}) {
  return (
    <Card className="app-card rounded-[8px] border-0 shadow-none">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-2xl font-normal tracking-tight">{value}</p>
          <p className="mt-0.5 text-xs font-light text-muted-foreground">{label}</p>
          {hint && <p className="mt-1 truncate text-[11px] font-light text-muted-foreground/80">{hint}</p>}
        </div>
        <span className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px]',
          tone === 'primary' && 'bg-primary/10 text-primary',
          tone === 'success' && 'bg-emerald-500/10 text-emerald-600',
          tone === 'warning' && 'bg-amber-500/10 text-amber-600',
          tone === 'muted' && 'bg-muted text-muted-foreground',
        )}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </CardContent>
    </Card>
  )
}

export function DevelopmentEmptyState({
  title,
  description,
  action,
  icon: Icon = Building2,
}: {
  title: string
  description: string
  action?: React.ReactNode
  icon?: LucideIcon
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-[8px] border-0 bg-[var(--app-surface-solid)] px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-[8px] bg-[var(--app-surface-soft)] text-muted-foreground">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <h3 className="mt-4 text-sm font-normal">{title}</h3>
      <p className="mt-1 max-w-md text-sm font-light text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function DevelopmentLoadingGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Carregando empreendimentos">
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <Card key={item} className="app-card overflow-hidden rounded-[8px] border-0 shadow-none">
          <Skeleton className="aspect-[16/8] rounded-none" />
          <CardContent className="space-y-3 p-5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <div className="grid grid-cols-3 gap-2 pt-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function WorkspaceLoading() {
  return (
    <div className="mx-auto max-w-[1500px] space-y-6 p-1 sm:p-3">
      <div className="space-y-3">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-3/5" />
        <Skeleton className="h-5 w-2/5" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-24 rounded-[8px]" />)}
      </div>
      <Skeleton className="h-12 rounded-[6px]" />
      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <Skeleton className="aspect-[16/9] rounded-[8px]" />
        <Skeleton className="h-72 rounded-[8px]" />
      </div>
    </div>
  )
}

export function DevelopmentErrorState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="mx-auto flex min-h-[55vh] max-w-xl items-center justify-center p-6 text-center">
      <div>
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <CircleDashed className="h-5 w-5" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-lg font-normal">{title}</h2>
        <p className="mt-2 text-sm font-light leading-6 text-muted-foreground">{description}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  )
}
