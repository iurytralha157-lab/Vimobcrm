'use client'

import type { Dispatch, SetStateAction } from 'react'
import { Loader2, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type {
  PropertyCity,
  PropertyNeighborhood,
} from '@/hooks/use-property-locations'

import { TextField } from './FeedbackStates'
import {
  UF_OPTIONS,
  type CityFormState,
  type CondominiumFormState,
  type NeighborhoodFormState,
} from './model'

const EMPTY_SELECT_VALUE = '__none__'

type BaseDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  editing: boolean
  onSubmit: () => void
}

type CityFormDialogProps = BaseDialogProps & {
  form: CityFormState
  setForm: Dispatch<SetStateAction<CityFormState>>
}

export function CityFormDialog({
  open,
  onOpenChange,
  pending,
  editing,
  onSubmit,
  form,
  setForm,
}: CityFormDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen)
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Nova cidade
        </Button>
      </DialogTrigger>
      <DialogContent className="border-0">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar cidade' : 'Nova cidade'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label>Nome da cidade *</Label>
            <Input
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="Ex: São Paulo"
            />
          </div>
          <div className="space-y-2">
            <Label>UF</Label>
            <Select
              value={form.uf || EMPTY_SELECT_VALUE}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  uf: value === EMPTY_SELECT_VALUE ? '' : value,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EMPTY_SELECT_VALUE}>Sem UF</SelectItem>
                {UF_OPTIONS.map((uf) => (
                  <SelectItem key={uf} value={uf}>
                    {uf}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button onClick={onSubmit} disabled={pending}>
              {pending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {editing ? 'Salvar alterações' : 'Cadastrar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type NeighborhoodFormDialogProps = BaseDialogProps & {
  cities: PropertyCity[]
  form: NeighborhoodFormState
  setForm: Dispatch<SetStateAction<NeighborhoodFormState>>
}

export function NeighborhoodFormDialog({
  open,
  onOpenChange,
  pending,
  editing,
  onSubmit,
  cities,
  form,
  setForm,
}: NeighborhoodFormDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen)
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Novo bairro
        </Button>
      </DialogTrigger>
      <DialogContent className="border-0">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar bairro' : 'Novo bairro'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label>Cidade *</Label>
            <Select
              value={form.city_id}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  city_id: value,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a cidade" />
              </SelectTrigger>
              <SelectContent>
                {cities.map((city) => (
                  <SelectItem key={city.id} value={city.id}>
                    {city.name} {city.uf ? `(${city.uf})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Nome do bairro *</Label>
            <Input
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="Ex: Centro"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button onClick={onSubmit} disabled={pending}>
              {pending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {editing ? 'Salvar alterações' : 'Cadastrar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type CondominiumFormDialogProps = BaseDialogProps & {
  cities: PropertyCity[]
  neighborhoods: PropertyNeighborhood[]
  form: CondominiumFormState
  setForm: Dispatch<SetStateAction<CondominiumFormState>>
  onSelectedCityChange: (cityId: string) => void
}

export function CondominiumFormDialog({
  open,
  onOpenChange,
  pending,
  editing,
  onSubmit,
  cities,
  neighborhoods,
  form,
  setForm,
  onSelectedCityChange,
}: CondominiumFormDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen)
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Novo condomínio
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-0">
        <DialogHeader>
          <DialogTitle>
            {editing ? 'Editar condomínio' : 'Novo condomínio'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label>Nome do condomínio *</Label>
            <Input
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="Ex: Residencial das Flores"
            />
          </div>
          <div className="space-y-2">
            <Label>Cidade</Label>
            <Select
              value={form.city_id || EMPTY_SELECT_VALUE}
              onValueChange={(value) => {
                const cityId = value === EMPTY_SELECT_VALUE ? '' : value
                onSelectedCityChange(cityId)
                setForm((current) => ({
                  ...current,
                  city_id: cityId,
                  neighborhood_id: '',
                }))
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a cidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EMPTY_SELECT_VALUE}>
                  Sem cidade informada
                </SelectItem>
                {cities.map((city) => (
                  <SelectItem key={city.id} value={city.id}>
                    {city.name} {city.uf ? `(${city.uf})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Bairro</Label>
            <Select
              value={form.neighborhood_id || EMPTY_SELECT_VALUE}
              onValueChange={(value) => {
                const neighborhoodId =
                  value === EMPTY_SELECT_VALUE ? '' : value
                const neighborhood = neighborhoods.find(
                  ({ id }) => id === neighborhoodId,
                )
                const cityId = neighborhood?.city_id || form.city_id
                if (neighborhood?.city_id) onSelectedCityChange(cityId)
                setForm((current) => ({
                  ...current,
                  city_id: cityId,
                  neighborhood_id: neighborhoodId,
                }))
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o bairro" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EMPTY_SELECT_VALUE}>
                  Sem bairro informado
                </SelectItem>
                {neighborhoods.map((neighborhood) => (
                  <SelectItem key={neighborhood.id} value={neighborhood.id}>
                    {neighborhood.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Endereço</Label>
            <Input
              value={form.address}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  address: event.target.value,
                }))
              }
              placeholder="Ex: Rua das Flores, 123"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <TextField
              label="CEP"
              value={form.cep}
              onChange={(value) =>
                setForm((current) => ({ ...current, cep: value }))
              }
              placeholder="00000-000"
            />
            <TextField
              label="Número"
              value={form.number}
              onChange={(value) =>
                setForm((current) => ({ ...current, number: value }))
              }
              placeholder="123"
            />
            <TextField
              label="Complemento"
              value={form.complement}
              onChange={(value) =>
                setForm((current) => ({ ...current, complement: value }))
              }
              placeholder="Bloco, portaria..."
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextField
              label="Taxa padrão do condomínio (R$)"
              value={form.default_condominium_fee}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  default_condominium_fee: value.replace(/[^\d.,]/g, ''),
                }))
              }
              placeholder="800"
            />
            <TextField
              label="Foto do condomínio (URL)"
              value={form.photo_url}
              onChange={(value) =>
                setForm((current) => ({ ...current, photo_url: value }))
              }
              placeholder="https://..."
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between gap-3 rounded-[6px] bg-[var(--app-surface-soft)] p-3">
              <Label>Tem portaria</Label>
              <Switch
                checked={form.has_concierge}
                onCheckedChange={(checked) =>
                  setForm((current) => ({
                    ...current,
                    has_concierge: checked,
                    concierge_type: checked ? current.concierge_type : '',
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo de portaria</Label>
              <Select
                value={form.concierge_type || EMPTY_SELECT_VALUE}
                disabled={!form.has_concierge}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    concierge_type:
                      value === EMPTY_SELECT_VALUE ? '' : value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_SELECT_VALUE}>
                    Não informado
                  </SelectItem>
                  <SelectItem value="24h">24h</SelectItem>
                  <SelectItem value="comercial">Horário comercial</SelectItem>
                  <SelectItem value="remota">Remota</SelectItem>
                  <SelectItem value="sem_portaria">Sem portaria</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <TextField
            label="Observações internas"
            value={form.notes}
            onChange={(value) =>
              setForm((current) => ({ ...current, notes: value }))
            }
            placeholder="Acesso, referência, regras internas..."
          />
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button onClick={onSubmit} disabled={pending}>
              {pending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {editing ? 'Salvar alterações' : 'Cadastrar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
