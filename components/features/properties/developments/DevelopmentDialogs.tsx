'use client'

import { type FormEvent, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type {
  PropertyDevelopmentBuildingCreateInput,
  PropertyDevelopmentBulkUnitsInput,
  PropertyDevelopmentCreateInput,
  PropertyDevelopmentFloorPlanCreateInput,
  PropertyDevelopmentPhaseCreateInput,
  PropertyDevelopmentType,
  PropertyDevelopmentUnitPatchInput,
  PropertyDevelopmentUnitStatus,
} from '@/lib/validation'

import {
  BUILDING_TYPE_LABELS,
  DEVELOPMENT_STATUS_LABELS,
  DEVELOPMENT_TYPE_LABELS,
  PHASE_STATUS_LABELS,
  UNIT_STATUS_LABELS,
} from './development-ui'

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

export type DevelopmentCreateValues = PropertyDevelopmentCreateInput

export function DevelopmentCreateDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: DialogBaseProps & { onSubmit: (values: DevelopmentCreateValues) => Promise<void> }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [developerName, setDeveloperName] = useState('')
  const [developmentType, setDevelopmentType] = useState<PropertyDevelopmentType>('vertical')
  const [status, setStatus] = useState<NonNullable<PropertyDevelopmentCreateInput['status']>>('planning')
  const [summary, setSummary] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await onSubmit({
      code: code.trim(),
      name: name.trim(),
      developer_name: developerName.trim() || undefined,
      development_type: developmentType,
      status,
      commercial_status: 'draft',
      summary: summary.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim().toUpperCase() || undefined,
      neighborhood: neighborhood.trim() || undefined,
      expected_delivery_date: expectedDeliveryDate || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => changeDialogOpen(pending, onOpenChange, nextOpen)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo empreendimento</DialogTitle>
          <DialogDescription>Cadastre a base comercial agora. Fases, torres, plantas e unidades entram na próxima etapa.</DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <div className="space-y-2">
              <Label htmlFor="development-code">Código *</Label>
              <Input id="development-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="VMB-001" required maxLength={80} autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="development-name">Nome do empreendimento *</Label>
              <Input id="development-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Residencial Horizonte" required minLength={2} maxLength={200} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="development-developer">Incorporadora ou construtora</Label>
            <Input id="development-developer" value={developerName} onChange={(event) => setDeveloperName(event.target.value)} placeholder="Nome da empresa responsável" maxLength={160} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="development-type">Tipo</Label>
              <Select value={developmentType} onValueChange={(value) => setDevelopmentType(value as PropertyDevelopmentType)}>
                <SelectTrigger id="development-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DEVELOPMENT_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="development-status">Etapa</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as NonNullable<PropertyDevelopmentCreateInput['status']>)}>
                <SelectTrigger id="development-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DEVELOPMENT_STATUS_LABELS).filter(([value]) => !['cancelled', 'archived'].includes(value)).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="development-summary">Resumo comercial</Label>
            <Textarea id="development-summary" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Posicionamento, diferenciais e público do lançamento…" rows={3} maxLength={600} />
          </div>
          <fieldset className="space-y-3 rounded-[8px] bg-[var(--app-surface-soft)] p-4">
            <legend className="px-1 text-sm font-normal">Localização</legend>
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_88px]">
              <div className="space-y-2">
                <Label htmlFor="development-neighborhood">Bairro</Label>
                <Input id="development-neighborhood" value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="development-city">Cidade</Label>
                <Input id="development-city" value={city} onChange={(event) => setCity(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="development-state">UF</Label>
                <Input id="development-state" value={state} onChange={(event) => setState(event.target.value.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase())} maxLength={2} />
              </div>
            </div>
          </fieldset>
          <div className="space-y-2 sm:max-w-xs">
            <Label htmlFor="development-delivery">Previsão de entrega</Label>
            <Input id="development-delivery" type="date" value={expectedDeliveryDate} onChange={(event) => setExpectedDeliveryDate(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
            <Button type="submit" disabled={pending || !code.trim() || name.trim().length < 2}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar empreendimento
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export type DevelopmentPhaseValues = PropertyDevelopmentPhaseCreateInput

export function DevelopmentPhaseDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: DialogBaseProps & { onSubmit: (values: DevelopmentPhaseValues) => Promise<void> }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [status, setStatus] = useState<NonNullable<PropertyDevelopmentPhaseCreateInput['status']>>('planned')
  const [launchDate, setLaunchDate] = useState('')
  const [deliveryDate, setDeliveryDate] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await onSubmit({ code: code.trim(), name: name.trim(), status, launch_date: launchDate || undefined, expected_delivery_date: deliveryDate || undefined })
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => changeDialogOpen(pending, onOpenChange, nextOpen)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Nova fase</DialogTitle><DialogDescription>Organize o lançamento e a entrega em etapas independentes.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
            <div className="space-y-2"><Label htmlFor="phase-code">Código *</Label><Input id="phase-code" value={code} onChange={(event) => setCode(event.target.value)} required autoFocus /></div>
            <div className="space-y-2"><Label htmlFor="phase-name">Nome *</Label><Input id="phase-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Fase 1" required /></div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="phase-status">Status</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as NonNullable<PropertyDevelopmentPhaseCreateInput['status']>)}><SelectTrigger id="phase-status"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(PHASE_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="phase-launch">Lançamento</Label><Input id="phase-launch" type="date" value={launchDate} onChange={(event) => setLaunchDate(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="phase-delivery">Entrega prevista</Label><Input id="phase-delivery" type="date" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} /></div>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button><Button type="submit" disabled={pending || !code.trim() || !name.trim()}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar fase</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export type DevelopmentBuildingValues = PropertyDevelopmentBuildingCreateInput

export function DevelopmentBuildingDialog({
  open,
  onOpenChange,
  pending,
  phases,
  defaultPhaseId,
  onSubmit,
}: DialogBaseProps & {
  phases: Array<{ id: string; name: string }>
  defaultPhaseId?: string
  onSubmit: (values: DevelopmentBuildingValues) => Promise<void>
}) {
  const [phaseId, setPhaseId] = useState(defaultPhaseId || phases[0]?.id || '')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [buildingType, setBuildingType] = useState<NonNullable<PropertyDevelopmentBuildingCreateInput['building_type']>>('tower')
  const [floorCount, setFloorCount] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await onSubmit({
      phase_id: phaseId,
      code: code.trim(),
      name: name.trim(),
      building_type: buildingType,
      floor_count: floorCount ? Number(floorCount) : undefined,
      status: 'planned',
    })
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => changeDialogOpen(pending, onOpenChange, nextOpen)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Nova torre ou agrupador</DialogTitle><DialogDescription>Vincule a estrutura a uma fase para manter o espelho de unidades organizado.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2"><Label htmlFor="building-phase">Fase *</Label><Select value={phaseId} onValueChange={setPhaseId}><SelectTrigger id="building-phase"><SelectValue placeholder="Selecione uma fase" /></SelectTrigger><SelectContent>{phases.map((phase) => <SelectItem key={phase.id} value={phase.id}>{phase.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
            <div className="space-y-2"><Label htmlFor="building-code">Código *</Label><Input id="building-code" value={code} onChange={(event) => setCode(event.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="building-name">Nome *</Label><Input id="building-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Torre A" required /></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="building-type">Tipo</Label><Select value={buildingType} onValueChange={(value) => setBuildingType(value as NonNullable<PropertyDevelopmentBuildingCreateInput['building_type']>)}><SelectTrigger id="building-type"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(BUILDING_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="building-floors">Quantidade de andares</Label><Input id="building-floors" type="number" min={0} value={floorCount} onChange={(event) => setFloorCount(event.target.value)} /></div>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button><Button type="submit" disabled={pending || !phaseId || !code.trim() || !name.trim()}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar estrutura</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export type DevelopmentFloorPlanValues = PropertyDevelopmentFloorPlanCreateInput

function optionalNumber(value: string) {
  return value === '' ? undefined : Number(value)
}

export function DevelopmentFloorPlanDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: DialogBaseProps & { onSubmit: (values: DevelopmentFloorPlanValues) => Promise<void> }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [propertyType, setPropertyType] = useState('Apartamento')
  const [bedrooms, setBedrooms] = useState('')
  const [suites, setSuites] = useState('')
  const [bathrooms, setBathrooms] = useState('')
  const [parkingSpaces, setParkingSpaces] = useState('')
  const [privateArea, setPrivateArea] = useState('')
  const [totalArea, setTotalArea] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await onSubmit({
      code: code.trim(),
      name: name.trim(),
      status: 'active',
      property_type: propertyType.trim() || undefined,
      bedrooms: optionalNumber(bedrooms),
      suites: optionalNumber(suites),
      bathrooms: optionalNumber(bathrooms),
      parking_spaces: optionalNumber(parkingSpaces),
      private_area: optionalNumber(privateArea),
      total_area: optionalNumber(totalArea),
      description: description.trim() || undefined,
      image_url: imageUrl.trim() || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => changeDialogOpen(pending, onOpenChange, nextOpen)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Nova planta</DialogTitle><DialogDescription>Crie uma tipologia reutilizável em diferentes torres e unidades.</DialogDescription></DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-[140px_1fr_1fr]">
            <div className="space-y-2"><Label htmlFor="plan-code">Código *</Label><Input id="plan-code" value={code} onChange={(event) => setCode(event.target.value)} required autoFocus /></div>
            <div className="space-y-2"><Label htmlFor="plan-name">Nome *</Label><Input id="plan-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Tipo 68 m²" required /></div>
            <div className="space-y-2"><Label htmlFor="plan-type">Tipo de imóvel</Label><Input id="plan-type" value={propertyType} onChange={(event) => setPropertyType(event.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[['Quartos', bedrooms, setBedrooms, 'plan-bedrooms'], ['Suítes', suites, setSuites, 'plan-suites'], ['Banheiros', bathrooms, setBathrooms, 'plan-bathrooms'], ['Vagas', parkingSpaces, setParkingSpaces, 'plan-parking']].map(([label, value, setter, id]) => (
              <div className="space-y-2" key={String(id)}><Label htmlFor={String(id)}>{String(label)}</Label><Input id={String(id)} type="number" min={0} value={value as string} onChange={(event) => (setter as (value: string) => void)(event.target.value)} /></div>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="plan-private-area">Área privativa (m²)</Label><Input id="plan-private-area" type="number" min={0.01} step="0.01" value={privateArea} onChange={(event) => setPrivateArea(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="plan-total-area">Área total (m²)</Label><Input id="plan-total-area" type="number" min={0.01} step="0.01" value={totalArea} onChange={(event) => setTotalArea(event.target.value)} /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="plan-image">Imagem da planta (URL)</Label><Input id="plan-image" type="url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://…" /></div>
          <div className="space-y-2"><Label htmlFor="plan-description">Descrição</Label><Textarea id="plan-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button><Button type="submit" disabled={pending || !code.trim() || !name.trim()}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar planta</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export type DevelopmentBulkUnitsValues = PropertyDevelopmentBulkUnitsInput

export function DevelopmentBulkUnitsDialog({
  open,
  onOpenChange,
  pending,
  buildings,
  floorPlans,
  onSubmit,
}: DialogBaseProps & {
  buildings: Array<{ id: string; name: string }>
  floorPlans: Array<{ id: string; name: string }>
  onSubmit: (values: DevelopmentBulkUnitsValues) => Promise<void>
}) {
  const [buildingId, setBuildingId] = useState(buildings[0]?.id || '')
  const [floorPlanId, setFloorPlanId] = useState('none')
  const [startFloor, setStartFloor] = useState('1')
  const [unitsPerFloor, setUnitsPerFloor] = useState('4')
  const [startNumber, setStartNumber] = useState('101')
  const [count, setCount] = useState('40')
  const [numberPadding, setNumberPadding] = useState('3')
  const [prefix, setPrefix] = useState('')
  const [initialListPrice, setInitialListPrice] = useState('')
  const [priceTableName, setPriceTableName] = useState('Tabela de lançamento')
  const estimatedUnits = Math.max(0, Number(count))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await onSubmit({
      building_id: buildingId,
      floor_plan_id: floorPlanId === 'none' ? null : floorPlanId,
      prefix: prefix.trim(),
      start_number: Number(startNumber),
      count: Number(count),
      start_floor: Number(startFloor),
      units_per_floor: Number(unitsPerFloor),
      number_padding: Number(numberPadding),
			initial_list_price: Number(initialListPrice),
			price_table_name: priceTableName.trim() || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => changeDialogOpen(pending, onOpenChange, nextOpen)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Gerar unidades em lote</DialogTitle><DialogDescription>Crie o espelho de uma torre de uma só vez. A API valida duplicidades antes de gravar.</DialogDescription></DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="bulk-building">Torre ou agrupador *</Label><Select value={buildingId} onValueChange={setBuildingId}><SelectTrigger id="bulk-building"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{buildings.map((building) => <SelectItem key={building.id} value={building.id}>{building.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="bulk-plan">Planta padrão</Label><Select value={floorPlanId} onValueChange={setFloorPlanId}><SelectTrigger id="bulk-plan"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sem planta vinculada</SelectItem>{floorPlans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <fieldset className="space-y-4 rounded-[8px] bg-[var(--app-surface-soft)] p-4">
            <legend className="px-1 text-sm font-normal">Sequência</legend>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="space-y-2"><Label htmlFor="bulk-floor-start">Andar inicial</Label><Input id="bulk-floor-start" type="number" value={startFloor} onChange={(event) => setStartFloor(event.target.value)} required /></div>
              <div className="space-y-2"><Label htmlFor="bulk-units-floor">Unid./andar</Label><Input id="bulk-units-floor" type="number" min={1} max={100} value={unitsPerFloor} onChange={(event) => setUnitsPerFloor(event.target.value)} required /></div>
              <div className="space-y-2"><Label htmlFor="bulk-start-number">Nº inicial</Label><Input id="bulk-start-number" type="number" min={0} value={startNumber} onChange={(event) => setStartNumber(event.target.value)} required /></div>
              <div className="space-y-2"><Label htmlFor="bulk-count">Quantidade</Label><Input id="bulk-count" type="number" min={1} max={500} value={count} onChange={(event) => setCount(event.target.value)} required /></div>
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-[1fr_150px]">
            <div className="space-y-2"><Label htmlFor="bulk-prefix">Prefixo do código</Label><Input id="bulk-prefix" value={prefix} onChange={(event) => setPrefix(event.target.value)} placeholder="TORRE-A-" maxLength={24} /></div>
            <div className="space-y-2"><Label htmlFor="bulk-padding">Dígitos do número</Label><Input id="bulk-padding" type="number" min={0} max={8} value={numberPadding} onChange={(event) => setNumberPadding(event.target.value)} /></div>
          </div>
          <fieldset className="space-y-4 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-4">
			<legend className="px-1 text-sm font-normal">Tabela comercial inicial</legend>
            <div className="grid gap-4 sm:grid-cols-2">
			  <div className="space-y-2"><Label htmlFor="bulk-price">Preço de lista (R$) *</Label><Input id="bulk-price" type="number" min={0.01} max={1000000000000} step="0.01" value={initialListPrice} onChange={(event) => setInitialListPrice(event.target.value)} placeholder="650000" required /></div>
			  <div className="space-y-2"><Label htmlFor="bulk-price-table">Nome da tabela</Label><Input id="bulk-price-table" value={priceTableName} onChange={(event) => setPriceTableName(event.target.value)} /></div>
            </div>
          </fieldset>
          <div className="flex items-center justify-between rounded-[8px] bg-primary/5 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-normal"><Sparkles className="h-4 w-4 text-primary" />Prévia da geração</div>
            <Badge variant="secondary">{estimatedUnits} unidades</Badge>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button><Button type="submit" disabled={pending || !buildingId || estimatedUnits < 1}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Gerar unidades</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export type DevelopmentUnitValues = PropertyDevelopmentUnitPatchInput

export function DevelopmentUnitDialog({
  open,
  onOpenChange,
  pending,
  unit,
  onSubmit,
}: DialogBaseProps & {
  unit: { unit_number: string; status: PropertyDevelopmentUnitStatus; published: boolean; updated_at: string }
  onSubmit: (values: DevelopmentUnitValues) => Promise<void>
}) {
  type MutableUnitStatus = NonNullable<PropertyDevelopmentUnitPatchInput['status']>
  const [status, setStatus] = useState<MutableUnitStatus | 'reserved'>(unit.status)
  const [published, setPublished] = useState(unit.published)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await onSubmit({
      ...(status === 'reserved' ? {} : { status }),
      published,
      expected_updated_at: unit.updated_at,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => changeDialogOpen(pending, onOpenChange, nextOpen)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Unidade {unit.unit_number}</DialogTitle><DialogDescription>Atualize disponibilidade e publicação sem alterar a estrutura do espelho.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="unit-status">Status comercial</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as MutableUnitStatus)} disabled={unit.status === 'reserved'}>
              <SelectTrigger id="unit-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(UNIT_STATUS_LABELS).filter(([value]) => value !== 'reserved').map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            {unit.status === 'reserved' && <p className="text-xs text-muted-foreground">A reserva deve ser alterada pelo fluxo comercial próprio; aqui você ainda pode controlar a publicação.</p>}
          </div>
          <label className="flex cursor-pointer items-center gap-3 rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-3 text-sm"><Checkbox checked={published} onCheckedChange={(checked) => setPublished(checked === true)} /><span><span className="block font-normal">Unidade publicada</span><span className="text-xs font-light text-muted-foreground">Controla a visibilidade desta unidade nos canais.</span></span></label>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button><Button type="submit" disabled={pending}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar unidade</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DevelopmentPriceTableActivationDialog({
  open,
  onOpenChange,
  pending,
  table,
  onConfirm,
}: DialogBaseProps & {
  table: { name: string; version: number }
  onConfirm: () => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => changeDialogOpen(pending, onOpenChange, nextOpen)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Ativar tabela comercial?</DialogTitle><DialogDescription>A tabela ativa atual será encerrada. Preços de tabelas ativas são imutáveis para preservar o histórico.</DialogDescription></DialogHeader>
        <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4"><p className="font-normal">{table.name}</p><p className="mt-1 text-sm font-light text-muted-foreground">Versão {table.version}</p></div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button><Button onClick={() => void onConfirm()} disabled={pending}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Ativar tabela</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
