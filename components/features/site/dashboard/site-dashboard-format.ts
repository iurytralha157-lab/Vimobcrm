import { bucketUnitForRange, formatMoney, type LeadBucketUnit } from "@/components/features/marketing/marketing-format";
import { NEUTRAL_SOFT, NEUTRAL_STRONG } from "@/components/features/marketing/marketing-ui";
import type { LeadJourney, SiteAnalyticsDetailed, SiteAnalyticsSummary, SiteDashboardInsights } from "@/lib/validation";

export type { SiteDashboardInsights };
export type SiteInsightPage = SiteDashboardInsights["pages"][number];
export type SiteInsightProperty = SiteDashboardInsights["properties"][number];

/** Everything the tabs read. `insights` is null when the breakdowns are unavailable. */
export interface SiteDashboardData {
  summary: SiteAnalyticsSummary;
  detailed: SiteAnalyticsDetailed;
  insights: SiteDashboardInsights | null;
  dateFrom: string;
  dateTo: string;
  siteBaseUrl: string | null;
}

export type SiteChannel = "search" | "direct" | "campaign" | "social" | "referral";

/** No black fills on the Site dashboard: channels use the primary and neutral scales. */
export const SITE_CHANNELS: ReadonlyArray<{ key: SiteChannel; label: string; color: string }> = [
  { key: "search", label: "Busca", color: "bg-primary" },
  { key: "direct", label: "Direto", color: NEUTRAL_STRONG },
  { key: "campaign", label: "Campanhas", color: "bg-primary/60" },
  { key: "social", label: "Social", color: "bg-primary/30" },
  { key: "referral", label: "Referência", color: NEUTRAL_SOFT },
];

export const SITE_DEVICES = [
  { key: "mobile", label: "Celular" },
  { key: "desktop", label: "Desktop" },
  { key: "tablet", label: "Tablet" },
  { key: "other", label: "Outros / não identificados" },
] as const;

export function summaryChannelPercent(summary: SiteAnalyticsSummary, channel: SiteChannel) {
  const values: Record<SiteChannel, number> = {
    search: summary.searchPct,
    direct: summary.directPct,
    campaign: summary.campaignPct,
    social: summary.socialPct,
    referral: summary.referralPct,
  };
  return values[channel];
}

export function summaryDevicePercent(summary: SiteAnalyticsSummary, device: (typeof SITE_DEVICES)[number]["key"]) {
  const values = {
    mobile: summary.mobilePct,
    desktop: summary.desktopPct,
    tablet: summary.tabletPct,
    other: summary.otherDevicePct,
  };
  return values[device];
}

export function formatDuration(totalSeconds: number | null | undefined) {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) return "—";
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) {
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  }
  return `${Math.floor(seconds / 3_600)}h ${String(Math.floor((seconds % 3_600) / 60)).padStart(2, "0")}m`;
}

export function formatDecimal(value: number | null | undefined, decimals = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

export function formatCollectedAgo(value: string | null | undefined, now = Date.now()) {
  if (!value) return null;
  const date = new Date(value).getTime();
  if (!Number.isFinite(date)) return null;
  const minutes = Math.max(0, Math.floor((now - date) / 60_000));
  if (minutes < 1) return "Coleta agora";
  if (minutes < 60) return `Coleta há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `Coleta há ${hours} h`;
  return `Coleta há ${Math.floor(hours / 24)} dias`;
}

export interface SiteDelta {
  text: string;
  tone: "up" | "down" | "flat";
}

function signed(value: number, decimals: number) {
  const text = Math.abs(value).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${text}`;
}

function buildDelta(change: number, text: string, lowerIsBetter: boolean): SiteDelta {
  if (change === 0) return { text, tone: "flat" };
  return { text, tone: change > 0 !== lowerIsBetter ? "up" : "down" };
}

/** No comparison is shown when the previous period has nothing to compare with. */
export function percentDelta(current: number | null | undefined, previous: number | null | undefined, lowerIsBetter = false) {
  if (current === null || current === undefined || !previous) return null;
  const change = ((current - previous) / previous) * 100;
  return buildDelta(change, `${signed(change, 1)}%`, lowerIsBetter);
}

export function pointsDelta(current: number | null | undefined, previous: number | null | undefined, lowerIsBetter = false) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  const change = current - previous;
  return buildDelta(change, `${signed(change, 2)} p.p.`, lowerIsBetter);
}

export function secondsDelta(current: number | null | undefined, previous: number | null | undefined, lowerIsBetter = false) {
  if (current === null || current === undefined || !previous) return null;
  const change = Math.round(current - previous);
  return buildDelta(change, `${signed(change, 0)} s`, lowerIsBetter);
}

const KNOWN_PAGES: Array<[RegExp, string]> = [
  [/^\/?$/, "Página inicial"],
  [/^\/imoveis\/?$/, "Busca de imóveis"],
  [/^\/contato\/?$/, "Contato"],
  [/^\/sobre\/?$/, "Sobre a imobiliária"],
  [/^\/favoritos\/?$/, "Favoritos"],
];

