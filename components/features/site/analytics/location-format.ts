import type { LocationData } from "@/hooks/use-lead-analytics";

interface CountryMetadata {
  center: [number, number];
  label: string;
}

const regionNames = new Intl.DisplayNames(["pt-BR"], { type: "region" });

const COUNTRY_METADATA: Record<string, CountryMetadata> = {
  BR: { center: [-14.235, -51.925], label: "Brasil" },
  AR: { center: [-38.4161, -63.6167], label: "Argentina" },
  BO: { center: [-16.2902, -63.5887], label: "Bolívia" },
  CL: { center: [-35.6751, -71.543], label: "Chile" },
  PY: { center: [-23.4425, -58.4438], label: "Paraguai" },
  PE: { center: [-9.19, -75.0152], label: "Peru" },
  PT: { center: [39.3999, -8.2245], label: "Portugal" },
  US: { center: [37.0902, -95.7129], label: "Estados Unidos" },
  UY: { center: [-32.5228, -55.7658], label: "Uruguai" },
  GB: { center: [54.7024, -3.2766], label: "Reino Unido" },
};

const COUNTRY_ALIASES: Record<string, string> = {
  ARG: "AR",
  ARGENTINA: "AR",
  BOL: "BO",
  BOLIVIA: "BO",
  BRA: "BR",
  BRASIL: "BR",
  BRAZIL: "BR",
  CHL: "CL",
  CHILE: "CL",
  ENG: "GB",
  ENGLAND: "GB",
  INGLATERRA: "GB",
  GBR: "GB",
  UK: "GB",
  "UNITED KINGDOM": "GB",
  "REINO UNIDO": "GB",
  PRY: "PY",
  PARAGUAI: "PY",
  PARAGUAY: "PY",
  PER: "PE",
  PERU: "PE",
  PRT: "PT",
  PORTUGAL: "PT",
  USA: "US",
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  "ESTADOS UNIDOS": "US",
  URY: "UY",
  URUGUAI: "UY",
  URUGUAY: "UY",
};

function normalizeLocationPart(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function resolveCountryCode(country: string | null | undefined) {
  const normalized = normalizeLocationPart(country);
  if (!normalized) return null;
  return COUNTRY_ALIASES[normalized] ?? normalized;
}

export function getCountryMetadata(country: string | null | undefined) {
  const code = resolveCountryCode(country);
  return code ? (COUNTRY_METADATA[code] ?? null) : null;
}

export function getCountryLabel(country: string | null | undefined) {
  const code = resolveCountryCode(country);
  if (!code) return null;

  const supportedCountry = COUNTRY_METADATA[code];
  if (supportedCountry) return supportedCountry.label;

  if (code.length === 2) {
    try {
      return regionNames.of(code) || country?.trim() || code;
    } catch {
      // Preserve the provider value when Intl cannot resolve the region code.
    }
  }

  return country?.trim() || code;
}

export function getLocationLabel(
  location: LocationData,
  fallback = "Local não identificado",
) {
  const countryCode = resolveCountryCode(location.country);
  const isCountryEquivalent = (value: string | null | undefined) =>
    Boolean(
      value?.trim() && countryCode && resolveCountryCode(value) === countryCode,
    );
  const candidates = [
    isCountryEquivalent(location.city) ? null : location.city?.trim(),
    isCountryEquivalent(location.region) ? null : location.region?.trim(),
    getCountryLabel(location.country),
  ].filter((value): value is string => Boolean(value));

  const seen = new Set<string>();
  return (
    candidates
      .filter((value) => {
        const normalized = normalizeLocationPart(value);
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      })
      .join(", ") || fallback
  );
}
