import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  asaasPaymentCanReceiveCheckoutAttempt,
  asaasPaymentCheckoutState,
  authoritativePaymentCheckoutState,
  billingCheckoutIntentRpcArgs,
  cardPaymentRecoveryAction,
  providerFailureIsDeterministic,
  providerRecoveryPath,
} from "./asaas-billing-intent.ts";
import {
  asaasPaidPaymentPollingRpcCall,
  asaasWebhookRpcCall,
  parseAsaasWebhook,
} from "./asaas-webhook.ts";

test("provider cancellation is never authoritative after a failed or rejected snapshot write", () => {
  assert.deepEqual(
    authoritativePaymentCheckoutState({
      providerState: "cancelled",
      reconciliationOutcome: null,
    }),
    {
      authoritative: false,
      state: "assisted",
      source: "unreconciled",
    },
  );
  assert.deepEqual(
    authoritativePaymentCheckoutState({
      providerState: "cancelled",
      reconciliationOutcome: "identifier_mismatch",
      localState: "pending",
      localCheckoutClosed: false,
    }),
    {
      authoritative: false,
      state: "assisted",
      source: "unreconciled",
    },
  );
  assert.equal(
    authoritativePaymentCheckoutState({
      providerState: "cancelled",
      reconciliationOutcome: "stale_snapshot",
      localState: "cancelled",
      localCheckoutClosed: false,
    }).authoritative,
    false,
  );
});

test("an exact stronger local snapshot can win an ordering race only after terminal intent proof", () => {
  assert.deepEqual(
    authoritativePaymentCheckoutState({
      providerState: "cancelled",
      reconciliationOutcome: "stale_snapshot",
      localState: "settled",
    }),
    {
      authoritative: true,
      state: "settled",
      source: "local_snapshot",
    },
  );
  assert.deepEqual(
    authoritativePaymentCheckoutState({
      providerState: "cancelled",
      reconciliationOutcome: "stale_snapshot",
      localState: "cancelled",
      localCheckoutClosed: true,
    }),
    {
      authoritative: true,
      state: "cancelled",
      source: "local_snapshot",
    },
  );
});

test("stale cancelled subscription polling preserves a paid local snapshot and never deletes the provider subscription", () => {
  assert.deepEqual(
    authoritativePaymentCheckoutState({
      providerState: "cancelled",
      reconciliationOutcome: null,
      localState: "settled",
    }),
    {
      authoritative: true,
      state: "settled",
      source: "local_snapshot",
    },
  );

  const source = readFileSync(
    new URL("../asaas-payment-status/index.ts", import.meta.url),
    "utf8",
  );
  const subscriptionScope = source.slice(
    source.indexOf("} else if (checkout.provider_subscription_id)"),
    source.indexOf('if (payment?.id && state === "settled")'),
  );
  const storedStatus = subscriptionScope.indexOf("stored.status");
  const localReload = subscriptionScope.indexOf(
    "await loadExactLocalPaymentAuthority({",
  );
  const localState = subscriptionScope.indexOf("state = authority.state");
  assert.ok(
    storedStatus >= 0 && storedStatus < localReload && localReload < localState,
  );
  assert.match(subscriptionScope, /requiresLocalAuthority/);
  assert.match(
    subscriptionScope,
    /return paymentReconciliationUnavailableResponse\(payment\.id\)/,
  );
  assert.doesNotMatch(source, /\{ method: "DELETE" \}/);
});

test("a plan change freezes the exact quote sent to the intent reservation", () => {
  const request = billingCheckoutIntentRpcArgs(
    "org-checkout",
    "BOLETO",
    6,
    "plan-pro",
    297,
  );

  assert.deepEqual(request, {
    p_organization_id: "org-checkout",
    p_billing_method: "BOLETO",
    p_billing_period_months: 6,
    p_expected_plan_id: "plan-pro",
    p_expected_monthly_price: 297,
  });
  assert.notDeepEqual(
    request,
    billingCheckoutIntentRpcArgs(
      "org-checkout",
      "BOLETO",
      6,
      "plan-enterprise",
      497,
    ),
  );
});

test("ambiguous provider failures remain recoverable instead of opening duplicates", () => {
  for (const status of [408, 409, 425, 429, 500, 502, 503, 504]) {
    assert.equal(
      providerFailureIsDeterministic(status),
      false,
      `HTTP ${status} must preserve the intent for recovery`,
    );
  }

  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(
      providerFailureIsDeterministic(status),
      true,
      `HTTP ${status} must release a definitively rejected intent`,
    );
  }
});

test("timeout recovery searches the provider with the immutable intent reference", () => {
  const externalReference = "intent/with spaces";

  assert.equal(
    providerRecoveryPath("PIX", externalReference),
    "/payments?externalReference=intent%2Fwith+spaces&limit=10&offset=0",
  );
  assert.equal(
    providerRecoveryPath("BOLETO", externalReference),
    "/payments?externalReference=intent%2Fwith+spaces&limit=10&offset=0",
  );
  assert.equal(
    providerRecoveryPath("CREDIT_CARD", externalReference),
    "/subscriptions?externalReference=intent%2Fwith+spaces&limit=10&offset=0",
  );
});

test("Pix and boleto confirmations share the authoritative payment webhook route", () => {
  for (const billingType of ["PIX", "BOLETO"] as const) {
    const parsed = parseAsaasWebhook({
      id: `evt-${billingType.toLowerCase()}-confirmed`,
      event: "PAYMENT_CONFIRMED",
      dateCreated: "2026-08-03 12:00:00",
      payment: {
        id: `pay-${billingType.toLowerCase()}`,
        billingType,
        status: "CONFIRMED",
        externalReference: `intent-${billingType.toLowerCase()}`,
      },
    });
    const call = asaasWebhookRpcCall(parsed);

    assert.equal(
      call.name,
      "reconcile_asaas_payment_webhook_with_period_intent",
    );
    assert.equal(call.args.p_event_id, parsed.id);
    assert.deepEqual(call.args.p_payment, parsed.resource);
  }
});

test("a refused card capture is routed to reconciliation and remains retryable", () => {
  const parsed = parseAsaasWebhook({
    id: "evt-card-refused",
    event: "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
    dateCreated: "2026-08-03 12:01:00",
    payment: {
      id: "pay-card-refused",
      subscription: "sub-card",
      billingType: "CREDIT_CARD",
      status: "CREDIT_CARD_CAPTURE_REFUSED",
    },
  });
  const call = asaasWebhookRpcCall(parsed);

  assert.equal(
    call.name,
    "reconcile_asaas_payment_webhook_with_period_intent",
  );
  assert.equal(
    cardPaymentRecoveryAction(
      String((call.args.p_payment as Record<string, unknown>).status),
    ),
    "retry",
  );
});

test("terminal card states are never confused with a transient pending state", () => {
  assert.equal(cardPaymentRecoveryAction("PENDING"), "wait");
  assert.equal(cardPaymentRecoveryAction("CONFIRMED"), "settled");
  assert.equal(cardPaymentRecoveryAction("RECEIVED"), "settled");
  assert.equal(cardPaymentRecoveryAction("OVERDUE"), "retry");
  assert.equal(cardPaymentRecoveryAction("CANCELED"), "cancelled");
  assert.equal(cardPaymentRecoveryAction("DELETED"), "cancelled");
  assert.equal(cardPaymentRecoveryAction("REFUNDED"), "assisted");
  assert.equal(cardPaymentRecoveryAction("REFUND_IN_PROGRESS"), "assisted");
  assert.equal(cardPaymentRecoveryAction("PARTIALLY_REFUNDED"), "assisted");
  assert.equal(
    cardPaymentRecoveryAction("RECEIVED_IN_CASH_UNDONE"),
    "assisted",
  );
  assert.equal(cardPaymentRecoveryAction("CHARGEBACK_REQUESTED"), "assisted");
});

test("refund denied preserves the settled checkout instead of reopening payment", () => {
  assert.equal(asaasPaymentCheckoutState("REFUND_DENIED"), "settled");
  assert.equal(asaasPaymentCanReceiveCheckoutAttempt("REFUND_DENIED"), false);
});

