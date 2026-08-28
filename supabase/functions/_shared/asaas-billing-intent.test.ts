import assert from "node:assert/strict";
import test from "node:test";
import {
  asaasBankSlipArtifactIsInvalid,
  asaasCheckoutPaymentIntegrity,
  asaasPaymentCanReceiveCheckoutAttempt,
  asaasPaymentCheckoutState,
  asaasPaymentDisposition,
  asaasPaymentRequiresAssistance,
  asaasSubscriptionCycle,
  billingPaymentCancellationAction,
  billingCheckoutIntentRpcArgs,
  cardPaymentRecoveryAction,
  cardSubscriptionRecoveryAction,
  cardSubscriptionRequiresDeletion,
  checkoutPlanSelect,
  hostedCheckoutRecoveryPath,
  isBillingPeriodMonths,
  normalizeBillingPeriodMonths,
  normalizeCheckoutClientIp,
  normalizeCheckoutCreditCard,
  providerFailureIsDeterministic,
  providerlessCheckoutCancellationAction,
  providerlessCheckoutRetryAfterSeconds,
  providerRecoveryPath,
  selectBillingProviderRecoveryCandidate,
  selectBillingSubscriptionPaymentCandidate,
  subscriptionPaymentsPath,
} from "./asaas-billing-intent.ts";

test("normalizes only valid, non-expired credit cards", () => {
  const now = new Date("2026-08-03T12:00:00Z");
  assert.deepEqual(
    normalizeCheckoutCreditCard({
      number: "4111 1111 1111 1111",
      expiry_month: "8",
      expiry_year: "2030",
      ccv: "123",
    }, now),
    {
      number: "4111111111111111",
      expiryMonth: "08",
      expiryYear: "2030",
      ccv: "123",
    },
  );
  assert.equal(
    normalizeCheckoutCreditCard({
      number: "4111111111111112",
      expiry_month: "08",
      expiry_year: "2030",
      ccv: "123",
    }, now),
    null,
  );
  assert.equal(
    normalizeCheckoutCreditCard({
      number: "4111111111111111",
      expiry_month: "07",
      expiry_year: "2026",
      ccv: "123",
    }, now),
    null,
  );
  assert.equal(
    normalizeCheckoutCreditCard({
      holder_name: "  Andre da Silva  ",
      holder_cpf_cnpj: "529.982.247-25",
      number: "4111111111111111",
      expiry_month: "08",
      expiry_year: "2030",
      ccv: "123",
    }, now)?.holderName,
    "Andre da Silva",
  );
  assert.equal(
    normalizeCheckoutCreditCard({
      holder_cpf_cnpj: "529.982.247-25",
      number: "4111111111111111",
      expiry_month: "08",
      expiry_year: "2030",
      ccv: "123",
    }, now)?.holderCpfCnpj,
    "52998224725",
  );
});

test("accepts only a canonical-looking client IP", () => {
  assert.equal(normalizeCheckoutClientIp("203.0.113.10"), "203.0.113.10");
  assert.equal(normalizeCheckoutClientIp("2001:db8::10"), "2001:db8::10");
  assert.equal(normalizeCheckoutClientIp("999.1.1.1"), null);
  assert.equal(normalizeCheckoutClientIp("unknown"), null);
});

test("validates the supported billing periods", () => {
  for (const period of [1, 6, 12]) {
    assert.equal(isBillingPeriodMonths(period), true);
  }
  for (const period of [undefined, null, 0, 3, "6"]) {
    assert.equal(isBillingPeriodMonths(period), false);
  }
});

test("defaults an omitted billing period to monthly during rollout", () => {
  assert.equal(normalizeBillingPeriodMonths(undefined), 1);
  assert.equal(normalizeBillingPeriodMonths(6), 6);
  assert.equal(normalizeBillingPeriodMonths(12), 12);
  assert.equal(normalizeBillingPeriodMonths(null), null);
  assert.equal(normalizeBillingPeriodMonths("6"), null);
  assert.equal(normalizeBillingPeriodMonths(3), null);
});

test("maps billing period months to the Asaas recurring cycle", () => {
  assert.equal(asaasSubscriptionCycle(1), "MONTHLY");
  assert.equal(asaasSubscriptionCycle(6), "SEMIANNUALLY");
  assert.equal(asaasSubscriptionCycle(12), "YEARLY");
});

