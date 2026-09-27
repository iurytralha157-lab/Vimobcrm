'use client'

import { AlertTriangle, CalendarDays, Clock3, RefreshCw, UsersRound } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDashboardVisits } from '@/hooks/use-dashboard-visits'
import { sourceLabels } from '@/hooks/use-dashboard-filters'
import type { DashboardAPIFilters } from '@/lib/api/dashboard'
import type { DashboardVisit, DashboardVisits } from '@/lib/validation/dashboard-visits'

type DashboardVisitsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters?: DashboardAPIFilters
  periodLabel: string
}

function formatDate(value: string | null, timezone: string, includeTime = true) {
  if (!value) return 'Sem registro'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Data indisponível'
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    }).format(date)
  } catch {
    return 'Data indisponível'
  }
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return `${parts[0]?.[0] ?? '?'}${parts.length > 1 ? parts.at(-1)?.[0] ?? '' : ''}`
}

function statusLabel(status: string) {
  switch (status) {
    case 'scheduled': return 'Agendada'
    case 'completed': return 'Concluída'
    case 'cancelled':
    case 'canceled': return 'Cancelada'
    case 'no_show': return 'Não compareceu'
    default: return status
  }
}

function VisitRow({ visit, timezone }: { visit: DashboardVisit; timezone: string }) {
  return (
    <li className="rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface-solid)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-normal text-[var(--app-text-primary)]">{visit.lead_name}</p>
          <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">
            {visit.event_type === 'meeting' ? 'Reunião' : 'Visita'} · {sourceLabels[visit.source] || visit.source}
          </p>
        </div>
        <span className={`rounded-[5px] px-2 py-0.5 text-[11px] ${visit.is_overdue ? 'bg-destructive/10 text-destructive' : 'bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]'}`}>
          {visit.is_overdue ? 'Atrasada' : statusLabel(visit.status)}
        </span>
      </div>
      <div className="mt-2 grid gap-x-4 gap-y-1.5 text-[11px] font-light text-[var(--app-text-secondary)] sm:grid-cols-2">
        <p><span className="text-[var(--app-text-tertiary)]">Compromisso:</span> {formatDate(visit.start_time, timezone)}</p>
        <p><span className="text-[var(--app-text-tertiary)]">Marcada em:</span> {formatDate(visit.created_at, timezone)}</p>
        <p><span className="text-[var(--app-text-tertiary)]">Quem marcou:</span> {visit.created_by_name}</p>
        <p><span className="text-[var(--app-text-tertiary)]">Responsável:</span> {visit.owner_name}</p>
      </div>
    </li>
  )
}

