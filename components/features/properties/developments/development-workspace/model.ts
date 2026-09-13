export const UNIT_PAGE_SIZE = 50

export type WorkspaceTab =
  | 'overview'
  | 'structure'
  | 'floor-plans'
  | 'units'
  | 'reservations'
  | 'commercial'
  | 'history'

export function inventoryTone(status: string) {
  if (status === 'available') return 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
  if (status === 'reserved') return 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300'
  if (status === 'sold') return 'border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300'
  if (status === 'negotiation') return 'border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-300'
  return 'border-border bg-muted/35 text-muted-foreground'
}
const EVENT_LABELS: Record<string, string> = {
  created: 'Unidade criada',
  updated: 'Unidade atualizada',
  status_changed: 'Status da unidade alterado',
  property_linked: 'Ficha de imóvel vinculada',
  price_changed: 'Preço da unidade atualizado',
  reservation_created: 'Reserva criada',
  reservation_extended: 'Prazo da reserva prorrogado',
  reservation_released: 'Reserva liberada',
  reservation_cancelled: 'Reserva cancelada',
  reservation_converted: 'Reserva convertida em venda',
  reservation_expired: 'Reserva expirada',
}

export function developmentUnitEventLabel(event: {
  event_type: string
  metadata?: Record<string, unknown>
}) {
  if (
    event.event_type === 'property_linked' &&
    event.metadata?.operation === 'unlink_property'
  ) {
    return 'Ficha de imóvel desvinculada'
  }
  return EVENT_LABELS[event.event_type] ?? event.event_type
}
