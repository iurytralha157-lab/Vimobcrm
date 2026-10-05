// Meta may append a generated date/hash token to an otherwise useful title.
// Only remove that unmistakable terminal token; preserve all other names.
const generatedTitleSuffix = /(?:\s+|[-_])20\d{2}[-_/](?:0[1-9]|1[0-2])[-_/](?:0[1-9]|[12]\d|3[01])[-_](?:[a-f\d]{16,}|[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})$/i;

export function dashboardCreativeDisplayName(
  name: string,
  creativeId: string | null,
  adId: string | null,
  isAd: boolean,
): string {
  const trimmed = name.trim();
  const fallback = isAd ? "Anúncio sem título" : "Criativo sem título";
  if (!trimmed || trimmed === creativeId || trimmed === adId) return fallback;
  return trimmed.replace(generatedTitleSuffix, "").trim() || fallback;
}
