'use client'

import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type {
  PropertyOfferStatus,
  PropertyOfferType,
  PropertyOfferUpsertInput,
  PropertyWorkspaceOffer,
} from '@/lib/validation'

const OFFER_LABELS: Record<PropertyOfferType, string> = {
  sale: 'Venda',
  rent: 'Locação',
  seasonal: 'Temporada',
}

const STATUS_OPTIONS: Array<{ value: PropertyOfferStatus; label: string }> = [
  { value: 'draft', label: 'Rascunho' },
  { value: 'active', label: 'Ativa' },
  { value: 'paused', label: 'Pausada' },
  { value: 'reserved', label: 'Reservada' },
  { value: 'completed', label: 'Concluída' },
  { value: 'withdrawn', label: 'Retirada' },
  { value: 'expired', label: 'Expirada' },
]

interface PropertyOfferDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  offerType: PropertyOfferType
  offer?: PropertyWorkspaceOffer | null
  pending?: boolean
  onSubmit: (input: PropertyOfferUpsertInput) => Promise<void>
}

export function PropertyOfferDialog({
  open,
  onOpenChange,
  offerType,
  offer,
  pending = false,
  onSubmit,
}: PropertyOfferDialogProps) {
  const [status, setStatus] = useState<PropertyOfferStatus>(offer?.status ?? 'draft')
  const [price, setPrice] = useState(offer?.price != null ? String(offer.price) : '')
  const [currency, setCurrency] = useState(offer?.currency ?? 'BRL')
  const [pricePeriod, setPricePeriod] = useState(
    offer?.price_period ?? (offerType === 'sale' ? 'total' : offerType === 'rent' ? 'monthly' : 'daily'),
  )
  const [availableFrom, setAvailableFrom] = useState(offer?.available_from ?? '')
  const [availableUntil, setAvailableUntil] = useState(offer?.available_until ?? '')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await onSubmit({
      status,
      price: price.trim() === '' ? null : Number(price),
      currency,
      price_period: pricePeriod as PropertyOfferUpsertInput['price_period'],
      available_from: availableFrom || null,
      available_until: availableUntil || null,
      terms: offer?.terms ?? {},
      metadata: offer?.metadata ?? {},
      expected_updated_at: offer?.updated_at,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{offer ? 'Editar' : 'Criar'} oferta de {OFFER_LABELS[offerType].toLowerCase()}</DialogTitle>
            <DialogDescription>
              Venda, locação e temporada convivem como ofertas independentes do mesmo imóvel.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="offer-status">Situação</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as PropertyOfferStatus)}>
                <SelectTrigger id="offer-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="offer-currency">Moeda</Label>
              <Input
                id="offer-currency"
                maxLength={3}
                value={currency}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="offer-price">Valor</Label>
              <Input
                id="offer-price"
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="offer-period">Periodicidade</Label>
              <Select
                value={pricePeriod}
                onValueChange={(value) => setPricePeriod(value as NonNullable<PropertyOfferUpsertInput['price_period']>)}
                disabled={offerType === 'sale'}
              >
                <SelectTrigger id="offer-period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="total">Valor total</SelectItem>
                  <SelectItem value="daily">Diária</SelectItem>
                  <SelectItem value="weekly">Semanal</SelectItem>
                  <SelectItem value="monthly">Mensal</SelectItem>
                  <SelectItem value="yearly">Anual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="offer-from">Disponível a partir de</Label>
              <Input id="offer-from" type="date" value={availableFrom} onChange={(event) => setAvailableFrom(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="offer-until">Disponível até</Label>
              <Input id="offer-until" type="date" value={availableUntil} onChange={(event) => setAvailableUntil(event.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar oferta
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
