'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Bath,
  BedDouble,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  DoorOpen,
  ExternalLink,
  Eye,
  EyeOff,
  FileStack,
  History,
  Layers3,
  MapPin,
  MoreHorizontal,
  ParkingCircle,
  Pencil,
  Plus,
  Ruler,
  Sparkles,
  Tag,
  TrendingUp,
} from 'lucide-react'

import { AppLayout } from '@/components/shared/layout/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  useActivatePropertyDevelopmentPriceTable,
  useBulkCreatePropertyDevelopmentUnits,
  useCreatePropertyDevelopmentBuilding,
  useCreatePropertyDevelopmentFloorPlan,
  useCreatePropertyDevelopmentPhase,
	useCreatePropertyDevelopmentReservation,
	usePropertyDevelopmentUnits,
  usePropertyDevelopmentWorkspace,
  useUpdatePropertyDevelopmentUnit,
	useUpdatePropertyDevelopmentUnitPrice,
} from '@/hooks/properties'
import { uuidSchema, type PropertyDevelopmentUnitStatus } from '@/lib/validation'
import { cn } from '@/lib/utils'

import {
  DevelopmentBuildingDialog,
  DevelopmentBulkUnitsDialog,
  DevelopmentFloorPlanDialog,
  DevelopmentPhaseDialog,
  DevelopmentPriceTableActivationDialog,
  DevelopmentUnitDialog,
  type DevelopmentBuildingValues,
  type DevelopmentBulkUnitsValues,
  type DevelopmentFloorPlanValues,
  type DevelopmentPhaseValues,
  type DevelopmentUnitValues,
} from './DevelopmentDialogs'
import {
  DevelopmentReservationDialog,
  DevelopmentUnitPriceDialog,
  type DevelopmentReservationValues,
  type DevelopmentUnitPriceValues,
} from './DevelopmentCommercialDialogs'
import { DevelopmentReservationsTab } from './DevelopmentReservationsTab'
import {
  BUILDING_TYPE_LABELS,
  COMMERCIAL_STATUS_LABELS,
  DEVELOPMENT_STATUS_LABELS,
  DEVELOPMENT_TYPE_LABELS,
  PHASE_STATUS_LABELS,
  PRICE_TABLE_STATUS_LABELS,
  UNIT_STATUS_LABELS,
  DevelopmentEmptyState,
  DevelopmentErrorState,
  MetricCard,
  WorkspaceLoading,
  formatDevelopmentCurrency,
  formatDevelopmentDate,
  isSafeDevelopmentImageUrl,
} from './development-ui'

