import type { Dispatch, SetStateAction } from 'react'
import { Building2, Layers3, Plus } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TabsContent } from '@/components/ui/tabs'
import type { PropertyDevelopmentWorkspace } from '@/lib/validation'

import {
  BUILDING_TYPE_LABELS,
  PHASE_STATUS_LABELS,
  DevelopmentEmptyState,
  formatDevelopmentDate,
} from '../development-ui'

interface StructureTabProps {
  workspace: PropertyDevelopmentWorkspace
  canManage: boolean
  setPhaseOpen: Dispatch<SetStateAction<boolean>>
  openBuilding: (phaseId?: string) => void
}

export function StructureTab({
  workspace,
  canManage,
  setPhaseOpen,
  openBuilding,
}: StructureTabProps) {
  return (
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
  )
}
