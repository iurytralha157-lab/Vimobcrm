import type { Dispatch, SetStateAction } from 'react'
import Image from 'next/image'
import {
  Bath,
  BedDouble,
  FileStack,
  ParkingCircle,
  Plus,
  Ruler,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { TabsContent } from '@/components/ui/tabs'
import type { PropertyDevelopmentWorkspace } from '@/lib/validation'

import {
  DevelopmentEmptyState,
  isSafeDevelopmentImageUrl,
} from '../development-ui'

interface FloorPlansTabProps {
  workspace: PropertyDevelopmentWorkspace
  canManage: boolean
  setFloorPlanOpen: Dispatch<SetStateAction<boolean>>
}

export function FloorPlansTab({
  workspace,
  canManage,
  setFloorPlanOpen,
}: FloorPlansTabProps) {
  return (
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
  )
}
