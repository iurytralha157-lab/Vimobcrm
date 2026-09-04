const DELIVERY_STATUS_RANK: Record<string, number> = {
  received: 0,
  queued: 1,
  pending: 1,
  retry: 1,
  processing: 2,
  sending: 2,
  sent: 3,
  delivered: 4,
  read: 5,
};

const normalizeStatus = (value: unknown) => {
  if (typeof value === "string") return value.trim().toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim().toLowerCase();
  }
  return "";
};

/**
 * Keeps provider delivery receipts monotonic. Terminal failures stay terminal
 * until a full reconciliation can repair the message, outbox and CRM history.
 */
export function monotonicWhatsAppMessageStatus(
  currentValue: unknown,
  incomingValue: unknown,
) {
  const current = normalizeStatus(currentValue);
  const incoming = normalizeStatus(incomingValue);

  if (!current) return incoming || "received";
  if (!incoming || current === incoming) return current;
  if (current === "read") return current;
  if (current === "failed") return current;
  if (incoming === "read") return incoming;
  if (incoming === "failed") {
    return current === "delivered" ? current : incoming;
  }

  const currentRank = DELIVERY_STATUS_RANK[current];
  const incomingRank = DELIVERY_STATUS_RANK[incoming];
  if (currentRank !== undefined && incomingRank !== undefined && incomingRank < currentRank) {
    return current;
  }

  return incoming;
}

/** Provider queue acknowledgements must never reopen the local delivery outbox. */
export function monotonicWhatsAppOutboxStatus(
  currentValue: unknown,
  incomingValue: unknown,
) {
  const current = normalizeStatus(currentValue);
  const incoming = normalizeStatus(incomingValue);

  if (current === "dead") return current;
  if (current && ["received", "queued", "pending"].includes(incoming)) {
    return current;
  }
  return monotonicWhatsAppMessageStatus(current, incoming);
}
