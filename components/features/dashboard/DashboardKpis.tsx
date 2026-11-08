import type { DealsEvolutionPoint, EnhancedDashboardStats } from "@/hooks/use-dashboard-stats";
import { cn } from "@/lib/utils";

import { DashboardKpiCard, DashboardSkeletonBlock } from "./dashboard-ui";
import { dashboardCardsSpark, dashboardDelta, dashboardKpiRates } from "./dashboard-kpi-model";

type Trigger = (trigger: HTMLElement) => void;

type KpiData = Pick<
  EnhancedDashboardStats,
  | "totalLeads"
  | "uniqueLeads"
  | "reentries"
  | "totalEntries"
  | "entryBreakdownAvailable"
  | "openLeads"
  | "lostLeads"
  | "closedLeads"
  | "avgResponseTime"
  | "totalSalesValue"
  | "leadsTrend"
  | "entriesTrend"
  | "openTrend"
  | "lostTrend"
  | "closedTrend"
>;

type DashboardKpiGridProps = {
  /** Desktop keeps the original 5 + 4 grid; mobile the 2 × 2 plus secondary grid. */
  layout: "desktop" | "mobile";
  data: KpiData;
  isLoading?: boolean;
  periodLabel: string;
  evolution: readonly DealsEvolutionPoint[];
  scheduledVisits?: number | string;
  propertyCount?: number | string;
  siteVisits?: number | string;
  onLeadsClick?: Trigger;
  onLostClick?: Trigger;
  onWonClick?: Trigger;
  onFirstContactClick?: Trigger;
  onVisitsClick?: Trigger;
};