function VisitList({ visits, timezone, empty, note }: {
  visits: DashboardVisit[]
  timezone: string
  empty: string
  note?: string
}) {
  return (
    <div className="space-y-2">
      {note ? <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">{note}</p> : null}
      {visits.length === 0 ? (
        <p className="rounded-[8px] bg-[var(--app-surface-soft)] p-5 text-center text-[12px] text-[var(--app-text-secondary)]">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {visits.map((visit) => <VisitRow key={visit.id} visit={visit} timezone={timezone} />)}
        </ul>
      )}
    </div>
  )
}

function Ranking({ data }: { data: DashboardVisits }) {
  const maxCreator = Math.max(1, ...data.creators.map((person) => person.count))
  const maxSource = Math.max(1, ...data.sources.map((source) => source.count))
  const creatorsArePartial = data.creators.reduce((sum, person) => sum + person.count, 0) < data.total
  const sourcesArePartial = data.sources.reduce((sum, source) => sum + source.count, 0) < data.total

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 sm:p-4" aria-labelledby="visit-creators-title">
        <div className="mb-3 flex items-center gap-2">
          <UsersRound className="h-4 w-4 text-primary" aria-hidden="true" />
          <h3 id="visit-creators-title" className="text-[13px] font-normal">Quem marcou mais</h3>
        </div>
        {data.creators.length === 0 ? <p className="text-[12px] text-[var(--app-text-secondary)]">Nenhuma visita marcada no período.</p> : (
          <ol className="space-y-2">
            {data.creators.map((person, index) => (
              <li key={person.id ?? 'unknown'} className="rounded-[8px] bg-[var(--app-surface-solid)] p-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="w-5 text-right text-[11px] tabular-nums text-[var(--app-text-tertiary)]">{index + 1}</span>
                  <Avatar className="h-7 w-7 border border-[var(--app-border)]">
                    <AvatarImage src={person.avatarUrl ?? undefined} alt={person.name} />
                    <AvatarFallback className="bg-primary/15 text-[10px] text-primary">{initials(person.name)}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--app-text-primary)]">{person.name}</span>
                  <span className="text-[12px] tabular-nums text-[var(--app-text-primary)]">{person.count}</span>
                </div>
                <div className="ml-[46px] mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--app-surface-hover)]">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (person.count / maxCreator) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ol>
        )}
        {creatorsArePartial ? <p className="mt-2 text-[11px] text-[var(--app-text-tertiary)]">Mostrando os 50 primeiros autores. O total considera todos.</p> : null}
      </section>
      <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 sm:p-4" aria-labelledby="visit-sources-title">
        <div className="mb-3 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" aria-hidden="true" />
          <h3 id="visit-sources-title" className="text-[13px] font-normal">Origem dos leads</h3>
        </div>
        {data.sources.length === 0 ? <p className="text-[12px] text-[var(--app-text-secondary)]">Nenhuma origem disponível no período.</p> : (
          <ol className="space-y-2">
            {data.sources.map((source) => (
              <li key={source.source} className="rounded-[8px] bg-[var(--app-surface-solid)] p-2.5">
                <div className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="min-w-0 truncate text-[var(--app-text-primary)]">{sourceLabels[source.source] || source.source}</span>
                  <span className="tabular-nums text-[var(--app-text-primary)]">{source.count}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--app-surface-hover)]">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (source.count / maxSource) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ol>
        )}
        {sourcesArePartial ? <p className="mt-2 text-[11px] text-[var(--app-text-tertiary)]">Mostrando as 50 principais origens. O total considera todas.</p> : null}
      </section>
    </div>
  )
}

export function DashboardVisitsDialog({ open, onOpenChange, filters }: DashboardVisitsDialogProps) {
  const { data, isPending, isError, refetch } = useDashboardVisits(filters, open)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="dashboard-dialog-shell flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-[min(760px,calc(100dvh-32px))] sm:max-h-[calc(100dvh-32px)] sm:w-[min(1000px,calc(100vw-32px))] sm:max-w-[1000px] [&>button.absolute]:right-3 [&>button.absolute]:top-3 [&>button.absolute]:grid [&>button.absolute]:h-9 [&>button.absolute]:w-9 [&>button.absolute]:place-items-center sm:[&>button.absolute]:right-4 sm:[&>button.absolute]:top-4">
        <DialogHeader className="shrink-0 px-4 pb-3 pr-14 pt-[calc(0.75rem+env(safe-area-inset-top))] text-left sm:px-5 sm:pt-4">
          <DialogTitle className="flex items-center gap-2.5 text-[14px] font-light leading-snug text-[var(--app-text-primary)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            Visitas e reuniões
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="dashboard-dialog-scroll min-h-0 flex-1 overflow-x-hidden">
          <div className="space-y-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-5">
            {isError ? (
              <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] text-[var(--app-text-secondary)]">
                <p>Não foi possível carregar as visitas deste período.</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => void refetch()} className="mt-2 gap-1.5 text-primary">
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Tentar novamente
                </Button>
              </div>
            ) : isPending || !data ? (
              <div className="space-y-3" role="status" aria-label="Carregando visitas">
                <div className="grid grid-cols-3 gap-2">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-[8px]" />)}</div>
                <Skeleton className="h-60 rounded-[8px]" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  {[
                    { label: 'Marcadas', value: data.total, icon: CalendarDays },
                    { label: 'Próximas', value: data.upcoming, icon: Clock3 },
                    { label: 'Atrasadas', value: data.overdue, icon: AlertTriangle },
                  ].map(({ label, value, icon: Icon }) => (
                    <div key={label} className="min-w-0 rounded-[8px] bg-[var(--app-surface-soft)] p-2.5 sm:p-3">
                      <p className="flex items-center gap-1.5 text-[11px] font-light text-[var(--app-text-tertiary)] sm:text-[12px]"><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{label}</p>
                      <p className="mt-1 text-[19px] font-normal tabular-nums text-[var(--app-text-primary)] sm:text-[22px]">{value.toLocaleString('pt-BR')}</p>
                    </div>
                  ))}
                </div>
                <Tabs defaultValue="all" className="space-y-3">
                  <div className="overflow-x-auto">
                    <TabsList className="h-auto w-max min-w-full justify-start gap-1 bg-[var(--app-surface-soft)] p-1">
                      <TabsTrigger value="all" className="shrink-0 text-[11px] data-[state=active]:shadow-none sm:text-[12px]">Marcadas</TabsTrigger>
                      <TabsTrigger value="upcoming" className="shrink-0 text-[11px] data-[state=active]:shadow-none sm:text-[12px]">Próximas</TabsTrigger>
                      <TabsTrigger value="overdue" className="shrink-0 text-[11px] data-[state=active]:shadow-none sm:text-[12px]">Atrasadas</TabsTrigger>
                      <TabsTrigger value="ranking" className="shrink-0 text-[11px] data-[state=active]:shadow-none sm:text-[12px]">Quem marcou e origem</TabsTrigger>
                    </TabsList>
                  </div>
                  <TabsContent value="all" className="mt-0">
                    <VisitList visits={data.visits} timezone={data.reportTimezone} empty="Nenhuma visita ou reunião marcada neste período." note={data.visitsTruncated ? 'Mostrando as 100 marcações mais recentes. O total acima inclui todas.' : undefined} />
                  </TabsContent>
                  <TabsContent value="upcoming" className="mt-0">
                    <VisitList visits={data.upcomingVisits} timezone={data.reportTimezone} empty="Nenhuma visita futura entre as marcadas neste período." note={data.upcoming > data.upcomingVisits.length ? 'Mostrando as 20 visitas futuras mais próximas.' : undefined} />
                  </TabsContent>
                  <TabsContent value="overdue" className="mt-0">
                    <VisitList visits={data.overdueVisits} timezone={data.reportTimezone} empty="Nenhuma visita atrasada entre as marcadas neste período." note={data.overdue > data.overdueVisits.length ? 'Mostrando as 20 visitas atrasadas mais antigas.' : undefined} />
                  </TabsContent>
                  <TabsContent value="ranking" className="mt-0"><Ranking data={data} /></TabsContent>
                </Tabs>
                <p className="text-[11px] font-light leading-4 text-[var(--app-text-tertiary)]">
                  As contagens seguem o cartão da Dashboard: visitas e reuniões criadas no período e ligadas a leads visíveis. “Quem marcou” é o autor registrado no evento; “responsável” é a pessoa atribuída ao compromisso. Atrasadas seguem o fuso da organização para compromissos de dia inteiro.
                </p>
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
