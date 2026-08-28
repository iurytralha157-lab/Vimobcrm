'use client'

import { type FormEvent, useState } from 'react'
import { CircleDollarSign, Loader2, Search, User, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useLeads } from '@/hooks/use-leads'
import { useUserPermissions } from '@/hooks/use-user-permissions'
import { commandSearchFilter } from '@/lib/search-text'
import type {
  PropertyDevelopmentReservation,
  PropertyDevelopmentReservationCreateInput,
  PropertyDevelopmentUnit,
  PropertyDevelopmentUnitPriceInput,
} from '@/lib/validation'

type DialogBaseProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending?: boolean
}

function changeDialogOpen(
  pending: boolean | undefined,
  onOpenChange: (open: boolean) => void,
  nextOpen: boolean,
) {
  if (!pending) onOpenChange(nextOpen)
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000
const DEFAULT_RESERVATION_MS = 48 * 60 * 60 * 1_000

function toDateTimeLocal(date: Date) {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return adjusted.toISOString().slice(0, 16)
}

function expirationBounds() {
  const now = new Date()
  return {
    min: toDateTimeLocal(now),
    max: toDateTimeLocal(new Date(now.getTime() + THIRTY_DAYS_MS)),
  }
}

export type DevelopmentReservationValues = PropertyDevelopmentReservationCreateInput

export function DevelopmentReservationDialog({
  open,
  onOpenChange,
  pending,
  unit,
  onSubmit,
}: DialogBaseProps & {
  unit: Pick<PropertyDevelopmentUnit, 'unit_number' | 'building_name' | 'updated_at' | 'list_price' | 'currency'>
  onSubmit: (values: DevelopmentReservationValues) => Promise<void>
}) {
  const bounds = expirationBounds()
  const [expiration, setExpiration] = useState(() => toDateTimeLocal(new Date(Date.now() + DEFAULT_RESERVATION_MS)))
  const [notes, setNotes] = useState('')
  const [leadSearch, setLeadSearch] = useState('')
  const [selectedLead, setSelectedLead] = useState<{ id: string; name: string } | null>(null)
  const [leadSelectorOpen, setLeadSelectorOpen] = useState(false)
  const [validationError, setValidationError] = useState<string>()
  const debouncedLeadSearch = useDebouncedValue(leadSearch, 300)
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions()
  const canSelectLead = !permissionsLoading && (
    hasPermission('lead_view_own') ||
    hasPermission('lead_view_team') ||
    hasPermission('lead_view_all')
  )
  const leadsQuery = useLeads(
    { search: debouncedLeadSearch, limit: 8 },
    { enabled: open && leadSelectorOpen && canSelectLead },
  )
  const leads = leadsQuery.data ?? []

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const expiresAt = new Date(expiration)
    const now = Date.now()

    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now) {
      setValidationError('Escolha uma data futura para a expiração.')
      return
    }
    if (expiresAt.getTime() > now + THIRTY_DAYS_MS) {
      setValidationError('A reserva pode durar no máximo 30 dias.')
      return
    }

    setValidationError(undefined)
    await onSubmit({
      lead_id: selectedLead?.id || null,
      expires_at: expiresAt.toISOString(),
      notes: notes.trim() || null,
      expected_unit_updated_at: unit.updated_at,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => changeDialogOpen(pending, onOpenChange, nextOpen)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reservar unidade {unit.unit_number}</DialogTitle>
          <DialogDescription>
            {unit.building_name || 'Empreendimento'} · a disponibilidade será confirmada no momento da reserva.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <div className="space-y-2">
            <Label>Lead relacionado</Label>
            {!canSelectLead ? (
              <div className="rounded-[8px] bg-muted/35 p-3 text-xs text-muted-foreground">
                Seu perfil não pode consultar leads. A reserva pode ser criada sem esse vínculo.
              </div>
            ) : selectedLead ? (
              <div className="flex items-center justify-between rounded-[8px] border-0 bg-primary/5 p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary"><User className="h-4 w-4" /></span>
                  <span className="truncate text-sm font-normal">{selectedLead.name}</span>
                </div>
                <Button type="button" variant="ghost" size="icon" onClick={() => setSelectedLead(null)} aria-label="Remover lead" disabled={pending}><X className="h-4 w-4" /></Button>
              </div>
            ) : (
              <Popover open={leadSelectorOpen} onOpenChange={(nextOpen) => { if (!pending) setLeadSelectorOpen(nextOpen) }}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="w-full justify-start border-dashed text-muted-foreground" disabled={pending}><Search className="mr-2 h-4 w-4" />Buscar por nome, telefone ou e-mail</Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(420px,calc(100vw-2rem))] p-0" align="start">
                  <Command filter={commandSearchFilter}>
                    <CommandInput placeholder="Buscar lead..." value={leadSearch} onValueChange={setLeadSearch} />
                    <CommandList>
                      <CommandEmpty>
                        {leadsQuery.isLoading
                          ? 'Buscando leads...'
                          : leadsQuery.isError
                            ? 'Não foi possível buscar leads. Feche e abra a busca para tentar novamente.'
                            : 'Nenhum lead encontrado.'}
                      </CommandEmpty>
                      <CommandGroup>
                        {leads.map((lead) => (
                          <CommandItem
                            key={lead.id}
                            value={`${lead.name} ${lead.phone || ''} ${lead.email || ''}`}
                            onSelect={() => {
                              setSelectedLead({ id: lead.id, name: lead.name })
                              setLeadSelectorOpen(false)
                            }}
                            className="flex cursor-pointer items-center gap-3 p-3"
                          >
                            <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0"><span className="block truncate text-sm font-medium">{lead.name}</span><span className="block truncate text-xs text-muted-foreground">{lead.phone || lead.email || 'Sem contato informado'}</span></span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
            <p className="text-xs text-muted-foreground">O vínculo é opcional e pode ser feito depois.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reservation-expiration">Expira em *</Label>
            <Input id="reservation-expiration" type="datetime-local" value={expiration} min={bounds.min} max={bounds.max} onChange={(event) => setExpiration(event.target.value)} required />
            <p className="text-xs text-muted-foreground">Prazo padrão de 48 horas; limite máximo de 30 dias.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reservation-notes">Observações</Label>
            <Textarea id="reservation-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={2_000} placeholder="Condições combinadas, documentos pendentes ou contexto da negociação." />
          </div>
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
            <Button type="submit" disabled={pending || !expiration}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar reserva</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export type DevelopmentUnitPriceValues = PropertyDevelopmentUnitPriceInput

export function DevelopmentUnitPriceDialog({
  open,
  onOpenChange,
  pending,
  unit,
  draftPriceTable,
  activePriceTable,
  onSubmit,
}: DialogBaseProps & {
  unit: PropertyDevelopmentUnit
  draftPriceTable?: { id: string; name: string; updated_at: string } | null
  activePriceTable?: { id: string; name: string; updated_at: string } | null
  onSubmit: (values: DevelopmentUnitPriceValues) => Promise<void>
}) {
  const [listPrice, setListPrice] = useState(String(unit.draft_list_price ?? unit.list_price ?? ''))
  const [minimumPrice, setMinimumPrice] = useState(String(unit.draft_minimum_price ?? unit.minimum_price ?? ''))
  const [paymentTerms, setPaymentTerms] = useState('')
  const [validationError, setValidationError] = useState<string>()
  const draftTableId = unit.draft_price_table_id || null
  const sourceTable = draftPriceTable || (draftTableId
    ? { id: draftTableId, name: unit.draft_price_table_name || 'Tabela em rascunho', updated_at: unit.draft_price_table_updated_at || null }
    : activePriceTable)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const list = Number(listPrice)
    const minimum = minimumPrice ? Number(minimumPrice) : null
    if (!Number.isFinite(list) || list <= 0) {
      setValidationError('Informe um preço de tabela válido.')
      return
    }
    if (minimum != null && (!Number.isFinite(minimum) || minimum <= 0 || minimum > list)) {
      setValidationError('O preço mínimo deve ser positivo e não pode superar o preço de tabela.')
      return
    }

    setValidationError(undefined)
    await onSubmit({
      list_price: list,
      minimum_price: minimum,
      payment_terms: paymentTerms.trim() ? { description: paymentTerms.trim() } : undefined,
      expected_price_table_id: sourceTable?.id || null,
      expected_price_table_updated_at: sourceTable?.updated_at || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => changeDialogOpen(pending, onOpenChange, nextOpen)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar preço da unidade {unit.unit_number}</DialogTitle>
          <DialogDescription>O ajuste será salvo em uma tabela rascunho, preservando a versão comercial vigente.</DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <div className="rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 text-sm">
            <span className="text-muted-foreground">Base de edição</span>
            <p className="mt-1 font-normal">{sourceTable?.name || 'Nova tabela rascunho'}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="unit-list-price">Preço de tabela *</Label><Input id="unit-list-price" type="number" min="0.01" max="1000000000000" step="0.01" value={listPrice} onChange={(event) => setListPrice(event.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="unit-minimum-price">Preço mínimo</Label><Input id="unit-minimum-price" type="number" min="0.01" max="1000000000000" step="0.01" value={minimumPrice} onChange={(event) => setMinimumPrice(event.target.value)} /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="unit-payment-terms">Condições de pagamento</Label><Textarea id="unit-payment-terms" value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} rows={4} placeholder="Ex.: 20% de entrada e saldo em 36 parcelas." /></div>
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
            <Button type="submit" disabled={pending || !listPrice}><CircleDollarSign className="mr-2 h-4 w-4" />{pending ? 'Salvando...' : 'Salvar em rascunho'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export type ReservationAction = 'cancel' | 'convert' | 'extend'

export function DevelopmentReservationActionDialog({
  open,
  onOpenChange,
  pending,
  reservation,
  action,
  onCancel,
  onConvert,
  onExtend,
}: DialogBaseProps & {
  reservation: PropertyDevelopmentReservation
  action: ReservationAction
  onCancel: (reason: string) => Promise<void>
  onConvert: () => Promise<void>
  onExtend: (expiresAt: string) => Promise<void>
}) {
  const bounds = expirationBounds()
  const [reason, setReason] = useState('')
  const [expiration, setExpiration] = useState(() => {
    const currentExpiration = new Date(reservation.expires_at).getTime()
    const nextExpiration = Math.max(Date.now(), currentExpiration) + DEFAULT_RESERVATION_MS
    return toDateTimeLocal(new Date(Math.min(nextExpiration, Date.now() + THIRTY_DAYS_MS)))
  })
  const [validationError, setValidationError] = useState<string>()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (action === 'cancel') {
      if (reason.trim().length < 2) {
        setValidationError('Informe o motivo do cancelamento.')
        return
      }
      await onCancel(reason.trim())
      return
    }
    if (action === 'convert') {
      await onConvert()
      return
    }

    const expiresAt = new Date(expiration)
    const now = Date.now()
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now || expiresAt.getTime() > now + THIRTY_DAYS_MS) {
      setValidationError('Escolha uma data futura dentro do limite de 30 dias.')
      return
    }
    if (expiresAt.getTime() <= new Date(reservation.expires_at).getTime()) {
      setValidationError('O novo prazo precisa ser posterior ao vencimento atual.')
      return
    }
    await onExtend(expiresAt.toISOString())
  }

  const titles: Record<ReservationAction, string> = {
    cancel: 'Cancelar reserva?',
    convert: 'Converter reserva em venda?',
    extend: 'Prorrogar reserva',
  }
  const descriptions: Record<ReservationAction, string> = {
    cancel: 'A unidade voltará ao estoque disponível e o motivo ficará registrado no histórico.',
    convert: 'A unidade será marcada como vendida. Esta ação deve ser usada após a confirmação comercial.',
    extend: 'Defina o novo prazo de validade da reserva, respeitando o limite máximo de 30 dias.',
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => changeDialogOpen(pending, onOpenChange, nextOpen)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{titles[action]}</DialogTitle><DialogDescription>{descriptions[action]}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4"><p className="font-normal">Unidade {reservation.unit_number || reservation.unit_code || reservation.unit_id}</p><p className="mt-1 text-xs font-light text-muted-foreground">{reservation.lead_name || 'Sem lead vinculado'}</p></div>
          {action === 'cancel' && <div className="space-y-2"><Label htmlFor="reservation-cancellation-reason">Motivo *</Label><Textarea id="reservation-cancellation-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={500} autoFocus /></div>}
          {action === 'extend' && <div className="space-y-2"><Label htmlFor="reservation-new-expiration">Nova expiração *</Label><Input id="reservation-new-expiration" type="datetime-local" value={expiration} min={bounds.min} max={bounds.max} onChange={(event) => setExpiration(event.target.value)} required /></div>}
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Voltar</Button><Button type="submit" variant={action === 'cancel' ? 'destructive' : 'default'} disabled={pending}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{action === 'cancel' ? 'Cancelar reserva' : action === 'convert' ? 'Confirmar venda' : 'Salvar novo prazo'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