test("passes period and quote snapshot to the billing reservation RPC", () => {
  assert.deepEqual(
    billingCheckoutIntentRpcArgs(
      "organization-123",
      "CREDIT_CARD",
      6,
      "plan-123",
      297,
    ),
    {
      p_organization_id: "organization-123",
      p_billing_method: "CREDIT_CARD",
      p_billing_period_months: 6,
      p_expected_plan_id: "plan-123",
      p_expected_monthly_price: 297,
    },
  );
});

test("checkout plan selection exposes periods, features and limits", () => {
  const fields = new Set(checkoutPlanSelect.split(","));
  for (
    const field of [
      "billing_periods",
      "display_features",
      "max_users",
      "max_leads",
      "max_whatsapp_sessions",
    ]
  ) {
    assert.equal(
      fields.has(field),
      true,
      `missing checkout plan field ${field}`,
    );
  }
});

test("recovery uses the stable intent reference and the matching resource", () => {
  assert.equal(
    providerRecoveryPath("PIX", "intent 123"),
    "/payments?externalReference=intent+123&limit=10&offset=0",
  );
  assert.equal(
    providerRecoveryPath("BOLETO", "intent-boleto"),
    "/payments?externalReference=intent-boleto&limit=10&offset=0",
  );
  assert.equal(
    providerRecoveryPath("CREDIT_CARD", "intent-456"),
    "/subscriptions?externalReference=intent-456&limit=10&offset=0",
  );
  assert.equal(
    hostedCheckoutRecoveryPath("checkout/id"),
    "/checkouts/checkout%2Fid",
  );
});

test("ambiguous provider failures keep the intent recoverable", () => {
  assert.equal(providerFailureIsDeterministic(422), true);
  assert.equal(providerFailureIsDeterministic(408), false);
  assert.equal(providerFailureIsDeterministic(429), false);
  assert.equal(providerFailureIsDeterministic(500), false);
});

test("provider recovery requires one exact immutable candidate", () => {
  const payment = {
    id: "pay_123",
    externalReference: "vimob:intent:123",
    customer: "cus_123",
    billingType: "PIX",
    value: 297,
    dueDate: "2026-08-05",
  };
  const paymentInput = {
    method: "PIX" as const,
    externalReference: "vimob:intent:123",
    expectedCustomerId: "cus_123",
    expectedAmount: 297,
    expectedBillingPeriodMonths: 1 as const,
    candidates: [payment],
  };
  assert.deepEqual(selectBillingProviderRecoveryCandidate(paymentInput), {
    outcome: "found",
    resource: payment,
  });
  assert.deepEqual(
    selectBillingProviderRecoveryCandidate({
      ...paymentInput,
      candidates: [payment, { ...payment, id: "pay_duplicate" }],
    }),
    { outcome: "ambiguous" },
  );
  assert.deepEqual(
    selectBillingProviderRecoveryCandidate({
      ...paymentInput,
      hasMore: true,
    }),
    { outcome: "ambiguous" },
  );
  assert.deepEqual(
    selectBillingProviderRecoveryCandidate({
      ...paymentInput,
      candidates: [{ ...payment, value: 297.01 }],
    }),
    { outcome: "mismatch" },
  );
  assert.deepEqual(
    selectBillingProviderRecoveryCandidate({
      ...paymentInput,
      candidates: [{ ...payment, customer: "cus_other" }],
    }),
    { outcome: "mismatch" },
  );
  assert.deepEqual(
    selectBillingProviderRecoveryCandidate({
      ...paymentInput,
      candidates: [],
    }),
    { outcome: "not_found" },
  );

  const subscription = {
    id: "sub_123",
    externalReference: "vimob:intent:card",
    customer: "cus_123",
    billingType: "CREDIT_CARD",
    value: 297,
    cycle: "MONTHLY",
    nextDueDate: "2026-08-05",
    status: "ACTIVE",
  };
  assert.equal(
    selectBillingProviderRecoveryCandidate({
      method: "CREDIT_CARD",
      externalReference: "vimob:intent:card",
      expectedCustomerId: "cus_123",
      expectedAmount: 297,
      expectedBillingPeriodMonths: 1,
      candidates: [subscription],
    }).outcome,
    "found",
  );
  assert.equal(
    selectBillingProviderRecoveryCandidate({
      method: "CREDIT_CARD",
      externalReference: "vimob:intent:card",
      expectedCustomerId: "cus_123",
      expectedAmount: 297,
      expectedBillingPeriodMonths: 6,
      candidates: [subscription],
    }).outcome,
    "mismatch",
  );
  assert.equal(
    selectBillingProviderRecoveryCandidate({
      method: "CREDIT_CARD",
      externalReference: "vimob:intent:card",
      expectedCustomerId: "cus_123",
      expectedAmount: 297,
      expectedBillingPeriodMonths: 1,
      candidates: [{ ...subscription, status: "INACTIVE" }],
    }).outcome,
    "mismatch",
  );
  assert.equal(
    selectBillingProviderRecoveryCandidate({
      method: "CREDIT_CARD",
      externalReference: "vimob:intent:card",
      expectedCustomerId: "cus_123",
      expectedAmount: 297,
      expectedBillingPeriodMonths: 1,
      candidates: [{ ...subscription, status: "EXPIRED" }],
    }).outcome,
    "mismatch",
  );
});

