import { Fragment, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Banknote,
  CircleDollarSign,
  ExternalLink,
  Gauge,
  Target,
} from "lucide-react";

import { MetaCreativePreview } from "@/components/features/meta";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import type {
  MarketingCreative,
  useMarketingDashboard,
} from "@/hooks/marketing";
import type {
  CampaignAggregated,
  MarketingDailyPerformance,
} from "@/hooks/use-campaign-insights";
import { cn } from "@/lib/utils";

import { MarketingDataState } from "./MarketingDataState";
import { MarketingTrendChart } from "./MarketingTrendChart";
import type { MarketingTabHrefs } from "./marketing-tabs";

type MarketingModel = ReturnType<typeof useMarketingDashboard>;

interface MarketingOverviewDashboardProps {
  model: MarketingModel;
  tabHrefs: MarketingTabHrefs;
}

interface MacroPanelProps {
  title: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  action?: ReactNode;
}

interface MacroKpiProps {
  label: string;
  value: string | null;
  icon: typeof Banknote;
  trendValues: Array<number | null>;
  trendLabel: string;
}

interface DenseMetricProps {
  label: string;
  value: string | null;
  hint?: string;
  tone?: "default" | "positive" | "warning";
}

const WEEKDAYS = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];
const DAY_IN_MS = 24 * 60 * 60 * 1_000;
const MAX_SPARKLINE_DAYS = 366;

function formatCurrency(
  value: number | null | undefined,
  currency: string | null | undefined,
) {
  if (value === null || value === undefined || !currency) return null;
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

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  return new Intl.NumberFormat("pt-BR", {
    notation: Math.abs(value) >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function formatRatio(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x`;
}

function parseTrendDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [, year, month, day] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const parsed = new Date(timestamp);

  return parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() === Number(month) - 1 &&
    parsed.getUTCDate() === Number(day)
    ? timestamp
    : null;
}

function buildDailyTrendValues(
  dailyData: MarketingDailyPerformance[],
  dateFrom: string,
  dateTo: string,
  selectValue: (day: MarketingDailyPerformance) => number | null,
) {
  const start = parseTrendDate(dateFrom);
  const end = parseTrendDate(dateTo);
  if (start === null || end === null || start > end) {
    return dailyData.map(selectValue);
  }

  const dayCount = Math.round((end - start) / DAY_IN_MS) + 1;
  if (dayCount > MAX_SPARKLINE_DAYS) return dailyData.map(selectValue);

  const valuesByDate = new Map(
    dailyData.map((day) => [day.date, selectValue(day)] as const),
  );

  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(start + index * DAY_IN_MS).toISOString().slice(0, 10);
    return valuesByDate.has(date) ? (valuesByDate.get(date) ?? null) : null;
  });
}

function KpiSparkline({
  values = [],
  label,
}: {
  values?: Array<number | null>;
  label: string;
}) {
  const gradientId = `marketing-kpi-sparkline-${useId().replace(/:/g, "")}`;
  const finiteValues = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );

  if (finiteValues.length === 0) {
    return (
      <div
        className="flex h-full items-center"
        role="img"
        aria-label={`${label}: sem dados no período`}
      >
        <span className="w-full border-t border-dashed border-primary/25" />
      </div>
    );
  }

  const minimum = Math.min(...finiteValues);
  const maximum = Math.max(...finiteValues);
  const range = maximum - minimum;
  const width = 100;
  const height = 26;
  const verticalPadding = 2;
  const drawableHeight = height - verticalPadding * 2;
  const denominator = Math.max(values.length - 1, 1);
  const points = values.map((value, index) => {
    if (value === null || !Number.isFinite(value)) return null;

    return {
      x: (index / denominator) * width,
      y:
        range === 0
          ? value === 0
            ? height - verticalPadding
            : height / 2
          : verticalPadding + ((maximum - value) / range) * drawableHeight,
    };
  });
  const segments = points.reduce<Array<Array<{ x: number; y: number }>>>(
    (result, point, index) => {
      if (!point) return result;
      if (index === 0 || points[index - 1] === null) result.push([]);
      result.at(-1)!.push(point);
      return result;
    },
    [],
  );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-full w-full overflow-visible opacity-80 transition-opacity duration-200 group-hover:opacity-100"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {segments.map((segment, index) => {
        if (segment.length === 1) {
          const point = segment[0];
          return (
            <circle
              key={`${point.x}-${point.y}`}
              cx={point.x}
              cy={point.y}
              r="1.8"
              fill="var(--primary)"
              vectorEffect="non-scaling-stroke"
            />
          );
        }

        const linePath = segment
          .map(
            (point, pointIndex) =>
              `${pointIndex === 0 ? "M" : "L"} ${point.x} ${point.y}`,
          )
          .join(" ");
        const firstPoint = segment[0];
        const lastPoint = segment.at(-1)!;
        const areaPath = `${linePath} L ${lastPoint.x} ${height} L ${firstPoint.x} ${height} Z`;

        return (
          <g key={`${index}-${firstPoint.x}`}>
            <path d={areaPath} fill={`url(#${gradientId})`} />
            <path
              d={linePath}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </svg>
  );
}

function MacroPanel({
  title,
  children,
  className,
  contentClassName,
  action,
}: MacroPanelProps) {
  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none",
        className,
      )}
    >
      <header className="flex min-h-11 items-center justify-between gap-3 px-3.5 py-2.5">
        <h2 className="truncate text-[13px] font-medium tracking-[-0.01em] text-[var(--app-text-primary)]">
          {title}
        </h2>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className={cn("px-3.5 pb-3.5", contentClassName)}>{children}</div>
    </section>
  );
}

