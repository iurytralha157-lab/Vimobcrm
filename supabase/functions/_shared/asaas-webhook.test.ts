import assert from "node:assert/strict";
import test from "node:test";
import {
  ASAAS_BANK_SLIP_REGISTRATION_CANCELLED,
  asaasCardRecurrenceSubscriptionRpcCall,
  asaasPaidPaymentPollingRpcCall,
  asaasRawEventMarksBankSlipRegistrationCancelled,
  asaasWebhookRpcCall,
  constantTimeTextEqual,
  effectiveAsaasWebhookOutcome,
  normalizeAsaasEventDate,
  normalizedWebhookRpcOutcome,
  parseAsaasWebhook,
} from "./asaas-webhook.ts";

test("compares the configured Asaas token without early string comparison", () => {
  assert.equal(constantTimeTextEqual("a".repeat(32), "a".repeat(32)), true);
  assert.equal(
    constantTimeTextEqual("a".repeat(32), `${"a".repeat(31)}b`),
    false,
  );
  assert.equal(constantTimeTextEqual("short", "a".repeat(32)), false);
});

test("parses a payment webhook and normalizes its provider timestamp", () => {
  const parsed = parseAsaasWebhook({
    id: "evt_123",
    event: "payment_confirmed",
    dateCreated: "2026-07-28 14:30:00",
    payment: {
      id: "pay_123",
      status: "CONFIRMED",
    },
  });

  assert.equal(parsed.id, "evt_123");
  assert.equal(parsed.event, "PAYMENT_CONFIRMED");
  assert.equal(parsed.eventAt, "2026-07-28T17:30:00.000Z");
  assert.equal(parsed.resourceType, "payment");
  assert.equal(parsed.resource.id, "pay_123");
});

test("parses current Asaas subscription lifecycle events", () => {
  const parsed = parseAsaasWebhook({
    id: "evt_subscription_123",
    event: "SUBSCRIPTION_INACTIVATED",
    dateCreated: "2026-07-28 14:31:00",
    subscription: {
      id: "sub_123",
      customer: "cus_123",
      status: "INACTIVE",
    },
  });

  assert.equal(parsed.resourceType, "subscription");
  assert.equal(parsed.resource.id, "sub_123");
});

test("parses and routes every supported Asaas checkout lifecycle event", () => {
  for (
    const event of [
      "CHECKOUT_CREATED",
      "CHECKOUT_CANCELED",
      "CHECKOUT_EXPIRED",
      "CHECKOUT_PAID",
    ]
  ) {
    const parsed = parseAsaasWebhook({
      id: `evt_${event.toLowerCase()}`,
      event: event.toLowerCase(),
      dateCreated: "2026-08-02 15:00:00",
      checkout: {
        id: "checkout_123",
        status: event.replace("CHECKOUT_", ""),
      },
    });

    assert.equal(parsed.event, event);
    assert.equal(parsed.resourceType, "checkout");
    assert.equal(parsed.resource.id, "checkout_123");

    const rpcCall = asaasWebhookRpcCall(parsed);
    assert.equal(
      rpcCall.name,
      "reconcile_asaas_checkout_webhook_with_intent",
    );
    assert.equal(rpcCall.args.p_event_id, parsed.id);
    assert.equal(rpcCall.args.p_event_type, event);
    assert.equal(rpcCall.args.p_event_at, "2026-08-02T18:00:00.000Z");
    assert.deepEqual(rpcCall.args.p_checkout, parsed.resource);
    assert.deepEqual(rpcCall.args.p_payload, parsed.payload);
  }
});

test("preserves payment and subscription RPC routing", () => {
  const payment = parseAsaasWebhook({
    id: "evt_payment_1",
    event: "PAYMENT_CONFIRMED",
    payment: { id: "pay_1" },
  });
  const subscription = parseAsaasWebhook({
    id: "evt_subscription_1",
    event: "SUBSCRIPTION_CREATED",
    subscription: { id: "sub_1" },
  });

  assert.deepEqual(asaasWebhookRpcCall(payment), {
    name: "reconcile_asaas_payment_webhook_with_period_intent",
    args: {
      p_event_id: "evt_payment_1",
      p_event_type: "PAYMENT_CONFIRMED",
      p_event_at: null,
      p_payload: payment.payload,
      p_payment: payment.resource,
    },
  });
  assert.deepEqual(asaasWebhookRpcCall(subscription), {
    name: "reconcile_asaas_subscription_webhook_with_period_intent",
    args: {
      p_event_id: "evt_subscription_1",
      p_event_type: "SUBSCRIPTION_CREATED",
      p_event_at: null,
      p_payload: subscription.payload,
      p_subscription: subscription.resource,
    },
  });
});

test("keeps a CIP boleto cancellation payable but marks its artifact invalid", () => {
  const parsed = parseAsaasWebhook({
    id: "evt_bank_slip_cancelled",
    event: "PAYMENT_BANK_SLIP_CANCELLED",
    dateCreated: "2026-08-04 12:00:00",
    payment: {
      id: "pay_boleto_1",
      billingType: "BOLETO",
      dueDate: "2026-08-03",
    },
  });
  const rpcCall = asaasWebhookRpcCall(parsed);
  const payment = rpcCall.args.p_payment as Record<string, unknown>;
  const payload = rpcCall.args.p_payload as Record<string, unknown>;

  assert.equal(
    rpcCall.name,
    "reconcile_asaas_payment_webhook_with_period_intent",
  );
  assert.equal(payment.status, "OVERDUE");
  assert.equal(
    payment.vimobBillingArtifactState,
    ASAAS_BANK_SLIP_REGISTRATION_CANCELLED,
  );
  assert.equal(
    payload.vimobBillingArtifactState,
    ASAAS_BANK_SLIP_REGISTRATION_CANCELLED,
  );
  assert.deepEqual(payload.payment, payment);
  assert.equal(
    asaasRawEventMarksBankSlipRegistrationCancelled(payload),
    true,
  );
  assert.equal(
    asaasRawEventMarksBankSlipRegistrationCancelled({
      event: "PAYMENT_UPDATED",
      payment: { status: "OVERDUE" },
    }),
    false,
  );
});

