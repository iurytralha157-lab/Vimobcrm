import type { PropertyFormData } from "@/components/features/properties/property-form/property-form-model";

const PROPERTY_MEDIA_REBASE_FIELDS = new Set([
  "updated_at",
  "imagem_principal",
  "image_urls",
  "fotos",
  "site_publication",
  "anunciar",
  "published_on_site",
]);

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => valuesEqual(value, right[index]))
    );
  }
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = new Set([
      ...Object.keys(leftRecord),
      ...Object.keys(rightRecord),
    ]);
    return [...keys].every((key) =>
      valuesEqual(leftRecord[key], rightRecord[key]),
    );
  }
  return false;
}
export function arePropertySnapshotsEqualOutsideMedia(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>,
) {
  if (!previous) return false;
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...keys].every(
    (key) => {
      if (PROPERTY_MEDIA_REBASE_FIELDS.has(key)) return true;
      if (key === "metadata") {
        const withoutMediaMetadata = (value: unknown) => {
          if (value == null) return {};
          if (!value || typeof value !== "object" || Array.isArray(value)) return value;
          const rest = { ...(value as Record<string, unknown>) };
          delete rest.hidden_site_image_urls;
          return rest;
        };
        return valuesEqual(withoutMediaMetadata(previous[key]), withoutMediaMetadata(next[key]));
      }
      return valuesEqual(previous[key], next[key]);
    },
  );
}

export function rebasePropertyFormMedia(previous: PropertyFormData, server: PropertyFormData): PropertyFormData {
  return {
    ...previous,
    imagem_principal: server.imagem_principal,
    fotos: server.fotos,
    hidden_site_image_urls: server.hidden_site_image_urls,
  };
}

export function resolvePropertyFormRefetch(input: {
  hydratedPropertyId: string | null;
  hydratedUpdatedAt: string | null;
  nextPropertyId: string;
  nextUpdatedAt: string;
  hasLocalChanges: boolean;
  serverChangesAreMediaOnly: boolean;
}) {
  const shouldHydrate =
    input.hydratedPropertyId !== input.nextPropertyId ||
    !input.hasLocalChanges;
  if (shouldHydrate) {
    return {
      action: "hydrate" as const,
      expectedUpdatedAt: input.nextUpdatedAt,
    };
  }
  if (input.serverChangesAreMediaOnly) {
    return {
      action: "preserve-and-rebase" as const,
      expectedUpdatedAt: input.nextUpdatedAt,
    };
  }
  return {
    action: "preserve" as const,
    expectedUpdatedAt: input.hydratedUpdatedAt,
  };
}
