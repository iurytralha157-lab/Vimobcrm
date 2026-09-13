import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  DoorOpen,
  Eye,
  EyeOff,
  MapPin,
  TrendingUp,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type {
  PropertyDevelopmentPriceTable,
  PropertyDevelopmentWorkspace,
} from '@/lib/validation'

import {
  COMMERCIAL_STATUS_LABELS,
  DEVELOPMENT_STATUS_LABELS,
  DEVELOPMENT_TYPE_LABELS,
  MetricCard,
  formatDevelopmentDate,
} from '../development-ui'

interface WorkspaceHeaderProps {
  workspace: PropertyDevelopmentWorkspace
  address: string
  activePriceTable?: PropertyDevelopmentPriceTable
  onBack: () => void
}

export function WorkspaceHeader({
  workspace,
  address,
  activePriceTable,
  onBack,
}: WorkspaceHeaderProps) {
  const { development, summary } = workspace
  const { inventory } = summary

  return (
    <>
          <header className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={onBack}
                className="-ml-2"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Lançamentos
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
    </>
  )
}