test("routes only canonical card recurrence subscription references", () => {
  const paymentId = "123e4567-e89b-12d3-a456-426614174000";
  const parsed = parseAsaasWebhook({
    id: "evt_card_recurrence_1",
    event: "SUBSCRIPTION_CREATED",
    subscription: {
      id: "sub_1",
      customer: "cus_1",
      externalReference: `vimob:billing-card-recurrence:${paymentId}`,
    },
  });

  assert.deepEqual(asaasCardRecurrenceSubscriptionRpcCall(parsed), {
    name: "reconcile_billing_card_recurrence_subscription",
    args: {
      p_subscription: parsed.resource,
    },
  });

  for (
    const externalReference of [
      paymentId,
      `VIMOB:billing-card-recurrence:${paymentId}`,
      ` vimob:billing-card-recurrence:${paymentId}`,
      "vimob:billing-card-recurrence:not-a-uuid",
      "vimob:billing-card-recurrence:123e4567-e89b-12d3-a456-42661417400",
    ]
  ) {
    const unrelated = parseAsaasWebhook({
      id: `evt_${externalReference.length}`,
      event: "SUBSCRIPTION_UPDATED",
      subscription: {
        id: "sub_legacy",
        externalReference,
      },
    });
    assert.equal(asaasCardRecurrenceSubscriptionRpcCall(unrelated), null);
  }

  const payment = parseAsaasWebhook({
    id: "evt_payment_2",
    event: "PAYMENT_CONFIRMED",
    payment: {
      id: "pay_2",
      externalReference: `vimob:billing-card-recurrence:${paymentId}`,
    },
  });
  assert.equal(asaasCardRecurrenceSubscriptionRpcCall(payment), null);
});

test("keeps legacy outcomes for supplemental no-ops", () => {
  assert.equal(
    normalizedWebhookRpcOutcome({ outcome: "PROCESSED" }),
    "processed",
  );
  assert.equal(normalizedWebhookRpcOutcome(null), "");
  assert.equal(
    effectiveAsaasWebhookOutcome(
      { outcome: "unmatched" },
      { outcome: "not_found" },
    ),
    "unmatched",
  );
  assert.equal(
    effectiveAsaasWebhookOutcome(
      { outcome: "processed" },
      { outcome: "not_applicable" },
    ),
    "processed",
  );
  assert.equal(
    effectiveAsaasWebhookOutcome(
      { outcome: "unmatched" },
      { outcome: "completed" },
    ),
    "completed",
  );
  assert.equal(effectiveAsaasWebhookOutcome({}, undefined), "processed");
});

test("rejects malformed and unrelated webhook payloads", () => {
  assert.throws(() => parseAsaasWebhook(null), /deve ser um objeto/);
  assert.throws(
    () =>
      parseAsaasWebhook({
        id: "evt_1",
        event: "CUSTOMER_CREATED",
        payment: { id: "pay_1" },
      }),
    /nao suportado/,
  );
  assert.throws(
    () =>
      parseAsaasWebhook({
        id: "evt_1",
        event: "PAYMENT_RECEIVED",
        payment: {},
      }),
    /sem cobranca valida/,
  );
  assert.throws(
    () =>
      parseAsaasWebhook({
        id: "evt_1",
        event: "CHECKOUT_UPDATED",
        checkout: { id: "checkout_1" },
      }),
    /nao suportado/,
  );
  assert.throws(
    () =>
      parseAsaasWebhook({
        id: "evt_1",
        event: "CHECKOUT_EXPIRED",
        checkout: {},
      }),
    /sem checkout valido/,
  );
});

test("returns null instead of inventing an ordering timestamp", () => {
  assert.equal(normalizeAsaasEventDate("not-a-date"), null);
  assert.equal(normalizeAsaasEventDate(null), null);
});

test("interprets naive Asaas dateCreated in America/Sao_Paulo and preserves explicit offsets", () => {
  assert.equal(
    normalizeAsaasEventDate("2026-08-04 06:56:38"),
    "2026-08-04T09:56:38.000Z",
  );
  assert.equal(
    normalizeAsaasEventDate("2026-08-04T06:56:38-04:00"),
    "2026-08-04T10:56:38.000Z",
  );
  assert.equal(
    normalizeAsaasEventDate("2026-08-04T09:56:38Z"),
    "2026-08-04T09:56:38.000Z",
  );
});

test("builds an idempotent synthetic paid event for polling fallback", () => {
  const call = asaasPaidPaymentPollingRpcCall({
    id: "pay_123",
    status: "received",
    billingType: "PIX",
  }, new Date("2026-08-03T15:30:00.000Z"));

  assert.equal(call.name, "reconcile_asaas_payment_webhook_with_period_intent");
  assert.equal(call.args.p_event_id, "payment-status:pay_123:RECEIVED");
  assert.equal(call.args.p_event_type, "PAYMENT_RECEIVED");
  assert.equal(call.args.p_event_at, "2026-08-03T15:30:00.000Z");
  assert.equal(
    (call.args.p_payload as Record<string, unknown>).vimobSource,
    "payment-status-poll",
  );
  assert.throws(
    () => asaasPaidPaymentPollingRpcCall({ id: "pay_123", status: "PENDING" }),
    /Pagamento pago invalido/,
  );
});
