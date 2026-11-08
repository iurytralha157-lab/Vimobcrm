import { useMemo } from "react";

import { cn } from "@/lib/utils";

import { formatCompact, formatCount, formatMoney, formatPercent, percentOf, ratio } from "./marketing-format";
import type { MarketingModel } from "./marketing-model";
import { EmptyNote, KpiCard, KpiRow, Panel, ProviderBadge, StatTile } from "./marketing-ui";

const TH = "whitespace-nowrap px-2 pb-2 text-right text-[12px] font-light text-[var(--app-text-secondary)]";
const TD = "whitespace-nowrap px-2 py-2.5 text-right text-[12px] font-light tabular-nums text-[var(--app-text-primary)]";
const STAGE_COLORS = ["bg-primary/25", "bg-primary/40", "bg-primary/60", "bg-primary", "bg-[var(--app-text-primary)]"];

export function MarketingAcquisitionTab({ model }: { model: MarketingModel }) {
  const summary = model.insightsQuery.data!.summary;
  const currency = summary.currency;
  const leads = summary.crmAttributedLeads;
  const stages = [
    { label: "Leads no CRM", value: leads, base: summary.reportedResults, baseLabel: "de Meta e Google" },
    { label: "Contatados", value: summary.totalContacted, base: leads, baseLabel: "da etapa" },
    { label: "Respondidos", value: summary.totalResponded, base: summary.totalContacted, baseLabel: "da etapa" },
    { label: "Qualificados", value: summary.totalQualified, base: summary.totalResponded, baseLabel: "da etapa" },
    { label: "Vendas", value: summary.totalWon, base: summary.totalQualified, baseLabel: "da etapa" },
  ];
  const campaigns = useMemo(() => [...model.campaigns].sort((a, b) => b.reported_results - a.reported_results), [model.campaigns]);

  return (
    <div className="space-y-3">
      <KpiRow>
        <KpiCard label="Chegada no CRM" value={formatPercent(summary.captureRate ?? percentOf(leads, summary.reportedResults))} note={`${formatCount(leads)} de ${formatCount(summary.reportedResults)} resultados`} />
        <KpiCard label="Taxa de resposta" value={formatPercent(summary.responseRate)} note={`${formatCount(summary.totalResponded)} responderam`} />
        <KpiCard label="Taxa de qualificação" value={formatPercent(summary.qualificationRate)} note={`${formatCount(summary.totalQualified)} de ${formatCount(leads)} leads`} />
        <KpiCard label="Taxa de venda" value={formatPercent(summary.conversionRate)} note={`${formatCount(summary.totalWon)} vendas`} />
      </KpiRow>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="Da impressão à venda" aside={`${formatMoney(summary.totalSpend, currency, 0)} investidos`}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <StatTile label="Impressões" value={formatCompact(summary.totalImpressions)} note={`CPM ${formatMoney(summary.cpm, currency)}`} />
            <StatTile label="Cliques no link" value={formatCount(summary.totalLinkClicks)} note={`${formatPercent(percentOf(summary.totalLinkClicks, summary.totalImpressions))} das impressões`} />
            <StatTile label="Meta e Google" value={formatCount(summary.reportedResults)} note={`${formatPercent(percentOf(summary.reportedResults, summary.totalLinkClicks))} dos cliques`} />
          </div>
          <ul className="mt-4 space-y-1.5">
            {stages.map((stage, index) => (
              <li key={stage.label} className="grid grid-cols-[84px_minmax(0,1fr)_112px] items-center gap-3 text-[12px] font-light sm:grid-cols-[110px_minmax(0,1fr)_140px]">
                <span className="truncate text-[var(--app-text-secondary)]">{stage.label}</span>
                <span className="flex h-9 justify-center">
                  <span
                    className={cn("flex h-full min-w-1.5 items-center justify-center rounded-[4px] tabular-nums", STAGE_COLORS[index], index >= 3 ? "text-white dark:text-[var(--app-background)]" : "text-[var(--app-text-primary)]")}
                    style={{ width: `${percentOf(stage.value, leads || stage.value) ?? 0}%` }}
                  >
                    {(percentOf(stage.value, leads) ?? 0) >= 8 ? formatCount(stage.value) : ""}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block truncate text-[var(--app-text-primary)]">{formatPercent(percentOf(stage.value, stage.base))} {stage.baseLabel}</span>
                  <span className="block text-[10px] text-[var(--app-text-tertiary)]">{formatMoney(ratio(summary.totalSpend, stage.value), currency)} cada</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
        <div className="grid gap-3">
          <Panel title="Quem responde rápido qualifica mais">
            <EmptyNote>Depende do cruzamento com o tempo de resposta, ainda fora desta versão.</EmptyNote>
          </Panel>
          <Panel title="Motivos de perda" aside={`${formatCount(summary.totalLost)} perdidos`}>
            <EmptyNote>Depende do cruzamento com os motivos do CRM, ainda fora desta versão.</EmptyNote>
          </Panel>
        </div>
      </div>
      <Panel title="Plataforma x CRM, por campanha" aside={`${formatCount(summary.captureGap)} resultados não chegaram ao CRM`}>
        {campaigns.length === 0 ? (
          <EmptyNote>Nenhuma campanha no período.</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead>
                <tr className="border-b border-[var(--app-border)]">
                  <th className={cn(TH, "pl-0 text-left")}>Campanha</th>
                  {["Na plataforma", "No CRM", "Não chegaram", "Investido", "CPL real", "Qualificados", "Custo por qualif.", "Vendas"].map((label) => (
                    <th key={label} className={TH}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.campaign_id} className="border-b border-[var(--app-border)]">
                    <td className={cn(TD, "max-w-[260px] pl-0 text-left")}>
                      <span className="flex items-center gap-2">
                        <ProviderBadge />
                        <span className="truncate" title={campaign.campaign_name}>{campaign.campaign_name}</span>
                      </span>
                    </td>
                    <td className={TD}>{formatCount(campaign.reported_results)}</td>
                    <td className={TD}>{formatCount(campaign.crm_attributed_leads)}</td>
                    <td className={TD}>{formatCount(campaign.capture_gap)}</td>
                    <td className={TD}>{formatMoney(campaign.spend, campaign.currency, 0)}</td>
                    <td className={TD}>{formatMoney(ratio(campaign.spend, campaign.crm_attributed_leads), campaign.currency)}</td>
                    <td className={TD}>{formatCount(campaign.qualified_count)}</td>
                    <td className={TD}>{formatMoney(ratio(campaign.spend, campaign.qualified_count), campaign.currency)}</td>
                    <td className={TD}>{formatCount(campaign.won_count)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className={cn(TD, "pl-0 text-left")}>Total</td>
                  <td className={TD}>{formatCount(summary.reportedResults)}</td>
                  <td className={TD}>{formatCount(leads)}</td>
                  <td className={TD}>{formatCount(summary.captureGap)}</td>
                  <td className={TD}>{formatMoney(summary.totalSpend, currency, 0)}</td>
                  <td className={TD}>{formatMoney(ratio(summary.totalSpend, leads), currency)}</td>
                  <td className={TD}>{formatCount(summary.totalQualified)}</td>
                  <td className={TD}>{formatMoney(summary.cpql, currency)}</td>
                  <td className={TD}>{formatCount(summary.totalWon)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
