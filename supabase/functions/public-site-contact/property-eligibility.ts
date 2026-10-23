const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PUBLIC_PROPERTY_STATUSES = new Set(["active", "ativo", "available", "disponivel"]);

export function canonicalPublicPropertyId(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Mirrors the Go public-site boundary: once a site/default publication row
 * exists it is authoritative; a legacy listing remains visible only during its
 * first canonical delivery. Explicit withdrawal or pause always wins.
 */
export function publicContactPropertyIsEligible(
  property: Record<string, unknown> | null,
  publication: Record<string, unknown> | null,
  publishedVersionExists: boolean,
) {
  if (!property || property.autorizado_comercializacao === false) return false;

  const status = String(property.status ?? "").trim().toLowerCase();
  if (!PUBLIC_PROPERTY_STATUSES.has(status)) return false;

  if (publication) {
    if (!property.organization_id || publication.organization_id !== property.organization_id
      || publication.property_id !== property.id || publication.channel !== "site"
      || publication.channel_account_key !== "default" || !canonicalPublicPropertyId(publication.id)) return false;
    if (publication.desired_state === "published" && publication.published_version === null) return property.published_on_site === true;
    return publication.desired_state === "published" &&
      typeof publication.published_version === 'number' &&
      Number.isSafeInteger(publication.published_version) && publication.published_version >= 1 &&
      publishedVersionExists;
  }

  return property.published_on_site === true;
}
