export type ParsedAsaasWebhook = {
  id: string;
  event: string;
  eventAt: string | null;
  resourceType: "payment" | "subscription" | "checkout";
  resource: Record<string, unknown>;
  payload: Record<string, unknown>;
};

export type AsaasWebhookRpcCall = {
  name:
    | "reconcile_asaas_payment_webhook_with_period_intent"
    | "reconcile_asaas_subscription_webhook_with_period_intent"
    | "reconcile_asaas_checkout_webhook_with_intent";
  args: Record<string, unknown>;
};

export type AsaasCardRecurrenceSubscriptionRpcCall = {
  name: "reconcile_billing_card_recurrence_subscription";
  args: {
    p_subscription: Record<string, unknown>;
  };
};

type PolledPaidPayment = Record<string, unknown> & {
  id: string;
  status?: string | null;
};

const MAX_EVENT_ID_LENGTH = 512;
const MAX_RESOURCE_ID_LENGTH = 255;
const ASAAS_TIME_ZONE = "America/Sao_Paulo";
const ASAAS_NAIVE_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
const ASAAS_OFFSET_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:z|[+-]\d{2}:\d{2})$/i;
const CANONICAL_CARD_RECURRENCE_REFERENCE =
  /^vimob:billing-card-recurrence:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const paidPaymentEvents = new Set([
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_RECEIVED_IN_CASH",
]);
const paidPaymentStatuses = new Set([
  "CONFIRMED",
  "RECEIVED",
  "RECEIVED_IN_CASH",
]);
const supportedCheckoutEvents = new Set([
  "CHECKOUT_CREATED",
  "CHECKOUT_CANCELED",
  "CHECKOUT_EXPIRED",
  "CHECKOUT_PAID",
]);

export const ASAAS_BANK_SLIP_REGISTRATION_CANCELLED =
  "BANK_SLIP_REGISTRATION_CANCELLED" as const;

const asaasDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ASAAS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizedText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function dateTimePartsInAsaasZone(value: Date): DateTimeParts | null {
  const parts = Object.fromEntries(
    asaasDateFormatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const result = {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };

  return Object.values(result).every(Number.isInteger) ? result : null;
}

function sameDateTimeParts(left: DateTimeParts, right: DateTimeParts) {
  return left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second;
}

function normalizeNaiveAsaasEventDate(text: string) {
  const match = ASAAS_NAIVE_DATE_TIME.exec(text);
  if (!match) return null;

  const expected: DateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
  };
  const millisecond = Number((match[7] || "").padEnd(3, "0") || "0");
  const wallClockTimestamp = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
    expected.second,
    millisecond,
  );
  const wallClockDate = new Date(wallClockTimestamp);
  const validCalendarDate = wallClockDate.getUTCFullYear() === expected.year &&
    wallClockDate.getUTCMonth() + 1 === expected.month &&
    wallClockDate.getUTCDate() === expected.day &&
    wallClockDate.getUTCHours() === expected.hour &&
    wallClockDate.getUTCMinutes() === expected.minute &&
    wallClockDate.getUTCSeconds() === expected.second;
  if (!validCalendarDate) return null;

  let timestamp = wallClockTimestamp;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const zoned = dateTimePartsInAsaasZone(new Date(timestamp));
    if (!zoned) return null;
    const representedTimestamp = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second,
    );
    const timestampAtWholeSecond = timestamp - (timestamp % 1_000);
    const nextTimestamp = wallClockTimestamp -
      (representedTimestamp - timestampAtWholeSecond);
    if (nextTimestamp === timestamp) break;
    timestamp = nextTimestamp;
  }

  const instant = new Date(timestamp);
  const roundTrip = dateTimePartsInAsaasZone(instant);
  return roundTrip && sameDateTimeParts(roundTrip, expected)
    ? instant.toISOString()
    : null;
}

export function constantTimeTextEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