function inventoryTone(status: string) {
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

const UNIT_PAGE_SIZE = 50

type WorkspaceTab =
  | 'overview'
  | 'structure'
  | 'floor-plans'
  | 'units'
  | 'reservations'
  | 'commercial'
  | 'history'

export function PropertyDevelopmentWorkspaceScreen() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const routeDevelopmentId = typeof params.id === 'string' ? params.id : null
  const parsedDevelopmentId = uuidSchema.safeParse(routeDevelopmentId)
  const developmentId = parsedDevelopmentId.success ? parsedDevelopmentId.data : null
  const invalidDevelopmentId = Boolean(routeDevelopmentId && !parsedDevelopmentId.success)
  const workspaceQuery = usePropertyDevelopmentWorkspace(developmentId)
  const createPhase = useCreatePropertyDevelopmentPhase(developmentId)
  const createBuilding = useCreatePropertyDevelopmentBuilding(developmentId)
  const createFloorPlan = useCreatePropertyDevelopmentFloorPlan(developmentId)
  const bulkCreateUnits = useBulkCreatePropertyDevelopmentUnits(developmentId)
  const updateUnit = useUpdatePropertyDevelopmentUnit(developmentId)
  const createReservation = useCreatePropertyDevelopmentReservation(developmentId)
  const updateUnitPrice = useUpdatePropertyDevelopmentUnitPrice(developmentId)
  const activatePriceTable = useActivatePropertyDevelopmentPriceTable(developmentId)

  const [phaseOpen, setPhaseOpen] = useState(false)
  const [buildingOpen, setBuildingOpen] = useState(false)
  const [buildingPhaseId, setBuildingPhaseId] = useState<string>()
  const [floorPlanOpen, setFloorPlanOpen] = useState(false)
  const [bulkUnitsOpen, setBulkUnitsOpen] = useState(false)
  const [unitDialogOpen, setUnitDialogOpen] = useState(false)
  const [reservationDialogOpen, setReservationDialogOpen] = useState(false)
  const [unitPriceDialogOpen, setUnitPriceDialogOpen] = useState(false)
  const [selectedUnitId, setSelectedUnitId] = useState<string>()
  const [activationOpen, setActivationOpen] = useState(false)
  const [selectedPriceTableId, setSelectedPriceTableId] = useState<string>()
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview')
  const [buildingFilter, setBuildingFilter] = useState('all')
	const [unitStatusFilter, setUnitStatusFilter] = useState<'all' | PropertyDevelopmentUnitStatus>('all')
	const [unitOffset, setUnitOffset] = useState(0)
	const unitsQuery = usePropertyDevelopmentUnits(developmentId, {
		building_id: buildingFilter === 'all' ? undefined : buildingFilter,
		status: unitStatusFilter === 'all' ? undefined : unitStatusFilter,
		limit: UNIT_PAGE_SIZE,
		offset: unitOffset,
	}, { enabled: activeTab === 'units' })

  const response = workspaceQuery.data
  const workspace = response?.data
  const development = workspace?.development
  const canManage = response?.meta.can_manage ?? false
	const unitResponse = unitsQuery.data
	const units = unitResponse?.data ?? []
	const unitMeta = unitResponse?.meta

  const selectedUnit = units.find((unit) => unit.id === selectedUnitId)
  const selectedPriceTable = workspace?.price_tables.find((table) => table.id === selectedPriceTableId)
  const draftPriceTable = workspace?.price_tables.find((table) => table.status === 'draft')
  const activePriceTable = workspace?.price_tables.find((table) => table.status === 'active')

  const inventory = workspace?.summary.inventory

  if (invalidDevelopmentId) {
    return (
      <AppLayout title="Ficha do empreendimento">
        <DevelopmentErrorState
          title="Link de empreendimento inválido"
          description="O identificador deste link não é válido. Volte ao catálogo e abra o empreendimento novamente."
          action={<Button variant="outline" onClick={() => router.push('/properties/developments')}>Voltar ao catálogo</Button>}
        />
      </AppLayout>
    )
  }

  if (workspaceQuery.isLoading) {
    return <AppLayout title="Ficha do empreendimento"><WorkspaceLoading /></AppLayout>
  }

  if (!workspace || !development || !response) {
    return (
      <AppLayout title="Ficha do empreendimento">
        <DevelopmentErrorState
          title="Não foi possível abrir o empreendimento"
          description={workspaceQuery.error instanceof Error ? workspaceQuery.error.message : 'O empreendimento não existe ou não está disponível para o seu perfil.'}
          action={<Button variant="outline" onClick={() => router.push('/properties/developments')}>Voltar ao catálogo</Button>}
        />
      </AppLayout>
    )
  }

  const address = [development.address, development.address_number, development.neighborhood, development.city, development.state].filter(Boolean).join(', ')

  const submitPhase = async (values: DevelopmentPhaseValues) => {
    try {
      await createPhase.mutateAsync(values)
      setPhaseOpen(false)
    } catch { /* The domain hook reports the error. */ }
  }

  const submitBuilding = async (values: DevelopmentBuildingValues) => {
    try {
      await createBuilding.mutateAsync(values)
      setBuildingOpen(false)
    } catch { /* The domain hook reports the error. */ }
  }

  const submitFloorPlan = async (values: DevelopmentFloorPlanValues) => {
    try {
      await createFloorPlan.mutateAsync(values)
      setFloorPlanOpen(false)
    } catch { /* The domain hook reports the error. */ }
  }

  const submitBulkUnits = async (values: DevelopmentBulkUnitsValues) => {
    try {
      await bulkCreateUnits.mutateAsync(values)
      setBulkUnitsOpen(false)
    } catch { /* The domain hook reports the error. */ }
  }

  const submitUnit = async (values: DevelopmentUnitValues) => {
    if (!selectedUnit) return
    try {
      await updateUnit.mutateAsync({ unitId: selectedUnit.id, input: values })
      setUnitDialogOpen(false)
    } catch { /* The domain hook reports the error. */ }
  }

  const submitReservation = async (values: DevelopmentReservationValues) => {
    if (!selectedUnit) return
    try {
      await createReservation.mutateAsync({ unitId: selectedUnit.id, input: values })
      setReservationDialogOpen(false)
    } catch { /* The domain hook reports the error. */ }
  }

  const submitUnitPrice = async (values: DevelopmentUnitPriceValues) => {
    if (!selectedUnit) return
    try {
      await updateUnitPrice.mutateAsync({ unitId: selectedUnit.id, input: values })
      setUnitPriceDialogOpen(false)
    } catch { /* The domain hook reports the error. */ }
  }

  const confirmPriceTableActivation = async () => {
    if (!selectedPriceTable) return
    try {
      await activatePriceTable.mutateAsync({
        priceTableId: selectedPriceTable.id,
        expected_updated_at: selectedPriceTable.updated_at,
      })
      setActivationOpen(false)
    } catch { /* The domain hook reports the error. */ }
  }

  const openBuilding = (phaseId?: string) => {
    setBuildingPhaseId(phaseId)
    setBuildingOpen(true)
  }

  const openUnit = (unitId: string) => {
    setSelectedUnitId(unitId)
    setUnitDialogOpen(true)
  }

  const openReservation = (unitId: string) => {
    setSelectedUnitId(unitId)
    setReservationDialogOpen(true)
  }

  const openUnitPrice = (unitId: string) => {
    setSelectedUnitId(unitId)
    setUnitPriceDialogOpen(true)
  }

  const openActivation = (priceTableId: string) => {
    setSelectedPriceTableId(priceTableId)
    setActivationOpen(true)
  }

  return (
    <AppLayout title="Ficha do empreendimento">
      <div className="min-h-full bg-muted/20">
        <div className="mx-auto max-w-[1500px] space-y-6 py-2">
          {workspaceQuery.isError ? (
            <div className="flex flex-col gap-2 rounded-[8px] bg-destructive/10 px-3 py-2 text-xs font-light text-destructive sm:flex-row sm:items-center sm:justify-between" role="status">
              <span>A atualização falhou; mantendo a ficha já carregada.</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void workspaceQuery.refetch()}
                disabled={workspaceQuery.isFetching}
                className="h-7 rounded-[6px] px-2.5 text-xs font-light shadow-none"
              >
                Tentar novamente
              </Button>
            </div>
          ) : null}
          <header className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/properties/developments")}
                className="-ml-2"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Empreendimentos
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    workspace.summary.publication_ready
                      ? "default"
                      : "secondary"
                  }
                >
                  {workspace.summary.completeness_score}% completo
                </Badge>
                <Badge
                  variant={
                    development.published_on_site ? "default" : "outline"
                  }
                  className="gap-1.5"
                >
                  {development.published_on_site ? (
                    <Eye className="h-3.5 w-3.5" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5" />
                  )}
                  {development.published_on_site
                    ? "Publicado no site"
                    : "Fora do site"}
                </Badge>
              </div>
            </div>
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="font-mono">
                    {development.code}
                  </Badge>
                  <Badge variant="outline">
                    {DEVELOPMENT_TYPE_LABELS[development.development_type] ??
                      development.development_type}
                  </Badge>
                  <Badge>
                    {DEVELOPMENT_STATUS_LABELS[development.status] ??
                      development.status}
                  </Badge>
                  <Badge
                    variant={
                      development.commercial_status === "active"
                        ? "default"
                        : "secondary"
                    }
                  >
                    {COMMERCIAL_STATUS_LABELS[development.commercial_status] ??
                      development.commercial_status}
                  </Badge>
                </div>
                <h1 className="max-w-4xl text-2xl font-normal tracking-tight sm:text-3xl">
                  {development.name}
                </h1>
                <p className="mt-2 flex items-center gap-1.5 text-sm font-light text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0" />
                  {address || "Localização não informada"}
                </p>
              </div>
              <div className="w-full max-w-sm rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 shadow-none">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-normal">Progresso da obra</span>
                  <span className="text-lg font-normal text-primary">
                    {development.construction_progress}%
                  </span>
                </div>
                <Progress
                  value={development.construction_progress}
                  className="mt-3 h-2"
                />
                <p className="mt-2 text-xs font-light text-muted-foreground">
                  Entrega prevista:{" "}
                  {formatDevelopmentDate(development.expected_delivery_date)}
                </p>
              </div>
            </div>
          </header>

          <section
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
            aria-label="Indicadores do empreendimento"
          >
            <MetricCard
              label="Unidades"
              value={inventory?.total ?? 0}
              hint={`${workspace.summary.buildings} estruturas`}
              icon={DoorOpen}
              tone="muted"
            />
            <MetricCard
              label="Disponíveis"
              value={inventory?.available ?? 0}
              hint="Estoque livre"
              icon={CheckCircle2}
              tone="success"
            />
            <MetricCard
              label="Reservadas"
              value={inventory?.reserved ?? 0}
              hint={`${inventory?.negotiation ?? 0} em negociação`}
              icon={Clock3}
              tone="warning"
            />
            <MetricCard
              label="Vendidas"
              value={inventory?.sold ?? 0}
              hint={
                activePriceTable
                  ? `Tabela v${activePriceTable.version} ativa`
                  : "Sem tabela ativa"
              }
              icon={TrendingUp}
            />
          </section>

          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as WorkspaceTab)}
            className="space-y-4"
          >
            <div
              data-collapse="wide"
              className="app-responsive-tab-list min-w-0 flex-1"
            >
              <TabsList
                data-responsive-tab-scroll
                aria-label="Seções da ficha do empreendimento"
                className="flex h-auto w-fit max-w-full flex-nowrap justify-start overflow-x-auto rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1.5 shadow-none"
              >
                <TabsTrigger
                  value="overview"
                  data-responsive-tab
                  aria-label="Visão geral"
                  title="Visão geral"
                  className="gap-2"
                >
                  <Building2 aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="app-responsive-tab-label">Visão geral</span>
                </TabsTrigger>
                <TabsTrigger
                  value="structure"
                  data-responsive-tab
                  aria-label="Estrutura"
                  title="Estrutura"
                  className="gap-2"
                >
                  <Layers3 aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="app-responsive-tab-label">Estrutura</span>
                </TabsTrigger>
                <TabsTrigger
                  value="floor-plans"
                  data-responsive-tab
                  aria-label="Plantas"
                  title="Plantas"
                  className="gap-2"
                >
                  <FileStack aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="app-responsive-tab-label">Plantas</span>
                </TabsTrigger>
                <TabsTrigger
                  value="units"
                  data-responsive-tab
                  aria-label="Espelho de unidades"
                  title="Espelho de unidades"
                  className="gap-2"
                >
                  <DoorOpen aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="app-responsive-tab-label">
                    Espelho de unidades
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="reservations"
                  data-responsive-tab
                  aria-label="Reservas"
                  title="Reservas"
                  className="gap-2"
                >
                  <CalendarClock
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="app-responsive-tab-label">Reservas</span>
                </TabsTrigger>
                <TabsTrigger
                  value="commercial"
                  data-responsive-tab
                  aria-label="Comercial"
                  title="Comercial"
                  className="gap-2"
                >
                  <CircleDollarSign
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="app-responsive-tab-label">Comercial</span>
                </TabsTrigger>
                <TabsTrigger
                  value="history"
                  data-responsive-tab
                  aria-label="Histórico"
                  title="Histórico"
                  className="gap-2"
                >
                  <History aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="app-responsive-tab-label">Histórico</span>
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="overview" className="space-y-6">
              <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
                <Card className="app-card overflow-hidden rounded-[8px] border-0 shadow-none">
                  <div className="relative aspect-[16/9] bg-muted">
                    {isSafeDevelopmentImageUrl(development.main_image_url) ? (
                      <Image
                        src={development.main_image_url}
                        alt={development.name}
                        fill
                        sizes="(max-width: 1024px) 100vw, 60vw"
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-gradient-to-br from-primary/5 via-muted to-primary/10">
                        <Building2 className="h-16 w-16 text-primary/20" />
                      </div>
                    )}
                  </div>
                  <CardContent className="p-5">
                    <h2 className="font-normal">
                      {development.summary ||
                        "Apresentação comercial ainda não cadastrada"}
                    </h2>
                    <p className="mt-2 whitespace-pre-wrap text-sm font-light leading-6 text-muted-foreground">
                      {development.description ||
                        "Adicione uma descrição completa para apresentar os diferenciais do empreendimento à equipe e aos clientes."}
                    </p>
                  </CardContent>
                </Card>
                <div className="space-y-6">
                  <Card className="app-card rounded-[8px] border-0 shadow-none">
                    <CardHeader>
                      <CardTitle className="text-base">
                        Linha do tempo
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {[
                        {
                          label: "Lançamento",
                          value: development.launch_date,
                          icon: Sparkles,
                        },
                        {
                          label: "Início da obra",
                          value: development.construction_started_at,
                          icon: Building2,
                        },
                        {
                          label: "Entrega prevista",
                          value: development.expected_delivery_date,
                          icon: CalendarClock,
                        },
                        {
                          label: "Entrega realizada",
                          value: development.delivered_at,
                          icon: CheckCircle2,
                        },
                      ].map((item, index) => (
                        <div className="flex gap-3" key={item.label}>
                          <span
                            className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                              item.value
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            <item.icon className="h-3.5 w-3.5" />
                          </span>
                          <div className={cn(index < 3 && "pb-1")}>
                            <p className="text-sm font-medium">{item.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatDevelopmentDate(item.value)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                  <Card className="app-card rounded-[8px] border-0 shadow-none">
                    <CardHeader>
                      <CardTitle className="text-base">
                        Responsáveis e registro
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">
                          Incorporadora
                        </span>
                        <span className="text-right font-medium">
                          {development.developer?.name || "Não vinculada"}
                        </span>
                      </div>
                      <Separator />
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Registro</span>
                        <span className="text-right font-medium">
                          {development.registration_number || "Não informado"}
                        </span>
                      </div>
                      <Separator />
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">
                          Visibilidade do endereço
                        </span>
                        <span className="text-right font-medium">
                          {development.public_address_visibility}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="structure" className="space-y-5">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <h2 className="text-lg font-normal">
                    Fases, torres e agrupadores
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    A hierarquia que organiza plantas, estoque e evolução do
                    projeto.
                  </p>
                </div>
                {canManage && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPhaseOpen(true)}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Nova fase
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => openBuilding()}
                      disabled={workspace.phases.length === 0}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Nova estrutura
                    </Button>
                  </div>
                )}
              </div>
              {workspace.phases.length === 0 ? (
                <DevelopmentEmptyState
                  title="Nenhuma fase cadastrada"
                  description="Crie a primeira fase para começar a montar torres, blocos, quadras ou setores."
                  icon={Layers3}
                  action={
                    canManage ? (
                      <Button onClick={() => setPhaseOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Criar primeira fase
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <div className="space-y-4">
                  {workspace.phases.map((phase) => {
                    const buildings = workspace.buildings.filter(
                      (building) => building.phase_id === phase.id,
                    );
                    return (
                      <Card key={phase.id} className="app-card rounded-[8px] border-0 shadow-none">
                        <CardHeader className="pb-3">
                          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                            <div className="flex items-center gap-3">
                              <span className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
                                <Layers3 className="h-4 w-4" />
                              </span>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <CardTitle className="text-base">
                                    {phase.name}
                                  </CardTitle>
                                  <Badge variant="outline">
                                    {PHASE_STATUS_LABELS[phase.status] ??
                                      phase.status}
                                  </Badge>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {phase.code} · entrega{" "}
                                  {formatDevelopmentDate(
                                    phase.expected_delivery_date,
                                  )}
                                </p>
                              </div>
                            </div>
                            {canManage && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openBuilding(phase.id)}
                              >
                                <Plus className="mr-2 h-4 w-4" />
                                Adicionar estrutura
                              </Button>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent>
                          {buildings.length === 0 ? (
                            <div className="rounded-[6px] bg-[var(--app-surface-soft)] p-5 text-center text-sm font-light text-muted-foreground">
                              Nenhuma torre ou agrupador nesta fase.
                            </div>
                          ) : (
                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                              {buildings.map((building) => {
                                const unitCount = building.unit_count ?? 0;
                                return (
                                  <div
                                    key={building.id}
                                    className="rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-4"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <span className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-[var(--app-surface-solid)] text-primary shadow-none">
                                        <Building2 className="h-4 w-4" />
                                      </span>
                                      <Badge variant="secondary">
                                        {BUILDING_TYPE_LABELS[
                                          building.building_type
                                        ] ?? building.building_type}
                                      </Badge>
                                    </div>
                                    <p className="mt-3 font-medium">
                                      {building.name}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {building.code} ·{" "}
                                      {building.floor_count ?? 0} andares
                                    </p>
                                    <p className="mt-3 text-sm">
                                      <span className="font-normal text-foreground">
                                        {unitCount}
                                      </span>{" "}
                                      <span className="text-muted-foreground">
                                        unidades
                                      </span>
                                    </p>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="floor-plans" className="space-y-5">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <h2 className="text-lg font-normal">
                    Biblioteca de plantas
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Tipologias reutilizáveis em todo o empreendimento.
                  </p>
                </div>
                {canManage && (
                  <Button size="sm" onClick={() => setFloorPlanOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Nova planta
                  </Button>
                )}
              </div>
              {workspace.floor_plans.length === 0 ? (
                <DevelopmentEmptyState
                  title="Nenhuma planta cadastrada"
                  description="Cadastre quartos, áreas, vagas e a imagem técnica de cada tipologia."
                  icon={FileStack}
                  action={
                    canManage ? (
                      <Button onClick={() => setFloorPlanOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Criar primeira planta
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {workspace.floor_plans.map((plan) => {
                    const count = plan.unit_count ?? 0;
                    return (
                      <Card key={plan.id} className="app-card overflow-hidden rounded-[8px] border-0 shadow-none">
                        <div className="relative aspect-[16/8] bg-muted">
                          {isSafeDevelopmentImageUrl(plan.image_url) ? (
                            <Image
                              src={plan.image_url}
                              alt={`Planta ${plan.name}`}
                              fill
                              sizes="(max-width: 768px) 100vw, 33vw"
                              className="object-contain p-3"
                              unoptimized
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center">
                              <FileStack className="h-10 w-10 text-muted-foreground/25" />
                            </div>
                          )}
                          <Badge
                            className="absolute right-3 top-3"
                            variant={
                              plan.status === "active" ? "default" : "secondary"
                            }
                          >
                            {plan.status === "active" ? "Ativa" : plan.status}
                          </Badge>
                        </div>
                        <CardContent className="space-y-4 p-5">
                          <div>
                            <p className="text-[12px] font-light text-muted-foreground">
                              {plan.code} · {plan.property_type || "Tipologia"}
                            </p>
                            <h3 className="mt-1 text-lg font-normal">
                              {plan.name}
                            </h3>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <BedDouble className="h-3.5 w-3.5" />
                              {plan.bedrooms ?? "—"} quartos
                            </span>
                            <span className="flex items-center gap-1">
                              <Bath className="h-3.5 w-3.5" />
                              {plan.bathrooms ?? "—"} banh.
                            </span>
                            <span className="flex items-center gap-1">
                              <ParkingCircle className="h-3.5 w-3.5" />
                              {plan.parking_spaces ?? "—"} vagas
                            </span>
                          </div>
                          <div className="flex items-center justify-between rounded-[6px] bg-[var(--app-surface-soft)] p-3">
                            <span className="flex items-center gap-1.5 text-sm">
                              <Ruler className="h-4 w-4 text-primary" />
                              {plan.private_area
                                ? `${plan.private_area} m²`
                                : "Área não informada"}
                            </span>
                            <Badge variant="outline">{count} unid.</Badge>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="units" className="space-y-5">
              <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
                <div>
                  <h2 className="text-lg font-normal">Espelho de unidades</h2>
                  <p className="text-sm text-muted-foreground">
                    Disponibilidade, publicação e vínculo com a ficha
                    individual.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select
                    value={buildingFilter}
                    onValueChange={(value) => {
                      setBuildingFilter(value);
                      setUnitOffset(0);
                    }}
                  >
                    <SelectTrigger
                      className="w-full sm:w-48"
                      aria-label="Filtrar unidades por estrutura"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as estruturas</SelectItem>
                      {workspace.buildings.map((building) => (
                        <SelectItem key={building.id} value={building.id}>
                          {building.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={unitStatusFilter}
                    onValueChange={(value) => {
                      setUnitStatusFilter(
                        value as "all" | PropertyDevelopmentUnitStatus,
                      );
                      setUnitOffset(0);
                    }}
                  >
                    <SelectTrigger
                      className="w-full sm:w-44"
                      aria-label="Filtrar unidades por status"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os status</SelectItem>
                      {Object.entries(UNIT_STATUS_LABELS).map(
                        ([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                  {canManage && (
                    <Button
                      size="sm"
                      onClick={() => setBulkUnitsOpen(true)}
                      disabled={workspace.buildings.length === 0}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Gerar unidades
                    </Button>
                  )}
                </div>
              </div>
              {(inventory?.total ?? 0) === 0 ? (
                <DevelopmentEmptyState
                  title="O espelho ainda está vazio"
                  description="Gere unidades em lote a partir de uma torre e, opcionalmente, de uma planta."
                  icon={DoorOpen}
                  action={
                    canManage && workspace.buildings.length > 0 ? (
                      <Button onClick={() => setBulkUnitsOpen(true)}>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Gerar primeiro estoque
                      </Button>
                    ) : undefined
                  }
                />
              ) : unitsQuery.isLoading ? (
                <Card className="p-8 text-center text-sm text-muted-foreground">
                  Carregando inventário...
                </Card>
              ) : unitsQuery.isError && units.length === 0 ? (
                <DevelopmentErrorState
                  title="Não foi possível carregar o inventário"
                  description={
                    unitsQuery.error instanceof Error
                      ? unitsQuery.error.message
                      : "Tente carregar a lista novamente."
                  }
                  action={
                    <Button
                      variant="outline"
                      onClick={() => void unitsQuery.refetch()}
                      disabled={unitsQuery.isFetching}
                    >
                      Tentar novamente
                    </Button>
                  }
                />
              ) : units.length === 0 ? (
                <DevelopmentEmptyState
                  title="Nenhuma unidade nestes filtros"
                  description="Altere a torre ou o status selecionado para visualizar o estoque."
                  icon={DoorOpen}
                />
              ) : (
                <div className="space-y-3">
                  {unitsQuery.isError ? (
                    <div className="rounded-[6px] bg-destructive/10 px-3 py-2 text-xs text-destructive" role="status">
                      A atualização falhou; mantendo as unidades já carregadas.
                    </div>
                  ) : null}
                  <Card className="app-card overflow-hidden rounded-[8px] border-0 shadow-none">
                    <div className="overflow-x-auto">
                      <Table className="min-w-[900px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Unidade</TableHead>
                            <TableHead>Estrutura</TableHead>
                            <TableHead>Planta</TableHead>
                            <TableHead>Área</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Publicação</TableHead>
                            <TableHead>Preço da tabela</TableHead>
                            <TableHead className="w-16" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {units.map((unit) => (
                            <TableRow key={unit.id}>
                              <TableCell>
                                <p className="font-medium">
                                  {unit.unit_number}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {unit.code}
                                </p>
                              </TableCell>
                              <TableCell>
                                {unit.building_name || "—"}
                                <span className="block text-xs text-muted-foreground">
                                  {unit.floor_number != null
                                    ? `${unit.floor_number}º andar`
                                    : "Sem andar"}
                                </span>
                              </TableCell>
                              <TableCell>
                                {unit.floor_plan_name || "—"}
                              </TableCell>
                              <TableCell>
                                {unit.private_area
                                  ? `${unit.private_area} m²`
                                  : "—"}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={inventoryTone(unit.status)}
                                >
                                  {UNIT_STATUS_LABELS[unit.status] ??
                                    unit.status}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {unit.published ? (
                                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600">
                                    <Eye className="h-3.5 w-3.5" />
                                    Publicada
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <EyeOff className="h-3.5 w-3.5" />
                                    Oculta
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                <p>
                                  {formatDevelopmentCurrency(
                                    unit.list_price,
                                    unit.currency || activePriceTable?.currency,
                                  )}
                                </p>
                                {canManage &&
                                  unit.draft_price_table_id &&
                                  ((unit.draft_list_price ?? null) !==
                                    (unit.list_price ?? null) ||
                                    (unit.draft_minimum_price ?? null) !==
                                      (unit.minimum_price ?? null)) && (
                                    <p className="mt-1 text-xs font-medium text-amber-600">
                                      Rascunho:{" "}
                                      {formatDevelopmentCurrency(
                                        unit.draft_list_price ??
                                          unit.list_price,
                                        unit.currency ||
                                          activePriceTable?.currency,
                                      )}
                                    </p>
                                  )}
                              </TableCell>
                              <TableCell>
                                {canManage && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`Ações da unidade ${unit.unit_number}`}
                                      >
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      {["available", "negotiation"].includes(
                                        unit.status,
                                      ) &&
                                        unit.price_table_status === "active" &&
                                        unit.list_price != null && (
                                          <DropdownMenuItem
                                            onClick={() =>
                                              openReservation(unit.id)
                                            }
                                          >
                                            <CalendarClock className="mr-2 h-4 w-4" />
                                            Criar reserva
                                          </DropdownMenuItem>
                                        )}
                                      {["available", "negotiation"].includes(
                                        unit.status,
                                      ) &&
                                        (unit.price_table_status !== "active" ||
                                          unit.list_price == null) && (
                                          <DropdownMenuItem disabled>
                                            <CalendarClock className="mr-2 h-4 w-4" />
                                            Ative um preço para reservar
                                          </DropdownMenuItem>
                                        )}
                                      <DropdownMenuItem
                                        onClick={() => openUnitPrice(unit.id)}
                                      >
                                        <CircleDollarSign className="mr-2 h-4 w-4" />
                                        Editar preço
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => openUnit(unit.id)}
                                      >
                                        <Pencil className="mr-2 h-4 w-4" />
                                        Alterar status e publicação
                                      </DropdownMenuItem>
                                      {unit.property_id && (
                                        <DropdownMenuItem
                                          onClick={() =>
                                            router.push(
                                              `/properties/${unit.property_id}`,
                                            )
                                          }
                                        >
                                          <ExternalLink className="mr-2 h-4 w-4" />
                                          Abrir ficha do imóvel
                                        </DropdownMenuItem>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </Card>
                  <div className="flex flex-col justify-between gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center">
                    <span>
                      Exibindo {unitMeta?.total ? unitOffset + 1 : 0}–
                      {Math.min(
                        unitOffset + UNIT_PAGE_SIZE,
                        unitMeta?.total ?? 0,
                      )}{" "}
                      de {unitMeta?.total ?? 0} unidades
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={unitOffset === 0 || unitsQuery.isFetching}
                        onClick={() =>
                          setUnitOffset((current) =>
                            Math.max(0, current - UNIT_PAGE_SIZE),
                          )
                        }
                      >
                        Anterior
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          unitOffset + UNIT_PAGE_SIZE >= (unitMeta?.total ?? 0)
                          || unitsQuery.isFetching
                        }
                        onClick={() =>
                          setUnitOffset((current) => current + UNIT_PAGE_SIZE)
                        }
                      >
                        Próxima
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="reservations" className="space-y-5">
              <DevelopmentReservationsTab
                developmentId={development.id}
                canManage={canManage}
              />
            </TabsContent>

            <TabsContent value="commercial" className="space-y-6">
              <div>
                <h2 className="text-lg font-normal">Tabelas comerciais</h2>
                <p className="text-sm font-light text-muted-foreground">
                  Versionamento de preço com uma única tabela ativa por
                  empreendimento.
                </p>
              </div>
              {workspace.price_tables.length === 0 ? (
                <DevelopmentEmptyState
                  title="Nenhuma tabela comercial"
                  description="As tabelas e os preços por unidade serão exibidos aqui assim que forem importados ou cadastrados."
                  icon={Tag}
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {workspace.price_tables.map((table) => {
                    return (
                      <Card
                        key={table.id}
                        className={cn(
                          "app-card rounded-[8px] border-0 shadow-none",
                          table.status === "active" &&
                            "border-primary/50 ring-1 ring-primary/10",
                        )}
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <CardTitle className="text-base">
                                {table.name}
                              </CardTitle>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Versão {table.version}
                              </p>
                            </div>
                            <Badge
                              variant={
                                table.status === "active"
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {PRICE_TABLE_STATUS_LABELS[table.status] ??
                                table.status}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid grid-cols-2 gap-3 rounded-[6px] bg-[var(--app-surface-soft)] p-3 text-sm">
                            <div>
                              <span className="block text-xs text-muted-foreground">
                                Vigência
                              </span>
                              {formatDevelopmentDate(table.valid_from)}
                            </div>
                            <div>
                              <span className="block text-xs text-muted-foreground">
                                Até
                              </span>
                              {formatDevelopmentDate(table.valid_until)}
                            </div>
                            <div>
                              <span className="block text-xs text-muted-foreground">
                                Unidades
                              </span>
                              {table.priced_unit_count}
                            </div>
                            <div>
                              <span className="block text-xs text-muted-foreground">
                                A partir de
                              </span>
                              {formatDevelopmentCurrency(
                                table.minimum_list_price,
                                table.currency,
                              )}
                            </div>
                          </div>
                          {canManage &&
                            ["draft", "approved"].includes(table.status) && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full"
                                onClick={() => openActivation(table.id)}
                              >
                                <CircleDollarSign className="mr-2 h-4 w-4" />
                                Ativar tabela
                              </Button>
                            )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
              <Card className="app-card rounded-[8px] border-0 shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">
                    Saúde comercial do estoque
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {["available", "negotiation", "reserved", "sold"].map(
                      (status) => (
                        <div
                          key={status}
                          className={cn(
                            "rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4",
                            inventoryTone(status),
                          )}
                        >
                          <p className="text-2xl font-normal">
                            {inventory?.[
                              status as
                                | "available"
                                | "negotiation"
                                | "reserved"
                                | "sold"
                            ] ?? 0}
                          </p>
                          <p className="mt-1 text-xs">
                            {UNIT_STATUS_LABELS[status]}
                          </p>
                        </div>
                      ),
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="history" className="space-y-5">
              <div>
                <h2 className="text-lg font-normal">Histórico operacional</h2>
                <p className="text-sm text-muted-foreground">
                  Eventos imutáveis do estoque, preços e vínculos com imóveis.
                </p>
              </div>
              {workspace.recent_unit_events.length === 0 ? (
                <DevelopmentEmptyState
                  title="Nenhum evento registrado"
                  description="As movimentações de unidades e preços aparecerão automaticamente nesta linha do tempo."
                  icon={History}
                />
              ) : (
                <Card className="app-card rounded-[8px] border-0 shadow-none">
                  <CardContent className="p-5">
                    <div className="space-y-5">
                      {workspace.recent_unit_events.map((event, index) => {
                        const unit = units.find(
                          (item) => item.id === event.unit_id,
                        );
                        return (
                          <div key={event.id} className="relative flex gap-4">
                            {index <
                              workspace.recent_unit_events.length - 1 && (
                              <span className="absolute bottom-[-20px] left-[15px] top-8 w-px bg-border" />
                            )}
                            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                              <History className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
                                <p className="text-sm font-medium">
                                  {EVENT_LABELS[event.event_type] ??
                                    event.event_type}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {formatDevelopmentDate(
                                    event.created_at,
                                    true,
                                  )}
                                </p>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {unit
                                  ? `Unidade ${unit.unit_number}`
                                  : "Unidade"}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {phaseOpen && (
        <DevelopmentPhaseDialog
          open
          onOpenChange={setPhaseOpen}
          pending={createPhase.isPending}
          onSubmit={submitPhase}
        />
      )}
      {buildingOpen && (
        <DevelopmentBuildingDialog
          open
          onOpenChange={setBuildingOpen}
          pending={createBuilding.isPending}
          phases={workspace.phases}
          defaultPhaseId={buildingPhaseId}
          onSubmit={submitBuilding}
        />
      )}
      {floorPlanOpen && (
        <DevelopmentFloorPlanDialog
          open
          onOpenChange={setFloorPlanOpen}
          pending={createFloorPlan.isPending}
          onSubmit={submitFloorPlan}
        />
      )}
      {bulkUnitsOpen && (
        <DevelopmentBulkUnitsDialog
          open
          onOpenChange={setBulkUnitsOpen}
          pending={bulkCreateUnits.isPending}
          buildings={workspace.buildings}
          floorPlans={workspace.floor_plans}
          onSubmit={submitBulkUnits}
        />
      )}
      {unitDialogOpen && selectedUnit && (
        <DevelopmentUnitDialog
          open
          onOpenChange={setUnitDialogOpen}
          pending={updateUnit.isPending}
          unit={selectedUnit}
          onSubmit={submitUnit}
        />
      )}
      {reservationDialogOpen && selectedUnit && (
        <DevelopmentReservationDialog
          open
          onOpenChange={setReservationDialogOpen}
          pending={createReservation.isPending}
          unit={selectedUnit}
          onSubmit={submitReservation}
        />
      )}
      {unitPriceDialogOpen && selectedUnit && (
        <DevelopmentUnitPriceDialog
          open
          onOpenChange={setUnitPriceDialogOpen}
          pending={updateUnitPrice.isPending}
          unit={selectedUnit}
          draftPriceTable={draftPriceTable}
          activePriceTable={activePriceTable}
          onSubmit={submitUnitPrice}
        />
      )}
      {activationOpen && selectedPriceTable && (
        <DevelopmentPriceTableActivationDialog
          open
          onOpenChange={setActivationOpen}
          pending={activatePriceTable.isPending}
          table={selectedPriceTable}
          onConfirm={confirmPriceTableActivation}
        />
      )}
    </AppLayout>
  );
}

export default PropertyDevelopmentWorkspaceScreen
