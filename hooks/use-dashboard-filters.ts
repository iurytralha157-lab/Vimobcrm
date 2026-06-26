import {
  startOfDay,
  endOfDay,
  subDays,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfQuarter,
  startOfYear,
} from "date-fns";

export type DatePreset =
  | "today"
  | "yesterday"
  | "last7days"
  | "last30days"
  | "thisMonth"
  | "lastMonth"
  | "thisQuarter"
  | "thisYear"
  | "custom";

export interface DashboardFilters {
  datePreset: DatePreset;
  dateRange: { from: Date; to: Date };
  teamId: string | null;
  userId: string | null;
  source: string | null;
  campaignId: string | null;
  adSetId: string | null;
  adId: string | null;
  // ✅ Adicionados
  tagId: string | null;
  dealStatus: string | null;
  searchQuery: string;
}

export interface DatePresetOption {
  value: DatePreset;
  label: string;
}

export const datePresetOptions: DatePresetOption[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last7days", label: "Últimos 7 dias" },
  { value: "last30days", label: "Últimos 30 dias" },
  { value: "thisMonth", label: "Este mês" },
  { value: "lastMonth", label: "Mês anterior" },
  { value: "thisQuarter", label: "Este trimestre" },
  { value: "thisYear", label: "Este ano" },
  { value: "custom", label: "Personalizado" },
];

export const sourceLabels: Record<string, string> = {
  meta: "Meta Ads",
  facebook: "Meta Ads",
  instagram: "Meta Ads",
  google: "Google Ads",
  google_ads: "Google Ads",
  site: "Site",
  website: "Site",
  landing_page: "Landing Page",
  whatsapp: "WhatsApp",
  manual: "Manual",
  webhook: "API / Integração",
  api: "API",
  indicacao: "Indicação",
  import: "Importação",
};

export function getDateRangeFromPreset(preset: DatePreset): { from: Date; to: Date } {
  const now = new Date();

  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday": {
      const yesterday = subDays(now, 1);
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
    }
    case "last7days":
      return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
    case "last30days":
      return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
    case "thisMonth":
      return { from: startOfMonth(now), to: endOfDay(now) };
    case "lastMonth": {
      const lastMonth = subMonths(now, 1);
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    }
    case "thisQuarter":
      return { from: startOfQuarter(now), to: endOfDay(now) };
    case "thisYear":
      return { from: startOfYear(now), to: endOfDay(now) };
    case "custom":
    default:
      return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
  }
}

// Deprecated: use useSharedFilters instead
export function useDashboardFilters() {
  console.warn("useDashboardFilters is deprecated. Use useSharedFilters instead.");
  return {} as Record<string, never>;
}
