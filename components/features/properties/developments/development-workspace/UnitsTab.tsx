import type { Dispatch, SetStateAction } from 'react'
import {
  CalendarClock,
  CircleDollarSign,
  DoorOpen,
  ExternalLink,
  Eye,
  EyeOff,
  FilePlus2,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  Unlink,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TabsContent } from '@/components/ui/tabs'
import type {
  PropertyDevelopmentPriceTable,
  PropertyDevelopmentUnit,
  PropertyDevelopmentUnitListMeta,
  PropertyDevelopmentUnitStatus,
  PropertyDevelopmentWorkspace,
} from '@/lib/validation'

import type { DevelopmentUnitPropertyAction } from '../DevelopmentUnitPropertyActionDialog'
import {
  UNIT_STATUS_LABELS,
  DevelopmentEmptyState,
  DevelopmentErrorState,
  formatDevelopmentCurrency,
} from '../development-ui'
import { inventoryTone, UNIT_PAGE_SIZE } from './model'

interface UnitsQueryState {
  isLoading: boolean
  isError: boolean
  isFetching: boolean
  error: unknown
  refetch: () => Promise<unknown>
}
interface UnitsTabProps {
  workspace: PropertyDevelopmentWorkspace
  inventory?: PropertyDevelopmentWorkspace['summary']['inventory']
  units: PropertyDevelopmentUnit[]
  unitMeta?: PropertyDevelopmentUnitListMeta
  activePriceTable?: PropertyDevelopmentPriceTable
  canManage: boolean
  buildingFilter: string
  setBuildingFilter: Dispatch<SetStateAction<string>>
  unitStatusFilter: 'all' | PropertyDevelopmentUnitStatus
  setUnitStatusFilter: Dispatch<SetStateAction<'all' | PropertyDevelopmentUnitStatus>>
  unitOffset: number
  setUnitOffset: Dispatch<SetStateAction<number>>
  setBulkUnitsOpen: Dispatch<SetStateAction<boolean>>
  openReservation: (unitId: string) => void
  openUnitPrice: (unitId: string) => void
  openUnit: (unitId: string) => void
  setUnitPropertyAction: Dispatch<SetStateAction<{
    action: DevelopmentUnitPropertyAction
    unitId: string
  } | null>>
  router: { push: (href: string) => void }
  unitsQuery: UnitsQueryState
}

export function UnitsTab({
  workspace,
  inventory,
  units,
  unitMeta,
  activePriceTable,
  canManage,
  buildingFilter,
  setBuildingFilter,
  unitStatusFilter,
  setUnitStatusFilter,
  unitOffset,
  setUnitOffset,
  setBulkUnitsOpen,
  openReservation,
  openUnitPrice,
  openUnit,
  setUnitPropertyAction,
  router,
  unitsQuery,
}: UnitsTabProps) {
  return (
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
                      <Table className="min-w-[1040px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Unidade</TableHead>
                            <TableHead>Estrutura</TableHead>
                            <TableHead>Planta</TableHead>
                            <TableHead>Área</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Publicação</TableHead>
                            <TableHead>Ficha do imóvel</TableHead>
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
                                {unit.property_id ? (
                                  <button
                                    type="button"
                                    onClick={() => router.push(`/properties/${unit.property_id}`)}
                                    className="inline-flex items-center gap-1.5 text-xs font-light text-primary hover:underline"
                                  >
                                    <Link2 className="h-3.5 w-3.5" />
                                    Vinculada
                                  </button>
                                ) : (
                                  <span className="text-xs font-light text-muted-foreground">
                                    Não vinculada
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
                                        <>
                                          <DropdownMenuSeparator />
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
                                          <DropdownMenuItem
                                            className="text-destructive focus:text-destructive"
                                            onClick={() => setUnitPropertyAction({
                                              action: 'unlink',
                                              unitId: unit.id,
                                            })}
                                          >
                                            <Unlink className="mr-2 h-4 w-4" />
                                            Desvincular ficha
                                          </DropdownMenuItem>
                                        </>
                                      )}
                                      {!unit.property_id && (
                                        <>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem
                                            onClick={() => setUnitPropertyAction({
                                              action: 'link',
                                              unitId: unit.id,
                                            })}
                                          >
                                            <Link2 className="mr-2 h-4 w-4" />
                                            Vincular imóvel existente
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onClick={() => setUnitPropertyAction({
                                              action: 'promote',
                                              unitId: unit.id,
                                            })}
                                          >
                                            <FilePlus2 className="mr-2 h-4 w-4" />
                                            Criar ficha do imóvel
                                          </DropdownMenuItem>
                                        </>
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
  )
}
