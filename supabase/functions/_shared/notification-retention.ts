type JsonRecord = Record<string, unknown>;

const DELIVERY_METADATA_KEYS = [
  "dispatch",
  "whatsapp_dispatch",
  "push_dispatch",
  "email_dispatch",
  "whatsapp_dispatch_required",
  "push_dispatch_required",
  "email_dispatch_required",
  "outcome_unknown",
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: JsonRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Returns true only when notification retention may safely hard-delete a row.
 *
 * Until a separate audited archive/DLQ exists, every delivery-backed row is
 * retained, including successful terminal deliveries. This is intentionally
 * stricter than status filtering: notifications with no delivery metadata are
 * the only rows eligible for the short in-app retention window.
 */
export function canPurgeNotification(metadata: unknown) {
  if (metadata === null || metadata === undefined) return true;
  if (!isRecord(metadata)) return false;
  return !DELIVERY_METADATA_KEYS.some((key) => hasOwn(metadata, key));
}
