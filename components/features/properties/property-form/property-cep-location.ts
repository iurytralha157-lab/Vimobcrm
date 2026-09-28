import type { PropertyCepAddress } from "@/lib/api/property-cep";

type LocationFields = {
  endereco: string;
  bairro: string;
  cidade: string;
  uf: string;
  city_id: string;
  neighborhood_id: string;
  condominium_id: string;
};

type CatalogMatches = {
  cityId?: string;
  neighborhoodId?: string;
};

const normalizeLocationName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

export function applyCepAddressToLocation<T extends LocationFields>(
  previous: T,
  address: PropertyCepAddress,
  matches: CatalogMatches,
): T {
  const cidade = address.localidade.trim();
  const uf = address.uf.trim().toUpperCase();
  const bairro = address.bairro.trim();
  const sameCity =
    normalizeLocationName(previous.cidade) === normalizeLocationName(cidade) &&
    previous.uf.trim().toUpperCase() === uf;
  const sameNeighborhood =
    sameCity &&
    bairro.length > 0 &&
    normalizeLocationName(previous.bairro) === normalizeLocationName(bairro);
  const cityId = matches.cityId || (sameCity ? previous.city_id : "");
  const neighborhoodId =
    matches.neighborhoodId ||
    (sameNeighborhood ? previous.neighborhood_id : "");

  return {
    ...previous,
    endereco: address.logradouro.trim() || previous.endereco,
    bairro,
    cidade,
    uf,
    city_id: cityId,
    neighborhood_id: neighborhoodId,
    condominium_id:
      sameNeighborhood &&
      cityId === previous.city_id &&
      neighborhoodId === previous.neighborhood_id
        ? previous.condominium_id
        : "",
  };
}

type PersistedLocation = {
  cep?: string | null;
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
};

export function persistedLocationMatchesForm(
  expected: PersistedLocation,
  actual: PersistedLocation,
): boolean {
  if (
    (expected.cep ?? "").replace(/\D/g, "") !==
    (actual.cep ?? "").replace(/\D/g, "")
  ) {
    return false;
  }
  return (["endereco", "bairro", "cidade", "uf"] as const).every(
    (field) =>
      normalizeLocationName(expected[field] ?? "") ===
      normalizeLocationName(actual[field] ?? ""),
  );
}

export async function readBackPropertyLocation<T extends PersistedLocation>(
  expected: PersistedLocation,
  readPersisted: () => Promise<T>,
): Promise<{ savedProperty: T; matches: boolean }> {
  const savedProperty = await readPersisted();
  return {
    savedProperty,
    matches: persistedLocationMatchesForm(expected, savedProperty),
  };
}