test("subscription payment recovery requires one exact immutable tuple", () => {
  const payment = {
    id: "pay_subscription_1",
    subscription: "sub_123",
    externalReference: "vimob:intent:card",
    customer: "cus_123",
    billingType: "CREDIT_CARD",
    value: 297,
    dueDate: "2026-08-05",
  };
  const input = {
    subscriptionId: "sub_123",
    externalReference: "vimob:intent:card",
    expectedCustomerId: "cus_123",
    expectedAmount: 297,
    candidates: [payment],
  };

  assert.deepEqual(selectBillingSubscriptionPaymentCandidate(input), {
    outcome: "found",
    resource: payment,
  });
  assert.deepEqual(
    selectBillingSubscriptionPaymentCandidate({
      ...input,
      candidates: [{ ...payment, deleted: true }],
    }),
    {
      outcome: "found",
      resource: { ...payment, deleted: true },
    },
  );
  assert.deepEqual(
    selectBillingSubscriptionPaymentCandidate({
      ...input,
      candidates: [payment, { ...payment, id: "pay_subscription_2" }],
    }),
    { outcome: "ambiguous" },
  );
  assert.deepEqual(
    selectBillingSubscriptionPaymentCandidate({ ...input, hasMore: true }),
    { outcome: "ambiguous" },
  );
  for (
    const mismatched of [
      { ...payment, subscription: "sub_other" },
      { ...payment, externalReference: "vimob:intent:other" },
      { ...payment, customer: "cus_other" },
      { ...payment, billingType: "PIX" },
      { ...payment, value: 296.99 },
      { ...payment, dueDate: "not-a-date" },
    ]
  ) {
    assert.deepEqual(
      selectBillingSubscriptionPaymentCandidate({
        ...input,
        candidates: [mismatched],
      }),
      { outcome: "mismatch" },
    );
  }
  assert.deepEqual(
    selectBillingSubscriptionPaymentCandidate({ ...input, candidates: [] }),
    { outcome: "not_found" },
  );
});

test("card retries reuse the existing subscription charge", () => {
  assert.equal(cardPaymentRecoveryAction("CONFIRMED"), "settled");
  assert.equal(
    cardPaymentRecoveryAction("credit_card_capture_refused"),
    "retry",
  );
  assert.equal(cardPaymentRecoveryAction("OVERDUE"), "retry");
  assert.equal(cardPaymentRecoveryAction("CANCELED"), "cancelled");
  assert.equal(cardPaymentRecoveryAction("CANCELLED"), "cancelled");
  assert.equal(cardPaymentRecoveryAction("DELETED"), "cancelled");
  for (
    const status of [
      "REFUNDED",
      "REFUND_REQUESTED",
      "REFUND_IN_PROGRESS",
      "PARTIALLY_REFUNDED",
      "RECEIVED_IN_CASH_UNDONE",
      "CHARGEBACK",
      "CHARGEBACK_REQUESTED",
      "CHARGEBACK_DISPUTE",
      "AWAITING_CHARGEBACK_REVERSAL",
    ]
  ) {
    assert.equal(asaasPaymentRequiresAssistance(status), true, status);
    assert.equal(cardPaymentRecoveryAction(status), "assisted", status);
  }
  assert.equal(asaasPaymentRequiresAssistance("PENDING"), false);
  assert.equal(cardPaymentRecoveryAction("PENDING"), "wait");
  assert.equal(
    subscriptionPaymentsPath("sub/id"),
    "/subscriptions/sub%2Fid/payments?limit=100&offset=0",
  );
});

