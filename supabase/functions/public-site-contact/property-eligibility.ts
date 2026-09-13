const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PUBLIC_PROPERTY_STATUSES = new Set(["active", "ativo"]);

export function canonicalPublicPropertyId(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Mirrors the Go public-site boundary: once a site/default publication row
 * exists it is authoritative and the legacy boolean can no longer bypass it.
 */
export function publicContactPropertyIsEligible(
  property: Record<string, unknown> | null,
  publication: Record<string, unknown> | null,
  publishedVersionExists: boolean,
) {
  if (!property) return false;

  const status = String(property.status ?? "").trim().toLowerCase();
  if (!PUBLIC_PROPERTY_STATUSES.has(status)) return false;

  if (publication) {
    return publication.desired_state === "published" &&
      publication.published_version !== null &&
      publication.published_version !== undefined &&
      publishedVersionExists;
  }

  return property.published_on_site === true;
}
