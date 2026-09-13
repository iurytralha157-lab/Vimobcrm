export const PUBLIC_TRACKING_EVENT_TYPES = [
  "pageview",
  "page_view",
  "session_start",
  "page_duration",
  "property_search",
  "property_view",
  "favorite",
  "whatsapp_click",
  "cta_click",
] as const;

export type PublicTrackingEventType =
  (typeof PUBLIC_TRACKING_EVENT_TYPES)[number];

export const PUBLIC_SITE_SEARCH_FILTER_KEYS = [
  "search",
  "cidade",
  "bairro",
  "tipo",
  "finalidade",
  "min_price",
  "max_price",
  "quartos",
  "suites",
  "banheiros",
  "vagas",
] as const;

export type PublicSiteSearchFilterKey =
  (typeof PUBLIC_SITE_SEARCH_FILTER_KEYS)[number];

export type PublicSiteSearchFilters = Partial<
  Record<PublicSiteSearchFilterKey, string>
>;

// Lifecycle flushes keep shorter visits current, so a two-minute heartbeat cuts
// steady-state request volume by 75% compared with the previous 30s interval.
export const PUBLIC_TRACKING_HEARTBEAT_MS = 2 * 60 * 1_000;

export function pickPublicSiteSearchFilters(
  input: string | URLSearchParams,
): PublicSiteSearchFilters {
  const searchParams =
    typeof input === "string" ? new URLSearchParams(input) : input;
  const filters: PublicSiteSearchFilters = {};

  for (const key of PUBLIC_SITE_SEARCH_FILTER_KEYS) {
    const value = searchParams.get(key)?.trim();
    if (value) filters[key] = value;
  }

  return filters;
}