test("payment cancellation distinguishes a cancelled boleto artifact from a cancelled charge", () => {
  assert.equal(
    billingPaymentCancellationAction({
      status: "BANK_SLIP_CANCELLED",
      billingType: "BOLETO",
    }),
    "wait",
  );
  assert.equal(
    billingPaymentCancellationAction({
      status: "BANK_SLIP_CANCELLED",
      billingType: "PIX",
    }),
    "assisted",
  );
  for (const status of ["CANCELED", "CANCELLED", "DELETED"]) {
    assert.equal(
      billingPaymentCancellationAction({ status, billingType: "BOLETO" }),
      "cancelled",
      status,
    );
  }
  assert.equal(
    billingPaymentCancellationAction({
      status: "PENDING",
      billingType: "PIX",
      deleted: true,
    }),
    "cancelled",
  );
});

test("payment attempts use an explicit fail-closed provider allowlist", () => {
  for (
    const status of [
      "CREATED",
      "PENDING",
      "OVERDUE",
      "DUNNING_REQUESTED",
      "DUNNING_RECEIVED",
    ]
  ) {
    assert.equal(asaasPaymentDisposition(status), "payable", status);
    assert.equal(asaasPaymentCanReceiveCheckoutAttempt(status), true, status);
    assert.equal(asaasPaymentCheckoutState(status), "pending", status);
  }
  assert.equal(
    asaasPaymentDisposition("CREDIT_CARD_CAPTURE_REFUSED"),
    "retryable",
  );
  assert.equal(
    asaasPaymentCanReceiveCheckoutAttempt("CREDIT_CARD_CAPTURE_REFUSED"),
    true,
  );

  for (const status of [null, "", "NEW_ASAAS_STATUS"]) {
    assert.equal(
      asaasPaymentCanReceiveCheckoutAttempt(status),
      false,
      String(status),
    );
    assert.equal(
      asaasPaymentCheckoutState(status),
      "assisted",
      String(status),
    );
  }
  assert.equal(
    asaasPaymentDisposition("REPROVED_BY_RISK_ANALYSIS"),
    "assisted",
  );
});

test("payment-scoped checkout requires the exact provider identity and amount", () => {
  const exact = {
    expectedPaymentId: "pay_123",
    expectedCustomerId: "cus_123",
    expectedSubscriptionId: "sub_123",
    expectedBillingType: "CREDIT_CARD" as const,
    expectedAmount: 297,
    expectedDueDate: "2026-08-05",
    expectedExternalReference: "intent_123",
    providerPaymentId: "pay_123",
    providerCustomerId: "cus_123",
    providerSubscriptionId: "sub_123",
    providerBillingType: "CREDIT_CARD",
    providerAmount: 297.0,
    providerDueDate: "2026-08-05",
    providerExternalReference: "intent_123",
  };
  assert.equal(asaasCheckoutPaymentIntegrity(exact), "valid");
  assert.equal(
    asaasCheckoutPaymentIntegrity({
      ...exact,
      expectedExternalReference: undefined,
      providerExternalReference: "provider:recurring:invoice",
    }),
    "valid",
  );
  assert.equal(
    asaasCheckoutPaymentIntegrity({ ...exact, providerAmount: 296.99 }),
    "amount_mismatch",
  );
  assert.equal(
    asaasCheckoutPaymentIntegrity({ ...exact, providerAmount: undefined }),
    "amount_mismatch",
  );
  assert.equal(
    asaasCheckoutPaymentIntegrity({ ...exact, providerCustomerId: "" }),
    "customer_mismatch",
  );
  assert.equal(
    asaasCheckoutPaymentIntegrity({ ...exact, providerPaymentId: "pay_other" }),
    "payment_mismatch",
  );
  assert.equal(
    asaasCheckoutPaymentIntegrity({
      ...exact,
      providerSubscriptionId: "sub_other",
    }),
    "subscription_mismatch",
  );
  assert.equal(
    asaasCheckoutPaymentIntegrity({ ...exact, providerDeleted: true }),
    "deleted",
  );
  assert.equal(
    asaasCheckoutPaymentIntegrity({ ...exact, providerBillingType: "PIX" }),
    "billing_type_mismatch",
  );
  assert.equal(
    asaasCheckoutPaymentIntegrity({ ...exact, providerDueDate: "2026-08-06" }),
    "due_date_mismatch",
  );
  assert.equal(
    asaasCheckoutPaymentIntegrity({
      ...exact,
      providerExternalReference: "intent_other",
    }),
    "external_reference_mismatch",
  );
  assert.equal(
    asaasCheckoutPaymentIntegrity({
      ...exact,
      expectedSubscriptionId: null,
      providerSubscriptionId: "sub_123",
    }),
    "subscription_mismatch",
  );
  assert.equal(
    asaasCheckoutPaymentIntegrity({
      ...exact,
      expectedPaymentId: "",
      providerPaymentId: "",
    }),
    "payment_mismatch",
  );
  assert.equal(
    asaasCheckoutPaymentIntegrity({
      ...exact,
      expectedCustomerId: "",
      providerCustomerId: "",
    }),
    "customer_mismatch",
  );
  assert.equal(
    asaasCheckoutPaymentIntegrity({
      ...exact,
      expectedDueDate: "not-a-date",
      providerDueDate: "not-a-date",
    }),
    "due_date_mismatch",
  );
  assert.equal(
    asaasCheckoutPaymentIntegrity({
      ...exact,
      expectedExternalReference: "",
      providerExternalReference: "",
    }),
    "external_reference_mismatch",
  );
});

