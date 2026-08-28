'use client'

import { useState } from 'react'
import { CalendarClock, CheckCircle2, Clock3, History, MoreHorizontal, RefreshCw, Search, ShoppingBag, X, XCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  useCancelPropertyDevelopmentReservation,
  useConvertPropertyDevelopmentReservation,
  useExtendPropertyDevelopmentReservation,
  usePropertyDevelopmentReservations,
  usePropertyDevelopmentUnits,
} from '@/hooks/properties'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { commandSearchFilter } from '@/lib/search-text'
import type { PropertyDevelopmentReservation, PropertyDevelopmentReservationStatus } from '@/lib/validation'
import { cn } from '@/lib/utils'

import {
  DevelopmentEmptyState,
  DevelopmentErrorState,
  MetricCard,
  formatDevelopmentCurrency,
  formatDevelopmentDate,
} from './development-ui'
import { DevelopmentReservationActionDialog, type ReservationAction } from './DevelopmentCommercialDialogs'

const RESERVATION_PAGE_SIZE = 25

const RESERVATION_STATUS_LABELS: Record<PropertyDevelopmentReservationStatus, string> = {
  active: 'Ativa',
  converted: 'Convertida',
  cancelled: 'Cancelada',
  expired: 'Expirada',
}

function reservationTone(status: PropertyDevelopmentReservationStatus) {
  if (status === 'active') return 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300'
  if (status === 'converted') return 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
  if (status === 'expired') return 'border-slate-500/30 bg-slate-500/5 text-slate-600 dark:text-slate-300'
  return 'border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300'
}

