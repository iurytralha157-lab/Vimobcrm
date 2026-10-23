import { z } from "zod";
import type { PropertyFormData } from "@/components/features/properties/property-form/property-form-model";
import { withoutEphemeralPropertyMedia } from "@/lib/property-media-draft";

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const PROPERTY_DRAFT_STORAGE_WARNING = "Não foi possível guardar o rascunho neste navegador. Mantenha esta aba aberta para preservar os dados preenchidos.";
const INVALID_DRAFT_WARNING = "O rascunho salvo não pôde ser restaurado. Revise os campos antes de continuar.";

export function getPropertyCreationDraftStorage(): DraftStorage | null {
  try {
    if (typeof window !== "undefined") return window.localStorage;
    // Preserve the model helpers' existing host-provided Storage contract.
    // FormScreen's initial read/effects remain browser-only.
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  }
  catch { return null; }
}

/** Optional drafts are separate from the mandatory immutable create receipt. */
export function createPropertyCreationDraftStore(defaults: PropertyFormData) {
  const shape = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [
    key, typeof value === "boolean" ? z.boolean() : Array.isArray(value) ? z.array(z.string()) : z.string(),
  ]));
  // Old drafts may predate fields added to the form. Unknown obsolete fields
  // are stripped; existing fields must retain their actual form types.
  const schema = z.object(shape).partial();
  return {
    read(key: string, storage: DraftStorage | null = getPropertyCreationDraftStorage()) {
      if (!storage) return { draft: null, warning: PROPERTY_DRAFT_STORAGE_WARNING };
      let raw: string | null;
      try { raw = storage.getItem(key); }
      catch { return { draft: null, warning: PROPERTY_DRAFT_STORAGE_WARNING }; }
      if (!raw) return { draft: null, warning: null };
      try {
        const draft = schema.parse(JSON.parse(raw)) as Partial<PropertyFormData>;
        return { draft: withoutEphemeralPropertyMedia({ ...defaults, ...draft }), warning: null };
      } catch {
        // Leave both the old bytes and any pending creation intent untouched.
        return { draft: null, warning: INVALID_DRAFT_WARNING };
      }
    },
    save(key: string, data: PropertyFormData, storage: DraftStorage | null = getPropertyCreationDraftStorage()) {
      if (!storage) return false;
      try {
        const draft = schema.parse(data) as Partial<PropertyFormData>;
        storage.setItem(key, JSON.stringify(withoutEphemeralPropertyMedia({ ...defaults, ...draft })));
        return true;
      } catch { return false; }
    },
    clear(key: string, storage: DraftStorage | null = getPropertyCreationDraftStorage()) {
      if (!storage) return false;
      try { storage.removeItem(key); return true; }
      catch { return false; }
    },
  };
}
