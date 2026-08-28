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
import type { PropertyKeyCreateInput } from '@/lib/validation'

interface PropertyKeyCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending?: boolean
  onSubmit: (input: PropertyKeyCreateInput) => Promise<void>
}

export function PropertyKeyCreateDialog({ open, onOpenChange, pending = false, onSubmit }: PropertyKeyCreateDialogProps) {
  const [label, setLabel] = useState('Chave principal')
  const [keyCode, setKeyCode] = useState('')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await onSubmit({
      label,
      key_code: keyCode || null,
      current_location: location || null,
      notes: notes || null,
      metadata: {},
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Cadastrar chave</DialogTitle>
            <DialogDescription>Registre o conjunto físico e o local onde ele começa sob custódia.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <div className="space-y-2">
              <Label htmlFor="key-label">Identificação</Label>
              <Input id="key-label" value={label} onChange={(event) => setLabel(event.target.value)} required maxLength={120} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="key-code">Código interno</Label>
                <Input id="key-code" value={keyCode} onChange={(event) => setKeyCode(event.target.value)} maxLength={120} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="key-location">Local atual</Label>
                <Input id="key-location" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Ex.: recepção" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="key-notes">Observações</Label>
              <Textarea id="key-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cadastrar chave
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