function formatNumber(value: number | string) {
  return typeof value === "string" ? value : value.toLocaleString("pt-BR");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number) {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

const PRIMARY_TOURS = [
  "dashboard-kpi-leads",
  "dashboard-kpi-open",
  "dashboard-kpi-lost",
  "dashboard-kpi-won",
  "dashboard-kpi-visits",
];
const SECONDARY_TOURS = [
  "dashboard-kpi-vgv",
  "dashboard-kpi-first-contact",
  "dashboard-kpi-properties",
  "dashboard-kpi-site-visits",
];

export function DashboardKpiGrid({
  layout,
  data,
  isLoading,
  periodLabel,
  evolution,
  scheduledVisits,
  propertyCount,
  siteVisits,
  onLeadsClick,
  onLostClick,
  onWonClick,
  onFirstContactClick,
  onVisitsClick,
}: DashboardKpiGridProps) {
  const desktop = layout === "desktop";

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className={cn("grid gap-2", desktop ? "grid-cols-5" : "grid-cols-2 sm:grid-cols-4")}>
          {(desktop ? PRIMARY_TOURS : PRIMARY_TOURS.slice(0, 4)).map((tour) => (
            <div key={tour} data-tour={tour}>
              <DashboardSkeletonBlock className="h-[118px] rounded-[12px]" />
            </div>
          ))}
        </div>
        <div className={cn("grid gap-2", desktop ? "grid-cols-5" : "grid-cols-2 sm:grid-cols-3")}>
          {(desktop ? SECONDARY_TOURS : [SECONDARY_TOURS[0], PRIMARY_TOURS[4], ...SECONDARY_TOURS.slice(1)]).map((tour, index) => (
            <div key={tour} data-tour={tour} className={cn(index === 0 && "col-span-2")}>
              <DashboardSkeletonBlock className="h-[78px] rounded-[12px]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const rates = dashboardKpiRates(data);
  const entriesBreakdown = data.entryBreakdownAvailable
    ? `${data.uniqueLeads.toLocaleString("pt-BR")} entradas iniciais + ${data.reentries.toLocaleString("pt-BR")} reentradas`
    : null;
  const salesValuePerWin = data.closedLeads > 0 ? data.totalSalesValue / data.closedLeads : null;

  const leads = (
    <DashboardKpiCard
      key="leads"
      tourTarget="dashboard-kpi-leads"
      label="Leads"
      value={formatNumber(data.totalEntries)}
      spark={dashboardCardsSpark(evolution)}
      note={entriesBreakdown ? `${data.reentries.toLocaleString("pt-BR")} reentradas` : "Leads únicos"}
      delta={dashboardDelta(data.entryBreakdownAvailable ? data.entriesTrend : data.leadsTrend)}
      hint={entriesBreakdown
        ? `Entradas no período: ${entriesBreakdown}. Cada reentrada soma uma nova entrada, mesmo quando continua no mesmo card. O gráfico mostra os cards criados em cada intervalo. ${periodLabel}.`
        : `Leads únicos no período. A contagem de reentradas ainda não está disponível nesta versão da API. ${periodLabel}.`}
      onClick={onLeadsClick}
    />
  );
  const open = (
    <DashboardKpiCard
      key="open"
      tourTarget="dashboard-kpi-open"
      label="Em aberto"
      value={formatNumber(data.openLeads ?? 0)}
      spark={evolution.map((point) => point.abertos)}
      note={`${formatPercent(rates.open)} dos leads`}
      delta={dashboardDelta(data.openTrend)}
      hint={`Cards únicos do período que estão em aberto; percentual sobre os cards únicos. ${periodLabel}.`}
    />
  );
  const lost = (
    <DashboardKpiCard
      key="lost"
      tourTarget="dashboard-kpi-lost"
      label="Perdidos"
      value={formatNumber(data.lostLeads ?? 0)}
      spark={evolution.map((point) => point.perdas)}
      note={`${formatPercent(rates.lost)} dos leads`}
      delta={dashboardDelta(data.lostTrend, { lowerIsBetter: true })}
      hint={`Cards únicos do período que estão perdidos; percentual sobre os cards únicos. ${periodLabel}.`}
      onClick={onLostClick}
    />
  );
  const won = (
    <DashboardKpiCard
      key="won"
      tourTarget="dashboard-kpi-won"
      label="Ganhos"
      value={formatNumber(data.closedLeads)}
      spark={evolution.map((point) => point.ganhos)}
      note={`${formatPercent(rates.won)} de conversão`}
      delta={dashboardDelta(data.closedTrend)}
      hint={`Cards únicos do período que estão ganhos; conversão sobre os cards únicos. ${periodLabel}.`}
      onClick={onWonClick}
    />
  );
  const visits = (
    <DashboardKpiCard
      key="visits"
      tourTarget="dashboard-kpi-visits"
      label="Visitas"
      value={formatNumber(scheduledVisits ?? 0)}
      compact={!desktop}
      note="Visitas e reuniões marcadas"
      hint={`Visitas e reuniões criadas no período - ${periodLabel}. O filtro usa a data de criação da marcação, independente do dia da visita e da entrada do lead.`}
      onClick={onVisitsClick}
    />
  );
  const vgv = (
    <DashboardKpiCard
      key="vgv"
      tourTarget="dashboard-kpi-vgv"
      label="VGV"
      value={formatCurrency(data.totalSalesValue)}
      compact
      className="col-span-2"
      note={salesValuePerWin === null ? "Sem vendas no período" : `${formatCurrency(salesValuePerWin)} por venda`}
      hint={`VGV estimado dos cards ganhos captados no período - ${periodLabel}. Usa o valor do lead ou, quando ausente, o preço atual do imóvel. Não é histórico de fechamentos no período.`}
    />
  );
  const firstContact = (
    <DashboardKpiCard
      key="first-contact"
      tourTarget="dashboard-kpi-first-contact"
      label="1º contato"
      value={data.avgResponseTime}
      compact
      note="Média da primeira resposta"
      hint="Média da primeira resposta humana registrada. Ao filtrar por usuário, considera quem respondeu; os demais indicadores usam o responsável atual do lead."
      onClick={onFirstContactClick}
    />
  );
  const properties = (
    <DashboardKpiCard
      key="properties"
      tourTarget="dashboard-kpi-properties"
      label="Imóveis"
      value={formatNumber(propertyCount ?? 0)}
      compact
      note="Cadastrados"
      hint="Total de imóveis cadastrados"
    />
  );
  const siteSessions = (
    <DashboardKpiCard
      key="site-visits"
      tourTarget="dashboard-kpi-site-visits"
      label="Visitas no site"
      value={formatNumber(siteVisits ?? 0)}
      compact
      note="Sessões únicas"
      hint={`Sessões únicas no site no período - ${periodLabel}`}
    />
  );

  if (desktop) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-5 gap-2">{[leads, open, lost, won, visits]}</div>
        <div className="grid grid-cols-5 gap-2">{[vgv, firstContact, properties, siteSessions]}</div>
      </div>
    );
  }
  return (
    <div className="space-y-2 sm:space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[leads, open, lost, won]}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[vgv, visits, firstContact, properties, siteSessions]}</div>
    </div>
  );
}