function TableRowSeparator({
  colSpan,
  strong = false,
  insetClassName = "mx-1.5",
}: {
  colSpan: number;
  strong?: boolean;
  insetClassName?: string;
}) {
  return (
    <tr aria-hidden="true">
      <td colSpan={colSpan} className="h-px p-0">
        <div
          className={cn(
            "h-px",
            insetClassName,
            strong ? "bg-[var(--app-border-strong)]" : "bg-[var(--app-border)]",
          )}
        />
      </td>
    </tr>
  );
}

function MacroKpi({
  label,
  value,
  icon: Icon,
  trendValues,
  trendLabel,
}: MacroKpiProps) {
  return (
    <article className="group min-w-0 overflow-hidden border-b border-[var(--app-border)] px-2.5 pt-3 pb-2.5 odd:border-r @min-[300px]/marketing:px-3.5 @min-[1000px]/marketing:border-b-0 @min-[1000px]/marketing:border-r">
      <div className="flex items-center justify-between gap-1.5 @min-[300px]/marketing:gap-3">
        <p className="truncate text-[10px] font-medium text-[var(--app-text-secondary)] @min-[300px]/marketing:text-[11px]">
          {label}
        </p>
        <Icon
          className="h-3.5 w-3.5 shrink-0 text-primary"
          aria-hidden="true"
        />
      </div>
      <p
        className={cn(
          "mt-2 truncate text-[20px] font-medium leading-none tracking-[-0.03em] text-[var(--app-text-primary)] tabular-nums @min-[300px]/marketing:text-[22px]",
          value === null &&
            "text-[12px] font-normal text-[var(--app-text-tertiary)]",
        )}
      >
        {value ?? "Aguardando dados"}
      </p>
      <div className="mt-2 h-6">
        <KpiSparkline values={trendValues} label={trendLabel} />
      </div>
    </article>
  );
}