export function normalizeAsaasEventDate(value: unknown) {
  const text = normalizedText(value);
  if (!text) return null;

  if (!ASAAS_OFFSET_DATE_TIME.test(text)) {
    return normalizeNaiveAsaasEventDate(text);
  }

  const timestamp = Date.parse(text.replace(" ", "T"));

  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function parseAsaasWebhook(value: unknown): ParsedAsaasWebhook {
  const payload = asRecord(value);
  if (!payload) {
    throw new Error("Payload do webhook Asaas deve ser um objeto.");
  }

  const id = normalizedText(payload.id);
  if (!id || id.length > MAX_EVENT_ID_LENGTH) {
    throw new Error("Evento Asaas sem identificador valido.");
  }

  const event = normalizedText(payload.event).toUpperCase();
  const resourceType = event.startsWith("PAYMENT_")
    ? "payment"
    : event.startsWith("SUBSCRIPTION_")
    ? "subscription"
    : supportedCheckoutEvents.has(event)
    ? "checkout"
    : null;
  if (!resourceType) {
    throw new Error("Evento Asaas nao suportado por este endpoint.");
  }

  const resource = asRecord(payload[resourceType]);
  const resourceId = normalizedText(resource?.id);
  if (!resource || !resourceId || resourceId.length > MAX_RESOURCE_ID_LENGTH) {
    const invalidResourceMessages = {
      payment: "Evento Asaas sem cobranca valida.",
      subscription: "Evento Asaas sem assinatura valida.",
      checkout: "Evento Asaas sem checkout valido.",
    } as const;
    throw new Error(invalidResourceMessages[resourceType]);
  }

  if (
    resourceType === "payment" &&
    event === "PAYMENT_BANK_SLIP_CANCELLED"
  ) {
    const status = normalizedText(resource.status).toUpperCase() || "OVERDUE";
    const markedPayment = {
      ...resource,
      status,
      vimobBillingArtifactState: ASAAS_BANK_SLIP_REGISTRATION_CANCELLED,
    };
    const markedPayload = {
      ...payload,
      payment: markedPayment,
      vimobBillingArtifactState: ASAAS_BANK_SLIP_REGISTRATION_CANCELLED,
    };

    return {
      id,
      event,
      eventAt: normalizeAsaasEventDate(payload.dateCreated),
      resourceType,
      resource: markedPayment,
      payload: markedPayload,
    };
  }

  return {
    id,
    event,
    eventAt: normalizeAsaasEventDate(payload.dateCreated),
    resourceType,
    resource,
    payload,
  };
}

export function asaasRawEventMarksBankSlipRegistrationCancelled(
  value: unknown,
) {
  const payload = asRecord(value);
  return normalizedText(payload?.event).toUpperCase() ===
    "PAYMENT_BANK_SLIP_CANCELLED";
}

export function asaasCardRecurrenceSubscriptionRpcCall(
  webhook: ParsedAsaasWebhook,
): AsaasCardRecurrenceSubscriptionRpcCall | null {
  if (webhook.resourceType !== "subscription") return null;

  const externalReference = webhook.resource.externalReference;
  if (
    typeof externalReference !== "string" ||
    !CANONICAL_CARD_RECURRENCE_REFERENCE.test(externalReference)
  ) {
    return null;
  }

  return {
    name: "reconcile_billing_card_recurrence_subscription",
    args: {
      p_subscription: webhook.resource,
    },
  };
}

export function asaasPaymentWebhookShouldProvisionCardRecurrence(
  webhook: ParsedAsaasWebhook,
) {
  if (
    webhook.resourceType !== "payment" ||
    !paidPaymentEvents.has(webhook.event)
  ) {
    return false;
  }

  return normalizedText(webhook.resource.billingType).toUpperCase() ===
      "CREDIT_CARD" &&
    paidPaymentStatuses.has(
      normalizedText(webhook.resource.status).toUpperCase(),
    );
}

export function normalizedWebhookRpcOutcome(value: unknown) {
  return normalizedText(asRecord(value)?.outcome).toLowerCase();
}

export function effectiveAsaasWebhookOutcome(
  primary: unknown,
  supplemental?: unknown,
) {
  const primaryOutcome = normalizedWebhookRpcOutcome(primary) || "processed";
  const supplementalOutcome = normalizedWebhookRpcOutcome(supplemental);

  return supplementalOutcome &&
      supplementalOutcome !== "not_found" &&
      supplementalOutcome !== "not_applicable"
    ? supplementalOutcome
    : primaryOutcome;
}

export function asaasWebhookRpcCall(
  webhook: ParsedAsaasWebhook,
): AsaasWebhookRpcCall {
  const commonArgs = {
    p_event_id: webhook.id,
    p_event_type: webhook.event,
    p_event_at: webhook.eventAt,
    p_payload: webhook.payload,
  };

  switch (webhook.resourceType) {
    case "payment":
      return {
        name: "reconcile_asaas_payment_webhook_with_period_intent",
        args: {
          ...commonArgs,
          p_payment: webhook.resource,
        },
      };
    case "subscription":
      return {
        name: "reconcile_asaas_subscription_webhook_with_period_intent",
        args: {
          ...commonArgs,
          p_subscription: webhook.resource,
        },
      };
    case "checkout":
      return {
        name: "reconcile_asaas_checkout_webhook_with_intent",
        args: {
          ...commonArgs,
          p_checkout: webhook.resource,
        },
      };
  }
}

export function asaasPaidPaymentPollingRpcCall(
  payment: PolledPaidPayment,
  observedAt = new Date(),
): AsaasWebhookRpcCall {
  const paymentId = normalizedText(payment.id);
  const status = normalizedText(payment.status).toUpperCase();
  const event = status === "CONFIRMED"
    ? "PAYMENT_CONFIRMED"
    : status === "RECEIVED"
    ? "PAYMENT_RECEIVED"
    : status === "RECEIVED_IN_CASH"
    ? "PAYMENT_RECEIVED_IN_CASH"
    : "";
  if (!paymentId || paymentId.length > MAX_RESOURCE_ID_LENGTH || !event) {
    throw new Error("Pagamento pago invalido para conciliacao por polling.");
  }
  if (!Number.isFinite(observedAt.getTime())) {
    throw new Error("Instante de conciliacao por polling invalido.");
  }

  const eventAt = observedAt.toISOString();
  const eventId = `payment-status:${paymentId}:${status}`;
  const resource = { ...payment, id: paymentId, status };
  const payload = {
    id: eventId,
    event,
    dateCreated: eventAt,
    payment: resource,
    vimobSource: "payment-status-poll",
  };

  return {
    name: "reconcile_asaas_payment_webhook_with_period_intent",
    args: {
      p_event_id: eventId,
      p_event_type: event,
      p_event_at: eventAt,
      p_payment: resource,
      p_payload: payload,
    },
  };
}
