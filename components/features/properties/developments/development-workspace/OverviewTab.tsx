import Image from 'next/image'
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  Sparkles,
} from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { TabsContent } from '@/components/ui/tabs'
import type { PropertyDevelopment } from '@/lib/validation'
import { cn } from '@/lib/utils'

import {
  formatDevelopmentDate,
  isSafeDevelopmentImageUrl,
} from '../development-ui'

interface OverviewTabProps {
  development: PropertyDevelopment
}

export function OverviewTab({ development }: OverviewTabProps) {
  return (
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
  )
}