function DenseMetric({
  label,
  value,
  hint,
  tone = "default",
}: DenseMetricProps) {
  return (
    <div className="min-w-0 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 py-2.5 transition-colors hover:bg-[var(--app-surface-hover)] @min-[1000px]/marketing:px-2 @min-[1450px]/marketing:px-2.5">
      <p className="truncate text-[8px] font-medium uppercase tracking-[0.04em] text-[var(--app-text-secondary)] @min-[1450px]/marketing:text-[9px]">
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 truncate text-[14px] font-medium leading-none tracking-[-0.02em] text-[var(--app-text-primary)] tabular-nums @min-[1000px]/marketing:text-[13px] @min-[1450px]/marketing:text-[17px]",
          value === null &&
            "text-[11px] font-normal text-[var(--app-text-tertiary)]",
          value !== null && tone === "positive" && "text-[var(--success)]",
          value !== null && tone === "warning" && "text-[var(--warning)]",
        )}
      >
        {value ?? "Indisponível"}
      </p>
      {hint ? (
        <p className="mt-1.5 truncate text-[8px] font-light text-[var(--app-text-tertiary)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function CampaignMacroTable({
  campaigns,
  currency,
}: {
  campaigns: CampaignAggregated[];
  currency: string | null;
}) {
  const rows = campaigns.slice(0, 8);
  const totals = rows.reduce(
    (result, campaign) => ({
      spend: result.spend + (campaign.spend ?? 0),
      meta: result.meta + campaign.reported_results,
      conversations:
        result.conversations + campaign.meta_reported_conversations,
    }),
    { spend: 0, meta: 0, conversations: 0 },
  );

  if (rows.length === 0) {
    return (
      <MarketingDataState
        compact
        kind="empty"
        title="Nenhuma campanha no período"
        description="Ajuste o período ou sincronize a conta de anúncios."
      />
    );
  }

  return (
    <div className="overflow-x-auto [scrollbar-width:thin]">
      <table className="w-full min-w-[520px] table-fixed border-separate border-spacing-0 text-left">
        <colgroup>
          <col className="w-[48%]" />
          <col className="w-[12%]" />
          <col className="w-[11%]" />
          <col className="w-[13%]" />
          <col className="w-[16%]" />
        </colgroup>
        <thead>
          <tr className="text-[9px] font-medium uppercase tracking-[0.04em] text-[var(--app-text-tertiary)]">
            <th className="pb-2 pr-2 pl-2 font-medium">Campanha</th>
            <th className="px-1.5 pb-2 text-right font-medium">Investido</th>
            <th className="px-1.5 pb-2 text-right font-medium">Resultados</th>
            <th
              className="px-1.5 pb-2 text-right font-medium"
              title="Parcela dos resultados reportados pela Meta como conversas iniciadas"
            >
              % conversas
            </th>
            <th className="pb-2 pr-2 pl-1.5 text-right font-medium">
              Custo/resultado
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((campaign) => {
            const costPerResult =
              campaign.spend !== null && campaign.reported_results > 0
                ? campaign.spend / campaign.reported_results
                : null;
            const conversationShare =
              campaign.reported_results > 0
                ? (campaign.meta_reported_conversations /
                    campaign.reported_results) *
                  100
                : null;

            return (
              <Fragment key={campaign.campaign_id}>
                <TableRowSeparator colSpan={5} insetClassName="mx-3" />
                <tr className="group text-[10px] text-[var(--app-text-secondary)]">
                  <td className="max-w-[300px] font-medium text-[var(--app-text-primary)]">
                    <div className="ml-1.5 truncate rounded-l-[6px] py-3 pr-2 pl-0.5 transition-colors group-hover:bg-[var(--app-surface-hover)]">
                      {campaign.campaign_name}
                    </div>
                  </td>
                  <td className="text-right tabular-nums">
                    <div className="px-1.5 py-3 transition-colors group-hover:bg-[var(--app-surface-hover)]">
                      {formatCurrency(
                        campaign.spend,
                        campaign.currency ?? currency,
                      ) ?? "—"}
                    </div>
                  </td>
                  <td
                    className="text-right tabular-nums"
                    title={`${formatNumber(campaign.meta_reported_leads)} formulários · ${formatNumber(campaign.meta_reported_conversations)} conversas`}
                  >
                    <div className="px-1.5 py-3 transition-colors group-hover:bg-[var(--app-surface-hover)]">
                      {formatNumber(campaign.reported_results)}
                    </div>
                  </td>
                  <td className="text-right text-primary tabular-nums">
                    <div className="px-1.5 py-3 transition-colors group-hover:bg-[var(--app-surface-hover)]">
                      {formatPercent(conversationShare) ?? "—"}
                    </div>
                  </td>
                  <td className="text-right tabular-nums">
                    <div className="mr-1.5 rounded-r-[6px] py-3 pr-0.5 pl-1.5 transition-colors group-hover:bg-[var(--app-surface-hover)]">
                      {formatCurrency(
                        costPerResult,
                        campaign.currency ?? currency,
                      ) ?? "—"}
                    </div>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <TableRowSeparator colSpan={5} strong insetClassName="mx-3" />
          <tr className="text-[10px] font-medium text-[var(--app-text-primary)]">
            <td className="py-3 pr-2 pl-2">Total exibido</td>
            <td className="px-1.5 py-3 text-right tabular-nums">
              {formatCurrency(totals.spend, currency) ?? "—"}
            </td>
            <td className="px-1.5 py-3 text-right tabular-nums">
              {formatNumber(totals.meta)}
            </td>
            <td className="px-1.5 py-3 text-right text-primary tabular-nums">
              {totals.meta > 0
                ? formatPercent((totals.conversations / totals.meta) * 100)
                : "—"}
            </td>
            <td className="py-3 pr-2 pl-1.5 text-right tabular-nums">
              {totals.meta > 0
                ? formatCurrency(totals.spend / totals.meta, currency)
                : "—"}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ResultsOriginDonut({
  formLeads,
  conversations,
}: {
  formLeads: number;
  conversations: number;
}) {
  const total = formLeads + conversations;
  const formPercent = total > 0 ? (formLeads / total) * 100 : 0;
  const conversationPercent = total > 0 ? 100 - formPercent : 0;

  return (
    <div className="flex min-h-[190px] flex-col items-center justify-center gap-5">
      <div
        className="relative h-36 w-36 shrink-0 rounded-full"
        style={{
          background:
            total > 0
              ? `conic-gradient(var(--primary) 0 ${formPercent}%, var(--success) ${formPercent}% 100%)`
              : "conic-gradient(var(--app-surface-hover) 0 100%)",
        }}
        role="img"
        aria-label={`${formatPercent(formPercent)} formulários e ${formatPercent(conversationPercent)} conversas`}
      >
        <div className="absolute inset-[28px] flex flex-col items-center justify-center rounded-full bg-[var(--app-surface-solid)]">
          <span className="text-[22px] font-medium tracking-[-0.04em] text-[var(--app-text-primary)] tabular-nums">
            {formatNumber(total)}
          </span>
          <span className="mt-0.5 text-[8px] uppercase tracking-[0.08em] text-[var(--app-text-tertiary)]">
            resultados
          </span>
        </div>
      </div>

      <div className="w-full max-w-[220px] min-w-0 space-y-3">
        <div className="flex items-center justify-between gap-3 text-[10px]">
          <span className="inline-flex min-w-0 items-center gap-2 text-[var(--app-text-secondary)]">
            <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
            <span className="truncate">Formulários</span>
          </span>
          <span className="font-medium text-[var(--app-text-primary)] tabular-nums">
            {formatNumber(formLeads)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 text-[10px]">
          <span className="inline-flex min-w-0 items-center gap-2 text-[var(--app-text-secondary)]">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--success)]" />
            <span className="truncate">Conversas</span>
          </span>
          <span className="font-medium text-[var(--app-text-primary)] tabular-nums">
            {formatNumber(conversations)}
          </span>
        </div>
      </div>
    </div>
  );
}

function WeekdayBars({
  data,
  hasCRMAttribution,
}: {
  data: MarketingDailyPerformance[];
  hasCRMAttribution: boolean;
}) {
  const weekdays = WEEKDAYS.map((label, weekday) => ({
    label,
    weekday,
    meta: 0,
    crm: 0,
  }));

  data.forEach((day) => {
    const timestamp = parseTrendDate(day.date);
    if (timestamp === null) return;
    const weekday = new Date(timestamp).getUTCDay();
    weekdays[weekday].meta += day.reportedResults;
    weekdays[weekday].crm += day.crmAttributedLeads;
  });

  const maximum = Math.max(
    ...weekdays.flatMap((item) => [item.meta, item.crm]),
    1,
  );

  return (
    <div aria-label="Resultados Meta e entradas no CRM por dia da semana">
      <div className="space-y-2">
        {weekdays.map((item) => {
          const metaWidth = Math.min(100, (item.meta / maximum) * 100);
          const crmWidth = Math.min(100, (item.crm / maximum) * 100);
          const comparisonTitle = hasCRMAttribution
            ? `${item.meta} resultado(s) Meta · ${item.crm} lead(s) CRM`
            : `${item.meta} resultado(s) Meta · atribuição CRM indisponível`;

          return (
            <div
              key={item.weekday}
              className="grid grid-cols-[30px_minmax(0,1fr)_52px] items-center gap-2"
            >
              <span className="text-[9px] text-[var(--app-text-tertiary)]">
                {item.label}
              </span>
              <div
                className="relative h-6 overflow-hidden rounded-[5px] bg-[var(--app-surface-soft)]"
                title={comparisonTitle}
              >
                {item.meta > 0 ? (
                  <div
                    className="absolute inset-y-0 left-0 rounded-[5px] bg-primary transition-[width] duration-500"
                    style={{ width: `${metaWidth}%` }}
                  />
                ) : null}
                {hasCRMAttribution && item.crm > 0 ? (
                  <div
                    className="absolute top-1.5 bottom-1.5 left-0 rounded-r-[3px] bg-[var(--success)] transition-[width] duration-500"
                    style={{ width: `${crmWidth}%` }}
                  />
                ) : null}
              </div>
              <span className="flex items-center justify-end gap-1 text-right text-[8px] tabular-nums">
                <span className="font-medium text-primary">{item.meta}</span>
                <span className="text-[var(--app-text-tertiary)]">/</span>
                <span className="font-medium text-[var(--success)]">
                  {hasCRMAttribution ? item.crm : "—"}
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-3 pt-2.5 text-[8px] text-[var(--app-text-tertiary)]">
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Resultados
          Meta
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
          Leads CRM
        </span>
      </div>
    </div>
  );
}

function getSafeCreativeDestination(creative: MarketingCreative) {
  return (
    [
      creative.creative_permalink_url,
      creative.creative_video_url,
      creative.creative_url,
    ]
      .map((candidate) => {
        if (!candidate?.trim()) return null;
        try {
          const url = new URL(candidate);
          return url.protocol === "https:" || url.protocol === "http:"
            ? url.toString()
            : null;
        } catch {
          return null;
        }
      })
      .find((candidate): candidate is string => Boolean(candidate)) ?? null
  );
}

function BestAdIdentity({
  creative,
  mediaHref,
}: {
  creative: MarketingCreative;
  mediaHref: string;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const destination = getSafeCreativeDestination(creative);
  const previewCreative = {
    name: creative.ad_name,
    type: creative.creative_video_url ? "video" : "image",
    thumbnailUrl: creative.thumbnail_url,
    creativeUrl: creative.creative_url,
    videoUrl: creative.creative_video_url,
    permalinkUrl: creative.creative_permalink_url,
  } as const;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <HoverCard
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        openDelay={140}
        closeDelay={160}
      >
        <HoverCardTrigger asChild>
          <Link
            href={mediaHref}
            onFocus={() => setPreviewOpen(true)}
            onBlur={() => setPreviewOpen(false)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-[6px] text-left outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/35"
            aria-label={`Pré-visualizar ${creative.ad_name}; abrir galeria de mídia`}
          >
            <MetaCreativePreview
              creative={previewCreative}
              size="sm"
              showAction={false}
              className="shrink-0"
            />
            <span className="min-w-0 truncate" title={creative.ad_name}>
              {creative.ad_name}
            </span>
          </Link>
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          align="start"
          sideOffset={8}
          className="z-[80] max-h-[calc(100vh-24px)] w-[220px] overflow-y-auto rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface-solid)] p-2.5 text-[var(--app-text-primary)] shadow-[0_10px_30px_rgba(0,0,0,0.12)]"
        >
          <MetaCreativePreview
            creative={previewCreative}
            size="preview"
            showAction={false}
            className="w-full"
          />
          <p className="mt-2 truncate text-[10px] font-medium">
            {creative.ad_name}
          </p>
          <p className="mt-0.5 truncate text-[8px] text-[var(--app-text-tertiary)]">
            {creative.campaign_name ?? "Campanha não informada pela Meta"}
          </p>
        </HoverCardContent>
      </HoverCard>

      {destination ? (
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] shadow-none hover:bg-primary/10 hover:text-primary"
        >
          <a
            href={destination}
            target="_blank"
            rel="noopener noreferrer"
            title={`Abrir criativo ${creative.ad_name}`}
            aria-label={`Abrir criativo ${creative.ad_name}`}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled
          title="A Meta não informou um link para este anúncio"
          aria-label={`Link do anúncio ${creative.ad_name} indisponível`}
          className="h-8 w-8 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] shadow-none"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

export function MarketingOverviewDashboard({
  model,
  tabHrefs,
}: MarketingOverviewDashboardProps) {
  const data = model.insightsQuery.data!;
  const { summary } = data;
  const hasSpend = data.hasSpendData && summary.totalSpend !== null;
  const hasCRMAttribution = data.dataQuality.hasCRMAttribution;
  const hasDailyFacts =
    data.dataQuality.hasDailyFacts && data.dailyData.length > 0;
  const hasComparableSpendTrend =
    hasDailyFacts &&
    hasSpend &&
    Boolean(summary.currency) &&
    !data.dataQuality.multipleCurrencies;
  const reportedResults = summary.reportedResults;
  const costPerReportedResult =
    hasSpend && reportedResults > 0
      ? (summary.totalSpend ?? 0) / reportedResults
      : null;
  const spendTrend = hasComparableSpendTrend
    ? buildDailyTrendValues(
        data.dailyData,
        model.dateRange.from,
        model.dateRange.to,
        (day) => day.spend,
      )
    : [];
  const resultTrend = hasDailyFacts
    ? buildDailyTrendValues(
        data.dailyData,
        model.dateRange.from,
        model.dateRange.to,
        (day) => day.reportedResults,
      )
    : [];
  const costPerResultTrend = hasComparableSpendTrend
    ? buildDailyTrendValues(
        data.dailyData,
        model.dateRange.from,
        model.dateRange.to,
        (day) =>
          day.reportedResults > 0 ? day.spend / day.reportedResults : null,
      )
    : [];
  const captureRateTrend =
    hasDailyFacts && hasCRMAttribution
      ? buildDailyTrendValues(
          data.dailyData,
          model.dateRange.from,
          model.dateRange.to,
          (day) => day.captureRate,
        )
      : [];
  const paidCreatives = model.creatives
    .filter((creative) => creative.source_kind === "paid")
    .slice(0, 5);

  return (
    <div className="@container/marketing min-w-0 text-[var(--app-text-primary)]">
      <div className="space-y-3">
        <section className="overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
          <div className="grid grid-cols-2 @min-[1000px]/marketing:grid-cols-[repeat(4,minmax(0,1fr))_minmax(320px,1.7fr)]">
            <MacroKpi
              icon={Banknote}
              label="Investimento"
              value={
                hasSpend
                  ? formatCurrency(summary.totalSpend, summary.currency)
                  : null
              }
              trendValues={spendTrend}
              trendLabel="Evolução diária do investimento no período"
            />
            <MacroKpi
              icon={Target}
              label="Resultado"
              value={formatNumber(reportedResults)}
              trendValues={resultTrend}
              trendLabel="Evolução diária dos resultados reportados pela Meta"
            />
            <MacroKpi
              icon={CircleDollarSign}
              label="Custo por resultado"
              value={formatCurrency(costPerReportedResult, summary.currency)}
              trendValues={costPerResultTrend}
              trendLabel="Evolução diária do custo por resultado"
            />
            <MacroKpi
              icon={Gauge}
              label="Entrada no CRM"
              value={
                hasCRMAttribution ? formatPercent(summary.captureRate) : null
              }
              trendValues={captureRateTrend}
              trendLabel="Evolução diária da entrada de resultados no CRM"
            />

            <div className="col-span-2 min-w-0 border-t border-[var(--app-border)] px-3.5 pt-3 pb-3.5 @min-[1000px]/marketing:col-span-1 @min-[1000px]/marketing:border-t-0">
              <p className="mb-2 text-[11px] font-medium text-[var(--app-text-secondary)]">
                Complementares
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <DenseMetric
                  label="Impressões"
                  value={formatNumber(summary.totalImpressions)}
                />
                <DenseMetric
                  label="Alcance"
                  value={formatNumber(summary.totalReach)}
                />
                <DenseMetric
                  label="Cliques"
                  value={formatNumber(summary.totalClicks)}
                />
                <DenseMetric label="CTR" value={formatPercent(summary.ctr)} />
              </div>
            </div>
          </div>
        </section>

        <div className="grid min-w-0 gap-3 @min-[1000px]/marketing:grid-cols-[minmax(500px,1.72fr)_minmax(235px,0.78fr)_minmax(210px,0.7fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <MacroPanel
              title="Visão temporal"
              action={
                <div
                  aria-hidden="true"
                  className="flex items-center gap-3 whitespace-nowrap text-[9px] font-light text-[var(--app-text-tertiary)]"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[var(--chart-1)]" />
                    Resultados Meta
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[var(--chart-2)]" />
                    Leads CRM
                  </span>
                </div>
              }
              className="min-h-[318px]"
              contentClassName="px-2 pb-1"
            >
              {data.dailyData.length > 0 ? (
                <MarketingTrendChart
                  data={data.dailyData.map((day) => ({
                    date: day.date,
                    leads: day.reportedResults,
                    conversations: day.crmAttributedLeads,
                    total: day.reportedResults,
                  }))}
                  dateFrom={model.dateRange.from}
                  dateTo={model.dateRange.to}
                  showLegend={false}
                  labels={{
                    primary: "Resultados Meta",
                    secondary: "Leads CRM",
                  }}
                  ariaLabel="Visão temporal de resultados da Meta e leads confirmados no CRM"
                />
              ) : (
                <MarketingDataState
                  compact
                  kind="empty"
                  title="Sem série temporal"
                  description="Sincronize a conta ou amplie o período."
                />
              )}
            </MacroPanel>

            <MacroPanel
              title="Campanhas"
              action={
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[9px] font-light text-[var(--app-text-secondary)] shadow-none transition-colors hover:bg-primary hover:text-primary-foreground"
                >
                  <Link href={tabHrefs.paid}>
                    Detalhar <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              }
              className="min-h-[300px]"
              contentClassName="px-2"
            >
              <CampaignMacroTable
                campaigns={model.campaigns}
                currency={summary.currency}
              />
            </MacroPanel>
          </div>

          <div className="grid min-w-0 gap-3 lg:grid-cols-2 @min-[1000px]/marketing:contents">
            <div className="flex min-w-0 flex-col gap-3">
              <MacroPanel
                title="Outras métricas e indicadores"
                className="min-h-[318px]"
                contentClassName="grid grid-cols-2 gap-2 sm:grid-cols-3"
              >
                <DenseMetric
                  label="CPC"
                  value={formatCurrency(summary.cpc, summary.currency)}
                />
                <DenseMetric
                  label="CPM"
                  value={formatCurrency(summary.cpm, summary.currency)}
                />
                <DenseMetric
                  label="Frequência"
                  value={
                    summary.totalImpressions !== null &&
                    summary.totalReach !== null &&
                    summary.totalReach > 0
                      ? formatNumber(
                          summary.totalImpressions / summary.totalReach,
                        )
                      : null
                  }
                />
                <DenseMetric
                  label="Entrada CRM"
                  value={formatPercent(summary.captureRate)}
                  tone="positive"
                />
                <DenseMetric
                  label="Hook rate"
                  value={formatPercent(model.campaignMetrics.averageHookRate)}
                />
                <DenseMetric
                  label="Respondidos"
                  value={
                    hasCRMAttribution
                      ? formatNumber(summary.totalResponded)
                      : null
                  }
                />
                <DenseMetric
                  label="Qualificados"
                  value={
                    hasCRMAttribution
                      ? formatNumber(summary.totalQualified)
                      : null
                  }
                />
                <DenseMetric
                  label="Ganhos"
                  value={
                    hasCRMAttribution ? formatNumber(summary.totalWon) : null
                  }
                  tone="positive"
                />
                <DenseMetric
                  label="ROAS"
                  value={formatRatio(summary.roas)}
                  tone={
                    summary.roas !== null && summary.roas >= 1
                      ? "positive"
                      : "default"
                  }
                />
              </MacroPanel>

              <MacroPanel
                title="Melhores anúncios"
                action={
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[9px] font-light text-[var(--app-text-secondary)] shadow-none transition-colors hover:bg-primary hover:text-primary-foreground"
                  >
                    <Link
                      href={tabHrefs.media}
                      aria-label="Abrir galeria de mídia"
                    >
                      Ver mídia <ArrowUpRight className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                }
                className="min-h-[300px]"
                contentClassName="px-2"
              >
                {paidCreatives.length > 0 ? (
                  <div className="min-w-0 overflow-hidden">
                    <table className="w-full table-fixed border-separate border-spacing-0 text-left">
                      <thead>
                        <tr className="text-[8px] uppercase tracking-[0.04em] text-[var(--app-text-tertiary)]">
                          <th className="w-[72%] pb-2 font-medium">
                            Nome do anúncio
                          </th>
                          <th className="w-[19%] pb-2 text-right font-medium">
                            Impressões
                          </th>
                          <th
                            className="w-[9%] pb-2 text-right font-medium"
                            title="Leads confirmados no CRM"
                          >
                            CRM
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {paidCreatives.map((creative) => (
                          <Fragment key={creative.id}>
                            <TableRowSeparator
                              colSpan={3}
                              insetClassName="mx-3"
                            />
                            <tr className="group text-[9px] text-[var(--app-text-secondary)]">
                              <td className="font-medium text-[var(--app-text-primary)]">
                                <div className="ml-1.5 flex min-h-[60px] items-center rounded-l-[6px] py-2.5 pr-0.5 pl-0.5 transition-colors group-hover:bg-[var(--app-surface-hover)] group-focus-within:bg-[var(--app-surface-hover)]">
                                  <BestAdIdentity
                                    creative={creative}
                                    mediaHref={tabHrefs.media}
                                  />
                                </div>
                              </td>
                              <td className="text-right text-primary tabular-nums">
                                <div className="flex min-h-[60px] items-center justify-end px-1 py-2.5 transition-colors group-hover:bg-[var(--app-surface-hover)] group-focus-within:bg-[var(--app-surface-hover)]">
                                  {formatNumber(creative.impressions) ?? "—"}
                                </div>
                              </td>
                              <td className="text-right text-[var(--success)] tabular-nums">
                                <div className="mr-1.5 flex min-h-[60px] items-center justify-end rounded-r-[6px] py-2.5 pr-0.5 pl-1 transition-colors group-hover:bg-[var(--app-surface-hover)] group-focus-within:bg-[var(--app-surface-hover)]">
                                  {formatNumber(creative.leads_count) ?? "—"}
                                </div>
                              </td>
                            </tr>
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <MarketingDataState
                    compact
                    kind="empty"
                    title="Sem anúncios sincronizados"
                    description="Os anúncios aparecerão após a sincronização da Meta."
                  />
                )}
              </MacroPanel>
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <MacroPanel
                title="Origem dos resultados"
                className="min-h-[318px]"
              >
                <ResultsOriginDonut
                  formLeads={summary.metaReportedLeads}
                  conversations={summary.metaReportedConversations}
                />
              </MacroPanel>

              <MacroPanel title="Período" className="min-h-[300px]">
                {hasDailyFacts ? (
                  <WeekdayBars
                    data={data.dailyData}
                    hasCRMAttribution={hasCRMAttribution}
                  />
                ) : (
                  <MarketingDataState
                    compact
                    kind="empty"
                    title="Sem dados no período"
                    description="Sincronize a conta ou amplie o período."
                  />
                )}
              </MacroPanel>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
