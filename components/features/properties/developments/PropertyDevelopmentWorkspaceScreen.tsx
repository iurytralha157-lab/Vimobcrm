'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

import { AppLayout } from '@/components/shared/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent } from '@/components/ui/tabs'
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
  DevelopmentUnitPropertyActionDialog,
  type DevelopmentUnitPropertyAction,
} from './DevelopmentUnitPropertyActionDialog'
import {
  DevelopmentErrorState,
  WorkspaceLoading,
} from './development-ui'
import {
  CommercialTab,
  FloorPlansTab,
  HistoryTab,
  OverviewTab,
  StructureTab,
  UnitsTab,
  WorkspaceHeader,
  WorkspaceTabList,
  UNIT_PAGE_SIZE,
  type WorkspaceTab,
} from './development-workspace'

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
  const [unitPropertyAction, setUnitPropertyAction] = useState<{
    action: DevelopmentUnitPropertyAction
    unitId: string
  } | null>(null)
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
  const propertyActionUnit = units.find((unit) => unit.id === unitPropertyAction?.unitId)
  const propertyActionFloorPlan = workspace?.floor_plans.find(
    (floorPlan) => floorPlan.id === propertyActionUnit?.floor_plan_id,
  )
  const selectedPriceTable = workspace?.price_tables.find((table) => table.id === selectedPriceTableId)
  const draftPriceTable = workspace?.price_tables.find((table) => table.status === 'draft')
  const activePriceTable = workspace?.price_tables.find((table) => table.status === 'active')

  const inventory = workspace?.summary.inventory

  if (invalidDevelopmentId) {
    return (
      <AppLayout title="Ficha do empreendimento">
        <DevelopmentErrorState
          title="Link de empreendimento inválido"
          description="O identificador deste link não é válido. Volte aos lançamentos e abra o empreendimento novamente."
          action={<Button variant="outline" onClick={() => router.push('/properties/launches')}>Voltar aos lançamentos</Button>}
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
          action={<Button variant="outline" onClick={() => router.push('/properties/launches')}>Voltar aos lançamentos</Button>}
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
          <WorkspaceHeader
            workspace={workspace}
            address={address}
            activePriceTable={activePriceTable}
            onBack={() => router.push('/properties/launches')}
          />

          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as WorkspaceTab)}
            className="space-y-4"
          >
            <WorkspaceTabList />
            <OverviewTab development={development} />
            <StructureTab
              workspace={workspace}
              canManage={canManage}
              setPhaseOpen={setPhaseOpen}
              openBuilding={openBuilding}
            />
            <FloorPlansTab
              workspace={workspace}
              canManage={canManage}
              setFloorPlanOpen={setFloorPlanOpen}
            />
            <UnitsTab
              workspace={workspace}
              inventory={inventory}
              units={units}
              unitMeta={unitMeta}
              activePriceTable={activePriceTable}
              canManage={canManage}
              buildingFilter={buildingFilter}
              setBuildingFilter={setBuildingFilter}
              unitStatusFilter={unitStatusFilter}
              setUnitStatusFilter={setUnitStatusFilter}
              unitOffset={unitOffset}
              setUnitOffset={setUnitOffset}
              setBulkUnitsOpen={setBulkUnitsOpen}
              openReservation={openReservation}
              openUnitPrice={openUnitPrice}
              openUnit={openUnit}
              setUnitPropertyAction={setUnitPropertyAction}
              router={router}
              unitsQuery={unitsQuery}
            />
            <TabsContent value="reservations" className="space-y-5">
              <DevelopmentReservationsTab
                developmentId={development.id}
                canManage={canManage}
              />
            </TabsContent>
            <CommercialTab
              workspace={workspace}
              inventory={inventory}
              canManage={canManage}
              openActivation={openActivation}
            />
            <HistoryTab workspace={workspace} units={units} />
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
      {unitPropertyAction && propertyActionUnit && (
        <DevelopmentUnitPropertyActionDialog
          key={`${propertyActionUnit.id}-${unitPropertyAction.action}`}
          developmentId={development.id}
          developmentName={development.name}
          unit={propertyActionUnit}
          action={unitPropertyAction.action}
          floorPlanPropertyType={propertyActionFloorPlan?.property_type}
          onClose={() => setUnitPropertyAction(null)}
        />
      )}
    </AppLayout>
  );
}

export default PropertyDevelopmentWorkspaceScreen
