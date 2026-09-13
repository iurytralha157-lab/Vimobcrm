const HOUR_IN_MS = 60 * 60 * 1_000;

export const SITE_ANALYTICS_DELAYED_AFTER_MS = 24 * HOUR_IN_MS;
export const SITE_ANALYTICS_STALE_AFTER_MS = 72 * HOUR_IN_MS;

export type SiteAnalyticsFreshnessStatus =
  "unavailable" | "fresh" | "delayed" | "stale";

export interface SiteAnalyticsFreshness {
  status: SiteAnalyticsFreshnessStatus;
  collectedAt: Date | null;
  ageMs: number | null;
}

export function getSiteAnalyticsFreshness(
  lastCollectedAt?: string | null,
  now: Date = new Date(),
): SiteAnalyticsFreshness {
  const collectedAt = lastCollectedAt ? new Date(lastCollectedAt) : null;
  if (
    !collectedAt ||
    !Number.isFinite(collectedAt.getTime()) ||
    !Number.isFinite(now.getTime())
  ) {
    return { status: "unavailable", collectedAt: null, ageMs: null };
  }

  const ageMs = Math.max(0, now.getTime() - collectedAt.getTime());
  if (ageMs > SITE_ANALYTICS_STALE_AFTER_MS) {
    return { status: "stale", collectedAt, ageMs };
  }
  if (ageMs > SITE_ANALYTICS_DELAYED_AFTER_MS) {
    return { status: "delayed", collectedAt, ageMs };
  }
  return { status: "fresh", collectedAt, ageMs };
}

export function describeSiteAnalyticsFreshness(
  freshness: SiteAnalyticsFreshness,
) {
  if (freshness.status === "unavailable" || freshness.ageMs === null) {
    return "Nenhuma coleta registrada";
  }
  if (freshness.status === "fresh") return "Evento recebido nas últimas 24h";

  const hours = Math.max(1, Math.floor(freshness.ageMs / HOUR_IN_MS));
  if (hours < 48) return `Sem novos eventos há ${hours} horas`;

  const days = Math.floor(hours / 24);
  return `Sem novos eventos há ${days} dias`;
}
