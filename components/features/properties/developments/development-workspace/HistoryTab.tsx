import { History } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { TabsContent } from '@/components/ui/tabs'
import type {
  PropertyDevelopmentUnit,
  PropertyDevelopmentWorkspace,
} from '@/lib/validation'

import {
  DevelopmentEmptyState,
  formatDevelopmentDate,
} from '../development-ui'
import { developmentUnitEventLabel } from './model'

interface HistoryTabProps {
  workspace: PropertyDevelopmentWorkspace
  units: PropertyDevelopmentUnit[]
}
export function HistoryTab({ workspace, units }: HistoryTabProps) {
  return (
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
                                  {developmentUnitEventLabel(event)}
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
  )
}