test("a CIP cancellation invalidates only the old boleto artifact", () => {
  const cancelled = {
    status: "OVERDUE",
    billingType: "BOLETO",
    webhookEvent: "PAYMENT_BANK_SLIP_CANCELLED",
    providerDueDate: "2026-08-03",
    recordedDueDate: "2026-08-03",
  };
  assert.equal(asaasBankSlipArtifactIsInvalid(cancelled), true);
  assert.equal(
    asaasPaymentDisposition(cancelled.status, {
      bankSlipArtifactInvalid: asaasBankSlipArtifactIsInvalid(cancelled),
    }),
    "bank_slip_artifact_invalid",
  );
  assert.equal(
    asaasBankSlipArtifactIsInvalid({
      ...cancelled,
      providerDueDate: "2026-08-08",
    }),
    false,
    "a new due date represents a safe reissue",
  );
  assert.equal(
    asaasBankSlipArtifactIsInvalid({
      ...cancelled,
      billingType: "PIX",
    }),
    false,
    "changing the payment method invalidates the old boleto marker",
  );
});

test("provider-less cancellation waits five minutes before final recovery", () => {
  const now = Date.parse("2026-08-03T12:05:00.000Z");
  const base = {
    status: "creating",
    providerRequestStartedAt: "2026-08-03T12:00:00.000Z",
    createdAt: "2026-08-03T11:59:00.000Z",
  };

  assert.equal(
    providerlessCheckoutCancellationAction(base, now - 1),
    "retry_later",
  );
  assert.equal(
    providerlessCheckoutCancellationAction(base, now),
    "recover_then_cancel",
  );
  assert.equal(
    providerlessCheckoutCancellationAction(
      { ...base, paymentId: "pay_1" },
      now,
    ),
    "not_providerless",
  );
  assert.equal(
    providerlessCheckoutCancellationAction({ ...base, status: "pending" }, now),
    "not_providerless",
  );
  assert.equal(
    providerlessCheckoutRetryAfterSeconds(base, now - 90_000),
    90,
  );
  assert.equal(providerlessCheckoutRetryAfterSeconds({}, now), 5);
});

test("a card subscription with no payment becomes safely cancelable after grace", () => {
  const input = {
    providerRequestStartedAt: "2026-08-03T12:00:00.000Z",
    createdAt: "2026-08-03T11:59:00.000Z",
  };
  assert.equal(
    cardSubscriptionRecoveryAction(
      null,
      input,
      Date.parse("2026-08-03T12:04:59.999Z"),
    ),
    "wait",
  );
  assert.equal(
    cardSubscriptionRecoveryAction(
      null,
      input,
      Date.parse("2026-08-03T12:05:00.000Z"),
    ),
    "retry",
  );
  assert.equal(cardSubscriptionRequiresDeletion("retry"), true);
  assert.equal(cardSubscriptionRequiresDeletion("cancelled"), true);
  assert.equal(cardSubscriptionRequiresDeletion("assisted"), false);
  assert.equal(cardSubscriptionRequiresDeletion("wait"), false);
});
