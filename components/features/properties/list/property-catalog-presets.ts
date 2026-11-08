import type { PropertyFilters } from "@/hooks/use-properties";

export type PropertyCatalogPreset = "all" | "ready" | "launches" | "rentals" | "third_party";

export const getPresetFilters = (preset: PropertyCatalogPreset): PropertyFilters => {
  if (preset === "ready") return { portfolio_type: "ready" };
  if (preset === "third_party") return { portfolio_type: "third_party" };
  if (preset === "rentals") return { tipo_de_negocio: "rental_catalog" };
  if (preset === "launches") return { tipo_de_negocio: "Lançamento" };
  return {};
};
