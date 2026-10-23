import { filterPublicSiteEligibleProperties } from "./public-property-eligibility.ts";

const PAGE_SIZE = 200;
type Row = Record<string, unknown>;
type QueryResponse = { data: unknown; error: unknown };
type CatalogQuery = {
  select: (columns: string) => CatalogQuery;
  eq: (column: string, value: unknown) => CatalogQuery;
  not: (column: string, operator: string, value: unknown) => CatalogQuery;
  order: (column: string, options: { ascending: boolean; nullsFirst?: boolean }) => CatalogQuery;
  range: (from: number, to: number) => Promise<QueryResponse>;
  in: (column: string, values: string[]) => Promise<QueryResponse>;
};
export type PublicCatalogClient = { from: (table: string) => CatalogQuery };

function rows(response: QueryResponse): Row[] {
  if (response.error || !Array.isArray(response.data)) throw new Error("public property catalog unavailable");
  if (response.data.some((value) => !value || typeof value !== "object" || Array.isArray(value))) throw new Error("public property catalog unavailable");
  return response.data as Row[];
}

// Load public candidates in stable pages, then apply live vetoes and immutable
// snapshots before any code match, ranking or top-N limit. A private portfolio
// cannot consume the search budget. A request may reuse this result locally.
export async function loadPublicPropertyCatalog(
  client: PublicCatalogClient,
  organizationId: string,
  columns: string,
): Promise<Row[]> {
  try {
    const candidates = new Map<string, Row>();
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = rows(await client.from("properties").select(columns)
        .eq("organization_id", organizationId).eq("published_on_site", true)
        .order("created_at", { ascending: false }).order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1));
      for (const property of page) {
        if (property.organization_id === organizationId && typeof property.id === "string") candidates.set(property.id, property);
      }
      if (page.length < PAGE_SIZE) break;
    }
    const canonicalIds = new Set<string>();
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = rows(await client.from("property_channel_publications").select("property_id")
        .eq("organization_id", organizationId).eq("channel", "site").eq("channel_account_key", "default")
        .eq("desired_state", "published").not("published_version", "is", null)
        .order("property_id", { ascending: true }).range(offset, offset + PAGE_SIZE - 1));
      for (const publication of page) {
        if (typeof publication.property_id === "string" && !candidates.has(publication.property_id)) canonicalIds.add(publication.property_id);
      }
      if (page.length < PAGE_SIZE) break;
    }
    const missingIds = [...canonicalIds];
    for (let offset = 0; offset < missingIds.length; offset += 100) {
      for (const property of rows(await client.from("properties").select(columns)
        .eq("organization_id", organizationId).in("id", missingIds.slice(offset, offset + 100)))) {
        if (property.organization_id === organizationId && typeof property.id === "string") candidates.set(property.id, property);
      }
    }
    const properties = [...candidates.values()];
    const projected: Row[] = [];
    // This cast changes only the query type shape; the actual client and the
    // existing tenant/hierarchy/publication boundary remain unchanged.
    const eligibilityClient = client as unknown as Parameters<typeof filterPublicSiteEligibleProperties>[0];
    for (let offset = 0; offset < properties.length; offset += PAGE_SIZE) {
      projected.push(...await filterPublicSiteEligibleProperties(eligibilityClient, organizationId, properties.slice(offset, offset + PAGE_SIZE)));
    }
    return projected;
  } catch {
    return [];
  }
}

export function publicPropertyCode(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function matchPublicPropertyCodes(properties: Row[], codes: string[]): Row[] {
  const normalized = codes.map(publicPropertyCode).filter(Boolean);
  return properties.filter((property) => normalized.some((code) => publicPropertyCode(property.code).includes(code)))
    .map((property) => ({ ...property, score: normalized.includes(publicPropertyCode(property.code)) ? 100 : 80 }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);
}
