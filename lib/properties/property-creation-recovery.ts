import { VimobAPIError } from "@/lib/api/vimob-error";

export type ConfirmedPropertyReceipt = { id: string; organizationId: string; actorId: string };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readConfirmedPropertyReceipt(
  storage: Pick<Storage, "getItem">,
  key: string,
  scope: { actorId?: string; organizationId?: string | null },
): ConfirmedPropertyReceipt | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || !("id" in value)
      || !("organizationId" in value) || typeof value.id !== "string"
      || typeof value.organizationId !== "string" || !idPattern.test(value.id)
      || !idPattern.test(value.organizationId) || !scope.actorId
      || value.organizationId !== scope.organizationId
      || ("actorId" in value && value.actorId !== scope.actorId)) {
      throw new Error("invalid receipt");
    }
    // Older receipts were persisted under the same actor/tenant-specific key.
    return { id: value.id, organizationId: value.organizationId, actorId: scope.actorId };
  } catch {
    throw new Error("Não foi possível recuperar o imóvel anterior neste navegador. Confira a carteira antes de iniciar outro cadastro.");
  }
}

/** Only the manager-authorized recovery endpoint can establish removal. */
export async function verifyConfirmedPropertyRecovery(
  receipt: ConfirmedPropertyReceipt,
  readProperty: () => Promise<{ id: string; organization_id: string }>,
): Promise<"existing" | "removed"> {
  try {
    const property = await readProperty();
    if (property.id !== receipt.id || property.organization_id !== receipt.organizationId) {
      throw new Error("Não foi possível confirmar o imóvel no cadastro original. Confira a carteira antes de tentar novamente.");
    }
    return "existing";
  } catch (error) {
    if (error instanceof VimobAPIError && error.status === 410
      && error.code === "property_creation_resource_removed") return "removed";
    throw error;
  }
}
