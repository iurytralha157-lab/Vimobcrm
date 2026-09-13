'use client'

import type { Dispatch, SetStateAction } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { TextField } from './FeedbackStates'
import type { OwnerFormState } from './model'

type OwnerFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: boolean
  form: OwnerFormState
  setForm: Dispatch<SetStateAction<OwnerFormState>>
  pending: boolean
  onSave: () => void
}

export function OwnerFormDialog({
  open,
  onOpenChange,
  editing,
  form,
  setForm,
  pending,
  onSave,
}: OwnerFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-0">
        <DialogHeader>
          <DialogTitle>
            {editing ? 'Editar proprietário' : 'Novo proprietário'}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 pt-4 md:grid-cols-2">
          <TextField
            label="Nome *"
            value={form.name}
            onChange={(value) =>
              setForm((current) => ({ ...current, name: value }))
            }
            placeholder="Nome completo"
          />
          <TextField
            label="E-mail"
            value={form.email}
            onChange={(value) =>
              setForm((current) => ({ ...current, email: value }))
            }
            placeholder="email@exemplo.com"
          />
          <TextField
            label="Celular"
            value={form.cellphone}
            onChange={(value) =>
              setForm((current) => ({ ...current, cellphone: value }))
            }
            placeholder="(00) 00000-0000"
          />
          <TextField
            label="Origem"
            value={form.media_source}
            onChange={(value) =>
              setForm((current) => ({ ...current, media_source: value }))
            }
            placeholder="Indicação, site..."
          />
          <TextField
            label="Tel. residencial"
            value={form.phone_residential}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                phone_residential: value,
              }))
            }
            placeholder="(00) 0000-0000"
          />
          <TextField
            label="Tel. comercial"
            value={form.phone_commercial}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                phone_commercial: value,
              }))
            }
            placeholder="(00) 0000-0000"
          />
          <div className="flex items-center justify-between rounded-[6px] bg-[var(--app-surface-soft)] p-3 md:col-span-2">
            <Label>Enviar avisos por e-mail</Label>
            <Switch
              checked={form.notify_email}
              onCheckedChange={(checked) =>
                setForm((current) => ({
                  ...current,
                  notify_email: checked,
                }))
              }
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Observações</Label>
            <Textarea
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              placeholder="Observações internas..."
              className="min-h-24 border-0 shadow-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={pending}>
            {pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
