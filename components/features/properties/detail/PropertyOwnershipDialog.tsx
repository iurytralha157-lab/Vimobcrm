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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type {
  PropertyOwnerOption,
  PropertyOwnershipCreateInput,
  PropertyOwnershipUpdateInput,
  PropertyWorkspaceOwnership,
} from '@/lib/validation'

type OwnershipSubmitInput =
  | { mode: 'create'; input: PropertyOwnershipCreateInput }
  | { mode: 'update'; ownershipId: string; input: PropertyOwnershipUpdateInput }

interface PropertyOwnershipDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ownership?: PropertyWorkspaceOwnership | null
  ownerOptions: PropertyOwnerOption[]
  ownerOptionsLoading?: boolean
  canViewOwnerContacts: boolean
  pending?: boolean
  onSubmit: (command: OwnershipSubmitInput) => Promise<void>
}

function localToday() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

function valueOrNull(value: string) {
  return value.trim() || null
}

export function PropertyOwnershipDialog({
  open,
  onOpenChange,
  ownership,
  ownerOptions,
  ownerOptionsLoading = false,
  canViewOwnerContacts,
  pending = false,
  onSubmit,
}: PropertyOwnershipDialogProps) {
  const editing = Boolean(ownership)
  const [ownerMode, setOwnerMode] = useState<'existing' | 'new'>('existing')
  const [ownerId, setOwnerId] = useState('')
  const [name, setName] = useState(ownership?.owner.name ?? '')
  const [cellphone, setCellphone] = useState(ownership?.owner.cellphone ?? '')
  const [email, setEmail] = useState(ownership?.owner.email ?? '')
  const [phoneResidential, setPhoneResidential] = useState(ownership?.owner.phone_residential ?? '')
  const [phoneCommercial, setPhoneCommercial] = useState(ownership?.owner.phone_commercial ?? '')
  const [mediaSource, setMediaSource] = useState(ownership?.owner.media_source ?? '')
  const [notifyEmail, setNotifyEmail] = useState(ownership?.owner.notify_email ?? false)
  const [ownerNotes, setOwnerNotes] = useState(ownership?.owner.notes ?? '')
  const [ownershipPercentage, setOwnershipPercentage] = useState(String(ownership?.ownership_percentage ?? 100))
  const [isPrimary, setIsPrimary] = useState(ownership?.is_primary ?? false)
  const [validFrom, setValidFrom] = useState(ownership?.valid_from ?? localToday())
  const [notes, setNotes] = useState(ownership?.notes ?? '')

  const ownerDetails = {
    name,
    phone_residential: valueOrNull(phoneResidential),
    phone_commercial: valueOrNull(phoneCommercial),
    cellphone: valueOrNull(cellphone),
    email: valueOrNull(email),
    media_source: valueOrNull(mediaSource),
    notify_email: Boolean(email.trim()) && notifyEmail,
    notes: valueOrNull(ownerNotes),
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const relationship = {
      ownership_percentage: Number(ownershipPercentage),
      is_primary: isPrimary,
      valid_from: validFrom,
      notes: valueOrNull(notes),
    }

    if (ownership) {
      await onSubmit({
        mode: 'update',
        ownershipId: ownership.id,
        input: {
          ...relationship,
          owner: canViewOwnerContacts
            ? { ...ownerDetails, expected_updated_at: ownership.owner.updated_at }
            : undefined,
          expected_updated_at: ownership.updated_at,
        },
      })
      return
    }

    await onSubmit({
      mode: 'create',
      input: {
        ...relationship,
        owner_id: ownerMode === 'existing' ? ownerId : undefined,
        new_owner: ownerMode === 'new' ? ownerDetails : undefined,
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar proprietário e participação' : 'Vincular proprietário'}</DialogTitle>
            <DialogDescription>
              Registre o titular, sua participação e o período válido deste vínculo.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-5">
            {!editing && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ownership-owner-mode">Origem do proprietário</Label>
                  <Select value={ownerMode} onValueChange={(value) => setOwnerMode(value as 'existing' | 'new')}>
                    <SelectTrigger id="ownership-owner-mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="existing">Vincular cadastro existente</SelectItem>
                      <SelectItem value="new">Cadastrar novo proprietário</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {ownerMode === 'existing' && (
                  <div className="space-y-2">
                    <Label htmlFor="ownership-owner">Proprietário</Label>
                    <Select value={ownerId} onValueChange={setOwnerId} disabled={ownerOptionsLoading}>
                      <SelectTrigger id="ownership-owner">
                        <SelectValue placeholder={ownerOptionsLoading ? 'Carregando...' : 'Selecione'} />
                      </SelectTrigger>
                      <SelectContent>
                        {ownerOptions.map((owner) => (
                          <SelectItem key={owner.id} value={owner.id}>{owner.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}

            {(editing || ownerMode === 'new') && (
              <div className="grid gap-4 rounded-lg border p-4">
                <div className="space-y-2">
                  <Label htmlFor="ownership-owner-name">Nome completo</Label>
                  <Input
                    id="ownership-owner-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    maxLength={160}
                    disabled={editing && !canViewOwnerContacts}
                  />
                </div>
                {(!editing || canViewOwnerContacts) && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="ownership-cellphone">Celular</Label>
                        <Input id="ownership-cellphone" value={cellphone} onChange={(event) => setCellphone(event.target.value)} maxLength={40} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="ownership-email">E-mail</Label>
                        <Input id="ownership-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={160} />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="ownership-phone-residential">Telefone residencial</Label>
                        <Input id="ownership-phone-residential" value={phoneResidential} onChange={(event) => setPhoneResidential(event.target.value)} maxLength={40} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="ownership-phone-commercial">Telefone comercial</Label>
                        <Input id="ownership-phone-commercial" value={phoneCommercial} onChange={(event) => setPhoneCommercial(event.target.value)} maxLength={40} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ownership-media-source">Origem do contato</Label>
                      <Input id="ownership-media-source" value={mediaSource} onChange={(event) => setMediaSource(event.target.value)} maxLength={80} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ownership-owner-notes">Observações do proprietário</Label>
                      <Textarea id="ownership-owner-notes" value={ownerNotes} onChange={(event) => setOwnerNotes(event.target.value)} rows={2} maxLength={1_200} />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <Label htmlFor="ownership-notify-email">Receber notificações por e-mail</Label>
                        <p className="text-xs text-muted-foreground">Usa o endereço cadastrado acima.</p>
                      </div>
                      <Switch id="ownership-notify-email" checked={notifyEmail} onCheckedChange={setNotifyEmail} disabled={!email.trim()} />
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ownership-percentage">Participação (%)</Label>
                <Input
                  id="ownership-percentage"
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  value={ownershipPercentage}
                  onChange={(event) => setOwnershipPercentage(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ownership-valid-from">Válido desde</Label>
                <Input id="ownership-valid-from" type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} required />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label htmlFor="ownership-primary">Proprietário principal</Label>
                <p className="text-xs text-muted-foreground">O imóvel pode ter somente um titular principal por período.</p>
              </div>
              <Switch id="ownership-primary" checked={isPrimary} onCheckedChange={setIsPrimary} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ownership-notes">Observações do vínculo</Label>
              <Textarea id="ownership-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={1_200} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
            <Button type="submit" disabled={pending || (!editing && ownerMode === 'existing' && !ownerId)}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? 'Salvar alterações' : 'Vincular proprietário'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export type { OwnershipSubmitInput }
