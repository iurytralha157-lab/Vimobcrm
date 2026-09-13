"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronRight, Layers3 } from "lucide-react";

import { MetaCreativePreview } from "@/components/features/meta";
import type {
  AdAggregated,
  AdsetAggregated,
  CampaignAggregated,
} from "@/hooks/use-campaign-insights";
import { cn } from "@/lib/utils";

export interface MarketingPaidTableProps {
  campaigns: CampaignAggregated[];
}

type PerformanceLevel = "campaign" | "adset" | "ad" | "total";

interface PerformanceRow {
  id: string;
  name: string;
  level: PerformanceLevel;
  status: string | null;
  currency: string | null;
  spend: number | null;
  budget: number | null;
  budgetType: string | null;
  reportedResults: number;
  messages: number;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  cpc: number | null;
  ctr: number | null;
  frequency: number | null;
  childCount: number;
  secondaryLabel: string | null;
  creative: AdAggregated | null;
}

function formatCurrency(value: number | null, currency: string | null) {
  if (value === null || !currency) return null;
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("pt-BR", {
      maximumFractionDigits: 2,
    })}`;
  }
}

function formatNumber(value: number | null) {
  if (value === null) return null;
  return new Intl.NumberFormat("pt-BR", {
    notation: value >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value === null) return null;
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function safeRatio(
  numerator: number | null,
  denominator: number | null,
  multiplier = 1,
) {
  if (numerator === null || denominator === null || denominator <= 0) {
    return null;
  }
  return (numerator / denominator) * multiplier;
}

function sumCompleteMetric(values: Array<number | null>) {
  if (values.length === 0 || values.some((value) => value === null)) {
    return null;
  }
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function formatBudget(
  value: number | null,
  currency: string | null,
  type: string | null,
) {
  const formatted = formatCurrency(value, currency);
  if (!formatted) return null;
  const normalized = String(type ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "daily") return `${formatted}/dia`;
  if (normalized === "lifetime") return `${formatted} total`;
  return formatted;
}

function formatMetaLabel(value: string | null) {
  if (!value) return null;
  return value
    .trim()
    .toLocaleLowerCase("pt-BR")
    .replaceAll("_", " ")
    .replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase("pt-BR"));
}

function statusPresentation(status: string | null) {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();
  const active = normalized === "ACTIVE" || normalized === "LEARNING";
  return {
    active,
    label:
      normalized === "ACTIVE"
        ? "Ativa"
        : normalized === "LEARNING"
          ? "Aprendizado"
          : normalized === "PAUSED"
            ? "Pausada"
            : normalized === "ARCHIVED"
              ? "Arquivada"
              : status || "Status não informado",
  };
}

function rowSurface(level: PerformanceLevel, expanded = false) {
  if (level === "total") return "bg-transparent";
  if (expanded) return "bg-primary/[0.045]";
  if (level === "adset") {
    return "bg-primary/[0.015] hover:bg-primary/[0.04]";
  }
  if (level === "ad") return "bg-transparent hover:bg-primary/[0.03]";
  return "bg-transparent hover:bg-primary/[0.035]";
}

function toCampaignRow(campaign: CampaignAggregated): PerformanceRow {
  return {
    id: campaign.campaign_id,
    name: campaign.campaign_name,
    level: "campaign",
    status: campaign.status,
    currency: campaign.currency,
    spend: campaign.spend,
    budget: campaign.budget,
    budgetType: campaign.budget_type,
    reportedResults: campaign.reported_results,
    messages: campaign.meta_reported_conversations,
    impressions: campaign.impressions,
    reach: campaign.reach,
    clicks: campaign.clicks,
    cpc: campaign.cpc ?? safeRatio(campaign.spend, campaign.clicks),
    ctr: campaign.ctr ?? safeRatio(campaign.clicks, campaign.impressions, 100),
    frequency: campaign.frequency,
    childCount: campaign.adsets.length,
    secondaryLabel: formatMetaLabel(campaign.objective),
    creative: null,
  };
}

function toAdsetRow(adset: AdsetAggregated): PerformanceRow {
  const reportedResults = adset.leads_reported + adset.conversations_count;
  return {
    id: adset.adset_id,
    name: adset.adset_name,
    level: "adset",
    status: adset.status,
    currency: adset.currency,
    spend: adset.spend,
    budget: adset.budget,
    budgetType: adset.budget_type,
    reportedResults,
    messages: adset.conversations_count,
    impressions: adset.impressions,
    reach: adset.reach,
    clicks: adset.clicks,
    cpc: adset.cpc ?? safeRatio(adset.spend, adset.clicks),
    ctr: adset.ctr ?? safeRatio(adset.clicks, adset.impressions, 100),
    frequency: null,
    childCount: adset.ads.length,
    secondaryLabel: formatMetaLabel(adset.optimization_goal),
    creative: null,
  };
}

function toAdRow(ad: AdAggregated): PerformanceRow {
  const reportedResults = ad.leads_reported + ad.conversations_count;
  return {
    id: ad.ad_id,
    name: ad.ad_name,
    level: "ad",
    status: ad.status,
    currency: ad.currency,
    spend: ad.spend,
    budget: null,
    budgetType: null,
    reportedResults,
    messages: ad.conversations_count,
    impressions: ad.impressions,
    reach: ad.reach,
    clicks: ad.clicks,
    cpc: ad.cpc ?? safeRatio(ad.spend, ad.clicks),
    ctr: ad.ctr ?? safeRatio(ad.clicks, ad.impressions, 100),
    frequency: null,
    childCount: 0,
    secondaryLabel: ad.creative_id ? "Criativo sincronizado" : null,
    creative: ad,
  };
}

function buildTotalRow(campaigns: CampaignAggregated[]): PerformanceRow {
  const campaignsWithSpend = campaigns.filter(
    (campaign) => campaign.spend !== null,
  );
  const currencies = Array.from(
    new Set(
      campaignsWithSpend
        .map((campaign) => campaign.currency)
        .filter((currency): currency is string => Boolean(currency)),
    ),
  );
  const hasCompatibleCurrency =
    campaignsWithSpend.length > 0 &&
    campaignsWithSpend.every((campaign) => Boolean(campaign.currency)) &&
    currencies.length === 1;
  const currency = hasCompatibleCurrency ? currencies[0] : null;
  const spend = hasCompatibleCurrency
    ? sumCompleteMetric(campaigns.map((campaign) => campaign.spend))
    : null;
  const impressions = sumCompleteMetric(
    campaigns.map((campaign) => campaign.impressions),
  );
  const reach = sumCompleteMetric(campaigns.map((campaign) => campaign.reach));
  const clicks = sumCompleteMetric(
    campaigns.map((campaign) => campaign.clicks),
  );

  return {
    id: "total",
    name: "Total exibido",
    level: "total",
    status: null,
    currency,
    spend,
    budget: null,
    budgetType: null,
    reportedResults: campaigns.reduce(
      (total, campaign) => total + campaign.reported_results,
      0,
    ),
    messages: campaigns.reduce(
      (total, campaign) => total + campaign.meta_reported_conversations,
      0,
    ),
    impressions,
    reach,
    clicks,
    cpc: safeRatio(spend, clicks),
    ctr: safeRatio(clicks, impressions, 100),
    frequency: null,
    childCount: campaigns.length,
    secondaryLabel:
      campaignsWithSpend.length > 0 && spend === null
        ? "Total financeiro indisponível"
        : null,
    creative: null,
  };
}

function DataCell({
  value,
  tone = "default",
  title,
}: {
  value: string | null;
  tone?: "default" | "primary" | "success";
  title?: string;
}) {
  return value === null ? (
    <span
      className="text-[10px] font-normal text-[var(--app-text-tertiary)]"
      title={title ?? "Dado não disponível na sincronização atual"}
    >
      —
    </span>
  ) : (
    <span
      className={cn(
        "whitespace-nowrap font-medium tabular-nums",
        tone === "primary" && "text-primary",
        tone === "success" && "text-emerald-500",
      )}
      title={title}
    >
      {value}
    </span>
  );
}

function MetricCell({
  level,
  value,
  tone,
  title,
  className,
}: {
  level: PerformanceLevel;
  value: string | null;
  tone?: "default" | "primary" | "success";
  title?: string;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "bg-transparent text-right",
        level === "total"
          ? "border-t border-[var(--app-border-strong)]"
          : "border-t border-[var(--app-border)]",
        className,
      )}
    >
      <div className="px-2 py-3">
        <DataCell value={value} tone={tone} title={title} />
      </div>
    </td>
  );
}

function PerformanceCells({ row }: { row: PerformanceRow }) {
  const costPerResult = safeRatio(row.spend, row.reportedResults);
  const costPerMessage = safeRatio(row.spend, row.messages);

  return (
    <>
      <MetricCell
        level={row.level}
        value={formatCurrency(row.spend, row.currency)}
      />
      <MetricCell
        level={row.level}
        value={formatNumber(row.reportedResults)}
        tone="primary"
        title="Resultados reportados pela plataforma para a campanha, como formulários e conversas iniciadas"
      />
      <MetricCell
        level={row.level}
        value={formatCurrency(costPerResult, row.currency)}
        className="hidden lg:table-cell"
      />
      <MetricCell
        level={row.level}
        value={formatBudget(row.budget, row.currency, row.budgetType)}
        className="hidden xl:table-cell"
        title={
          row.budgetType
            ? `Orçamento ${row.budgetType === "daily" ? "diário" : "total"}`
            : undefined
        }
      />
      <MetricCell
        level={row.level}
        value={formatNumber(row.messages)}
        className="hidden md:table-cell"
      />
      <MetricCell
        level={row.level}
        value={formatCurrency(costPerMessage, row.currency)}
        className="hidden xl:table-cell"
      />
      <MetricCell
        level={row.level}
        value={formatNumber(row.impressions)}
        className="hidden md:table-cell"
      />
      <MetricCell
        level={row.level}
        value={formatNumber(row.reach)}
        className="hidden xl:table-cell"
        title="Soma do alcance diário; não representa pessoas únicas no período"
      />
      <MetricCell
        level={row.level}
        value={formatNumber(row.clicks)}
        className="hidden md:table-cell"
      />
      <MetricCell
        level={row.level}
        value={formatCurrency(row.cpc, row.currency)}
        className="hidden lg:table-cell"
      />
      <MetricCell
        level={row.level}
        value={formatPercent(row.ctr)}
        tone="primary"
        className="hidden lg:table-cell"
      />
      <MetricCell
        level={row.level}
        className="hidden xl:table-cell"
        value={
          row.frequency === null
            ? null
            : row.frequency.toLocaleString("pt-BR", {
                maximumFractionDigits: 2,
              })
        }
      />
    </>
  );
}

function EntityCell({
  row,
  expanded = false,
  onToggle,
}: {
  row: PerformanceRow;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const status = statusPresentation(row.status);
  const isExpandable = Boolean(onToggle && row.childCount > 0);
  const label =
    row.level === "campaign"
      ? `${row.childCount} ${row.childCount === 1 ? "conjunto" : "conjuntos"}`
      : row.level === "adset"
        ? `${row.childCount} ${row.childCount === 1 ? "anúncio" : "anúncios"}`
        : row.level === "ad"
          ? "Anúncio"
          : `${row.childCount} ${row.childCount === 1 ? "campanha" : "campanhas"}`;
  const content = (
    <>
      {isExpandable ? (
        <span
          aria-hidden="true"
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-hover)] text-[var(--app-text-tertiary)] transition-colors group-hover/entity:bg-primary/10 group-hover/entity:text-primary group-focus-visible/entity:ring-2 group-focus-visible/entity:ring-primary/35",
            expanded && "bg-primary/10 text-primary",
          )}
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-200",
              expanded && "rotate-90",
            )}
          />
        </span>
      ) : row.level === "adset" ? (
        <span
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary"
        >
          <Layers3 className="h-3 w-3" />
        </span>
      ) : row.level === "ad" && row.creative ? (
        <MetaCreativePreview
          creative={{
            name: row.creative.ad_name,
            type: row.creative.creative_video_url ? "video" : "image",
            thumbnailUrl: row.creative.thumbnail_url,
            creativeUrl: row.creative.creative_url,
            videoUrl: row.creative.creative_video_url,
            permalinkUrl: row.creative.creative_permalink_url,
          }}
          size="sm"
          showAction
          className="shrink-0"
        />
      ) : null}

      <span className="min-w-0 flex-1 text-left">
        <span
          className={cn(
            "block truncate text-[10px] text-[var(--app-text-primary)]",
            row.level === "campaign" || row.level === "total"
              ? "font-medium"
              : "font-normal",
          )}
          title={row.name}
        >
          {row.name}
        </span>
        {row.level !== "total" ? (
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[9px] text-[var(--app-text-tertiary)]">
            <span className="inline-flex shrink-0 items-center gap-1">
              <span
                aria-hidden="true"
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  status.active
                    ? "bg-emerald-500"
                    : "bg-[var(--app-text-tertiary)]",
                )}
              />
              {status.label}
            </span>
            <span aria-hidden="true">•</span>
            <span>{label}</span>
            {row.secondaryLabel ? (
              <>
                <span aria-hidden="true">•</span>
                <span className="truncate">{row.secondaryLabel}</span>
              </>
            ) : null}
          </span>
        ) : row.secondaryLabel ? (
          <span className="mt-0.5 block truncate text-[9px] text-[var(--app-text-tertiary)]">
            {row.secondaryLabel}
          </span>
        ) : null}
      </span>
    </>
  );

  return (
    <th
      scope="row"
      className={cn(
        "min-w-0 bg-transparent font-normal",
        row.level === "total"
          ? "border-t border-[var(--app-border-strong)]"
          : "border-t border-[var(--app-border)]",
      )}
    >
      {isExpandable ? (
        <button
          type="button"
          aria-label={`${expanded ? "Ocultar" : "Ver"} ${row.level === "campaign" ? "conjuntos" : "anúncios"} de ${row.name}`}
          aria-expanded={expanded}
          onClick={onToggle}
          className={cn(
            "group/entity flex w-full min-w-0 items-center gap-2 rounded-[6px] px-2 py-2.5 focus-visible:outline-none",
            row.level === "adset" && "pl-4",
          )}
        >
          {content}
        </button>
      ) : (
        <div
          className={cn(
            "flex w-full min-w-0 items-center gap-2 px-2 py-2.5",
            row.level === "adset" && "pl-4",
            row.level === "ad" && "pl-7",
            row.level === "total" && "py-3",
          )}
        >
          {content}
        </div>
      )}
    </th>
  );
}

function PerformanceTableRow({
  row,
  expanded,
  onToggle,
}: {
  row: PerformanceRow;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  return (
    <tr
      className={cn(
        "group text-[10px] text-[var(--app-text-secondary)] transition-colors duration-150",
        rowSurface(row.level, expanded),
        row.level === "total" && "font-medium text-[var(--app-text-primary)]",
      )}
    >
      <EntityCell row={row} expanded={expanded} onToggle={onToggle} />
      <PerformanceCells row={row} />
    </tr>
  );
}

export function MarketingPaidTable({ campaigns }: MarketingPaidTableProps) {
  const [expandedCampaignIds, setExpandedCampaignIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedAdsetIds, setExpandedAdsetIds] = useState<Set<string>>(
    () => new Set(),
  );
  const totalRow = useMemo(() => buildTotalRow(campaigns), [campaigns]);

  const toggleCampaign = (campaignId: string) => {
    setExpandedCampaignIds((current) => {
      const next = new Set(current);
      if (next.has(campaignId)) next.delete(campaignId);
      else next.add(campaignId);
      return next;
    });
  };

  const toggleAdset = (campaignId: string, adsetId: string) => {
    const key = `${campaignId}:${adsetId}`;
    setExpandedAdsetIds((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="overflow-hidden rounded-[8px]">
      <span id="marketing-results-definition" className="sr-only">
        Resultados reportados pela plataforma para a campanha, como formulários
        e conversas iniciadas.
      </span>
      <table className="w-full table-fixed border-collapse text-left">
        <caption className="sr-only">
          Campanhas e seus conjuntos e anúncios sincronizados
        </caption>
        <colgroup>
          <col className="w-[50%] md:w-[32%] lg:w-[28%] xl:w-[24%]" />
          <col className="w-[25%] md:w-[12%] lg:w-[9%] xl:w-[7%]" />
          <col className="w-[25%] md:w-[9%] lg:w-[7%] xl:w-[5.5%]" />
          <col className="hidden lg:table-column lg:w-[10%] xl:w-[7.5%]" />
          <col className="hidden xl:table-column xl:w-[8%]" />
          <col className="hidden md:table-column md:w-[12%] lg:w-[9%] xl:w-[5%]" />
          <col className="hidden xl:table-column xl:w-[7.5%]" />
          <col className="hidden md:table-column md:w-[20%] lg:w-[12%] xl:w-[7%]" />
          <col className="hidden xl:table-column xl:w-[6.5%]" />
          <col className="hidden md:table-column md:w-[15%] lg:w-[8%] xl:w-[5.5%]" />
          <col className="hidden lg:table-column lg:w-[9%] xl:w-[5.5%]" />
          <col className="hidden lg:table-column lg:w-[8%] xl:w-[5%]" />
          <col className="hidden xl:table-column xl:w-[6%]" />
        </colgroup>
        <thead>
          <tr className="text-[9px] font-medium uppercase tracking-[0.04em] text-[var(--app-text-tertiary)]">
            <th scope="col" className="pb-2 pr-2 pl-2 font-medium">
              Campanha / conjunto / anúncio
            </th>
            <th scope="col" className="px-2 pb-2 text-right font-medium">
              Investido
            </th>
            <th
              scope="col"
              aria-describedby="marketing-results-definition"
              className="px-2 pb-2 text-right font-medium"
            >
              Resultados
            </th>
            <th
              scope="col"
              className="hidden px-2 pb-2 text-right font-medium lg:table-cell"
            >
              Custo/result.
            </th>
            <th
              scope="col"
              className="hidden px-2 pb-2 text-right font-medium xl:table-cell"
            >
              Orçamento
            </th>
            <th
              scope="col"
              className="hidden px-2 pb-2 text-right font-medium md:table-cell"
            >
              Mensagens
            </th>
            <th
              scope="col"
              className="hidden px-2 pb-2 text-right font-medium xl:table-cell"
            >
              Custo/msg
            </th>
            <th
              scope="col"
              className="hidden px-2 pb-2 text-right font-medium md:table-cell"
            >
              Impressões
            </th>
            <th
              scope="col"
              className="hidden px-2 pb-2 text-right font-medium xl:table-cell"
              title="Soma do alcance diário no período"
            >
              Alcance
            </th>
            <th
              scope="col"
              className="hidden px-2 pb-2 text-right font-medium md:table-cell"
            >
              Cliques
            </th>
            <th
              scope="col"
              className="hidden px-2 pb-2 text-right font-medium lg:table-cell"
            >
              CPC
            </th>
            <th
              scope="col"
              className="hidden px-2 pb-2 text-right font-medium lg:table-cell"
            >
              CTR
            </th>
            <th
              scope="col"
              className="hidden px-2 pb-2 text-right font-medium xl:table-cell"
            >
              Frequência
            </th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => {
            const campaignExpanded = expandedCampaignIds.has(
              campaign.campaign_id,
            );
            return (
              <Fragment key={campaign.campaign_id}>
                <PerformanceTableRow
                  row={toCampaignRow(campaign)}
                  expanded={campaignExpanded}
                  onToggle={() => toggleCampaign(campaign.campaign_id)}
                />

                {campaignExpanded
                  ? campaign.adsets.map((adset) => {
                      const adsetKey = `${campaign.campaign_id}:${adset.adset_id}`;
                      const adsetExpanded = expandedAdsetIds.has(adsetKey);

                      return (
                        <Fragment key={adsetKey}>
                          <PerformanceTableRow
                            row={toAdsetRow(adset)}
                            expanded={adsetExpanded}
                            onToggle={() =>
                              toggleAdset(campaign.campaign_id, adset.adset_id)
                            }
                          />

                          {adsetExpanded
                            ? adset.ads.map((ad) => (
                                <PerformanceTableRow
                                  key={`${adsetKey}:${ad.ad_id}`}
                                  row={toAdRow(ad)}
                                />
                              ))
                            : null}
                        </Fragment>
                      );
                    })
                  : null}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <PerformanceTableRow row={totalRow} />
        </tfoot>
      </table>
    </div>
  );
}
