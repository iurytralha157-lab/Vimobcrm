import type { SupabaseClient } from "npm:@supabase/supabase-js@2.108.1";

const catalogPageSize = 1_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unsafeLocationText = /[\u0000-\u001f\u007f]/;

type CatalogCity = {
  id?: unknown;
  organization_id?: unknown;
  name?: unknown;
  uf?: unknown;
  is_active?: unknown;
};

type CatalogNeighborhood = {
  id?: unknown;
  organization_id?: unknown;
  city_id?: unknown;
  name?: unknown;
  is_active?: unknown;
};

export type ImportedPropertyLocation = {
  city: unknown;
  state: unknown;
  neighborhood: unknown;
};

export type CanonicalPropertyLocation = {
  city_id?: string;
  neighborhood_id?: string;
};

function trustedLocationName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().normalize("NFC");
  if (
    normalized.length === 0 ||
    normalized.length > 120 ||
    unsafeLocationText.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function trustedState(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function locationNameKey(value: string) {
  return value.toLocaleLowerCase("pt-BR");
}

function cityKey(name: string, state: string) {
  return `${locationNameKey(name)}\u0000${state}`;
}

function neighborhoodKey(cityId: string, name: string) {
  return `${cityId}\u0000${locationNameKey(name)}`;
}

function addUniqueMatch(
  matches: Map<string, string | null>,
  key: string,
  id: string,
) {
  if (!matches.has(key)) {
    matches.set(key, id);
    return;
  }
  if (matches.get(key) !== id) matches.set(key, null);
}

export function createCanonicalPropertyLocationResolver(
  organizationId: string,
  cities: readonly CatalogCity[],
  neighborhoods: readonly CatalogNeighborhood[],
) {
  const cityMatches = new Map<string, string | null>();
  const neighborhoodMatches = new Map<string, string | null>();

  for (const city of cities) {
    const id = typeof city.id === "string" ? city.id : "";
    const rowOrganizationId = typeof city.organization_id === "string"
      ? city.organization_id
      : "";
    const name = trustedLocationName(city.name);
    const state = trustedState(city.uf);
    if (
      city.is_active !== true ||
      rowOrganizationId !== organizationId ||
      !uuidPattern.test(id) ||
      !name ||
      !state
    ) {
      continue;
    }
    addUniqueMatch(cityMatches, cityKey(name, state), id);
  }

  for (const neighborhood of neighborhoods) {
    const id = typeof neighborhood.id === "string" ? neighborhood.id : "";
    const rowOrganizationId = typeof neighborhood.organization_id === "string"
      ? neighborhood.organization_id
      : "";
    const cityId = typeof neighborhood.city_id === "string"
      ? neighborhood.city_id
      : "";
    const name = trustedLocationName(neighborhood.name);
    if (
      neighborhood.is_active !== true ||
      rowOrganizationId !== organizationId ||
      !uuidPattern.test(id) ||
      !uuidPattern.test(cityId) ||
      !name
    ) {
      continue;
    }
    addUniqueMatch(neighborhoodMatches, neighborhoodKey(cityId, name), id);
  }

  return {
    resolve(input: ImportedPropertyLocation): CanonicalPropertyLocation {
      const city = trustedLocationName(input.city);
      const state = trustedState(input.state);
      if (!city || !state) return {};

      const cityId = cityMatches.get(cityKey(city, state));
      if (!cityId) return {};

      const neighborhoodWasSupplied = input.neighborhood !== undefined &&
        input.neighborhood !== null &&
        input.neighborhood !== "";
      const neighborhood = trustedLocationName(input.neighborhood);
      if (!neighborhoodWasSupplied) return { city_id: cityId };
      if (!neighborhood) return {};

      const neighborhoodId = neighborhoodMatches.get(
        neighborhoodKey(cityId, neighborhood),
      );
      if (!neighborhoodId) {
        // Keep both ids absent so the property trigger does not erase a
        // trustworthy legacy neighborhood merely because its catalog entry is
        // missing or ambiguous.
        return {};
      }
      return { city_id: cityId, neighborhood_id: neighborhoodId };
    },
  };
}

async function loadCatalogRows<T extends CatalogCity | CatalogNeighborhood>(
  supabase: SupabaseClient,
  organizationId: string,
  table: "property_cities" | "property_neighborhoods",
  columns: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += catalogPageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq("organization_id", organizationId)
      .order("id", { ascending: true })
      .range(offset, offset + catalogPageSize - 1);
    if (error || !Array.isArray(data)) {
      throw new Error("property_location_catalog_load_failed");
    }
    rows.push(...data as T[]);
    if (data.length < catalogPageSize) return rows;
  }
}

export async function loadCanonicalPropertyLocationResolver(
  supabase: SupabaseClient,
  organizationId: string,
) {
  const [cities, neighborhoods] = await Promise.all([
    loadCatalogRows<CatalogCity>(
      supabase,
      organizationId,
      "property_cities",
      "id, organization_id, name, uf, is_active",
    ),
    loadCatalogRows<CatalogNeighborhood>(
      supabase,
      organizationId,
      "property_neighborhoods",
      "id, organization_id, city_id, name, is_active",
    ),
  ]);
  return createCanonicalPropertyLocationResolver(
    organizationId,
    cities,
    neighborhoods,
  );
}
