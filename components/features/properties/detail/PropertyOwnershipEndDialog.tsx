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
import type { PropertyOwnershipEndInput, PropertyWorkspaceOwnership } from '@/lib/validation'

interface PropertyOwnershipEndDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ownership: PropertyWorkspaceOwnership
  pending?: boolean
  onSubmit: (input: PropertyOwnershipEndInput) => Promise<void>
}

function localToday() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

export function PropertyOwnershipEndDialog({
  open,
  onOpenChange,
  ownership,
  pending = false,
  onSubmit,
}: PropertyOwnershipEndDialogProps) {
  const minimumValidTo = nextDate(ownership.valid_from)
  const [validTo, setValidTo] = useState(() => {
    const today = localToday()
    return today > minimumValidTo ? today : minimumValidTo
  })

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await onSubmit({
      valid_to: validTo,
      expected_updated_at: ownership.updated_at,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Encerrar vínculo de propriedade</DialogTitle>
            <DialogDescription>
              {ownership.owner.name} deixará de aparecer como proprietário ativo a partir da data informada. O período anterior ficará preservado no histórico.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-5">
            <Label htmlFor="ownership-valid-to">Encerrar a partir de</Label>
            <Input
              id="ownership-valid-to"
              type="date"
              min={minimumValidTo}
              value={validTo}
              onChange={(event) => setValidTo(event.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Encerrar vínculo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
