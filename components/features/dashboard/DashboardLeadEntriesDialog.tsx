'use client'

import Link from 'next/link'
import { ArrowUpRight, RefreshCw, Repeat2, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { useDashboardLeadEntries } from '@/hooks/use-dashboard-lead-entries'
import { sourceLabels } from '@/hooks/use-dashboard-filters'
import type { DashboardAPIFilters } from '@/lib/api/dashboard'
import type { DashboardLeadEntry } from '@/lib/validation/dashboard-lead-entries'

type DashboardLeadEntriesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters?: DashboardAPIFilters
  available: boolean
  onRetryAvailability: () => void
}

function formatEntryDate(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Data indisponível'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function EntryRow({ entry, onNavigate }: { entry: DashboardLeadEntry; onNavigate: () => void }) {
  const isReentry = entry.entryType === 'reentry'
  const source = entry.source ? sourceLabels[entry.source] || entry.source : 'Origem não informada'

  return (
    <li className="min-w-0 rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface-solid)] p-3 sm:p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 max-w-full truncate text-[13px] font-normal text-[var(--app-text-primary)]" title={entry.name}>
              {entry.name}
            </p>
            <span className={isReentry
              ? 'inline-flex shrink-0 items-center gap-1 rounded-[5px] bg-primary/15 px-2 py-0.5 text-[11px] font-normal text-primary'
              : 'inline-flex shrink-0 items-center rounded-[5px] bg-[var(--app-surface-soft)] px-2 py-0.5 text-[11px] font-light text-[var(--app-text-secondary)]'}>
              {isReentry ? <Repeat2 className="h-3 w-3" aria-hidden="true" /> : null}
              {isReentry ? 'Reentrada' : 'Entrada inicial'}
            </span>
          </div>
          <p className="mt-1 text-[11px] font-light text-[var(--app-text-secondary)]">
            {formatEntryDate(entry.occurredAt)} · {source}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-light text-[var(--app-text-tertiary)]">
            <span>Funil atual: {entry.pipelineName || 'Sem funil'}</span>
            {entry.campaignName ? <span>Campanha: {entry.campaignName}</span> : null}
          </p>
        </div>
        <Link
          href={entry.leadUrl}
          onClick={onNavigate}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-[6px] bg-primary/50 px-2.5 text-[11px] font-light text-primary-foreground transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
          aria-label={`Ver card de ${entry.name}`}
        >
          Ver card <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </li>
  )
}

export function DashboardLeadEntriesDialog({ open, onOpenChange, filters, available, onRetryAvailability }: DashboardLeadEntriesDialogProps) {
  const query = useDashboardLeadEntries(filters, open && available)
  const pages = query.data?.pages ?? []
  const entries = pages.flatMap((page) => page.items)
  const total = pages[0]?.total ?? 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="dashboard-dialog-shell flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-[min(760px,calc(100dvh-32px))] sm:max-h-[calc(100dvh-32px)] sm:w-[min(900px,calc(100vw-32px))] sm:max-w-[900px] [&>button.absolute]:right-3 [&>button.absolute]:top-3 [&>button.absolute]:grid [&>button.absolute]:h-9 [&>button.absolute]:w-9 [&>button.absolute]:place-items-center sm:[&>button.absolute]:right-4 sm:[&>button.absolute]:top-4"
      >
        <DialogHeader className="shrink-0 px-4 pb-3 pr-14 pt-[calc(0.75rem+env(safe-area-inset-top))] text-left sm:px-5 sm:pt-4">
          <DialogTitle className="flex items-center gap-2.5 text-[14px] font-light leading-snug text-[var(--app-text-primary)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            Entradas de leads
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="dashboard-dialog-scroll min-h-0 flex-1 overflow-x-hidden">
          <div className="space-y-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-5">
            {!available ? (
              <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] text-[var(--app-text-secondary)]">
                <p>A lista de entradas e reentradas ainda não está disponível nesta versão da API.</p>
                <Button type="button" variant="ghost" size="sm" className="mt-2 gap-1.5 text-primary" onClick={onRetryAvailability}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Verificar novamente
                </Button>
              </div>
            ) : query.isPending ? (
              <div className="space-y-2" role="status" aria-label="Carregando entradas de leads">
                <Skeleton className="h-8 rounded-[8px]" />
                <Skeleton className="h-24 rounded-[8px]" />
                <Skeleton className="h-24 rounded-[8px]" />
              </div>
            ) : query.isError && entries.length === 0 ? (
              <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] text-[var(--app-text-secondary)]">
                <p>Não foi possível carregar as entradas deste período.</p>
                <Button type="button" variant="ghost" size="sm" className="mt-2 gap-1.5 text-primary" onClick={() => void query.refetch()}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Tentar novamente
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] bg-[var(--app-surface-soft)] px-3 py-2.5 text-[11px] font-light text-[var(--app-text-secondary)]">
                  <span><strong className="font-normal tabular-nums text-[var(--app-text-primary)]">{total.toLocaleString('pt-BR')}</strong> entradas nos filtros atuais</span>
                  <span className="tabular-nums">Exibindo {entries.length.toLocaleString('pt-BR')} de {total.toLocaleString('pt-BR')}</span>
                </div>
                {entries.length === 0 ? (
                  <p className="rounded-[8px] bg-[var(--app-surface-soft)] p-5 text-center text-[12px] text-[var(--app-text-secondary)]">
                    Nenhuma entrada encontrada para estes filtros.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {entries.map((entry) => (
                      <EntryRow key={entry.entryId} entry={entry} onNavigate={() => onOpenChange(false)} />
                    ))}
                  </ul>
                )}
                {query.isFetchNextPageError ? (
                  <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 text-[12px] text-[var(--app-text-secondary)]">
                    Não foi possível carregar mais entradas.
                    <Button type="button" variant="ghost" size="sm" className="ml-2 text-primary" onClick={() => void query.fetchNextPage()}>Tentar novamente</Button>
                  </div>
                ) : query.hasNextPage ? (
                  <Button type="button" variant="outline" size="sm" className="w-full rounded-[6px]" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                    {query.isFetchingNextPage ? 'Carregando...' : 'Carregar mais entradas'}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
