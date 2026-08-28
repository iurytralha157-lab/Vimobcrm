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
const sharedSource = readFileSync(
  new URL("./asaas.ts", import.meta.url),
  "utf8",
);

function sourceScope(source: string, startMarker: string, endMarker: string) {
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

test("one-off handler reconciles, claims and re-reads before provider DELETE", () => {
  const branch = sourceScope(
    handlerSource,
    "} else if (paymentId) {",
    "} else if (!providerlessLookupCompleted) {",
  );
  assertOrdered(branch, [
    'source: "edge_payment_cancellation_preflight"',
    "const claim = await claimBillingPaymentCheckoutCancellation({",
    "claim.payment_id !== paymentId",
    "claimedPayment = await asaasRequest<AsaasPayment>(",
    'source: "edge_payment_cancellation_claimed_preflight"',
    "if (!providerAlreadyTerminal) {",
    "markBillingPaymentCheckoutCancellationDeleteStarted(",
    'method: "DELETE"',
  ]);
  assert.match(
    branch,
    /claim\.payment_id !== paymentId[\s\S]*claim\.customer_id !== expectedCustomerId[\s\S]*claim\.external_reference !== checkout\.external_reference[\s\S]*claim\.billing_type !== billingType[\s\S]*claim\.due_date !== expectedDueDate/,
  );
  assert.match(
    branch,
    /"claimed", "already_claimed", "recover_only"/,
  );
  assert.match(
    branch,
    /source: "edge_payment_cancellation_preflight"[\s\S]*reconciliation\.outcome !== "applied"/,
  );
  assert.doesNotMatch(
    branch,
    /\["applied", "stale_snapshot"\]\.includes\(reconciliation\.outcome\)/,
  );
  assert.match(
    branch,
    /let paymentIdentityVerified = false[\s\S]*paymentIdentityVerified = true[\s\S]*if \(!paymentIdentityVerified\)[\s\S]*provider_payment_not_verified/,
    "two bare 404 observations must fail closed without exact payment identity proof",
  );
  assert.doesNotMatch(branch, /cancelBillingCheckoutResource\(/);
});

test("one-off handler never deletes a paid post-claim observation", () => {
  const branch = sourceScope(
    handlerSource,
    "} else if (paymentId) {",
    "} else if (!providerlessLookupCompleted) {",
  );
  const paid = branch.indexOf('if (reconciliation.action === "settled")');
  const paidFinalize = branch.indexOf(
    'providerDeleteResult: "paid"',
    paid,
  );
  const remove = branch.indexOf('method: "DELETE"', paid);
  assert.ok(paid >= 0 && paid < paidFinalize && paidFinalize < remove);
  assert.match(
    branch.slice(paid, remove),
    /finalizeBillingPaymentCheckoutCancellation\([\s\S]*providerDeleteResult: "paid"[\s\S]*return paidDuringCancellationResponse\(\)/,
  );
});

test("one-off DELETE requires exact acknowledgement and terminal GET before finalization", () => {
  const branch = sourceScope(
    handlerSource,
    "} else if (paymentId) {",
    "} else if (!providerlessLookupCompleted) {",
  );
  assertOrdered(branch, [
    "markBillingPaymentCheckoutCancellationDeleteStarted(",
    'method: "DELETE"',
    "deletion.id !== paymentId || deletion.deleted !== true",
    "postDeletePayment = await asaasRequest<AsaasPayment>(",
    'source: "edge_payment_cancellation_post_delete"',
    'if (reconciliation.action !== "cancelled")',
    "const finalization = await finalizeBillingPaymentCheckoutCancellation({",
  ]);
});

test("worker claims durable one-off cancellations and validates the frozen tuple", () => {
  const serve = workerSource.slice(
    workerSource.indexOf("Deno.serve(async (request) =>"),
  );
  assertOrdered(serve, [
    "claimBillingPaymentCheckoutCancellationJobs({",
    "paymentCancellationJobs.push(...claimed)",
    "const paymentCancellationTasks = paymentCancellationJobs.map(",
    "await processPaymentCancellationJob(job)",
  ]);

  const observation = sourceScope(
    workerSource,
    "async function paymentCancellationObservation(",
    "async function finalizePaymentCancellationJob(",
  );
  assertOrdered(observation, [
    "payment = await asaasRequest<AsaasPayment>(",
    "asaasCheckoutPaymentIntegrity({",
    "reconcileAsaasPaymentSnapshot({",
  ]);
  assert.match(
    observation,
    /expectedPaymentId: job\.provider_payment_id[\s\S]*expectedCustomerId: job\.provider_customer_id[\s\S]*expectedSubscriptionId: null[\s\S]*expectedBillingType: job\.billing_type[\s\S]*expectedAmount: Number\(job\.amount\)[\s\S]*expectedDueDate: job\.due_date[\s\S]*expectedExternalReference: job\.external_reference/,
  );
  assert.match(observation, /if \(outcome !== "applied"\)/);
  assert.match(observation, /billingPaymentCancellationAction\(\{/);
  assert.match(observation, /action === "cancelled"/);
  assert.match(
    observation,
    /allowNotFoundAfterVerifiedMutation[\s\S]*"missing" as const[\s\S]*"unverified_missing" as const/,
    "worker GET 404 must remain ambiguous before a verified mutation",
  );
  assert.match(handlerSource, /billingPaymentCancellationAction\(\{/);
});

test("worker observes paid before DELETE and verifies deletion after mutation", () => {
  const process = sourceScope(
    workerSource,
    "async function processPaymentCancellationJob(",
    "Deno.serve(async (request) =>",
  );
  assertOrdered(process, [
    "const preflight = await paymentCancellationObservation(",
    'if (preflight.state === "paid")',
    'result: "paid"',
    "markBillingPaymentCheckoutCancellationDeleteStarted(",
    'method: "DELETE"',
    "deletion.id !== job.provider_payment_id || deletion.deleted !== true",
    "const postDelete = await paymentCancellationObservation(",
    "await finalizePaymentCancellationJob({",
  ]);
  assert.match(
    process,
    /preflight\.state === "deleted"[\s\S]*job\.claim_outcome === "recover_only" \? "deleted" : "not_found"/,
  );
  assert.match(
    process,
    /preflight\.state === "unverified_missing"[\s\S]*provider_payment_not_verified[\s\S]*preflight\.state === "paid"/,
    "a preflight 404 must enter manual failure before any local finalization",
  );
  assert.doesNotMatch(
    process.slice(0, process.indexOf('if (preflight.state === "paid")')),
    /finalizePaymentCancellationJob/,
    "no preflight 404 branch may finalize cancellation",
  );
  assert.match(
    process,
    /edge_payment_cancellation_worker_post_delete[\s\S]*allowNotFoundAfterVerifiedMutation: true/,
    "post-mutation 404 may be accepted only after the exact preflight and DELETE",
  );
});

test("one-off failures are fenced into bounded retry or terminal manual review", () => {
  assert.match(
    sharedSource,
    /export async function failBillingPaymentCheckoutCancellation\([\s\S]*"fail_billing_payment_checkout_cancellation"[\s\S]*p_claim_token: input\.claimToken[\s\S]*p_failure_class: input\.failureClass[\s\S]*p_error_code: input\.errorCode/,
  );
  assert.match(
    sharedSource,
    /export async function markBillingPaymentCheckoutCancellationDeleteStarted\([\s\S]*"mark_billing_payment_checkout_cancellation_delete_started"[\s\S]*p_claim_token: input\.claimToken[\s\S]*p_provider_payment_id: input\.providerPaymentId/,
  );

  const handlerCatch = handlerSource.slice(
    handlerSource.lastIndexOf("} catch (error) {"),
  );
  assert.match(
    handlerCatch,
    /failBillingPaymentCheckoutCancellation\(\{[\s\S]*failureClass: failure\.failureClass[\s\S]*errorCode: failure\.errorCode/,
  );
  assert.match(
    handlerSource,
    /claim\.final_outcome === "manual_review"[\s\S]*paymentCancellationManualReviewResponse\(\)/,
  );

  const workerServe = workerSource.slice(
    workerSource.indexOf("const paymentCancellationTasks"),
  );
  assert.match(
    workerServe,
    /failBillingPaymentCheckoutCancellation\(\{[\s\S]*claimToken: job\.claim_token[\s\S]*failureClass: failure\.failureClass[\s\S]*errorCode: failure\.errorCode/,
  );
  assert.match(
    workerServe,
    /finalOutcome === "manual_review"[\s\S]*"manual_review" as const/,
  );
  assert.match(
    workerServe,
    /const result = await processPaymentCancellationJob\(job\)[\s\S]*result === "deferred"[\s\S]*catch \(error\)[\s\S]*failBillingPaymentCheckoutCancellation/,
    "a processing payment must be deferred before the worker failure path",
  );
  const handlerPaymentBranch = sourceScope(
    handlerSource,
    "} else if (paymentId) {",
    "} else if (!providerlessLookupCompleted) {",
  );
  assert.match(
    handlerPaymentBranch,
    /deleteStart\.outcome === "busy"[\s\S]*cancellationBusyResponse\([\s\S]*deleteStart\.outcome === "already_cancelled"/,
    "busy and already-cancelled marker outcomes must return before failure handling",
  );
  for (const source of [handlerSource, workerSource]) {
    assert.match(
      source,
      /deleteStart\.outcome === "already_started"[\s\S]*provider_payment_delete_outcome_unknown/,
      "an ambiguous prior DELETE must be recover-only",
    );
    assert.match(
      source,
      /deleteStart\.outcome !== "proceed"[\s\S]*provider_payment_delete_fence_lost/,
      "only an exact live CAS may authorize provider DELETE",
    );
  }
  for (const source of [handlerSource, workerSource]) {
    assert.match(
      source,
      /error\.status === 401 \|\| error\.status === 403[\s\S]*failureClass: "retryable"[\s\S]*errorCode: "provider_auth_unavailable"/,
      "provider credential outages must use bounded retry, not first-attempt manual review",
    );
  }
});