/** Public pages are recorded under /sites/<slug> outside a custom domain. */
export function publicPath(path: string) {
  return path.replace(/^\/sites\/[^/]+/, "") || "/";
}

export function pageLabel(path: string, title?: string | null) {
  const relative = publicPath(path);
  const known = KNOWN_PAGES.find(([pattern]) => pattern.test(relative));
  if (known) return known[1];
  return title?.trim() || relative;
}

export function journeyOrigin(journey: Pick<LeadJourney, "utm_source" | "referrer">) {
  if (journey.utm_source?.trim()) return journey.utm_source.trim();
  if (!journey.referrer?.trim()) return "Direto";
  try {
    return new URL(journey.referrer).hostname.replace(/^www\./, "") || "Referência";
  } catch {
    return journey.referrer;
  }
}

export function journeyDevice(device: string | null | undefined) {
  return SITE_DEVICES.find((item) => item.key === device?.toLowerCase())?.label ?? null;
}

export function businessKind(businessType: string | null | undefined): "sale" | "rent" | "both" | "other" {
  const value = businessType?.toLocaleLowerCase("pt-BR") ?? "";
  const sale = /vend|lan[cç]amento/.test(value);
  const rent = /alug|loca|rental/.test(value);
  if (sale && rent) return "both";
  if (sale) return "sale";
  return rent ? "rent" : "other";
}

export function propertyBusinessLabel(businessType: string | null | undefined) {
  const labels = { sale: "Venda", rent: "Locação", both: "Venda e locação", other: businessType?.trim() || null };
  return labels[businessKind(businessType)];
}

export function propertyPriceLabel(property: Pick<SiteInsightProperty, "business_type" | "sale_price" | "rent_price">) {
  const kind = businessKind(property.business_type);
  if (kind === "rent" && property.rent_price) return `${formatMoney(property.rent_price, "BRL", 0)}/mês`;
  if (property.sale_price) return formatMoney(property.sale_price, "BRL", 0);
  if (property.rent_price) return `${formatMoney(property.rent_price, "BRL", 0)}/mês`;
  return null;
}

export function propertyTitleLine(property: Pick<SiteInsightProperty, "title" | "neighborhood">) {
  const title = property.title.trim();
  const neighborhood = property.neighborhood?.trim();
  if (!neighborhood || title.toLocaleLowerCase("pt-BR").includes(neighborhood.toLocaleLowerCase("pt-BR"))) return title;
  return `${title} · ${neighborhood}`;
}

export interface SiteDayBucket {
  key: string;
  label: string;
  tooltip: string;
  showLabel: boolean;
  showLabelOnPhone: boolean;
  sessions: number;
  views: number;
  leads: number;
}

const WEEK_DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const DAY_MS = 86_400_000;

function toUtc(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function dayMonth(date: Date) {
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function bucketStart(date: Date, unit: LeadBucketUnit) {
  if (unit === "mês") return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  if (unit === "semana") return new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY_MS);
  return date;
}

/** Fills every period of the range, so days without visits stay visible. */
export function buildSiteBuckets(
  rows: Array<{ date: string; sessions?: number; views: number; leads?: number }>,
  from: string,
  to: string,
) {
  const unit = bucketUnitForRange(from, to);
  const buckets = new Map<string, SiteDayBucket>();
  const end = toUtc(to);
  for (let cursor = toUtc(from); cursor <= end; cursor = new Date(cursor.getTime() + DAY_MS)) {
    const start = bucketStart(cursor, unit);
    const key = start.toISOString().slice(0, 10);
    if (buckets.has(key)) continue;
    const tooltip =
      unit === "mês"
        ? `${MONTHS[start.getUTCMonth()]} de ${start.getUTCFullYear()}`
        : unit === "semana"
          ? `Semana de ${dayMonth(start)}`
          : `${WEEK_DAYS[start.getUTCDay()]}, ${dayMonth(start)}`;
    buckets.set(key, {
      key,
      label: unit === "mês" ? MONTHS[start.getUTCMonth()] : dayMonth(start),
      tooltip,
      showLabel: true,
      showLabelOnPhone: true,
      sessions: 0,
      views: 0,
      leads: 0,
    });
  }
  rows.forEach((row) => {
    const bucket = buckets.get(bucketStart(toUtc(row.date), unit).toISOString().slice(0, 10));
    if (!bucket) return;
    bucket.sessions += row.sessions ?? 0;
    bucket.views += row.views;
    bucket.leads += row.leads ?? 0;
  });
  const list = Array.from(buckets.values());
  const labelStep = list.length > 16 ? 3 : 1;
  const phoneStep = list.length > 7 ? Math.ceil(list.length / 5) : 1;
  list.forEach((bucket, index) => {
    bucket.showLabel = index % labelStep === 0;
    bucket.showLabelOnPhone = index % phoneStep === 0;
  });
  return { unit, buckets: list };
}
