import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { AdAggregated, AdsetAggregated, CampaignAggregated } from "@/hooks/use-campaign-insights";
import { cn } from "@/lib/utils";

import { campaignStatusLabel, formatCompact, formatCount, formatMoney, formatPercent, isActiveStatus, isPausedStatus, percentOf, ratio } from "./marketing-format";
import type { MarketingModel } from "./marketing-model";
import type { MarketingTabHrefs } from "./marketing-tabs";
import { CreativeImage, EmptyNote, INK, KpiCard, KpiRow, NEUTRAL_SOFT, NEUTRAL_STRONG, PANEL_SOFT, Panel, ProviderBadge, SEGMENT_COLORS, SegmentedBar } from "./marketing-ui";

const TH = "whitespace-nowrap px-2 pb-2 text-right text-[12px] font-light text-[var(--app-text-secondary)]";
const TD = "whitespace-nowrap px-2 py-2.5 text-right text-[12px] font-light tabular-nums text-[var(--app-text-primary)]";
const FILTERS = [
  { key: "all", label: "Todas" },
  { key: "active", label: "Ativas" },
  { key: "paused", label: "Pausadas" },
] as const;

type TreeRow = {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: number | null;
  leads_count: number;
  qualified_count: number;
  won_count: number;
  currency: string | null;
  cpm?: number | null;
};

function MetricCells({ row, leads }: { row: TreeRow; leads: number }) {
  const cpm = row.cpm ?? (row.spend !== null && row.impressions ? (row.spend / row.impressions) * 1000 : null);
  return (
    <>
      <td className={TD}>{formatMoney(row.spend, row.currency, 0)}</td>
      <td className={TD}>{formatCompact(row.impressions)}</td>
      <td className={TD}>{formatCount(row.clicks)}</td>
      <td className={TD}>{formatPercent(row.ctr)}</td>
      <td className={TD}>{formatMoney(row.cpc, row.currency)}</td>
      <td className={TD}>{formatMoney(cpm, row.currency)}</td>
      <td className={TD}>{formatCount(leads)}</td>
      <td className={TD}>{formatMoney(ratio(row.spend, leads), row.currency)}</td>
      <td className={TD}>{formatCount(row.qualified_count)}</td>
      <td className={TD}>{formatMoney(ratio(row.spend, row.qualified_count), row.currency)}</td>
      <td className={TD}>{formatCount(row.won_count)}</td>
    </>
  );
}

