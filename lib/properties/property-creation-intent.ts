import { z } from "zod";
import { propertyCreateInputSchema } from "@/lib/validation/properties";

const propertyCreationIntentSchema = z.object({
  key: z.guid(),
  body: propertyCreateInputSchema,
});

export type PropertyCreationIntent = z.infer<typeof propertyCreationIntentSchema>;
type IntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readPropertyCreationIntent(storage: IntentStorage, storageKey: string): PropertyCreationIntent | null {
  const raw = storage.getItem(storageKey);
  if (!raw) return null;
  try {
    return propertyCreationIntentSchema.parse(JSON.parse(raw));
  } catch {
    // Failing closed is essential: silently replacing this record could repeat
    // a create whose response was lost after the database committed.
    throw new Error("A confirmação pendente do cadastro não pôde ser recuperada. Confira a carteira antes de iniciar outro cadastro.");
  }
}

export function preparePropertyCreationIntent(
  storage: IntentStorage,
  storageKey: string,
  body: z.infer<typeof propertyCreateInputSchema>,
  newKey: () => string = () => crypto.randomUUID(),
): PropertyCreationIntent {
  const existing = readPropertyCreationIntent(storage, storageKey);
  if (existing) return existing;
  const intent = propertyCreationIntentSchema.parse({ key: newKey(), body });
  // Persist the immutable request before POST, including when no response ever
  // arrives. It is scoped by the form's organization and actor draft key.
  storage.setItem(storageKey, JSON.stringify(intent));
  return intent;
}

export function forgetPropertyCreationIntent(storage: IntentStorage, storageKey: string) {
  storage.removeItem(storageKey);
}

export function preserveConfirmedPropertyCreation(
  storage: IntentStorage,
  intentKey: string,
  recoveryKey: string,
  receipt: { id: string; organizationId: string },
) {
  // If either write fails, an ID or the immutable intent remains recoverable.
  storage.setItem(recoveryKey, JSON.stringify(receipt));
  storage.removeItem(intentKey);
}

/** A rejected retry cannot establish whether an earlier request committed. */
export function propertyCreationRejectionCanReset(input: {
  wasRetry: boolean;
  clientRejected?: boolean;
  status?: number;
  code?: string;
}) {
  if (input.status === 410 && input.code === "property_creation_resource_removed") return true;
  // These are client fences, including after a successful POST. They cannot
  // prove a server rejection, so the original key/receipt must survive.
  if (input.code === "property_action_scope_changed"
    || input.code === "api_request_identity_changed") return false;
  if (input.wasRetry) return false;
  return Boolean(input.clientRejected || (input.status !== undefined
    && input.status >= 400 && input.status < 500 && input.status !== 408
    && input.code !== "property_idempotency_conflict" && input.code !== "property_creation_key_conflict"));
}
