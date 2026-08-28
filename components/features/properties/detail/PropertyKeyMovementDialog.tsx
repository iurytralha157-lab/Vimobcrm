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
import { Textarea } from '@/components/ui/textarea'
import type {
  PropertyKeyMovementInput,
  PropertyKeyMovementType,
  PropertyWorkspaceKey,
} from '@/lib/validation'

const MOVEMENT_LABELS: Partial<Record<PropertyKeyMovementType, string>> = {
  checkout: 'Retirar chave',
  transfer: 'Transferir custódia',
  return: 'Registrar devolução',
  location_change: 'Alterar local',
  mark_lost: 'Marcar como perdida',
  mark_found: 'Registrar localização',
  deactivate: 'Desativar chave',
  reactivate: 'Reativar chave',
}

interface PropertyKeyMovementDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  movementType: Exclude<PropertyKeyMovementType, 'registration'>
  propertyKey?: PropertyWorkspaceKey | null
  pending?: boolean
  onSubmit: (input: PropertyKeyMovementInput) => Promise<void>
}

export function PropertyKeyMovementDialog({
  open,
  onOpenChange,
  movementType,
  propertyKey,
  pending = false,
  onSubmit,
}: PropertyKeyMovementDialogProps) {
  const [holderName, setHolderName] = useState('')
  const [toLocation, setToLocation] = useState(propertyKey?.current_location ?? '')
  const [expectedReturn, setExpectedReturn] = useState('')
  const [notes, setNotes] = useState('')

  const needsHolder = movementType === 'checkout' || movementType === 'transfer'
  const needsLocation = ['return', 'location_change', 'mark_found', 'reactivate'].includes(movementType)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await onSubmit({
      movement_type: movementType,
      holder_name: holderName || null,
      from_location: propertyKey?.current_location ?? null,
      to_location: needsLocation ? toLocation || null : null,
      expected_return_at: expectedReturn ? new Date(expectedReturn).toISOString() : null,
      notes: notes || null,
      metadata: {},
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{MOVEMENT_LABELS[movementType]}</DialogTitle>
            <DialogDescription>
              {propertyKey?.label}. O evento ficará registrado no histórico de custódia.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            {needsHolder && (
              <div className="space-y-2">
                <Label htmlFor="movement-holder">Pessoa responsável</Label>
                <Input
                  id="movement-holder"
                  value={holderName}
                  onChange={(event) => setHolderName(event.target.value)}
                  placeholder="Nome de quem ficará com a chave"
                  required
                />
              </div>
            )}
            {needsLocation && (
              <div className="space-y-2">
                <Label htmlFor="movement-location">Local de destino</Label>
                <Input
                  id="movement-location"
                  value={toLocation}
                  onChange={(event) => setToLocation(event.target.value)}
                  placeholder="Ex.: armário 02"
                  required={movementType === 'location_change'}
                />
              </div>
            )}
            {needsHolder && (
              <div className="space-y-2">
                <Label htmlFor="movement-return">Previsão de devolução</Label>
                <Input id="movement-return" type="datetime-local" value={expectedReturn} onChange={(event) => setExpectedReturn(event.target.value)} />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="movement-notes">Observações</Label>
              <Textarea id="movement-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar movimentação
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