function ExpandButton({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? "Recolher" : "Expandir"} ${label}`}
      onClick={onClick}
      className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--app-text-secondary)]", PANEL_SOFT)}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

function NameCell({ title, note, indent = 0, lead }: { title: string; note: string; indent?: number; lead: React.ReactNode }) {
  return (
    <td className={cn(TD, "max-w-[300px] pl-0 text-left")} style={{ paddingLeft: indent }}>
      <span className="flex items-center gap-2">
        {lead}
        <span className="min-w-0">
          <span className="block truncate" title={title}>{title}</span>
          <span className="block truncate text-[10px] text-[var(--app-text-tertiary)]">{note}</span>
        </span>
      </span>
    </td>
  );
}

function AdRow({ ad }: { ad: AdAggregated }) {
  return (
    <tr className={cn("border-b border-[var(--app-border)]", PANEL_SOFT)}>
      <NameCell
        title={ad.ad_name}
        note={`Anúncio · ${campaignStatusLabel(ad.status)}`}
        indent={48}
        lead={
          <span className="flex h-9 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[4px]">
            <CreativeImage
              size="sm"
              className="h-full w-full"
              media={{ name: ad.ad_name, thumbnailUrl: ad.thumbnail_url, imageUrl: ad.creative_url, videoUrl: ad.creative_video_url, permalinkUrl: ad.creative_permalink_url }}
            />
          </span>
        }
      />
      <MetricCells row={ad} leads={ad.leads_count} />
    </tr>
  );
}

function AdsetRows({ adset }: { adset: AdsetAggregated }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className={cn("border-b border-[var(--app-border)]", PANEL_SOFT)}>
        <NameCell
          title={adset.adset_name}
          note={`${formatCount(adset.ads.length)} anúncios · ${campaignStatusLabel(adset.status)}`}
          indent={24}
          lead={<ExpandButton open={open} label={adset.adset_name} onClick={() => setOpen(!open)} />}
        />
        <MetricCells row={adset} leads={adset.leads_count} />
      </tr>
      {open ? adset.ads.map((ad) => <AdRow key={ad.ad_id} ad={ad} />) : null}
    </>
  );
}

function CampaignRows({ campaign }: { campaign: CampaignAggregated }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-b border-[var(--app-border)]">
        <NameCell
          title={campaign.campaign_name}
          note={`Meta · ${campaignStatusLabel(campaign.status)} · ${formatCount(campaign.adsets.length)} conjuntos`}
          lead={
            <>
              <ExpandButton open={open} label={campaign.campaign_name} onClick={() => setOpen(!open)} />
              <ProviderBadge />
            </>
          }
        />
        <MetricCells row={campaign} leads={campaign.crm_attributed_leads} />
      </tr>
      {open ? campaign.adsets.map((adset) => <AdsetRows key={adset.adset_id} adset={adset} />) : null}
    </>
  );
}

export function MarketingCampaignsTab({ model, tabHrefs }: { model: MarketingModel; tabHrefs: MarketingTabHrefs }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const summary = model.insightsQuery.data!.summary;
  const currency = summary.currency;
  const campaigns = useMemo(() => [...model.campaigns].sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0)), [model.campaigns]);
  const visible = campaigns.filter((campaign) =>
    filter === "all" ? true : filter === "active" ? isActiveStatus(campaign.status) : isPausedStatus(campaign.status),
  );
  const totalSpend = summary.totalSpend ?? 0;
  const leads = summary.crmAttributedLeads;
  const costRows = campaigns
    .map((campaign) => ({ campaign, cost: ratio(campaign.spend, campaign.qualified_count) }))
    .filter((row) => row.cost !== null)
    .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0))
    .slice(0, 6);
  const costMax = Math.max(...costRows.map((row) => row.cost ?? 0), summary.cpql ?? 0, 0);

  return (
    <div className="space-y-3">
      <KpiRow>
        <KpiCard label="Campanhas ativas" value={`${model.campaignMetrics.activeCampaigns} de ${campaigns.length}`} note={`${formatCount(summary.totalAdsets)} conjuntos · ${formatCount(summary.totalAds)} anúncios`} />
        <KpiCard label="Investimento" value={formatMoney(summary.totalSpend, currency, 0)} note={`CPM ${formatMoney(summary.cpm, currency)}`} href={tabHrefs.overview} />
        <KpiCard label="Cliques no link" value={formatCount(summary.totalLinkClicks)} note={`CTR ${formatPercent(summary.ctr)} · CPC ${formatMoney(summary.cpc, currency)}`} />
        <KpiCard label="Custo por qualificado" value={formatMoney(summary.cpql, currency)} note={`${formatCount(summary.totalQualified)} qualificados`} href={tabHrefs.acquisition} />
      </KpiRow>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel title="Para onde foi a verba" aside={`${formatMoney(totalSpend, currency, 0)} em ${campaigns.length} campanhas`}>
          <SegmentedBar items={campaigns.slice(0, 6).map((campaign, index) => ({ key: campaign.campaign_id, value: campaign.spend ?? 0, className: SEGMENT_COLORS[index] }))} />
          <ul className="mt-3 space-y-2">
            {campaigns.slice(0, 6).map((campaign, index) => (
              <li key={campaign.campaign_id} className="grid grid-cols-[minmax(0,1fr)_52px_52px_84px] items-center gap-2 text-[12px] font-light">
                <span className="flex min-w-0 items-center gap-2 text-[var(--app-text-primary)]">
                  <span aria-hidden="true" className={cn("h-2.5 w-2.5 shrink-0 rounded-[2px]", SEGMENT_COLORS[index])} />
                  <span className="truncate" title={campaign.campaign_name}>{campaign.campaign_name}</span>
                </span>
                <span className="text-right tabular-nums text-[var(--app-text-secondary)]">{formatPercent(percentOf(campaign.spend, totalSpend))}</span>
                <span className="text-right tabular-nums text-[var(--app-text-secondary)]">{formatPercent(percentOf(campaign.crm_attributed_leads, leads))}</span>
                <span className="text-right tabular-nums text-[var(--app-text-primary)]">{formatMoney(campaign.spend, campaign.currency, 0)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[10px] font-light text-[var(--app-text-tertiary)]">Colunas: parte da verba, parte dos leads e investimento.</p>
        </Panel>
        <Panel title="Custo por qualificado" aside={`Média ${formatMoney(summary.cpql, currency)}`}>
          {costRows.length === 0 ? <EmptyNote>Nenhuma campanha com qualificados no período.</EmptyNote> : null}
          <ul className="space-y-3">
            {costRows.map(({ campaign, cost }, index) => (
              <li key={campaign.campaign_id}>
                <div className="flex justify-between gap-3 text-[12px] font-light text-[var(--app-text-primary)]">
                  <span className="truncate" title={campaign.campaign_name}>{campaign.campaign_name}</span>
                  <span className="tabular-nums">{formatMoney(cost, campaign.currency)}</span>
                </div>
                <div className={cn("relative mt-1 h-2.5 rounded-[3px]", NEUTRAL_SOFT)} aria-hidden="true">
                  <span className={cn("block h-full rounded-[3px]", index === 0 ? "bg-primary" : NEUTRAL_STRONG)} style={{ width: `${costMax ? ((cost ?? 0) / costMax) * 100 : 0}%` }} />
                  {summary.cpql && costMax ? <span className={cn("absolute -top-0.5 h-3.5 w-0.5", INK)} style={{ left: `${(summary.cpql / costMax) * 100}%` }} /> : null}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel
        title="Campanhas, conjuntos e anúncios"
        aside={
          <span className="inline-flex gap-0.5 rounded-[8px] bg-[color-mix(in_srgb,var(--app-text-primary)_7.5%,transparent)] p-1">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={filter === item.key}
                onClick={() => setFilter(item.key)}
                className={cn("rounded-[6px] px-2.5 py-1 text-[12px] font-light", filter === item.key ? "bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]" : "text-[var(--app-text-secondary)]")}
              >
                {item.label}
              </button>
            ))}
          </span>
        }
      >
        {visible.length === 0 ? (
          <EmptyNote>Nenhuma campanha neste filtro.</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] border-collapse">
              <thead>
                <tr className="border-b border-[var(--app-border)]">
                  <th className={cn(TH, "pl-0 text-left")}>Nome</th>
                  {["Investido", "Impressões", "Cliques", "CTR", "CPC", "CPM", "Leads", "CPL real", "Qualificados", "Custo por qualif.", "Vendas"].map((label) => (
                    <th key={label} className={TH}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>{visible.map((campaign) => <CampaignRows key={campaign.campaign_id} campaign={campaign} />)}</tbody>
              <tfoot>
                <tr>
                  <td className={cn(TD, "pl-0 text-left")}>Total</td>
                  <MetricCells
                    leads={leads}
                    row={{ spend: summary.totalSpend, impressions: summary.totalImpressions, clicks: summary.totalClicks, ctr: summary.ctr, cpc: summary.cpc, cpm: summary.cpm, leads_count: leads, qualified_count: summary.totalQualified, won_count: summary.totalWon, currency }}
                  />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
