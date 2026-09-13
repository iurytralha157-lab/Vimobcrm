const PUBLICATION_QUERY_BATCH_SIZE = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PropertyRecord = Record<string, unknown>;
type QueryResponse = { data: unknown; error: unknown };
type PublicationQuery = {
  select: (columns: string) => PublicationQuery;
  eq: (column: string, value: unknown) => PublicationQuery;
  in: (column: string, values: string[]) => Promise<QueryResponse>;
  or: (filters: string) => Promise<QueryResponse>;
};
type SupabasePublicationClient = {
  from: (table: string) => PublicationQuery;
};
type SitePublicationRecord = {
  id?: unknown;
  organization_id?: unknown;
  property_id?: unknown;
  channel?: unknown;
  channel_account_key?: unknown;
  desired_state?: unknown;
  published_version?: unknown;
};
type SitePublicationVersionRecord = {
  publication_id?: unknown;
  organization_id?: unknown;
  property_id?: unknown;
  channel?: unknown;
  channel_account_key?: unknown;
  version?: unknown;
  payload?: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeStatus(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function chunk<T>(values: T[]) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += PUBLICATION_QUERY_BATCH_SIZE) {
    chunks.push(values.slice(index, index + PUBLICATION_QUERY_BATCH_SIZE));
  }
  return chunks;
}

function positivePublishedVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : null;
}

function canonicalSitePublication(
  row: SitePublicationRecord,
  organizationId: string,
  propertyId: string,
) {
  return row.organization_id === organizationId &&
    row.property_id === propertyId &&
    row.channel === "site" &&
    row.channel_account_key === "default";
}

function isMatchingDurableVersion(
  row: SitePublicationVersionRecord,
  publication: SitePublicationRecord,
  organizationId: string,
  propertyId: string,
  publishedVersion: number,
) {
  return row.publication_id === publication.id &&
    row.organization_id === organizationId &&
    row.property_id === propertyId &&
    row.channel === "site" &&
    row.channel_account_key === "default" &&
    row.version === publishedVersion;
}

function publishedPropertySnapshot(
  row: SitePublicationVersionRecord,
  liveProperty: PropertyRecord,
) {
  const payload = record(row.payload);
  const property = record(payload?.property);
  if (!property || property.id !== liveProperty.id) return null;

  // Canonical versions use the public-site schema. Project only those frozen
  // public fields; never merge unpublished live values over the snapshot.
  return {
    id: liveProperty.id,
    organization_id: liveProperty.organization_id,
    code: property.codigo,
    title: property.titulo,
    descricao: property.descricao,
    tipo_de_imovel: property.tipo_imovel,
    tipo_de_negocio: property.finalidade,
    status: liveProperty.status,
    destaque: property.destaque,
    bairro: property.bairro,
    cidade: property.cidade,
    uf: property.estado,
    quartos: property.quartos,
    suites: property.suites,
    banheiros: property.banheiros,
    vagas: property.vagas,
    area_util: property.area_construida,
    area_total: property.area_total,
    preco: property.valor_venda,
    valor_locacao: property.valor_aluguel,
    imagem_principal: property.imagem_principal,
    published_on_site: true,
  };
}

/**
 * Mirrors the Go public-site boundary. A property is externally visible only
 * while its live status is active. Once a site/default publication row exists,
 * that row is authoritative and requires both the published desired state and
 * the exact durable version referenced by published_version. The legacy flag
 * is accepted only when no canonical site/default row exists.
 */
