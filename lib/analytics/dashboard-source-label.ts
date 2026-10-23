export const sourceLabels: Readonly<Record<string, string>> = {
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

// Custom sources are data, including names inherited from Object.prototype.
export function findDashboardSourceLabel(source: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(sourceLabels, source)
    ? sourceLabels[source]
    : undefined;
}

export function getDashboardSourceLabel(
  source: string | null | undefined,
  fallback = "Origem não informada",
): string {
  return findDashboardSourceLabel(source ?? "") || source || fallback;
}