export function DevelopmentReservationsTab({
  developmentId,
  canManage,
}: {
  developmentId: string
  canManage: boolean
}) {
  const [status, setStatus] = useState<'all' | PropertyDevelopmentReservationStatus>('all')
  const [unitId, setUnitId] = useState('all')
  const [unitLabel, setUnitLabel] = useState('Todas as unidades')
  const [unitSearch, setUnitSearch] = useState('')
  const [unitFilterOpen, setUnitFilterOpen] = useState(false)
  const [offset, setOffset] = useState(0)
  const [selectedReservationId, setSelectedReservationId] = useState<string>()
  const [selectedAction, setSelectedAction] = useState<ReservationAction>()
  const reservationsQuery = usePropertyDevelopmentReservations(developmentId, {
    status: status === 'all' ? undefined : status,
    unit_id: unitId === 'all' ? undefined : unitId,
    limit: RESERVATION_PAGE_SIZE,
    offset,
  })
  const debouncedUnitSearch = useDebouncedValue(unitSearch, 300)
  const unitOptionsQuery = usePropertyDevelopmentUnits(developmentId, {
    search: debouncedUnitSearch || undefined,
    limit: 30,
    offset: 0,
  }, { enabled: unitFilterOpen })
  const unitOptions = unitOptionsQuery.data?.data ?? []
  const cancelReservation = useCancelPropertyDevelopmentReservation(developmentId)
  const convertReservation = useConvertPropertyDevelopmentReservation(developmentId)
  const extendReservation = useExtendPropertyDevelopmentReservation(developmentId)
  const response = reservationsQuery.data
  const reservations = response?.data ?? []
  const meta = response?.meta
  const selectedReservation = selectedReservationId
    ? reservations.find((reservation) => reservation.id === selectedReservationId)
    : undefined

  const openAction = (reservation: PropertyDevelopmentReservation, action: ReservationAction) => {
    setSelectedReservationId(reservation.id)
    setSelectedAction(action)
  }

  const closeAction = () => {
    setSelectedAction(undefined)
    setSelectedReservationId(undefined)
  }

  const submitCancel = async (reason: string) => {
    if (!canManage || !selectedReservation?.can_operate || selectedReservation.status !== 'active') {
      closeAction()
      return
    }
    try {
      await cancelReservation.mutateAsync({
        reservationId: selectedReservation.id,
        input: {
          expected_updated_at: selectedReservation.updated_at,
          cancellation_reason: reason,
        },
      })
      closeAction()
    } catch { /* The domain hook reports the error. */ }
  }

  const submitConvert = async () => {
    if (!canManage || !selectedReservation?.can_operate || selectedReservation.status !== 'active') {
      closeAction()
      return
    }
    try {
      await convertReservation.mutateAsync({
        reservationId: selectedReservation.id,
        input: { expected_updated_at: selectedReservation.updated_at },
      })
      closeAction()
    } catch { /* The domain hook reports the error. */ }
  }

  const submitExtend = async (expiresAt: string) => {
    if (!canManage || !selectedReservation?.can_operate || selectedReservation.status !== 'active') {
      closeAction()
      return
    }
    try {
      await extendReservation.mutateAsync({
        reservationId: selectedReservation.id,
        input: {
          expected_updated_at: selectedReservation.updated_at,
          expires_at: expiresAt,
        },
      })
      closeAction()
    } catch { /* The domain hook reports the error. */ }
  }

  const actionPending = selectedAction === 'cancel'
    ? cancelReservation.isPending
    : selectedAction === 'convert'
      ? convertReservation.isPending
      : extendReservation.isPending

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div><h2 className="text-lg font-normal">Reservas comerciais</h2><p className="text-sm font-light text-muted-foreground">Controle prazos, conversões e devoluções ao estoque com histórico auditável.</p></div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={status} onValueChange={(value) => { closeAction(); setStatus(value as typeof status); setOffset(0) }}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Filtrar reservas por status"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos os status</SelectItem>{Object.entries(RESERVATION_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex gap-1">
            <Popover open={unitFilterOpen} onOpenChange={setUnitFilterOpen}>
              <PopoverTrigger asChild><Button variant="outline" className="w-full justify-start sm:w-56"><Search className="mr-2 h-4 w-4 shrink-0" /><span className="truncate">{unitLabel}</span></Button></PopoverTrigger>
              <PopoverContent className="w-[min(360px,calc(100vw-2rem))] p-0" align="end">
                <Command filter={commandSearchFilter}>
                  <CommandInput placeholder="Buscar número ou código..." value={unitSearch} onValueChange={setUnitSearch} />
                  <CommandList>
                    <CommandEmpty>
                      {unitOptionsQuery.isLoading
                        ? 'Buscando unidades...'
                        : unitOptionsQuery.isError
                          ? 'Não foi possível buscar unidades. Feche e abra a busca para tentar novamente.'
                          : 'Nenhuma unidade encontrada.'}
                    </CommandEmpty>
                    <CommandGroup>
                      {unitOptions.map((unit) => (
                        <CommandItem
                          key={unit.id}
                          value={`${unit.unit_number} ${unit.code} ${unit.building_name || ''}`}
                          onSelect={() => {
                            closeAction()
                            setUnitId(unit.id)
                            setUnitLabel(`${unit.building_name ? `${unit.building_name} · ` : ''}${unit.unit_number}`)
                            setUnitSearch('')
                            setUnitFilterOpen(false)
                            setOffset(0)
                          }}
                          className="cursor-pointer"
                        >
                          <span><span className="block text-sm font-medium">Unidade {unit.unit_number}</span><span className="block text-xs text-muted-foreground">{unit.building_name || unit.code}</span></span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {unitId !== 'all' && <Button variant="ghost" size="icon" aria-label="Limpar filtro de unidade" onClick={() => { closeAction(); setUnitId('all'); setUnitLabel('Todas as unidades'); setUnitSearch(''); setOffset(0) }}><X className="h-4 w-4" /></Button>}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Reservas no filtro" value={meta?.total ?? 0} icon={History} tone="muted" />
        <MetricCard label="Ativas" value={meta?.active ?? 0} icon={Clock3} tone="warning" />
        <MetricCard label="Expiram em breve" value={meta?.expiring_soon ?? 0} icon={CalendarClock} tone="warning" />
        <MetricCard label="Expiradas" value={meta?.expired ?? 0} icon={XCircle} tone="muted" />
      </div>

      {reservationsQuery.isLoading ? (
        <Card><CardContent className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Carregando reservas...</CardContent></Card>
      ) : reservationsQuery.isError && reservations.length === 0 ? (
        <DevelopmentErrorState title="Não foi possível carregar as reservas" description={reservationsQuery.error instanceof Error ? reservationsQuery.error.message : 'Tente carregar a lista novamente.'} action={<Button variant="outline" disabled={reservationsQuery.isFetching} onClick={() => void reservationsQuery.refetch()}>Tentar novamente</Button>} />
      ) : reservations.length === 0 ? (
        <DevelopmentEmptyState title="Nenhuma reserva nestes filtros" description="As reservas criadas pelo espelho de unidades aparecerão aqui com prazo, cliente e situação comercial." icon={CalendarClock} />
      ) : (
        <div className="space-y-3">
          {reservationsQuery.isError ? (
            <div className="rounded-[6px] bg-destructive/10 px-3 py-2 text-xs text-destructive" role="status">
              A atualização falhou; mantendo as reservas já carregadas.
            </div>
          ) : null}
          {reservations.map((reservation) => (
            <Card key={reservation.id} className="app-card rounded-[8px] border-0 shadow-none">
              <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] border', reservationTone(reservation.status))}><CalendarClock className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><p className="font-normal">Unidade {reservation.unit_number || reservation.unit_code || reservation.unit_id}</p><Badge variant="outline" className={reservationTone(reservation.status)}>{RESERVATION_STATUS_LABELS[reservation.status]}</Badge></div>
                    <p className="mt-1 truncate text-sm font-light text-muted-foreground">{reservation.building_name || 'Estrutura não informada'} · {reservation.lead_name || (reservation.lead_id ? 'Lead sem nome' : canManage && reservation.can_operate ? 'Sem lead vinculado' : 'Lead não disponível')}</p>
                    {(canManage || reservation.lead_id) && reservation.cancellation_reason && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">Motivo: {reservation.cancellation_reason}</p>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 md:min-w-[430px]">
                  <div><span className="block text-xs font-light text-muted-foreground">Valor reservado</span><span className="font-normal">{formatDevelopmentCurrency(reservation.list_price_snapshot, reservation.currency)}</span></div>
                  <div><span className="block text-xs font-light text-muted-foreground">Criada em</span><span className="font-normal">{formatDevelopmentDate(reservation.created_at, true)}</span></div>
                  <div><span className="block text-xs font-light text-muted-foreground">Expira em</span><span className="font-normal">{formatDevelopmentDate(reservation.expires_at, true)}</span></div>
                </div>
                {canManage && reservation.can_operate && reservation.status === 'active' && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Ações da reserva da unidade ${reservation.unit_number || reservation.unit_id}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openAction(reservation, 'extend')}><CalendarClock className="mr-2 h-4 w-4" />Prorrogar prazo</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openAction(reservation, 'convert')}><ShoppingBag className="mr-2 h-4 w-4" />Converter em venda</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => openAction(reservation, 'cancel')}><XCircle className="mr-2 h-4 w-4" />Cancelar reserva</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {!canManage && reservation.status === 'converted' && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-label="Reserva convertida" />}
              </CardContent>
            </Card>
          ))}
          <div className="flex flex-col justify-between gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center">
            <span>Exibindo {meta?.total ? offset + 1 : 0}–{Math.min(offset + RESERVATION_PAGE_SIZE, meta?.total ?? 0)} de {meta?.total ?? 0} reservas</span>
            <div className="flex gap-2"><Button variant="outline" size="sm" disabled={offset === 0 || reservationsQuery.isFetching} onClick={() => { closeAction(); setOffset((current) => Math.max(0, current - RESERVATION_PAGE_SIZE)) }}>Anterior</Button><Button variant="outline" size="sm" disabled={offset + RESERVATION_PAGE_SIZE >= (meta?.total ?? 0) || reservationsQuery.isFetching} onClick={() => { closeAction(); setOffset((current) => current + RESERVATION_PAGE_SIZE) }}>Próxima</Button></div>
          </div>
        </div>
      )}

      {canManage && selectedReservation?.can_operate && selectedReservation.status === 'active' && selectedAction && (
        <DevelopmentReservationActionDialog
          open
          onOpenChange={(nextOpen) => { if (!nextOpen) closeAction() }}
          pending={actionPending}
          reservation={selectedReservation}
          action={selectedAction}
          onCancel={submitCancel}
          onConvert={submitConvert}
          onExtend={submitExtend}
        />
      )}
    </div>
  )
}