export function eligiblePublicPropertyIds(input: {
  organizationId: string;
  properties: PropertyRecord[];
  publications: SitePublicationRecord[];
  versions: SitePublicationVersionRecord[];
}) {
  const eligibleIds = new Set<string>();

  for (const property of input.properties) {
    const propertyId = typeof property?.id === "string" ? property.id : "";
    if (
      !propertyId ||
      property.organization_id !== input.organizationId ||
      !["active", "ativo"].includes(normalizeStatus(property.status))
    ) continue;

    const publications = input.publications.filter((publication) =>
      canonicalSitePublication(publication, input.organizationId, propertyId)
    );

    // More than one canonical row is impossible under the database unique
    // constraint. Treat corruption or an ambiguous mock/response as hidden.
    if (publications.length > 1) continue;
    if (publications.length === 0) {
      if (property.published_on_site === true) eligibleIds.add(propertyId);
      continue;
    }

    const publication = publications[0];
    const publishedVersion = positivePublishedVersion(publication.published_version);
    if (publication.desired_state !== "published" || publishedVersion === null) continue;

    const matchingVersions = input.versions.filter((version) =>
      isMatchingDurableVersion(
        version,
        publication,
        input.organizationId,
        propertyId,
        publishedVersion,
      )
    );
    if (
      matchingVersions.length === 1 &&
      publishedPropertySnapshot(matchingVersions[0], property)
    ) eligibleIds.add(propertyId);
  }

  return eligibleIds;
}

/**
 * Loads publication state in bounded batches so list/search paths do not issue
 * one publication query per property. Any lookup error or malformed list
 * response hides the whole candidate set rather than falling back open.
 */
export async function filterPublicSiteEligibleProperties(
  supabase: SupabasePublicationClient,
  organizationId: string,
  properties: PropertyRecord[],
) {
  const candidates = properties.filter((property) =>
    property?.organization_id === organizationId &&
    typeof property?.id === "string" &&
    property.id.length > 0
  );
  const propertyIds = [...new Set(candidates.map((property) => property.id as string))];
  if (!propertyIds.length) return [];

  const publications: SitePublicationRecord[] = [];
  for (const propertyIdBatch of chunk(propertyIds)) {
    const { data, error } = await supabase
      .from("property_channel_publications")
      .select(
        "id, organization_id, property_id, channel, channel_account_key, desired_state, published_version",
      )
      .eq("organization_id", organizationId)
      .eq("channel", "site")
      .eq("channel_account_key", "default")
      .in("property_id", propertyIdBatch);
    if (error || !Array.isArray(data)) {
      console.error(
        "[ai-agent-responder] canonical site publication lookup failed:",
        error || "invalid list response",
      );
      return [];
    }
    publications.push(...data);
  }

  const publishedPublications = publications.filter((publication) =>
    publication.desired_state === "published" &&
    positivePublishedVersion(publication.published_version) !== null &&
    typeof publication.id === "string" &&
    UUID_PATTERN.test(publication.id)
  );

  const versions: SitePublicationVersionRecord[] = [];
  for (const publicationBatch of chunk(publishedPublications)) {
    const exactPublishedVersions = publicationBatch.map((publication) =>
      `and(publication_id.eq.${publication.id},version.eq.${publication.published_version})`
    ).join(",");
    const { data, error } = await supabase
      .from("property_channel_publication_versions")
      .select(
        "publication_id, organization_id, property_id, channel, channel_account_key, version, payload",
      )
      .eq("organization_id", organizationId)
      .eq("channel", "site")
      .eq("channel_account_key", "default")
      .or(exactPublishedVersions);
    if (error || !Array.isArray(data)) {
      console.error(
        "[ai-agent-responder] canonical site publication version lookup failed:",
        error || "invalid list response",
      );
      return [];
    }
    versions.push(...data);
  }

  const eligibleIds = eligiblePublicPropertyIds({
    organizationId,
    properties: candidates,
    publications,
    versions,
  });
  return candidates.flatMap((property) => {
    const propertyId = property.id as string;
    if (!eligibleIds.has(propertyId)) return [];

    const matchingPublications = publications.filter((publication) =>
      canonicalSitePublication(publication, organizationId, propertyId)
    );
    if (matchingPublications.length === 0) return [property];

    const publication = matchingPublications[0];
    const publishedVersion = positivePublishedVersion(publication.published_version);
    if (publishedVersion === null) return [];
    const matchingVersions = versions.filter((version) =>
      isMatchingDurableVersion(
        version,
        publication,
        organizationId,
        propertyId,
        publishedVersion,
      )
    );
    if (matchingVersions.length !== 1) return [];
    const snapshot = publishedPropertySnapshot(matchingVersions[0], property);
    return snapshot ? [snapshot] : [];
  });
}
