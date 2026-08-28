import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const handlerSource = readFileSync(
  new URL("../asaas-cancel-payment/index.ts", import.meta.url),
  "utf8",
);
const workerSource = readFileSync(
  new URL("../asaas-card-recurrence-worker/index.ts", import.meta.url),
  "utf8",
);

function sourceScope(
  source: string,
  startMarker: string,
  endMarker: string,
) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(
    end > start,
    `missing end marker after ${startMarker}: ${endMarker}`,
  );
  return source.slice(start, end);
}

function assertOrdered(scope: string, markers: string[]) {
  let previous = -1;
  for (const marker of markers) {
    const current = scope.indexOf(marker, previous + 1);
    assert.ok(
      current > previous,
      `marker is missing or out of order: ${marker}`,
    );
    previous = current;
  }
}

test("synchronous subscription cancellation validates the provider tuple and claims before DELETE", () => {
  const branch = sourceScope(
    handlerSource,
    'if (checkout.billing_method === "CREDIT_CARD" && subscriptionId) {',
    "} else if (paymentId) {",
  );

  assertOrdered(branch, [
    "const subscription = await asaasRequest<AsaasSubscription>(",
    "validateBillingCardRecurrenceCancellationTarget({",
    "const claim = await claimBillingSubscriptionCheckoutCancellation({",
    "claim.subscription_id !== subscriptionId",
    "alreadyMissing = await deleteProviderResource(",
  ]);
  assert.match(
    branch,
    /validateBillingCardRecurrenceCancellationTarget\(\{[\s\S]*subscriptionId,[\s\S]*externalReference: checkout\.external_reference,[\s\S]*customerId: expectedCustomerId,[\s\S]*amount: checkout\.amount,[\s\S]*billingPeriodMonths: checkout\.billing_period_months/,
  );
  assert.match(
    branch,
    /claim\.subscription_id !== subscriptionId[\s\S]*claim\.payment_id !== paymentId[\s\S]*cancellationCustomerId !== expectedCustomerId[\s\S]*cancellationExternalReference !== checkout\.external_reference[\s\S]*cancellationAmount - checkout\.amount[\s\S]*cancellationPeriod !== checkout\.billing_period_months/,
  );
  assert.match(
    branch,
    /error\.status !== 404[\s\S]*provider_subscription_not_verified[\s\S]*const claim = await claimBillingSubscriptionCheckoutCancellation/,
    "a preflight 404 must fail closed before creating a deletion claim",
  );
  assert.match(
    branch,
    /activeSubscriptionCancellationClaim = \{[\s\S]*organizationId: checkout\.organization_id,[\s\S]*intentId: checkout\.intent_id,[\s\S]*claimToken: claim\.claim_token,[\s\S]*subscriptionId/,
    "a claimed direct cancellation must be available to the bounded failure path",
  );
  assert.match(
    handlerSource,
    /if \(activeSubscriptionCancellationClaim\)[\s\S]*paymentCancellationFailure\(error\)[\s\S]*failBillingSubscriptionCheckoutCancellation\(\{[\s\S]*claimToken: activeSubscriptionCancellationClaim\.claimToken[\s\S]*finalOutcome === "manual_review"[\s\S]*subscriptionCancellationManualReviewResponse/,
    "direct subscription failures must be fenced instead of waiting for lease expiry",
  );
  assert.match(
    branch,
    /claim\.outcome === "manual_review"[\s\S]*subscriptionCancellationManualReviewResponse[\s\S]*claim\.final_outcome === "paid_without_recurrence"[\s\S]*claim\.final_outcome === "manual_review"[\s\S]*subscriptionCancellationManualReviewResponse/,
    "manual-review replay must never be presented as a successful cancellation",
  );

  const deleteHelper = sourceScope(
    handlerSource,
    "async function deleteProviderResource(",
    "Deno.serve(async (request) =>",
  );
  assertOrdered(deleteHelper, [
    "if (!input.exactIdentityVerified)",
    'asaasRequest<AsaasDeleteResponse>(path, { method: "DELETE" })',
    "error.status !== 404",
    "return true",
  ]);
});

test("synchronous subscription cancellation re-reads provider and payment before exact finalization", () => {
  const branch = sourceScope(
    handlerSource,
    'if (checkout.billing_method === "CREDIT_CARD" && subscriptionId) {',
    "} else if (paymentId) {",
  );

  assertOrdered(branch, [
    "alreadyMissing = await deleteProviderResource(",
    "const deletedSubscription = await asaasRequest<AsaasSubscription>(",
    "validateBillingCardRecurrenceCancellationTarget({",
    "postDeletePayment = await asaasRequest<AsaasPayment>(",
    "const reconciliation = await reconcileSubscriptionCancellationPayment(",
    "await finalizeBillingSubscriptionCheckoutCancellation({",
  ]);
  assert.match(
    branch,
    /const deletedSubscription = await asaasRequest<AsaasSubscription>[\s\S]*error instanceof AsaasRequestError[\s\S]*error\.status !== 404[\s\S]*alreadyMissing = true/,
  );
  assert.doesNotMatch(branch, /cancelBillingCheckoutResource\(/);

  const reconcileHelper = sourceScope(
    handlerSource,
    "async function reconcileSubscriptionCancellationPayment(input:",
    "async function deleteProviderResource(",
  );
  assertOrdered(reconcileHelper, [
    "checkoutPaymentIntegrity({",
    "reconcileAsaasPaymentSnapshot({",
  ]);
});

test("worker consumes claimed subscription cancellation jobs before processing them", () => {
  const serveScope = workerSource.slice(
    workerSource.indexOf("Deno.serve(async (request) =>"),
  );
  assertOrdered(serveScope, [
    "const queues: WorkerQueue[]",
    "totalClaimed < batchSize",
    "claimBillingSubscriptionCheckoutCancellationJobs(",
    "cancellationJobs.push(...claimed)",
    "const cancellationTasks = cancellationJobs.map(",
    "await processCheckoutCancellationJob(job)",
    "const allOutcomes = await Promise.all([",
    "...cancellationTasks",
  ]);
  assert.match(
    serveScope,
    /claimBillingSubscriptionCheckoutCancellationJobs[\s\S]*workerId,[\s\S]*limit: 1,[\s\S]*leaseSeconds: CANCELLATION_LEASE_SECONDS/,
  );
  assert.match(
    serveScope,
    /await processCheckoutCancellationJob\(job\)[\s\S]*paymentCancellationFailure\(error\)[\s\S]*failBillingSubscriptionCheckoutCancellation\(\{[\s\S]*organizationId: job\.organization_id,[\s\S]*intentId: job\.intent_id,[\s\S]*claimToken: job\.claim_token,[\s\S]*failureClass: failure\.failureClass,[\s\S]*errorCode: failure\.errorCode/,
    "subscription checkout failures must leave the lease through the bounded failure RPC",
  );
  assert.match(
    serveScope,
    /finalOutcome === "manual_review"[\s\S]*"manual_review" as const[\s\S]*"failed" as const/,
    "terminal subscription failures must be surfaced as manual review",
  );
});

test("worker performs GET and tuple validation, DELETE, terminal GET, payment reconciliation and finalize in order", () => {
  const subscriptionState = sourceScope(
    workerSource,
    "async function checkoutCancellationSubscriptionState(",
    "async function reconcileCheckoutCancellationPayment(",
  );
  assertOrdered(subscriptionState, [
    "const subscription = await asaasRequest<AsaasSubscription>(",
    "validateBillingCardRecurrenceCancellationTarget({",
  ]);
  assert.match(
    subscriptionState,
    /validateBillingCardRecurrenceCancellationTarget\(\{[\s\S]*subscriptionId: job\.provider_subscription_id,[\s\S]*externalReference: job\.external_reference,[\s\S]*customerId: job\.provider_customer_id[\s\S]*amount: Number\(job\.amount\)[\s\S]*billingPeriodMonths: job\.billing_period_months/,
  );
  assert.match(
    subscriptionState,
    /error instanceof AsaasRequestError && error\.status === 404[\s\S]*allowNotFoundAfterVerifiedMutation[\s\S]*"absent"[\s\S]*"unverified_missing"/,
    "a subscription 404 is terminal only after a verified mutation",
  );

  const paymentReconciliation = sourceScope(
    workerSource,
    "async function reconcileCheckoutCancellationPayment(",
    "async function processCheckoutCancellationJob(",
  );
  assertOrdered(paymentReconciliation, [
    "payment = await asaasRequest<AsaasPayment>(",
    "asaasCheckoutPaymentIntegrity({",
    "reconcileAsaasPaymentSnapshot({",
  ]);

  const process = sourceScope(
    workerSource,
    "async function processCheckoutCancellationJob(",
    "Deno.serve(async (request) =>",
  );
  const preflight = process.indexOf(
    "const preflightState = await checkoutCancellationSubscriptionState(job)",
  );
  const remove = process.indexOf('{ method: "DELETE" }', preflight);
  const terminalGet = process.indexOf(
    "await checkoutCancellationSubscriptionState(job,",
    remove,
  );
  const payment = process.indexOf(
    "await reconcileCheckoutCancellationPayment(job)",
    terminalGet,
  );
  const finalize = process.indexOf(
    "await finalizeBillingSubscriptionCheckoutCancellation({",
    payment,
  );
  assert.ok(
    preflight >= 0 && preflight < remove && remove < terminalGet &&
      terminalGet < payment && payment < finalize,
  );
  assert.match(
    process.slice(remove, payment),
    /error instanceof AsaasRequestError && error\.status === 404[\s\S]*deleteReturnedNotFound = true/,
  );
  assert.match(
    process.slice(remove, payment),
    /deleteReturnedNotFound = true[\s\S]*const postDeleteState = deleteReturnedNotFound[\s\S]*checkoutCancellationSubscriptionState\(job,[\s\S]*allowNotFoundAfterVerifiedMutation: true[\s\S]*postDeleteState !== "absent"/,
  );
  assert.match(
    process.slice(preflight, remove),
    /preflightState === "unverified_missing"[\s\S]*provider_subscription_not_verified[\s\S]*preflightState === "active"/,
    "the checkout worker must stop before DELETE on an unverified 404",
  );

  const recurrenceCancel = sourceScope(
    workerSource,
    "async function processCancelJob(",
    "async function processJob(",
  );
  assert.match(
    recurrenceCancel,
    /error\.status === 404[\s\S]*failJob\(job, "permanent", "provider_subscription_not_verified"\)[\s\S]*return/,
    "the recurrence cancellation worker must not complete from a preflight 404",
  );
});
