import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  billingCardRecurrenceRecoveryPath,
  publicBillingCardRecurrenceState,
  validateBillingCardRecurrenceCandidates,
} from "./asaas-card-recurrence.ts";
import {
  asaasPaymentWebhookShouldProvisionCardRecurrence,
  parseAsaasWebhook,
} from "./asaas-webhook.ts";

test("public recurrence polling exposes only terminal-safe flags", () => {
  assert.deepEqual(publicBillingCardRecurrenceState("completed"), {
    recurrence_saved: true,
    recurrence_processing: false,
    recurrence_save_failed: false,
    requires_payment_method_update: false,
  });
  for (const status of ["prepared", "creating", "recovering"] as const) {
    assert.deepEqual(publicBillingCardRecurrenceState(status), {
      recurrence_saved: false,
      recurrence_processing: true,
      recurrence_save_failed: false,
      requires_payment_method_update: false,
    });
  }
  for (const status of ["failed", "cancelled"] as const) {
    assert.deepEqual(publicBillingCardRecurrenceState(status), {
      recurrence_saved: false,
      recurrence_processing: false,
      recurrence_save_failed: true,
      requires_payment_method_update: true,
    });
  }
  assert.equal(publicBillingCardRecurrenceState(null), null);
});

test("payment polling never infers completed recurrence from a paid subscription invoice", () => {
  const source = readFileSync(
    new URL("../asaas-payment-status/index.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    'const recurrence = billingType === "CREDIT_CARD"',
  );
  const end = source.indexOf("return jsonResponse(", start);
  assert.ok(start >= 0 && end > start);
  const recurrenceFallback = source.slice(start, end);

  assert.match(
    recurrenceFallback,
    /\? publicBillingCardRecurrenceState\(recurrenceStatus\)\s*: null/,
  );
  assert.doesNotMatch(
    recurrenceFallback,
    /publicBillingCardRecurrenceState\("completed"\)/,
  );
});

const expected = {
  externalReference:
    "vimob:billing-card-recurrence:11111111-1111-4111-8111-111111111111",
  customerId: "cus_recurring",
  amount: 297,
  billingPeriodMonths: 6 as const,
  nextDueDate: "2027-02-04",
};

const subscription = {
  id: "sub_future",
  status: "ACTIVE",
  customer: expected.customerId,
  externalReference: expected.externalReference,
  billingType: "CREDIT_CARD",
  cycle: "SEMIANNUALLY",
  value: expected.amount,
  nextDueDate: expected.nextDueDate,
};

test("recurrence recovery is narrowed by immutable reference and customer", () => {
  assert.equal(
    billingCardRecurrenceRecoveryPath(expected),
    "/subscriptions?externalReference=vimob%3Abilling-card-recurrence%3A11111111-1111-4111-8111-111111111111&customer=cus_recurring&includeDeleted=true&limit=100&offset=0",
  );
});

test("exact future subscription is recoverable after an ambiguous POST", () => {
  assert.deepEqual(
    validateBillingCardRecurrenceCandidates({
      ...expected,
      subscriptions: [subscription],
    }),
    { outcome: "found", subscription },
  );
});

test("duplicate provider subscriptions fail closed", () => {
  assert.deepEqual(
    validateBillingCardRecurrenceCandidates({
      ...expected,
      subscriptions: [
        subscription,
        { ...subscription, id: "sub_duplicate" },
      ],
    }),
    { outcome: "conflict", reason: "multiple_provider_subscriptions" },
  );
});

test("mismatched or deleted subscriptions are never attached locally", () => {
  for (
    const candidate of [
      { ...subscription, deleted: true },
      { ...subscription, status: "" },
      { ...subscription, status: "INACTIVE" },
      { ...subscription, nextDueDate: "2027-02-05" },
      { ...subscription, cycle: "MONTHLY" },
      { ...subscription, value: 197 },
      { ...subscription, billingType: "PIX" },
      { ...subscription, customer: "cus_other" },
    ]
  ) {
    const result = validateBillingCardRecurrenceCandidates({
      ...expected,
      subscriptions: [candidate],
    });
    assert.notEqual(result.outcome, "found");
  }
});

test("provider pagination is treated as ambiguous instead of selecting first", () => {
  assert.deepEqual(
    validateBillingCardRecurrenceCandidates({
      ...expected,
      subscriptions: [subscription],
      hasMore: true,
    }),
    { outcome: "conflict", reason: "provider_result_is_ambiguous" },
  );
});

test("card checkout durably prepares recurrence before charging the existing invoice", () => {
  const source = readFileSync(
    new URL("../asaas-create-charge/index.ts", import.meta.url),
    "utf8",
  );
  const checkout = source.indexOf(
    "async function paymentScopedCheckoutResponse",
  );
  const start = source.indexOf(
    "const attempt = await claimBillingPaymentCheckoutAttempt",
    checkout,
  );
  const end = source.indexOf("async function prepareAsaasCustomer", start);
  assert.ok(start >= 0 && end > start);
  const paymentScope = source.slice(start, end);

  const prepare = paymentScope.indexOf("prepareBillingCardRecurrence");
  const tokenize = paymentScope.indexOf("tokenizeCheckoutCreditCard");
  const store = paymentScope.indexOf(
    "persistBillingCardRecurrenceCredential",
  );
  const observedAt = paymentScope.indexOf(
    "const cardPaymentObservedAt = new Date()",
  );
  const charge = paymentScope.indexOf("/payWithCreditCard");
  const snapshotReconcile = paymentScope.indexOf(
    "await reconcileChangedPaymentSnapshot(",
    charge,
  );
  const paidReconcile = paymentScope.indexOf(
    "await reconcileBillingCheckoutPaidPayment(",
    snapshotReconcile,
  );
  assert.ok(prepare >= 0 && prepare < tokenize);
  assert.ok(tokenize < store && store < observedAt);
  assert.ok(observedAt < charge && charge < snapshotReconcile);
  assert.ok(snapshotReconcile < paidReconcile);
  assert.match(
    paymentScope.slice(snapshotReconcile, paidReconcile),
    /cardPaymentObservedAt/,
  );
  assert.match(
    paymentScope.slice(paidReconcile),
    /paidPayment,\s*cardPaymentObservedAt,/,
  );
  assert.equal((paymentScope.match(/\/payWithCreditCard`/g) || []).length, 1);
  assert.doesNotMatch(paymentScope, /provisionStoredBillingCardRecurrence/);
});

test("future subscription uses the database-confirmed due date", () => {
  const source = readFileSync(
    new URL("./asaas-card-recurrence.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "export async function provisionStoredBillingCardRecurrence",
  );
  const end = source.indexOf(
    "export async function prepareBillingCardRecurrence",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const provision = source.slice(start, end);

  assert.match(provision, /nextDueDate:\s*claim\.next_due_date/);
  assert.doesNotMatch(provision, /nextDueDate:\s*isoDateFromNow/);
});

test("recover-only retries reconcile by lookup and never create again", () => {
  const source = readFileSync(
    new URL("./asaas-card-recurrence.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf('if (claim.outcome === "recovering")');
  const end = source.indexOf(
    'if (claim.outcome !== "claimed" || !claim.lease_id)',
    start,
  );
  assert.ok(start >= 0 && end > start);
  const recoveryOnly = source.slice(start, end);

  assert.match(recoveryOnly, /recoverBillingCardRecurrence\(claim\)/);
  assert.match(
    recoveryOnly,
    /reconcileBillingCardRecurrenceSubscription/,
  );
  assert.doesNotMatch(recoveryOnly, /method:\s*"POST"/);
});

test("PROCESSING preserves the sealed recurrence and CONFIRMED enqueues it", () => {
  const processing = parseAsaasWebhook({
    id: "evt-processing",
    event: "PAYMENT_UPDATED",
    payment: {
      id: "pay-card",
      billingType: "CREDIT_CARD",
      status: "PROCESSING",
    },
  });
  const confirmed = parseAsaasWebhook({
    id: "evt-confirmed",
    event: "PAYMENT_CONFIRMED",
    payment: {
      id: "pay-card",
      billingType: "CREDIT_CARD",
      status: "CONFIRMED",
    },
  });

  assert.equal(
    asaasPaymentWebhookShouldProvisionCardRecurrence(processing),
    false,
  );
  assert.equal(
    asaasPaymentWebhookShouldProvisionCardRecurrence(confirmed),
    true,
  );

  const statusSource = readFileSync(
    new URL("../asaas-payment-status/index.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(statusSource, /provisionStoredBillingCardRecurrence/);
  assert.match(statusSource, /durable recurrence job/);
  assert.doesNotMatch(
    statusSource,
    /state === "processing"[\s\S]{0,300}failPreparedBillingCardRecurrence/,
  );
});

test("paid webhook acknowledges after durable enqueue without provider work", () => {
  const source = readFileSync(
    new URL("../asaas-webhook/index.ts", import.meta.url),
    "utf8",
  );
  const reconcile = source.indexOf("await supabase.rpc(rpcCall.name");
  const queued = source.indexOf(
    "asaasPaymentWebhookShouldProvisionCardRecurrence",
    reconcile,
  );
  const response = source.indexOf("return jsonResponse({", queued);
  assert.ok(reconcile >= 0 && reconcile < queued && queued < response);
  assert.doesNotMatch(source, /provisionStoredBillingCardRecurrence/);
  assert.doesNotMatch(source, /claimBillingCardRecurrenceByProviderPayment/);
  assert.doesNotMatch(source, /asaasRequest/);
});

test("ambiguous retry never clears or replaces the original sealed credential", () => {
  const source = readFileSync(
    new URL("../asaas-create-charge/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /prepared\.credential_stored === true/);
  assert.match(
    source,
    /if \(recurrenceCredentialStored\)[\s\S]*payment_reconciliation_required/,
  );
  const catchStart = source.indexOf(
    "const preserveExistingCredential =",
  );
  const catchEnd = source.indexOf("} finally {", catchStart);
  const retryCatch = source.slice(catchStart, catchEnd);
  assert.match(retryCatch, /!preserveExistingCredential/);
  assert.match(retryCatch, /preserveExistingCredential \|\|/);
  assert.ok(
    retryCatch.indexOf("!preserveExistingCredential") <
      retryCatch.indexOf("failPreparedBillingCardRecurrence"),
  );
});

test("a paid public capability can finish stored recurrence but cannot tokenize a new card", () => {
  const source = readFileSync(
    new URL("../asaas-create-charge/index.ts", import.meta.url),
    "utf8",
  );
  const paidStart = source.indexOf("if (isPaidStatus(normalizedStatus))");
  const paidEnd = source.indexOf('if (disposition === "cancelled")', paidStart);
  assert.ok(paidStart > 0 && paidEnd > paidStart);
  const paidScope = source.slice(paidStart, paidEnd);
  assert.match(paidScope, /prepared\.credential_stored === true/);
  assert.doesNotMatch(paidScope, /claimPaymentCardAttempt\(/);
  assert.doesNotMatch(paidScope, /tokenizeCheckoutCreditCard\(/);
  assert.doesNotMatch(paidScope, /persistBillingCardRecurrenceCredential\(/);
  assert.match(paidScope, /authenticated billing administrator/);
});

test("existing-subscription card changes are durably queued before capture and never PUT inline", () => {
  const source = readFileSync(
    new URL("../asaas-create-charge/index.ts", import.meta.url),
    "utf8",
  );
  const checkoutStart = source.indexOf(
    "async function paymentScopedCheckoutResponse",
  );
  const checkoutEnd = source.indexOf(
    "async function prepareAsaasCustomer",
    checkoutStart,
  );
  assert.ok(
    checkoutStart >= 0 && checkoutEnd > checkoutStart,
    "payment-scoped card flow must be present",
  );
  const checkout = source.slice(checkoutStart, checkoutEnd);

  const prepare = checkout.indexOf("prepareBillingSubscriptionCardUpdate({");
  const tokenize = checkout.indexOf("tokenizeCheckoutCreditCard({", prepare);
  const persist = checkout.indexOf(
    "persistBillingSubscriptionCardUpdateCredential({",
    tokenize,
  );
  const captureMarker = checkout.indexOf(
    "markBillingSubscriptionCardUpdateCaptureStarted({",
    persist,
  );
  const providerCapture = checkout.indexOf("/payWithCreditCard`", captureMarker);
  const disposition = checkout.indexOf(
    "const paymentDisposition = asaasPaymentDisposition",
    providerCapture,
  );
  const queuedResult = checkout.indexOf('"card_update_queued"', disposition);
  const responseJobId = checkout.indexOf("card_update_job_id:", queuedResult);

  assert.ok(
    prepare >= 0 && prepare < tokenize && tokenize < persist &&
      persist < captureMarker && captureMarker < providerCapture &&
      providerCapture < disposition && disposition < queuedResult &&
      queuedResult < responseJobId,
    "prepare, seal, capture fence and durable response must stay ordered",
  );
  assert.match(checkout, /mode: "settled_payment"/);
  assert.match(checkout, /"card_update_waiting_for_payment"/);
  assert.match(checkout, /recurrence_processing: recurrence\.processing/);
  assert.match(checkout, /reconcileBillingCheckoutPaidPayment\(/);
  assert.doesNotMatch(
    checkout,
    /`\/subscriptions\/\$\{encodeURIComponent\([^)]*\)\}\/creditCard`/,
  );
  assert.doesNotMatch(checkout, /succeedBillingSubscriptionCardUpdateJob\(/);
});
