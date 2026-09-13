export const PUBLIC_SITE_ATTRIBUTION_KEY_PREFIX =
  "vimob_public_attribution_v2";

export function getPublicAttributionKey(organizationId: string) {
  const normalizedOrganizationId = organizationId.trim();
  if (!normalizedOrganizationId) {
    throw new Error("Public site organization id must not be empty");
  }
  return `${PUBLIC_SITE_ATTRIBUTION_KEY_PREFIX}:${normalizedOrganizationId}`;
}

export function sanitizePublicReferrer(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return `${parsed.origin}${parsed.pathname || "/"}`.slice(0, 1000);
  } catch {
    return null;
  }
}