test("payment checkout blocks every assisted provider state before a new attempt", () => {
  const source = readFileSync(
    new URL("../asaas-create-charge/index.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /asaasPaymentCanReceiveCheckoutAttempt\(normalizedStatus\)/,
  );
  for (
    const status of [
      "REPROVED_BY_RISK_ANALYSIS",
      "REFUNDED",
      "SOME_FUTURE_STATUS",
      "",
    ]
  ) {
    assert.equal(asaasPaymentCanReceiveCheckoutAttempt(status), false, status);
    assert.equal(asaasPaymentCheckoutState(status), "assisted", status);
  }
});

test("organization card guard runs before active-card update, intent reservation and provider mutation", () => {
  const source = readFileSync(
    new URL("../asaas-create-charge/index.ts", import.meta.url),
    "utf8",
  );
  const claim = source.indexOf(
    "cardAttempt = await claimOrganizationCardAttempt({",
  );
  const updateActive = source.indexOf(
    "return await updateActiveSubscriptionCreditCard({",
  );
  const reserve = source.indexOf(
    "const intent = await reserveBillingCheckoutIntent(",
  );
  const customerMutation = source.indexOf(
    "const customerId = await prepareAsaasCustomer(",
    reserve,
  );
  assert.ok(claim > 0);
  assert.ok(updateActive > claim);
  assert.ok(reserve > claim);
  assert.ok(customerMutation > claim);
  assert.match(source, /claimAuthenticatedOrganizationCardAttempt\(\{/);
  assert.match(source, /authorizedUserId/);
});

test("saved-card update validates the active subscription then durably queues the sealed credential", () => {
  const source = readFileSync(
    new URL("../asaas-create-charge/index.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "async function updateActiveSubscriptionCreditCard",
  );
  const end = source.indexOf(
    "async function requireActiveAsaasSubscription",
    start,
  );
  const update = source.slice(start, end);
  const activeCheckStart = source.indexOf(
    "async function requireActiveAsaasSubscription",
  );
  const activeCheckEnd = source.indexOf(
    "function paymentCheckoutIntegrity",
    activeCheckStart,
  );
  const activeCheck = source.slice(activeCheckStart, activeCheckEnd);

  const activeCheckCall = update.indexOf(
    "const subscription = await requireActiveAsaasSubscription(",
  );
  const preparation = update.indexOf(
    "prepareBillingSubscriptionCardUpdate({",
    activeCheckCall,
  );
  const tokenization = update.indexOf(
    "tokenizeCheckoutCreditCard({",
    preparation,
  );
  const credentialStore = update.indexOf(
    "persistBillingSubscriptionCardUpdateCredential({",
    tokenization,
  );
  const acceptedResponse = update.indexOf(
    "card_update_job_id: prepared.jobId",
    credentialStore,
  );
  assert.ok(
    activeCheckCall >= 0 && activeCheckCall < preparation &&
      preparation < tokenization && tokenization < credentialStore &&
      credentialStore < acceptedResponse,
    "active preflight, durable prepare, tokenization and sealed storage must stay ordered",
  );
  assert.match(update, /mode: "saved_only"/);
  assert.match(update, /recurrence_saved: false/);
  assert.match(update, /recurrence_processing: true/);
  assert.match(update, /code: "card_update_queued"/);
  assert.match(update, /},\s*202,\s*\{ "Retry-After": "5" \}/);
  assert.doesNotMatch(update, /\/creditCard`/);
  assert.match(
    activeCheck,
    /\(subscription\.status \|\| ""\)\.trim\(\)\.toUpperCase\(\) !== "ACTIVE"/,
  );
  assert.match(activeCheck, /subscription\.id !== subscriptionId/);
  assert.match(
    activeCheck,
    /\(subscription\.customer \|\| ""\)\.trim\(\) !== expectedCustomerId\.trim\(\)/,
  );
  assert.doesNotMatch(activeCheck, /status\s*\|\|\s*"ACTIVE"/);
});

test("checkout rejects simultaneous organization and public-token identities before card rate limiting", () => {
  const source = readFileSync(
    new URL("../asaas-create-charge/index.ts", import.meta.url),
    "utf8",
  );
  const rejectAmbiguous = source.indexOf(
    "if (checkoutToken && organizationId)",
  );
  const authorize = source.indexOf(
    "const record = await getAuthorizedCheckoutRecord(",
  );
  const cardGuard = source.indexOf(
    "cardAttempt = await claimOrganizationCardAttempt({",
  );
  assert.ok(rejectAmbiguous > 0);
  assert.ok(authorize > rejectAmbiguous);
  assert.ok(cardGuard > authorize);
  assert.match(source, /code: "ambiguous_checkout_identity"/);
});

test("payment card guard adds durable capability and HMAC-IP limits before provider capture", () => {
  const source = readFileSync(
    new URL("../asaas-create-charge/index.ts", import.meta.url),
    "utf8",
  );
  const durableGuard = source.indexOf(
    "paymentCardGuard = await claimBillingPaymentCardAttemptGuard({",
  );
  const lease = source.indexOf(
    "const attempt = await claimBillingPaymentCheckoutAttempt({",
  );
  const providerCapture = source.indexOf("/payWithCreditCard`");
  assert.ok(durableGuard > 0);
  assert.ok(lease > durableGuard);
  assert.ok(providerCapture > lease);
  assert.match(source, /billingCheckoutIpFingerprint\(input\.cardClientIp\)/);
});

test("invalid card input and durable guard fail before customer notification mutation", () => {
  const source = readFileSync(
    new URL("../asaas-create-charge/index.ts", import.meta.url),
    "utf8",
  );
  const scopeStart = source.indexOf(
    "async function paymentScopedCheckoutResponse(",
  );
  const scopeEnd = source.indexOf(
    "async function prepareAsaasCustomer(",
    scopeStart,
  );
  const scope = source.slice(scopeStart, scopeEnd);
  const validation = scope.indexOf(
    'if (input.billingMethod === "CREDIT_CARD")',
  );
  const guard = scope.indexOf("claimBillingPaymentCardAttemptGuard({");
  const suppress = scope.indexOf(
    "suppressAsaasCustomerNotifications(customerId)",
  );
  const providerCapture = scope.indexOf("/payWithCreditCard`");
  assert.ok(validation > 0);
  assert.ok(guard > validation);
  assert.ok(suppress > guard);
  assert.ok(providerCapture > suppress);
  assert.equal(
    (scope.match(/claimBillingPaymentCardAttemptGuard\(\{/g) || []).length,
    1,
  );
});

test("Pix and boleto provider PUTs require one exclusive lease and retain ambiguous failures", () => {
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
  const checkout = source.slice(checkoutStart, checkoutEnd);
  const pixStart = checkout.indexOf('if (input.billingMethod === "PIX")');
  const boletoStart = checkout.indexOf(
    'if (input.billingMethod === "BOLETO")',
    pixStart,
  );
  const cardStart = checkout.indexOf(
    "const paymentId = access.paymentId",
    boletoStart,
  );
  assert.ok(
    checkoutStart >= 0 && checkoutEnd > checkoutStart && pixStart >= 0 &&
      boletoStart > pixStart && cardStart > boletoStart,
  );

  for (
    const [billingMethod, methodScope] of [
      ["PIX", checkout.slice(pixStart, boletoStart)],
      ["BOLETO", checkout.slice(boletoStart, cardStart)],
    ] as const
  ) {
    const claim = methodScope.indexOf(
      "const mutationAttempt = await claimBillingPaymentCheckoutAttempt({",
    );
    const leaseDecision = methodScope.indexOf(
      "const mutationLeaseResponse = paymentMutationLeaseResponse(",
    );
    const earlyReturn = methodScope.indexOf(
      "if (mutationLeaseResponse) return mutationLeaseResponse",
    );
    const providerPut = methodScope.indexOf('method: "PUT"');
    assert.ok(
      claim >= 0 && claim < leaseDecision && leaseDecision < earlyReturn &&
        earlyReturn < providerPut,
      `${billingMethod} must claim and resolve busy/rate-limit before PUT`,
    );
    assert.equal(
      (methodScope.match(/claimBillingPaymentCheckoutAttempt\(\{/g) || [])
        .length,
      1,
      `${billingMethod} must claim exactly once`,
    );
    assert.match(
      methodScope.slice(claim, providerPut),
      /paymentId: access\.paymentId,\s*providerPaymentId: payment\.id/,
    );
    assert.match(
      methodScope,
      /catch \(error\) \{\s*releaseMutationLease = error instanceof AsaasRequestError &&\s*providerFailureIsDeterministic\(error\.status\);\s*throw error;\s*\}/,
    );
    assert.match(
      methodScope,
      /finally \{\s*if \(releaseMutationLease\) \{\s*await releaseCardAttemptBestEffort\(\{/,
    );
    const acceptedSnapshot = methodScope.indexOf(
      "await reconcileChangedPaymentSnapshot(",
      providerPut,
    );
    const retainAcceptedMutation = methodScope.indexOf(
      "releaseMutationLease = false",
      acceptedSnapshot,
    );
    const reconciliationRequired = methodScope.indexOf(
      "return paymentReconciliationRequiredResponse({",
      retainAcceptedMutation,
    );
    assert.ok(
      acceptedSnapshot >= 0 && acceptedSnapshot < retainAcceptedMutation &&
        retainAcceptedMutation < reconciliationRequired,
      `${billingMethod} must retain its lease after an accepted PUT whose assert/CAS failed`,
    );
  }

  const leaseResponse = source.slice(
    source.indexOf("function paymentMutationLeaseResponse"),
    source.indexOf("async function updateActiveSubscriptionCreditCard"),
  );
  const busy = leaseResponse.indexOf('attempt.outcome === "busy"');
  const rateLimited = leaseResponse.indexOf(
    'attempt.outcome === "rate_limited"',
  );
  const claimed = leaseResponse.indexOf(
    'attempt.outcome !== "claimed" || !attempt.lease_id',
  );
  const noResponse = leaseResponse.indexOf("return null");
  assert.ok(
    busy >= 0 && busy < rateLimited && rateLimited < claimed &&
      claimed < noResponse,
  );
  assert.doesNotMatch(leaseResponse, /asaasRequest|method: "PUT"/);

  const cardScope = checkout.slice(cardStart);
  assert.equal(
    (cardScope.match(/claimBillingPaymentCheckoutAttempt\(\{/g) || []).length,
    1,
    "card checkout must not claim the provider-mutation lease twice",
  );
  const cardClaim = cardScope.indexOf(
    "const attempt = await claimBillingPaymentCheckoutAttempt({",
  );
  const cardCapture = cardScope.indexOf("/payWithCreditCard`");
  assert.ok(cardClaim >= 0 && cardClaim < cardCapture);
  assert.equal(
    (checkout.match(/claimBillingPaymentCheckoutAttempt\(\{/g) || []).length,
    3,
    "checkout has one mutation claim for each Pix, boleto and card branch",
  );
});

test("card mutation lease is retained for every ambiguous or accepted provider outcome", () => {
  const source = readFileSync(
    new URL("../asaas-create-charge/index.ts", import.meta.url),
    "utf8",
  );
  const scopeStart = source.indexOf(
    "let providerPaymentAttempted = false",
  );
  const scopeEnd = source.indexOf(
    "async function prepareAsaasCustomer",
    scopeStart,
  );
  assert.ok(scopeStart >= 0 && scopeEnd > scopeStart);
  const cardMutation = source.slice(scopeStart, scopeEnd);

  const releaseDefault = cardMutation.indexOf(
    "let releasePaymentLease = true",
  );
  const attempted = cardMutation.indexOf("providerPaymentAttempted = true");
  const providerPost = cardMutation.indexOf("/payWithCreditCard`");
  assert.ok(
    releaseDefault >= 0 && releaseDefault < attempted &&
      attempted < providerPost,
  );

  const subscriptionCaptureMarker = cardMutation.indexOf(
    "markBillingSubscriptionCardUpdateCaptureStarted({",
  );
  const markerNotProceed = cardMutation.indexOf(
    'captureMarker.outcome !== "proceed"',
    subscriptionCaptureMarker,
  );
  const retainMarkerLease = cardMutation.indexOf(
    "releasePaymentLease = false",
    markerNotProceed,
  );
  const markerReconciliation = cardMutation.indexOf(
    "return paymentReconciliationRequiredResponse({",
    retainMarkerLease,
  );
  assert.ok(
    subscriptionCaptureMarker >= 0 &&
      subscriptionCaptureMarker < markerNotProceed &&
      markerNotProceed < retainMarkerLease &&
      retainMarkerLease < markerReconciliation &&
      markerReconciliation < providerPost,
    "a lost capture fence must retain the lease and stop before the provider POST",
  );

  const providerCatchStart = cardMutation.indexOf(
    "} catch (error) {",
    providerPost,
  );
  const providerCatchEnd = cardMutation.indexOf("try {", providerCatchStart);
  const providerCatch = cardMutation.slice(
    providerCatchStart,
    providerCatchEnd,
  );
  assert.match(
    providerCatch,
    /error instanceof AsaasRequestError &&\s*\(error\.status === 400 \|\| error\.status === 422\)[\s\S]*throw new CardProviderRejectionError\(error\.message, error\.status\)[\s\S]*throw error/,
  );

  const acceptedSnapshotStart = cardMutation.indexOf(
    "assertPaymentBelongsToCheckout(input.record, paidPayment",
  );
  const acceptedSnapshotEnd = cardMutation.indexOf(
    "const paymentDisposition",
    acceptedSnapshotStart,
  );
  const acceptedSnapshot = cardMutation.slice(
    acceptedSnapshotStart,
    acceptedSnapshotEnd,
  );
  const acceptedReconciliation = acceptedSnapshot.indexOf(
    "await reconcileChangedPaymentSnapshot(",
  );
  const retainAccepted = acceptedSnapshot.indexOf(
    "releasePaymentLease = false",
    acceptedReconciliation,
  );
  const acceptedResponse = acceptedSnapshot.indexOf(
    "return paymentReconciliationRequiredResponse({",
    retainAccepted,
  );
  assert.ok(
    acceptedReconciliation >= 0 &&
      acceptedReconciliation < retainAccepted &&
      retainAccepted < acceptedResponse,
  );

  const outerCatchStart = cardMutation.indexOf(
    "} catch (error) {",
    acceptedSnapshotEnd,
  );
  const finallyStart = cardMutation.indexOf("} finally {", outerCatchStart);
  const outerCatch = cardMutation.slice(outerCatchStart, finallyStart);
  assert.match(
    outerCatch,
    /const deterministicRejection = error instanceof CardProviderRejectionError/,
  );
  assert.match(
    outerCatch,
    /const preserveExistingCredential =\s*error instanceof RecurrenceCredentialPersistenceError &&\s*error\.preserveExisting/,
  );
  assert.match(
    outerCatch,
    /!existingSubscriptionId &&\s*!preserveExistingCredential &&\s*\(!providerPaymentAttempted \|\| deterministicRejection\)[\s\S]*failPreparedBillingCardRecurrence/,
  );
  assert.match(
    outerCatch,
    /preserveExistingCredential \|\|\s*\(providerPaymentAttempted && !deterministicRejection\)[\s\S]*releasePaymentLease = false[\s\S]*code: "payment_reconciliation_required"/,
  );
  const captureFailure = outerCatch.indexOf(
    "failBillingSubscriptionCardUpdateCapture({",
  );
  const captureFailureFence = outerCatch.indexOf(
    "if (!refusalFinalized)",
    captureFailure,
  );
  const retainUnfencedRefusal = outerCatch.indexOf(
    "releasePaymentLease = false",
    captureFailureFence,
  );
  assert.ok(
    captureFailure >= 0 && captureFailure < captureFailureFence &&
      captureFailureFence < retainUnfencedRefusal,
    "a deterministic post-marker refusal may release only after its exact failure CAS",
  );
  assert.match(
    outerCatch.slice(captureFailure, captureFailureFence),
    /jobId: preparedSubscriptionCardUpdate\.jobId[\s\S]*generation: preparedSubscriptionCardUpdate\.generation[\s\S]*attemptLeaseId: attempt\.lease_id[\s\S]*errorCode: "provider_card_refused"/,
  );
  assert.match(outerCatch, /\}\s*throw error;\s*$/);

  const unknownGuard = cardMutation.indexOf(
    'paymentDisposition === "assisted" || paymentDisposition === "unknown"',
  );
  const retainUnknown = cardMutation.indexOf(
    "releasePaymentLease = false",
    unknownGuard,
  );
  const unknownReconciliation = cardMutation.indexOf(
    "return paymentReconciliationRequiredResponse({",
    retainUnknown,
  );
  assert.ok(
    unknownGuard >= 0 && unknownGuard < retainUnknown &&
      retainUnknown < unknownReconciliation,
    "unknown or assisted provider outcomes must retain the lease for reconciliation",
  );

  const paymentSettled = cardMutation.indexOf(
    'const paymentSettled = paymentDisposition === "settled"',
  );
  const unsettledGuard = cardMutation.indexOf(
    "if (!paymentSettled)",
    paymentSettled,
  );
  const retainUnsettled = cardMutation.indexOf(
    "releasePaymentLease = false",
    unsettledGuard,
  );
  const subscriptionSelection = cardMutation.indexOf(
    "const subscriptionId = paidPayment.subscription",
    retainUnsettled,
  );
  assert.ok(
    paymentSettled >= 0 && paymentSettled < unsettledGuard &&
      unsettledGuard < retainUnsettled &&
      retainUnsettled < subscriptionSelection,
  );

  const finallyScope = cardMutation.slice(finallyStart);
  assert.match(
    finallyScope,
    /if \(releasePaymentLease\) \{\s*await releaseCardAttemptBestEffort\(\{[\s\S]*leaseId: attempt\.lease_id/,
  );
});

test("accepted payment method changes use the shared exact CAS and exact local fallback", () => {
  const handler = readFileSync(
    new URL("../asaas-create-charge/index.ts", import.meta.url),
    "utf8",
  );
  const status = readFileSync(
    new URL("../asaas-payment-status/index.ts", import.meta.url),
    "utf8",
  );
  const shared = readFileSync(new URL("./asaas.ts", import.meta.url), "utf8");

  const handlerWrapper = handler.slice(
    handler.indexOf(
      "async function reconcilePaymentMethodChangeFromLocalSnapshot",
    ),
    handler.indexOf("async function paymentScopedCheckoutResponse"),
  );
  assert.match(
    handlerWrapper,
    /return await reconcilePaymentCapabilityMethodChange\(\{/,
  );
  assert.match(handlerWrapper, /record,\s*payment,\s*observedAt,/);
  assert.match(handler, /paymentReconciliationRequiredResponse\(\{/);

  const rpc = shared.slice(
    shared.indexOf("export async function reconcileAsaasPaymentMethodChange"),
    shared.indexOf(
      "export async function reconcilePaymentCapabilityMethodChange",
    ),
  );
  for (
    const argument of [
      "p_payment_id",
      "p_organization_id",
      "p_billing_intent_id",
      "p_provider_payment_id",
      "p_provider_customer_id",
      "p_provider_subscription_id",
      "p_external_reference",
      "p_payment_amount",
      "p_expected_old_billing_type",
      "p_expected_old_status",
      "p_expected_old_due_date",
      "p_new_billing_type",
      "p_new_status",
      "p_new_due_date",
      "p_observed_at",
    ]
  ) {
    assert.match(rpc, new RegExp(`${argument}: input\\.`));
  }
  assert.match(rpc, /"reconcile_asaas_payment_method_change"/);

  const sharedReconciliation = shared.slice(
    shared.indexOf(
      "export async function reconcilePaymentCapabilityMethodChange",
    ),
    shared.indexOf("export async function reconcileBillingCheckoutPaidPayment"),
  );
  assert.match(
    sharedReconciliation,
    /paymentCapabilityCheckoutIntegrity\([\s\S]*validateMutableFields: false/,
  );
  assert.match(
    sharedReconciliation,
    /await reconcileAsaasPaymentMethodChange\(\{[\s\S]*billingIntentId: access\.billingIntentId[\s\S]*providerPaymentId: input\.payment\.id[\s\S]*expectedOldBillingType: oldBillingType[\s\S]*newBillingType[\s\S]*observedAt: input\.observedAt\.toISOString\(\)/,
  );
  assert.match(
    sharedReconciliation,
    /!\["updated", "already_updated"\]\.includes\(changed\.outcome\)/,
  );

  const paymentStatus = status.slice(
    status.indexOf("async function paymentScopedStatusResponse"),
    status.indexOf("async function recoverProviderResource"),
  );
  const methodChange = paymentStatus.indexOf(
    "await reconcilePaymentCapabilityMethodChange({",
  );
  const exactFallback = paymentStatus.indexOf(
    "preloadedLocalAuthority = await loadExactLocalPaymentAuthority({",
    methodChange,
  );
  const rejectFallback = paymentStatus.indexOf(
    "return paymentReconciliationUnavailableResponse(payment.id)",
    exactFallback,
  );
  assert.ok(methodChange >= 0 && methodChange < exactFallback);
  assert.ok(exactFallback < rejectFallback);
  assert.match(
    paymentStatus.slice(exactFallback, rejectFallback),
    /localPaymentId: access\.paymentId[\s\S]*billingIntentId: access\.billingIntentId[\s\S]*paymentSnapshotSource: access\.paymentSnapshotSource[\s\S]*providerPaymentId: payment\.id[\s\S]*providerCustomerId:[\s\S]*providerSubscriptionId:[\s\S]*billingType: providerBillingType[\s\S]*amount:[\s\S]*dueDate: providerDueDate/,
  );
});

test("retry recovers an accepted Pix or boleto method change before strict local assertion", () => {
  const source = readFileSync(
    new URL("../asaas-create-charge/index.ts", import.meta.url),
    "utf8",
  );
  const scopeStart = source.indexOf(
    "async function paymentScopedCheckoutResponse",
  );
  const providerGet = source.indexOf(
    "let payment = await asaasRequest<AsaasPayment>",
    scopeStart,
  );
  const recovery = source.indexOf(
    "await reconcilePaymentMethodChangeFromLocalSnapshot",
    providerGet,
  );
  const strictAssertion = source.indexOf(
    "assertPaymentBelongsToCheckout(\n    input.record",
    recovery,
  );
  assert.ok(
    scopeStart >= 0 && providerGet < recovery && recovery < strictAssertion,
  );
  assert.match(
    source.slice(providerGet, strictAssertion),
    /providerBillingType === input\.billingMethod/,
  );
  assert.match(
    source.slice(providerGet, strictAssertion),
    /paymentObservedAt/,
  );
});

test("provider recovery handlers never fall back to an arbitrary first payment", () => {
  for (
    const path of [
      "../asaas-create-charge/index.ts",
      "../asaas-payment-status/index.ts",
      "../asaas-cancel-payment/index.ts",
    ]
  ) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /\.find\([^\n]+\)\s*\|\|\s*[^\n]*data\?\.?\[0\]/,
    );
    assert.doesNotMatch(source, /data\?\.?\[0\]/);
  }
});

test("both checkout capability scopes reconcile an exact deleted one-off payment", () => {
  const source = readFileSync(
    new URL("../asaas-payment-status/index.ts", import.meta.url),
    "utf8",
  );
  const shared = readFileSync(new URL("./asaas.ts", import.meta.url), "utf8");

  const paymentScope = source.slice(
    source.indexOf("async function paymentScopedStatusResponse"),
    source.indexOf("async function recoverProviderResource"),
  );
  const paymentObservedAt = paymentScope.indexOf(
    "const observedAt = new Date()",
  );
  const paymentProviderRead = paymentScope.indexOf(
    "payment = await asaasRequest<AsaasPayment>",
  );
  assert.ok(paymentObservedAt >= 0 && paymentObservedAt < paymentProviderRead);
  assert.match(
    paymentScope,
    /paymentIntegrity !== "valid" && paymentIntegrity !== "deleted"/,
  );
  assert.match(
    paymentScope,
    /payment = \{ \.\.\.payment, status: "DELETED" \}/,
  );
  assert.match(paymentScope, /reconcileAsaasPaymentSnapshot\(\{/);
  assert.match(paymentScope, /observedAt: observedAt\.toISOString\(\)/);
  assert.match(paymentScope, /reconciliationOutcome !== "applied"/);
  assert.match(paymentScope, /await loadExactLocalPaymentAuthority\(\{/);
  assert.match(
    paymentScope,
    /return paymentReconciliationUnavailableResponse\(payment\.id\)/,
  );
  assert.ok(
    paymentScope.indexOf('reconciliationOutcome !== "applied"') <
      paymentScope.indexOf("const pix ="),
  );

  const organizationScope = source.slice(
    source.indexOf("const directPaymentId = checkout.provider_payment_id"),
    source.indexOf("} else if (checkout.provider_subscription_id)"),
  );
  assert.ok(organizationScope.length > 0);
  assert.match(
    organizationScope,
    /integrity !== "valid" && integrity !== "deleted"/,
  );
  assert.match(
    organizationScope,
    /if \(integrity === "deleted"\)[\s\S]*status: "DELETED"/,
  );
  assert.match(organizationScope, /storeBillingCheckoutPayment\(\{/);
  assert.match(organizationScope, /stored\.status/);
  assert.match(organizationScope, /requiresLocalAuthority/);
  assert.match(organizationScope, /One-off payment snapshot was not stored/);
  assert.match(organizationScope, /paymentObservedAt/);
  assert.match(organizationScope, /reconcileAsaasPaymentSnapshot\(\{/);
  assert.match(
    organizationScope,
    /source: "edge_organization_checkout"/,
  );
  assert.match(
    organizationScope,
    /reconciliationOutcome === "applied"/,
  );
  assert.match(
    organizationScope,
    /await loadExactLocalPaymentAuthority\(\{/,
  );
  assert.match(
    organizationScope,
    /return paymentReconciliationUnavailableResponse\(payment\.id\)/,
  );
  const storeWrapper = shared.slice(
    shared.indexOf("export async function storeBillingCheckoutPayment"),
    shared.indexOf("export type BillingPaymentAttemptClaim"),
  );
  assert.match(storeWrapper, /data\.outcome !== "stored"/);
  assert.match(storeWrapper, /throw new Error\(/);

  const terminalScope = source.slice(
    source.indexOf('if (payment?.id && state === "settled")'),
    source.indexOf("const refreshedCheckout"),
  );
  assert.match(terminalScope, /state === "cancelled"/);
  assert.match(terminalScope, /cancelBillingCheckoutResource\(\{/);
  assert.match(
    terminalScope,
    /\["cancelled", "already_cancelled"\]\.includes/,
  );
  assert.match(terminalScope, /await loadExactLocalPaymentAuthority\(\{/);
  assert.match(terminalScope, /paymentReconciliationUnavailableResponse\(/);
});

test("deleted recurring invoices are reconciled exactly without cancelling the subscription during polling", () => {
  const source = readFileSync(
    new URL("../asaas-payment-status/index.ts", import.meta.url),
    "utf8",
  );
  const observation = source.indexOf("const paymentObservedAt = new Date()");
  const branchStart = source.indexOf(
    "} else if (checkout.provider_subscription_id)",
    observation,
  );
  const branchEnd = source.indexOf(
    'if (payment?.id && state === "settled")',
    branchStart,
  );
  const recurring = source.slice(branchStart, branchEnd);
  assert.ok(
    observation >= 0 && branchStart > observation && branchEnd > branchStart,
  );

  const directRead = recurring.indexOf(
    "payment = await asaasRequest<AsaasPayment>",
  );
  const listRead = recurring.indexOf(
    "const result = await asaasRequest<AsaasListResponse<AsaasPayment>>",
  );
  assert.ok(directRead >= 0 && listRead > directRead);
  assert.match(
    recurring,
    /expectedPaymentId: checkout\.payment\.id[\s\S]*expectedCustomerId:[\s\S]*expectedSubscriptionId: checkout\.provider_subscription_id[\s\S]*expectedBillingType: "CREDIT_CARD"[\s\S]*expectedAmount: checkout\.amount[\s\S]*expectedDueDate: checkout\.payment\.due_date[\s\S]*expectedExternalReference: checkout\.external_reference/,
  );
  assert.match(
    recurring,
    /integrity !== "valid" && integrity !== "deleted"/,
  );
  assert.match(recurring, /integrity === "deleted"[\s\S]*status: "DELETED"/);
  assert.match(
    recurring,
    /selectBillingSubscriptionPaymentCandidate\(\{[\s\S]*subscriptionId: checkout\.provider_subscription_id[\s\S]*externalReference: checkout\.external_reference[\s\S]*expectedCustomerId:[\s\S]*expectedAmount: checkout\.amount/,
  );
  assert.match(recurring, /payment\.deleted === true[\s\S]*status: "DELETED"/);
  assert.match(
    recurring,
    /storeBillingCheckoutPayment\(\{[\s\S]*intentId: checkout\.intent_id[\s\S]*organizationId: checkout\.organization_id[\s\S]*subscriptionId: checkout\.provider_subscription_id[\s\S]*billingType: "CREDIT_CARD"/,
  );
  assert.match(
    recurring,
    /reconcileAsaasPaymentSnapshot\(\{[\s\S]*providerPaymentId: payment\.id[\s\S]*providerCustomerId[\s\S]*providerSubscriptionId: payment\.subscription \|\|[\s\S]*checkout\.provider_subscription_id[\s\S]*observedAt: paymentObservedAt\.toISOString\(\)[\s\S]*source: "edge_subscription_checkout"/,
  );
  assert.match(
    recurring,
    /loadExactLocalPaymentAuthority\(\{[\s\S]*billingIntentId: checkout\.intent_id[\s\S]*providerPaymentId: payment\.id[\s\S]*providerCustomerId[\s\S]*providerSubscriptionId: payment\.subscription \|\|[\s\S]*checkout\.provider_subscription_id[\s\S]*billingType: "CREDIT_CARD"[\s\S]*amount: paymentAmount[\s\S]*dueDate: paymentDueDate/,
  );
  assert.match(
    recurring,
    /if \(!authority\.authoritative \|\| !localAuthority\)[\s\S]*paymentReconciliationUnavailableResponse\(payment\.id\)/,
  );

  // A terminal invoice is not authority to delete its recurring resource.
  assert.match(
    recurring,
    /if \(state === "cancelled"\) \{\s*state = "retry";\s*\}/,
  );
  assert.doesNotMatch(recurring, /cancelBillingCheckoutResource\(\{/);
});

test("provider observation instants precede reads and method mutations and are propagated", () => {
  const charge = readFileSync(
    new URL("../asaas-create-charge/index.ts", import.meta.url),
    "utf8",
  );
  const status = readFileSync(
    new URL("../asaas-payment-status/index.ts", import.meta.url),
    "utf8",
  );

  const statusPayment = status.slice(
    status.indexOf("async function paymentScopedStatusResponse"),
    status.indexOf("async function recoverProviderResource"),
  );
  const statusObservation = statusPayment.indexOf(
    "const observedAt = new Date()",
  );
  const statusRead = statusPayment.indexOf("await asaasRequest<AsaasPayment>");
  assert.ok(statusObservation >= 0 && statusObservation < statusRead);
  assert.match(
    statusPayment,
    /reconcilePaymentCapabilityMethodChange\(\{\s*record,\s*payment,\s*observedAt,/,
  );
  assert.match(statusPayment, /observedAt: observedAt\.toISOString\(\)/);
  assert.match(
    statusPayment,
    /reconcileBillingCheckoutPaidPayment\(payment, observedAt\)/,
  );

  const organizationObservation = status.indexOf(
    "const paymentObservedAt = new Date()",
  );
  const organizationEnd = status.indexOf(
    "const refreshedCheckout",
    organizationObservation,
  );
  const organizationPolling = status.slice(
    organizationObservation,
    organizationEnd,
  );
  assert.ok(
    organizationObservation >= 0 && organizationEnd > organizationObservation,
  );
  for (
    const providerRead of [
      "payment = await asaasRequest<AsaasPayment>",
      "const result = await asaasRequest<AsaasListResponse<AsaasPayment>>",
    ]
  ) {
    assert.ok(organizationPolling.indexOf(providerRead) > 0, providerRead);
  }
  assert.equal(
    (organizationPolling.match(
      /observedAt: paymentObservedAt\.toISOString\(\)/g,
    ) || [])
      .length,
    2,
  );
  assert.match(
    organizationPolling,
    /reconcileBillingCheckoutPaidPayment\(\s*payment,\s*paymentObservedAt,/,
  );

  const checkout = charge.slice(
    charge.indexOf("async function paymentScopedCheckoutResponse"),
    charge.indexOf("async function prepareAsaasCustomer"),
  );
  const checkoutObservation = checkout.indexOf(
    "const paymentObservedAt = new Date()",
  );
  const checkoutRead = checkout.indexOf(
    "let payment = await asaasRequest<AsaasPayment>",
  );
  assert.ok(checkoutObservation >= 0 && checkoutObservation < checkoutRead);
  assert.match(
    checkout,
    /reconcilePaymentMethodChangeFromLocalSnapshot\([\s\S]*paymentObservedAt/,
  );

  const pixStart = checkout.indexOf('if (input.billingMethod === "PIX")');
  const boletoStart = checkout.indexOf('if (input.billingMethod === "BOLETO")');
  const cardStart = checkout.indexOf(
    "const existingSubscriptionId = payment.subscription",
    boletoStart,
  );
  for (
    const methodScope of [
      checkout.slice(pixStart, boletoStart),
      checkout.slice(boletoStart, cardStart),
    ]
  ) {
    const observedAt = methodScope.indexOf(
      "const methodChangeObservedAt = new Date()",
    );
    const mutation = methodScope.indexOf('method: "PUT"');
    const reconciliation = methodScope.indexOf(
      "await reconcileChangedPaymentSnapshot(",
    );
    assert.ok(
      observedAt >= 0 && observedAt < mutation && mutation < reconciliation,
    );
    assert.match(
      methodScope.slice(reconciliation),
      /methodChangeObservedAt/,
    );
  }
});

test("payment capabilities bind intentless recurring invoices without weakening intent checkouts", () => {
  const statusSource = readFileSync(
    new URL("../asaas-payment-status/index.ts", import.meta.url),
    "utf8",
  );
  const sharedSource = readFileSync(
    new URL("./asaas.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    statusSource,
    /paymentSnapshotSource: access\.paymentSnapshotSource/,
  );
  assert.match(
    sharedSource,
    /paymentSnapshotSource: resolved\.snapshot_source/,
  );
  assert.match(
    sharedSource,
    /\["intent", "subscription", "legacy_catalog"\]\.includes/,
  );
  const expectedReference = sharedSource.slice(
    sharedSource.indexOf(
      "export function paymentCapabilityExpectedExternalReference",
    ),
    sharedSource.indexOf(
      "export function paymentCapabilityCheckoutIntegrity",
    ),
  );
  assert.match(
    expectedReference,
    /if \(access\.billingIntentId\?\.trim\(\)\) return access\.billingIntentId\.trim\(\)/,
  );
  assert.match(
    expectedReference,
    /access\.paymentSnapshotSource === "subscription" \|\|\s*access\.paymentSnapshotSource === "legacy_catalog"[\s\S]*return undefined/,
  );
  assert.match(expectedReference, /return null/);
  assert.equal(
    (expectedReference.match(/access\.paymentSnapshotSource ===/g) || [])
      .length,
    2,
  );
});

test("deleted Pix restoration is claimed once, re-read exactly, validated and CAS-reconciled before QR", () => {
  const source = readFileSync(
    new URL("../asaas-create-charge/index.ts", import.meta.url),
    "utf8",
  );
  const restoreStart = source.indexOf(
    "async function restoreDeletedPixPayment",
  );
  const restoreEnd = source.indexOf(
    "async function reconcileChangedPaymentSnapshot",
    restoreStart,
  );
  assert.ok(restoreStart > 0 && restoreEnd > restoreStart);
  const restore = source.slice(restoreStart, restoreEnd);

  const claim = restore.indexOf("await claimBillingPaymentRestore({");
  const exactClaimValidation = restore.indexOf(
    "claim.provider_payment_id !== input.payment.id",
  );
  const providerPost = restore.indexOf(
    "`/payments/${encodeURIComponent(input.payment.id)}/restore`",
  );
  const providerGet = restore.indexOf(
    "restoredPayment = await asaasRequest<AsaasPayment>",
  );
  const observedAt = restore.indexOf(
    "const restoredPaymentObservedAt = new Date()",
  );
  const exactValidation = restore.indexOf(
    "const refreshedIntegrity = paymentCheckoutIntegrity",
  );
  const localCAS = restore.indexOf("await reconcileChangedPaymentSnapshot(");
  assert.ok(
    claim >= 0 && claim < exactClaimValidation &&
      exactClaimValidation < providerPost && providerPost < observedAt &&
      observedAt < providerGet && providerGet < exactValidation &&
      exactValidation < localCAS,
  );
  assert.equal((restore.match(/\/restore`/g) || []).length, 1);
  assert.match(restore, /claim\.outcome === "claimed"/);
  assert.match(restore, /\["claimed", "recover_only"\]/);
  assert.match(restore, /checkoutToken: input\.checkoutToken/);
  assert.match(
    restore,
    /providerFailureIsDeterministic\(restoreError\.status\)/,
  );
  assert.match(restore, /paymentRestoreReconciliationRequiredResponse\(\{/);
  assert.match(
    restore.slice(localCAS),
    /input\.record,\s*input\.payment,\s*restoredPayment,\s*restoredPaymentObservedAt,/,
  );

  const claimRpc = source.slice(
    source.indexOf("async function claimBillingPaymentRestore"),
    restoreStart,
  );
  assert.match(claimRpc, /p_checkout_token: input\.checkoutToken/);
  assert.doesNotMatch(claimRpc, /p_provider_payment_id/);

  const checkout = source.slice(
    source.indexOf("async function paymentScopedCheckoutResponse"),
    source.indexOf("async function prepareAsaasCustomer"),
  );
  const restoreCall = checkout.indexOf("await restoreDeletedPixPayment({");
  const pixArtifact = checkout.indexOf("/pixQrCode`");
  assert.ok(restoreCall >= 0 && pixArtifact > restoreCall);
});

test("provider-deleted Pix claims once while the exact local payment is still actionable", () => {
  const migration = readFileSync(
    new URL(
      "../../migrations/20260804101153_secure_billing_payment_checkout_capabilities.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const restoreClaim = migration.slice(
    migration.indexOf(
      "create or replace function public.claim_billing_payment_restore",
    ),
    migration.indexOf(
      "revoke all on function public.claim_billing_payment_restore",
    ),
  );
  assert.match(
    restoreClaim,
    /not private\.billing_payment_checkout_is_actionable\(v_status\)[\s\S]*v_status <> 'DELETED'/,
  );
  assert.match(
    restoreClaim,
    /private\.billing_payment_checkout_is_actionable\(payment\.status\)[\s\S]*= 'DELETED'/,
  );
  assert.ok(
    restoreClaim.indexOf("if v_started_at is not null") <
      restoreClaim.indexOf(
        "private.billing_payment_checkout_is_processing(v_status)",
      ),
  );

  const pgTap = readFileSync(
    new URL(
      "../../tests/billing_payment_checkout_capabilities.test.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    pgTap,
    /status = 'PENDING'[\s\S]*claim_billing_payment_restore\([\s\S]*'claimed'[\s\S]*local payment remains actionable/,
  );
  assert.match(
    pgTap,
    /status_before_restore}' = 'PENDING'[\s\S]*provider-request marker commits before/,
  );
});

test("paid polling emits a deterministic authoritative webhook RPC call", () => {
  const first = asaasPaidPaymentPollingRpcCall({
    id: "pay-polling-1",
    status: "CONFIRMED",
    customer: "cus-1",
    externalReference: "intent-1",
  }, new Date("2026-08-03T12:04:00.000Z"));
  const repeated = asaasPaidPaymentPollingRpcCall({
    id: "pay-polling-1",
    status: "confirmed",
    customer: "cus-1",
    externalReference: "intent-1",
  }, new Date("2026-08-03T12:05:00.000Z"));

  assert.equal(
    first.name,
    "reconcile_asaas_payment_webhook_with_period_intent",
  );
  assert.equal(first.args.p_event_id, "payment-status:pay-polling-1:CONFIRMED");
  assert.equal(first.args.p_event_type, "PAYMENT_CONFIRMED");
  assert.equal(first.args.p_event_id, repeated.args.p_event_id);
});

test("Edge handler: delayed Pix QR and boleto URL return processing, then recover the same provider payment", () => {
  const source = readFileSync(
    new URL("../asaas-create-charge/index.ts", import.meta.url),
    "utf8",
  );
  const pixStart = source.indexOf("async function pixCheckoutResponse");
  const boletoStart = source.indexOf(
    "async function boletoCheckoutResponse",
    pixStart,
  );
  const hostedStart = source.indexOf(
    "function savedHostedCheckout",
    boletoStart,
  );
  assert.ok(
    pixStart >= 0 && boletoStart > pixStart && hostedStart > boletoStart,
  );

  const pix = source.slice(pixStart, boletoStart);
  const pixProviderRegistration = pix.indexOf(
    "await registerBillingCheckoutProvider({",
  );
  const pixLocalSnapshot = pix.indexOf(
    "await storeBillingCheckoutPayment({",
  );
  const pixArtifactRead = pix.indexOf(
    "await asaasRequest<AsaasPixQrCode>",
  );
  const pixProcessing = pix.indexOf(
    "const processing = !pix.encodedImage || !pix.payload",
  );
  const pixResponse = pix.indexOf("return jsonResponse({", pixProcessing);
  assert.ok(
    pixProviderRegistration >= 0 &&
      pixProviderRegistration < pixLocalSnapshot &&
      pixLocalSnapshot < pixArtifactRead &&
      pixArtifactRead < pixProcessing &&
      pixProcessing < pixResponse,
    "Pix must persist the provider identity before attempting its delayed artifact",
  );
  assert.match(
    pix.slice(pixArtifactRead, pixProcessing),
    /catch \(error\) \{[\s\S]*Pix QR Code will be recovered by payment-status/,
  );
  assert.match(
    pix.slice(pixResponse),
    /intent_id: intentId[\s\S]*payment_id: input\.payment\.id[\s\S]*processing,[\s\S]*status: processing \? "RECOVERING"/,
  );

  const boleto = source.slice(boletoStart, hostedStart);
  const boletoProviderRegistration = boleto.indexOf(
    "await registerBillingCheckoutProvider({",
  );
  const boletoLocalSnapshot = boleto.indexOf(
    "await storeBillingCheckoutPayment({",
  );
  const boletoInvoice = boleto.indexOf(
    "const invoiceUrl = safeAsaasPublicUrl(input.payment.invoiceUrl)",
  );
  const boletoProcessing = boleto.indexOf(
    "const processing = !invoiceUrl && !bankSlipUrl",
  );
  const boletoIdentification = boleto.indexOf(
    "await getBoletoIdentification(input.payment.id)",
  );
  const boletoResponse = boleto.indexOf(
    "return jsonResponse({",
    boletoIdentification,
  );
  assert.ok(
    boletoProviderRegistration >= 0 &&
      boletoProviderRegistration < boletoLocalSnapshot &&
      boletoLocalSnapshot < boletoInvoice &&
      boletoInvoice < boletoProcessing &&
      boletoProcessing < boletoIdentification &&
      boletoIdentification < boletoResponse,
    "boleto must persist the provider identity before resolving delayed bank artifacts",
  );
  assert.match(
    boleto.slice(boletoResponse),
    /intent_id: intentId[\s\S]*payment_id: input\.payment\.id[\s\S]*processing,[\s\S]*status: processing \? "RECOVERING"/,
  );
  assert.match(
    boleto.slice(boletoResponse),
    /invoice_url: invoiceUrl \|\| bankSlipUrl[\s\S]*bank_slip_url: bankSlipUrl \|\| invoiceUrl/,
  );

  const reuseStart = source.indexOf('if (intent.outcome === "reuse")');
  const recoverStart = source.indexOf(
    'if (intent.outcome === "recover")',
    reuseStart,
  );
  const createStart = source.indexOf(
    'if (intent.outcome !== "create")',
    recoverStart,
  );
  assert.ok(
    reuseStart >= 0 && recoverStart > reuseStart && createStart > recoverStart,
  );

  const reuse = source.slice(reuseStart, recoverStart);
  const exactPaymentRead = reuse.indexOf(
    "`/payments/${intent.provider_payment_id}`",
  );
  const reuseInput = reuse.indexOf("const directPaymentInput", exactPaymentRead);
  const reuseDispatch = reuse.indexOf(
    'return body.billing_type === "PIX"',
    reuseInput,
  );
  assert.ok(
    exactPaymentRead >= 0 &&
      exactPaymentRead < reuseInput &&
      reuseInput < reuseDispatch,
    "a repeated checkout must re-read and return the exact recorded provider payment",
  );
  assert.match(
    reuse.slice(reuseInput, reuseDispatch),
    /payment,[\s\S]*reused: true/,
  );
  assert.doesNotMatch(reuse, /method: "POST"/);

  const recover = source.slice(recoverStart, createStart);
  const immutableLookup = recover.indexOf(
    "const recovered = await recoverBillingProviderResource(",
  );
  const immutableReference = recover.indexOf(
    "intent.external_reference",
    immutableLookup,
  );
  const recoveredPayment = recover.indexOf(
    "const payment = recovered as AsaasPayment",
    immutableReference,
  );
  const recoveredDispatch = recover.indexOf(
    'return body.billing_type === "PIX"',
    recoveredPayment,
  );
  assert.ok(
    immutableLookup >= 0 &&
      immutableLookup < immutableReference &&
      immutableReference < recoveredPayment &&
      recoveredPayment < recoveredDispatch,
    "recovery must resolve the immutable intent reference and reuse that provider payment",
  );
  assert.doesNotMatch(recover, /method: "POST"/);
});

test("Edge handler: a refused captured card terminalizes the durable update before returning retry", () => {
  const source = readFileSync(
    new URL("../asaas-create-charge/index.ts", import.meta.url),
    "utf8",
  );
  const paymentScopeStart = source.indexOf(
    "async function paymentScopedCheckoutResponse",
  );
  const paymentScopeEnd = source.indexOf(
    "async function prepareAsaasCustomer",
    paymentScopeStart,
  );
  const paymentScope = source.slice(paymentScopeStart, paymentScopeEnd);
  const disposition = paymentScope.indexOf(
    "const paymentDisposition = asaasPaymentDisposition",
  );
  const refusedStart = paymentScope.indexOf(
    'paymentDisposition === "retryable" ||',
    disposition,
  );
  const refusedEnd = paymentScope.indexOf(
    'paymentDisposition === "assisted" || paymentDisposition === "unknown"',
    refusedStart,
  );
  assert.ok(
    disposition >= 0 && refusedStart > disposition && refusedEnd > refusedStart,
  );
  const refused = paymentScope.slice(refusedStart, refusedEnd);

  const finalizeCapture = refused.indexOf(
    "failBillingSubscriptionCardUpdateCapture({",
  );
  const failureResponse = refused.indexOf("return jsonResponse({", finalizeCapture);
  assert.ok(
    finalizeCapture >= 0 && failureResponse > finalizeCapture,
    "the exact capture-failure CAS must finish before the retry response",
  );
  assert.match(
    refused.slice(finalizeCapture, failureResponse),
    /jobId: preparedSubscriptionCardUpdate\.jobId[\s\S]*generation: preparedSubscriptionCardUpdate\.generation[\s\S]*attemptLeaseId: attempt\.lease_id[\s\S]*errorCode: paymentDisposition === "retryable"[\s\S]*\? "provider_card_refused"[\s\S]*: "provider_payment_cancelled"/,
  );
  assert.match(
    refused,
    /capture_refused[\s\S]*already_finalized[\s\S]*status === "cancelled"/,
  );
  assert.match(
    refused,
    /refusal\.outcome !== "capture_refused"[\s\S]*throw new Error\([\s\S]*catch \(error\) \{\s*releasePaymentLease = false[\s\S]*paymentReconciliationRequiredResponse\(/,
  );

  assert.match(
    refused,
    /state: paymentDisposition === "retryable" \? "retry"/,
  );
  assert.match(refused, /code: paymentDisposition === "retryable"/);
  assert.match(refused, /\? "card_not_authorized"/);
  assert.match(refused, /success: false/);
  assert.doesNotMatch(
    paymentScope,
    /`\/subscriptions\/\$\{encodeURIComponent\([^)]*\)\}\/creditCard`/,
  );
});

test("Checkout UI: polling uses payment-status as a fallback when the webhook is delayed", () => {
  const source = readFileSync(
    new URL(
      "../../../components/features/auth/screens/CheckoutScreen.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const paymentsSource = readFileSync(
    new URL("../../../lib/api/payments.ts", import.meta.url),
    "utf8",
  );
  const recoveryStart = source.indexOf(
    "// Provider status and organization activation are separate confirmations.",
  );
  const cardUpdateStart = source.indexOf(
    "if (!hasCheckoutIdentity || !directCardUpdateJobId) return;",
    recoveryStart,
  );
  assert.ok(recoveryStart >= 0 && cardUpdateStart > recoveryStart);
  const recovery = source.slice(recoveryStart, cardUpdateStart);

  const statusRead = recovery.indexOf(
    "const statusResult = await paymentsAPI.paymentStatus<",
  );
  const exactCapability = recovery.indexOf(
    "checkoutToken: token",
    statusRead,
  );
  const exactIntent = recovery.indexOf(
    "intentId: recoveryIntentId",
    exactCapability,
  );
  const exactPayment = recovery.indexOf(
    "paymentId: recoveryPaymentId",
    exactIntent,
  );
  const exactSubscription = recovery.indexOf(
    "subscriptionId: recoverySubscriptionId",
    exactPayment,
  );
  const providerState = recovery.indexOf(
    "setRecoveryState(statusResult.state)",
    exactSubscription,
  );
  const canonicalRead = recovery.indexOf(
    "const canonicalInfo = await readCheckoutInfo()",
    providerState,
  );
  assert.ok(
    statusRead >= 0 &&
      statusRead < exactCapability &&
      exactCapability < exactIntent &&
      exactIntent < exactPayment &&
      exactPayment < exactSubscription &&
      exactSubscription < providerState &&
      providerState < canonicalRead,
    "the exact payment-status capability must reconcile before the canonical checkout read",
  );
  assert.match(
    recovery,
    /const maxAttempts = recoveryMethod === "CREDIT_CARD" \? 24 : 60/,
  );
  assert.match(
    recovery,
    /if \(statusResult\.state === "settled"\)[\s\S]*setPaid\(true\)[\s\S]*window\.clearInterval\(interval\)/,
  );
  assert.match(
    recovery,
    /method === "PIX"[\s\S]*statusResult\.pix\?\.qr_code[\s\S]*statusResult\.pix\?\.qr_payload/,
  );
  assert.match(
    recovery,
    /method === "BOLETO"[\s\S]*statusResult\.boleto\?\.bank_slip_url[\s\S]*statusResult\.boleto\?\.identification_field[\s\S]*statusResult\.boleto\?\.bar_code/,
  );

  const interval = recovery.indexOf(
    "window.setInterval(() => void checkRecovery(), 5_000)",
  );
  const immediateCheck = recovery.indexOf("void checkRecovery()", interval);
  assert.ok(
    interval >= 0 && immediateCheck > interval,
    "fallback polling must run immediately and then every five seconds",
  );

  const paymentStatusStart = paymentsSource.indexOf("paymentStatus<T>(");
  const createChargeStart = paymentsSource.indexOf(
    "createCharge<T>(",
    paymentStatusStart,
  );
  assert.ok(paymentStatusStart >= 0 && createChargeStart > paymentStatusStart);
  const paymentStatus = paymentsSource.slice(
    paymentStatusStart,
    createChargeStart,
  );
  assert.match(paymentStatus, /\/v1\/public\/payments\/status/);
  assert.match(paymentStatus, /cache: "no-store"/);
});

test("Checkout UI: a recoverable intent is reconciled before another plan change is offered", () => {
  const source = readFileSync(
    new URL(
      "../../../components/features/auth/screens/CheckoutScreen.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  const hydrateStart = source.indexOf("const hydrateActiveCheckout");
  const loadStart = source.indexOf(
    "const generation = ++checkoutLoadGenerationRef.current",
    hydrateStart,
  );
  assert.ok(hydrateStart >= 0 && loadStart > hydrateStart);
  const hydrate = source.slice(hydrateStart, loadStart);
  assert.match(
    hydrate,
    /if \(!checkout\)[\s\S]*clearPaymentState\(\)[\s\S]*return/,
  );
  assert.match(
    hydrate,
    /setActiveCheckout\(checkout\)[\s\S]*setDirectPollingExpired\(false\)[\s\S]*setProcessingMethod\(checkout\.billing_method\)/,
  );

  const initialLoadEnd = source.indexOf(
    "loading || !info || !hasCheckoutIdentity || directCardUpdateJobId",
    loadStart,
  );
  assert.ok(initialLoadEnd > loadStart);
  const initialLoad = source.slice(loadStart, initialLoadEnd);
  const canonicalRead = initialLoad.indexOf("await readCheckoutInfo()");
  const generationFence = initialLoad.indexOf(
    "if (!isCurrentGeneration()) return;",
    canonicalRead,
  );
  const infoWrite = initialLoad.indexOf("setInfo(data)", generationFence);
  const activeIntentHydration = initialLoad.indexOf(
    "hydrateActiveCheckout(data.active_checkout)",
    infoWrite,
  );
  assert.ok(
    canonicalRead >= 0 &&
      canonicalRead < generationFence &&
      generationFence < infoWrite &&
      infoWrite < activeIntentHydration,
    "the canonical active intent must be hydrated before plan controls are rendered",
  );

  const planChangeStart = source.indexOf("const handlePlanChange = async");
  const planChangeEnd = source.indexOf(
    "const handleBillingDetailsContinue",
    planChangeStart,
  );
  assert.ok(planChangeStart >= 0 && planChangeEnd > planChangeStart);
  const planChange = source.slice(planChangeStart, planChangeEnd);
  const recoverableGuard = planChange.indexOf("activeCheckout ||");
  const blockedMessage = planChange.indexOf(
    "Cancele ou conclua a cobrança atual antes de trocar o plano.",
    recoverableGuard,
  );
  const planMutation = planChange.indexOf(
    "await settingsAPI.selectSubscriptionPlan(",
    blockedMessage,
  );
  const publicPlanMutation = planChange.indexOf(
    'fetch("/api/onboarding/checkout-plan"',
    blockedMessage,
  );
  assert.ok(
    recoverableGuard >= 0 &&
      recoverableGuard < blockedMessage &&
      blockedMessage < planMutation &&
      blockedMessage < publicPlanMutation,
    "an active recoverable intent must block both authenticated and public plan mutations",
  );
  assert.match(
    planChange.slice(0, blockedMessage),
    /paymentRequestInFlightRef\.current[\s\S]*pixResult[\s\S]*boletoResult[\s\S]*processingMethod[\s\S]*activeCheckout[\s\S]*awaitingCardConfirmation[\s\S]*paid/,
  );

  const controlsStart = source.indexOf("const canChangePlan =");
  const renderStart = source.indexOf("return (", controlsStart);
  assert.ok(controlsStart >= 0 && renderStart > controlsStart);
  const controls = source.slice(controlsStart, renderStart);
  assert.match(
    controls,
    /submitting[\s\S]*processingMethod[\s\S]*pixResult[\s\S]*boletoResult[\s\S]*activeCheckout[\s\S]*awaitingCardConfirmation[\s\S]*paid[\s\S]*changingPlanId/,
  );

  const planSelector = source.slice(
    source.indexOf("<DropdownMenu", renderStart),
    source.indexOf("</DropdownMenu>", renderStart),
  );
  assert.match(
    planSelector,
    /setPlanSelectorOpen\(canChangePlan \? open : false\)/,
  );
  assert.match(planSelector, /disabled=\{!canChangePlan\}/);
});
