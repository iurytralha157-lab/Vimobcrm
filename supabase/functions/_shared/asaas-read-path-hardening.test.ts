import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { asaasPaymentCheckoutState } from "./asaas-billing-intent.ts";

test("checkout info exposes only payable or processing payment snapshots without forging pending", () => {
  const source = readFileSync(
    new URL("../asaas-checkout-info/index.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("function paymentScopedCheckout");
  const end = source.indexOf("Deno.serve", start);
  assert.ok(start >= 0 && end > start);
  const paymentScope = source.slice(start, end);

  assert.match(paymentScope, /asaasPaymentCheckoutState\(paymentStatus,/);
  assert.match(
    paymentScope,
    /!\["pending", "processing", "retry"\]\.includes\(checkoutState\)/,
  );
  assert.match(paymentScope, /status: checkoutState/);
  assert.doesNotMatch(paymentScope, /status: "pending"/);

  const exposedStates = new Set(["pending", "processing", "retry"]);
  for (
    const status of [
      "CANCELED",
      "CANCELLED",
      "DELETED",
      "REFUNDED",
      "CHARGEBACK",
      "REPROVED_BY_RISK_ANALYSIS",
    ]
  ) {
    assert.equal(exposedStates.has(asaasPaymentCheckoutState(status)), false);
  }
  assert.equal(
    asaasPaymentCheckoutState("CREDIT_CARD_CAPTURE_REFUSED"),
    "retry",
  );

  assert.match(
    source,
    /payment_status: record\.access\.scope === "payment"\s*\? paymentStatus \|\| null/,
  );
});

test("read paths never infer completed recurrence from a paid subscription invoice", () => {
  for (
    const path of [
      "../asaas-checkout-info/index.ts",
      "../asaas-payment-status/index.ts",
    ]
  ) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /publicBillingCardRecurrenceState\("completed"\)/,
      path,
    );
    assert.match(
      source,
      /publicBillingCardRecurrenceState\((?:record\.access\.cardRecurrenceStatus|recurrenceStatus)\)/,
      path,
    );
  }
});

test("payment capability provider 404 falls back only to an exact closed terminal local tuple", () => {
  const source = readFileSync(
    new URL("../asaas-payment-status/index.ts", import.meta.url),
    "utf8",
  );
  const paymentStart = source.indexOf(
    "async function paymentScopedStatusResponse",
  );
  const paymentEnd = source.indexOf(
    "async function recoverProviderResource",
    paymentStart,
  );
  const paymentScope = source.slice(paymentStart, paymentEnd);
  const providerRead = paymentScope.indexOf(
    "payment = await asaasRequest<AsaasPayment>",
  );
  const integrity = paymentScope.indexOf("let paymentIntegrity", providerRead);
  const provider404 = paymentScope.slice(providerRead, integrity);
  assert.ok(providerRead >= 0 && integrity > providerRead);

  assert.match(
    provider404,
    /error instanceof AsaasRequestError && error\.status === 404/,
  );
  assert.match(
    provider404,
    /loadExactLocalPaymentAuthority\(\{[\s\S]*localPaymentId: access\.paymentId[\s\S]*organizationId: record\.organization\.id[\s\S]*billingIntentId: access\.billingIntentId[\s\S]*paymentSnapshotSource: access\.paymentSnapshotSource[\s\S]*providerPaymentId: access\.providerPaymentId[\s\S]*providerCustomerId[\s\S]*providerSubscriptionId: access\.providerSubscriptionId[\s\S]*billingType:[\s\S]*amount: paymentAmount[\s\S]*dueDate: paymentDueDate/,
  );
  assert.match(provider404, /exactLocalTerminalPaymentResponse\(\{/);
  assert.match(
    provider404,
    /return localResponse \|\|\s*paymentReconciliationUnavailableResponse/,
  );

  const localLoad = source.slice(
    source.indexOf("async function loadExactLocalPaymentAuthority"),
    source.indexOf("function paymentReconciliationUnavailableResponse"),
  );
  assert.match(
    localLoad,
    /asaasCheckoutPaymentIntegrity\(\{[\s\S]*expectedPaymentId: input\.providerPaymentId[\s\S]*expectedCustomerId: input\.providerCustomerId[\s\S]*expectedSubscriptionId: input\.providerSubscriptionId[\s\S]*expectedBillingType: input\.billingType[\s\S]*expectedAmount: input\.amount[\s\S]*expectedDueDate: input\.dueDate/,
  );
  assert.match(
    localLoad,
    /const activeCheckout = await getBillingCheckoutState\(input\.organizationId\)[\s\S]*const checkoutClosed = !activeCheckout \|\|\s*activeCheckout\.intent_id !== input\.billingIntentId/,
  );

  const terminalGuard = source.slice(
    source.indexOf("function isClosedTerminalLocalPaymentAuthority"),
    source.indexOf("async function exactLocalTerminalPaymentResponse"),
  );
  assert.match(
    terminalGuard,
    /authority\?\.checkoutClosed === true &&\s*\(authority\.state === "settled" \|\| authority\.state === "cancelled"\)/,
  );
});

test("identified organization polling without an active checkout requires one exact paid receipt", () => {
  const source = readFileSync(
    new URL("../asaas-payment-status/index.ts", import.meta.url),
    "utf8",
  );
  const evidenceStart = source.indexOf(
    "async function getExactRequestedPaymentReceiptEvidence",
  );
  const evidenceEnd = source.indexOf(
    "async function tryPixArtifact",
    evidenceStart,
  );
  const evidence = source.slice(evidenceStart, evidenceEnd);
  assert.match(
    evidence,
    /if \(!input\.intentId && !input\.paymentId && !input\.subscriptionId\) return null/,
  );
  assert.match(evidence, /\.eq\("organization_id", organizationId\)/);
  assert.match(evidence, /query\.eq\("billing_intent_id", input\.intentId\)/);
  assert.match(evidence, /query\.eq\("asaas_payment_id", input\.paymentId\)/);
  assert.match(
    evidence,
    /query\.eq\("asaas_subscription_id", input\.subscriptionId\)/,
  );
  assert.match(evidence, /payments\.length !== 1/);
  assert.match(
    evidence,
    /asaasPaymentCheckoutState\(payment\.status\) !== "settled"/,
  );
  assert.match(evidence, /getBillingPaymentReceiptReference\(/);
  assert.match(
    evidence,
    /return receipt \? \{ providerPaymentId, receipt \} : null/,
  );

  const noCheckoutStart = source.indexOf("if (!checkout) {");
  const noCheckoutEnd = source.indexOf(
    "if (\n      !ensureRequestedResourceMatches",
    noCheckoutStart,
  );
  const noCheckout = source.slice(noCheckoutStart, noCheckoutEnd);
  const identified = noCheckout.indexOf(
    "const requestedResource = Boolean(",
  );
  const exactEvidence = noCheckout.indexOf(
    "getExactRequestedPaymentReceiptEvidence(",
  );
  const failClosed = noCheckout.indexOf(
    "return paymentReconciliationUnavailableResponse(paymentId)",
  );
  const generalOrganizationFallback = noCheckout.indexOf(
    "const settled = record.organization.subscription_status",
  );
  assert.ok(
    identified >= 0 && identified < exactEvidence &&
      exactEvidence < failClosed &&
      failClosed < generalOrganizationFallback,
  );
  assert.match(
    noCheckout.slice(identified, generalOrganizationFallback),
    /if \(!evidence\)[\s\S]*paymentReconciliationUnavailableResponse/,
  );
});

test("organization one-off provider 404 uses the same exact closed terminal authority or returns 503", () => {
  const source = readFileSync(
    new URL("../asaas-payment-status/index.ts", import.meta.url),
    "utf8",
  );
  const directStart = source.indexOf(
    "const directPaymentId = checkout.provider_payment_id",
  );
  const directEnd = source.indexOf(
    "} else if (checkout.provider_subscription_id)",
    directStart,
  );
  const direct = source.slice(directStart, directEnd);
  const providerRead = direct.indexOf(
    "payment = await asaasRequest<AsaasPayment>",
  );
  const provider404 = direct.indexOf("error.status !== 404", providerRead);
  const exactLocal = direct.indexOf(
    "localAuthority = await loadExactLocalPaymentAuthority({",
    provider404,
  );
  const terminalResponse = direct.indexOf(
    "exactLocalTerminalPaymentResponse({",
    exactLocal,
  );
  const failClosed = direct.indexOf(
    "paymentReconciliationUnavailableResponse(directPaymentId)",
    terminalResponse,
  );
  assert.ok(
    providerRead >= 0 && providerRead < provider404 &&
      provider404 < exactLocal && exactLocal < terminalResponse &&
      terminalResponse < failClosed,
  );
  assert.match(
    direct.slice(exactLocal, terminalResponse),
    /organizationId: checkout\.organization_id[\s\S]*billingIntentId: checkout\.intent_id[\s\S]*providerPaymentId: directPaymentId[\s\S]*providerCustomerId[\s\S]*providerSubscriptionId: null[\s\S]*billingType: checkout\.billing_method[\s\S]*amount: paymentAmount[\s\S]*dueDate: paymentDueDate/,
  );
  assert.doesNotMatch(
    direct.slice(provider404, failClosed),
    /state\s*=\s*"pending"/,
  );
});
