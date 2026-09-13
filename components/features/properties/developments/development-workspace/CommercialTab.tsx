import { CircleDollarSign, Tag } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TabsContent } from '@/components/ui/tabs'
import type { PropertyDevelopmentWorkspace } from '@/lib/validation'
import { cn } from '@/lib/utils'

import {
  PRICE_TABLE_STATUS_LABELS,
  UNIT_STATUS_LABELS,
  DevelopmentEmptyState,
  formatDevelopmentCurrency,
  formatDevelopmentDate,
} from '../development-ui'
import { inventoryTone } from './model'

interface CommercialTabProps {
  workspace: PropertyDevelopmentWorkspace
  inventory?: PropertyDevelopmentWorkspace['summary']['inventory']
  canManage: boolean
  openActivation: (priceTableId: string) => void
}
export function CommercialTab({
  workspace,
  inventory,
  canManage,
  openActivation,
}: CommercialTabProps) {
  return (
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
  )
}
