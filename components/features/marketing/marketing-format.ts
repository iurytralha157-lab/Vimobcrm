import type { MarketingDailyPerformance } from "@/hooks/use-campaign-insights";

const EMPTY = "—";

export function formatMoney(value: number | null | undefined, currency: string | null | undefined, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(value) || !currency) return EMPTY;
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("pt-BR", { maximumFractionDigits: decimals })}`;
  }
}

export function formatCount(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return Math.round(value).toLocaleString("pt-BR");
}

export function formatCompact(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  }
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1_000).toLocaleString("pt-BR")} mil`;
  return formatCount(value);
}

export function formatPercent(value: number | null | undefined, decimals = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
}

export function ratio(part: number | null | undefined, total: number | null | undefined) {
  if (part === null || part === undefined || !total) return null;
  return part / total;
}

export function percentOf(part: number | null | undefined, total: number | null | undefined) {
  const value = ratio(part, total);
  return value === null ? null : value * 100;
}

export function campaignStatusLabel(status: string | null | undefined) {
  switch (String(status ?? "").toUpperCase()) {
    case "ACTIVE":
      return "Ativa";
    case "LEARNING":
      return "Em aprendizado";
    case "PAUSED":
    case "ADSET_PAUSED":
    case "CAMPAIGN_PAUSED":
      return "Pausada";
    case "ARCHIVED":
      return "Arquivada";
    case "DELETED":
      return "Excluída";
    case "":
      return EMPTY;
    default:
      return String(status);
  }
}

export function isActiveStatus(status: string | null | undefined) {
  return ["ACTIVE", "LEARNING"].includes(String(status ?? "").toUpperCase());
}

export function isPausedStatus(status: string | null | undefined) {
  return String(status ?? "").toUpperCase().includes("PAUSED");
}

export type LeadBucketUnit = "dia" | "semana" | "mês";

export interface LeadBucket {
  key: string;
  label: string;
  tooltip: string;
  showLabel: boolean;
  showLabelOnPhone: boolean;
  leads: number;
  qualified: number;
  reported: number;
  won: number;
  spend: number;
}

const WEEK_DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function utcDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

function dayMonth(date: Date) {
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function bucketUnitForRange(from: string, to: string): LeadBucketUnit {
  const days = Math.round((utcDate(to).getTime() - utcDate(from).getTime()) / 86_400_000) + 1;
  if (days > 90) return "mês";
  if (days > 31) return "semana";
  return "dia";
}

function bucketStart(date: Date, unit: LeadBucketUnit) {
  if (unit === "mês") return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  if (unit === "semana") {
    const offset = (date.getUTCDay() + 6) % 7;
    return new Date(date.getTime() - offset * 86_400_000);
  }
  return date;
}

/** Fills every period of the range, so the chart shows the days with no leads. */
export function buildLeadBuckets(rows: MarketingDailyPerformance[], from: string, to: string) {
  const unit = bucketUnitForRange(from, to);
  const buckets = new Map<string, LeadBucket>();
  const end = utcDate(to);
  for (let cursor = utcDate(from); cursor <= end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    const start = bucketStart(cursor, unit);
    const key = start.toISOString().slice(0, 10);
    if (!buckets.has(key)) {
      const label = unit === "mês" ? MONTHS[start.getUTCMonth()] : dayMonth(start);
      const tooltip =
        unit === "mês"
          ? `${MONTHS[start.getUTCMonth()]} de ${start.getUTCFullYear()}`
          : unit === "semana"
            ? `Semana de ${dayMonth(start)}`
            : `${WEEK_DAYS[start.getUTCDay()]}, ${dayMonth(start)}`;
      buckets.set(key, { key, label, tooltip, showLabel: true, showLabelOnPhone: true, leads: 0, qualified: 0, reported: 0, won: 0, spend: 0 });
    }
  }
  rows.forEach((row) => {
    const bucket = buckets.get(bucketStart(utcDate(row.date), unit).toISOString().slice(0, 10));
    if (!bucket) return;
    bucket.leads += row.crmAttributedLeads;
    bucket.qualified += row.qualified;
    bucket.reported += row.reportedResults;
    bucket.won += row.won;
    bucket.spend += row.spend;
  });
  const list = Array.from(buckets.values());
  const labelStep = list.length > 16 ? 3 : 1;
  list.forEach((bucket, index) => {
    bucket.showLabel = index % labelStep === 0;
    bucket.showLabelOnPhone = index % (list.length > 7 ? Math.ceil(list.length / 5) : 1) === 0;
  });
  return { unit, buckets: list };
}

export function niceAxisMax(value: number) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [0.25, 0.5, 1, 2, 2.5, 5, 10].map((item) => item * magnitude).find((item) => value <= item * 4);
  return (step ?? magnitude * 10) * 4;
}
