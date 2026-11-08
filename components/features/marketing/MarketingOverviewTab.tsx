import { useMemo } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { MarketingBestCreatives, MarketingCreativeSpotlight } from "./MarketingCreativeSpotlight";
import { MarketingLeadsChart } from "./MarketingLeadsChart";
import { campaignStatusLabel, formatCompact, formatCount, formatMoney, formatPercent, isActiveStatus, percentOf, ratio } from "./marketing-format";
import { rankPaidCreatives, type MarketingModel } from "./marketing-model";
import type { MarketingTabHrefs } from "./marketing-tabs";
import { EmptyNote, INK, KpiCard, KpiRow, NEUTRAL_SOFT, Panel, ProviderBadge, StatTile, StatusPill } from "./marketing-ui";

const TH = "whitespace-nowrap px-2 pb-2 text-right text-[12px] font-light text-[var(--app-text-secondary)]";
const TD = "whitespace-nowrap px-2 py-2.5 text-right text-[12px] font-light tabular-nums text-[var(--app-text-primary)]";

export function MarketingOverviewTab({ model, tabHrefs }: { model: MarketingModel; tabHrefs: MarketingTabHrefs }) {
  const data = model.insightsQuery.data!;
  const summary = data.summary;
  const currency = summary.currency;
  const leads = summary.crmAttributedLeads;
  const realCpl = ratio(summary.totalSpend, leads);
  const daily = data.dailyData;
  const creatives = useMemo(() => rankPaidCreatives(model), [model]);
  const campaigns = useMemo(() => [...model.campaigns].sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0)), [model.campaigns]);
  const totalResults = summary.metaReportedLeads + summary.metaReportedConversations;

  return (
    <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-3">
        <KpiRow>
          <KpiCard label="Investimento" value={formatMoney(summary.totalSpend, currency, 0)} note={`CPM ${formatMoney(summary.cpm, currency)}`} href={tabHrefs.paid} spark={daily.map((row) => row.spend)} />
          <KpiCard label="Leads no CRM" value={formatCount(leads)} note={`${formatCount(summary.totalLinkClicks)} cliques no link`} href={tabHrefs.acquisition} spark={daily.map((row) => row.crmAttributedLeads)} />
          <KpiCard label="CPL real" value={formatMoney(realCpl, currency)} note={`CTR ${formatPercent(summary.ctr)}`} href={tabHrefs.paid} spark={daily.map((row) => (row.crmAttributedLeads ? row.spend / row.crmAttributedLeads : 0))} />
          <KpiCard label="Vendas" value={formatCount(summary.totalWon)} note={`${formatMoney(summary.cac, currency, 0)} por venda`} href={tabHrefs.acquisition} spark={daily.map((row) => row.won)} />
        </KpiRow>

        <MarketingLeadsChart
          rows={daily}
          from={model.dateRange.from}
          to={model.dateRange.to}
          currency={currency}
          stats={
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <StatTile label="Meta e Google" value={formatCount(summary.reportedResults)} note="Informado pelas plataformas" />
              <StatTile label="Chegaram no CRM" value={formatCount(leads)} note={`${formatCount(summary.captureGap)} não chegaram`} />
              <StatTile label="Ganhos" value={formatCount(summary.totalWon)} note={`${formatPercent(percentOf(summary.totalWon, leads))} dos leads`} highlight />
              <StatTile label="Ainda em aberto" value={formatCount(summary.totalOpen)} note={`${formatPercent(percentOf(summary.totalOpen, leads))} dos leads`} />
              <StatTile label="Perdidos" value={formatCount(summary.totalLost)} note={`${formatPercent(percentOf(summary.totalLost, leads))} dos leads`} />
            </div>
          }
        />

        <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <Panel title="Do lead à venda">
            <p className="text-[12px] font-light text-[var(--app-text-secondary)]">Leads no período</p>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-[24px] font-normal tabular-nums text-[var(--app-text-primary)]">{formatCount(leads)}</span>
              <span className="text-[12px] font-light text-[var(--app-text-secondary)]">
                {formatCount(summary.totalQualified)} qualificados · {formatCount(summary.totalWon)} vendas
              </span>
            </div>
            <div className={cn("mt-2 flex h-6 gap-0.5 overflow-hidden rounded-[4px]", NEUTRAL_SOFT)} aria-hidden="true">
              <span className={INK} style={{ width: `${percentOf(summary.totalWon, leads) ?? 0}%` }} />
              <span className="bg-primary" style={{ width: `${percentOf(summary.totalQualified, leads) ?? 0}%` }} />
            </div>
          </Panel>
          {[
            { title: "Formulários", value: summary.metaReportedLeads, bar: "bg-primary" },
            { title: "Conversas", value: summary.metaReportedConversations, bar: INK },
          ].map((item) => (
            <Panel key={item.title} title={item.title}>
              <p className="text-[12px] font-light text-[var(--app-text-secondary)]">{formatCount(item.value)} resultados</p>
              <div className="mt-5 flex justify-between text-[12px] font-light text-[var(--app-text-primary)]">
                <span>Da mídia paga</span>
                <span className="tabular-nums">{formatPercent(percentOf(item.value, totalResults), 0)}</span>
              </div>
              <div className={cn("mt-1 h-1.5 overflow-hidden rounded-full", NEUTRAL_SOFT)} aria-hidden="true">
                <span className={cn("block h-full rounded-full", item.bar)} style={{ width: `${percentOf(item.value, totalResults) ?? 0}%` }} />
              </div>
            </Panel>
          ))}
        </div>

        <Panel title="Campanhas" aside={<Link href={tabHrefs.paid} scroll={false} className="hover:text-[var(--app-text-primary)]">Ver todas</Link>}>
          {campaigns.length === 0 ? (
            <EmptyNote>Nenhuma campanha no período.</EmptyNote>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] border-collapse">
                <thead>
                  <tr className="border-b border-[var(--app-border)]">
                    <th className={cn(TH, "pl-0 text-left")}>Campanha</th>
                    {["Investido", "Impressões", "CPM", "CTR", "Leads", "CPL real", "Qualificados", "Custo por qualif.", "Vendas"].map((label) => (
                      <th key={label} className={TH}>{label}</th>
                    ))}
                    <th className={cn(TH, "pr-0 text-left")}>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.slice(0, 5).map((campaign) => (
                    <tr key={campaign.campaign_id} className="border-b border-[var(--app-border)]">
                      <td className={cn(TD, "max-w-[220px] pl-0 text-left")}>
                        <span className="flex items-center gap-2">
                          <ProviderBadge />
                          <span className="truncate" title={campaign.campaign_name}>{campaign.campaign_name}</span>
                        </span>
                      </td>
                      <td className={TD}>{formatMoney(campaign.spend, campaign.currency, 0)}</td>
                      <td className={TD}>{formatCompact(campaign.impressions)}</td>
                      <td className={TD}>{formatMoney(campaign.cpm, campaign.currency)}</td>
                      <td className={TD}>{formatPercent(campaign.ctr)}</td>
                      <td className={TD}>{formatCount(campaign.crm_attributed_leads)}</td>
                      <td className={TD}>{formatMoney(ratio(campaign.spend, campaign.crm_attributed_leads), campaign.currency)}</td>
                      <td className={TD}>{formatCount(campaign.qualified_count)}</td>
                      <td className={TD}>{formatMoney(campaign.cpql, campaign.currency)}</td>
                      <td className={TD}>{formatCount(campaign.won_count)}</td>
                      <td className={cn(TD, "pr-0 text-left")}>
                        <StatusPill label={campaignStatusLabel(campaign.status)} active={isActiveStatus(campaign.status)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      <aside className="min-w-0 space-y-3">
        <MarketingCreativeSpotlight creatives={creatives} />
        <MarketingBestCreatives creatives={creatives} />
      </aside>
    </div>
  );
}
