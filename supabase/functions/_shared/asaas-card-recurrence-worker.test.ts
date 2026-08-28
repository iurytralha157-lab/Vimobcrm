import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateBillingCardRecurrenceCancellationTarget } from "./asaas-card-recurrence.ts";

const workerSource = readFileSync(
  new URL("../asaas-card-recurrence-worker/index.ts", import.meta.url),
  "utf8",
);
const recurrenceSource = readFileSync(
  new URL("./asaas-card-recurrence.ts", import.meta.url),
  "utf8",
);

test("recurrence worker is private, lease-CAS backed and enforces one global concurrent batch", () => {
  assert.match(
    workerSource,
    /authorizePrivateWorkerRequest\(request\)/,
  );
  assert.doesNotMatch(workerSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(workerSource, /bearerToken\(request\)/);
  assert.match(
    workerSource,
    /billingOrganizationIsUnavailable\(requestMarker\)[\s\S]*throw new BillingOrganizationUnavailableError/,
  );
  assert.match(
    workerSource,
    /error instanceof BillingOrganizationUnavailableError[\s\S]*return "deferred"/,
  );
  assert.match(workerSource, /const MAX_BATCH_SIZE = 5/);
  assert.match(workerSource, /const JOB_LEASE_SECONDS = 600/);
  assert.match(
    workerSource,
    /const batchSize = Math\.min\(Math\.max\(requestedBatch, 1\), MAX_BATCH_SIZE\)/,
  );

  const claimStart = workerSource.indexOf("let totalClaimed = 0");
  const taskStart = workerSource.indexOf("const outcomeTasks =", claimStart);
  const claimScope = workerSource.slice(claimStart, taskStart);
  assert.ok(claimStart >= 0 && taskStart > claimStart);
  assert.match(claimScope, /totalClaimed < batchSize/);
  assert.equal(
    (claimScope.match(/limit: 1/g) || []).length,
    4,
    "each queue contributes at most one lease per round",
  );
  assert.match(claimScope, /if \(claimedCount > 1\)/);
  assert.match(claimScope, /totalClaimed \+= claimedCount/);

  const awaitAll = workerSource.indexOf(
    "const allOutcomes = await Promise.all([",
    taskStart,
  );
  const taskScope = workerSource.slice(taskStart, awaitAll);
  assert.ok(awaitAll > taskStart);
  for (
    const taskList of [
      "outcomeTasks",
      "subscriptionCardUpdateTasks",
      "cancellationTasks",
      "paymentCancellationTasks",
    ]
  ) {
    assert.match(taskScope, new RegExp(`const ${taskList} =`));
  }
  const awaitScope = workerSource.slice(
    awaitAll,
    workerSource.indexOf("]);", awaitAll) + 3,
  );
  assert.match(
    awaitScope,
    /\.\.\.outcomeTasks,[\s\S]*\.\.\.subscriptionCardUpdateTasks,[\s\S]*\.\.\.cancellationTasks,[\s\S]*\.\.\.paymentCancellationTasks/,
  );
  assert.equal(
    (workerSource.match(/await Promise\.all\(\[/g) || []).length,
    1,
    "all claimed categories start work before the single global await",
  );
  assert.match(
    workerSource,
    /claimed: jobs\.length \+ subscriptionCardUpdateJobs\.length \+[\s\S]*cancellationJobs\.length \+[\s\S]*paymentCancellationJobs\.length/,
  );
  assert.doesNotMatch(workerSource, /await Promise\.all\(jobs\.map/);
  assert.match(recurrenceSource, /"claim_billing_card_recurrence_jobs"/);
  assert.match(recurrenceSource, /p_job_lease_id: input\.job\.job_lease_id/);
  assert.match(recurrenceSource, /"succeed_billing_card_recurrence_job"/);
  assert.match(recurrenceSource, /"fail_billing_card_recurrence_job"/);
  assert.match(
    recurrenceSource,
    /"mark_billing_card_recurrence_provider_request_started"/,
  );
});

test("create recovery performs exact GET before POST and recover-only never posts twice", () => {
  const createStart = workerSource.indexOf("async function processCreateJob(");
  const cancelStart = workerSource.indexOf("async function completeCancelJob(");
  const createScope = workerSource.slice(createStart, cancelStart);
  const lookup = createScope.indexOf("recoverBillingCardRecurrence(");
  const recoverOnly = createScope.indexOf('job.mode === "recover_only"');
  const requestMarker = createScope.indexOf(
    "markBillingCardRecurrenceProviderRequestStarted(",
  );
  const post = createScope.indexOf(
    'asaasRequest<AsaasSubscription>("/subscriptions"',
  );
  assert.ok(lookup > 0);
  assert.ok(recoverOnly > lookup);
  assert.ok(requestMarker > recoverOnly);
  assert.ok(post > requestMarker);
  assert.match(createScope, /preflight_lookup_failed/);
  assert.match(createScope, /provider_create_ambiguous/);
  assert.match(recurrenceSource, /externalReference: input\.externalReference/);
  assert.match(recurrenceSource, /customer: input\.customerId/);
});

test("sealed card credential is bound to both payment identities and secrets are absent from logs", () => {
  assert.match(workerSource, /providerPaymentId: job\.provider_payment_id/);
  assert.doesNotMatch(
    workerSource,
    /console\.(?:error|warn|log)[\s\S]{0,180}creditCardToken/,
  );
  assert.doesNotMatch(
    workerSource,
    /console\.(?:error|warn|log)[\s\S]{0,180}provider_card_credential/,
  );
  assert.doesNotMatch(
    workerSource,
    /console\.(?:error|warn|log)[\s\S]{0,180}remoteIp/,
  );
});

test("subscription-card update classifies preflight and post-marker failures by phase", () => {
  const failureStart = workerSource.indexOf(
    "function subscriptionCardUpdateFailure(",
  );
  const failureEnd = workerSource.indexOf(
    "async function failSubscriptionCardUpdate(",
    failureStart,
  );
  const failure = workerSource.slice(failureStart, failureEnd);
  assert.ok(failureStart >= 0 && failureEnd > failureStart);
  assert.match(failure, /phase: "preflight" \| "provider_put"/);

  const retryableStatuses = failure.indexOf("[401, 403, 409, 425, 429]");
  const transientStatuses = failure.indexOf("error.status === 408");
  const permanentStatuses = failure.indexOf("error.status === 400");
  assert.ok(
    retryableStatuses >= 0 && retryableStatuses < transientStatuses &&
      transientStatuses < permanentStatuses,
  );
  assert.match(
    failure.slice(retryableStatuses, transientStatuses),
    /failureClass: "retryable"/,
  );
  assert.match(
    failure.slice(transientStatuses, permanentStatuses),
    /error\.status >= 500[\s\S]*phase === "provider_put" \? "ambiguous" : "retryable"/,
  );
  assert.match(
    failure.slice(permanentStatuses),
    /error\.status === 422[\s\S]*failureClass: "permanent"/,
  );
  assert.match(
    failure.slice(failure.lastIndexOf("return {")),
    /phase === "provider_put" \? "ambiguous" : "retryable"/,
  );

  const processStart = workerSource.indexOf(
    "async function processSubscriptionCardUpdateJob(",
  );
  const processEnd = workerSource.indexOf(
    "async function processCreateJob(",
    processStart,
  );
  const process = workerSource.slice(processStart, processEnd);
  const preflightGet = process.indexOf(
    "`/subscriptions/${encodeURIComponent(job.provider_subscription_id)}`",
  );
  const marker = process.indexOf(
    "markBillingSubscriptionCardUpdateProviderRequestStarted({",
  );
  const providerPut = process.indexOf("}/creditCard`");
  const preflightCatch = process.slice(preflightGet, marker);
  const providerPutCatch = process.slice(providerPut);
  const explicitPreflight =
    /subscriptionCardUpdateFailure\(error, "preflight"\)/
      .test(preflightCatch);
  const defaultedPreflight =
    /phase: "preflight" \| "provider_put" = "preflight"/
      .test(failure) &&
    /subscriptionCardUpdateFailure\(error\)/.test(preflightCatch);
  assert.ok(
    explicitPreflight || defaultedPreflight,
    "GET timeout/network failures must use the retryable preflight phase",
  );
  assert.match(
    providerPutCatch,
    /subscriptionCardUpdateFailure\(error, "provider_put"\)/,
  );
});

test("subscription-card update marks before PUT and succeeds only after an exact 2xx snapshot", () => {
  const processStart = workerSource.indexOf(
    "async function processSubscriptionCardUpdateJob(",
  );
  const processEnd = workerSource.indexOf(
    "async function processCreateJob(",
    processStart,
  );
  const process = workerSource.slice(processStart, processEnd);
  const preflightGet = process.indexOf(
    "`/subscriptions/${encodeURIComponent(job.provider_subscription_id)}`",
  );
  const firstExact = process.indexOf(
    "subscriptionCardUpdateSnapshotIsExact(job, currentSubscription)",
    preflightGet,
  );
  const marker = process.indexOf(
    "markBillingSubscriptionCardUpdateProviderRequestStarted({",
    firstExact,
  );
  const markerFence = process.indexOf(
    'marker.outcome !== "proceed"',
    marker,
  );
  const providerPut = process.indexOf("}/creditCard`", markerFence);
  const secondExact = process.indexOf(
    "subscriptionCardUpdateSnapshotIsExact(job, updatedSubscription)",
    providerPut,
  );
  const mismatchFailure = process.indexOf(
    '"provider_subscription_update_response_mismatch"',
    secondExact,
  );
  const succeed = process.indexOf(
    "succeedBillingSubscriptionCardUpdateJob({",
    mismatchFailure,
  );
  assert.ok(
    preflightGet >= 0 && preflightGet < firstExact && firstExact < marker &&
      marker < markerFence && markerFence < providerPut &&
      providerPut < secondExact && secondExact < mismatchFailure &&
      mismatchFailure < succeed,
    "GET validation, durable marker, PUT, response validation and success CAS must stay ordered",
  );
  assert.match(
    process.slice(markerFence, providerPut),
    /marker\.outcome !== "proceed"\)[\s\S]*return;/,
  );
  assert.match(
    process.slice(providerPut, secondExact),
    /method: "PUT"[\s\S]*creditCardToken: credential\.creditCardToken[\s\S]*remoteIp: credential\.remoteIp/,
  );
  assert.match(
    process.slice(secondExact, succeed),
    /failSubscriptionCardUpdate\([\s\S]*"ambiguous"[\s\S]*provider_subscription_update_response_mismatch/,
  );

  const exactStart = workerSource.indexOf(
    "function subscriptionCardUpdateSnapshotIsExact(",
  );
  const exactEnd = workerSource.indexOf(
    "async function processSubscriptionCardUpdateJob(",
    exactStart,
  );
  const exact = workerSource.slice(exactStart, exactEnd);
  assert.match(exact, /subscription\.id === job\.provider_subscription_id/);
  assert.match(exact, /subscription\.customer === job\.provider_customer_id/);
  assert.match(
    exact,
    /subscription\.status\?\.trim\(\)\.toUpperCase\(\) === "ACTIVE"/,
  );
  assert.match(exact, /subscription\.deleted !== true/);
});

test("cancellation validates the immutable tuple and accepts 404 only after exact ownership proof", () => {
  const cancelStart = workerSource.indexOf("async function processCancelJob(");
  const processStart = workerSource.indexOf("async function processJob(");
  const cancelScope = workerSource.slice(cancelStart, processStart);
  const get = cancelScope.indexOf(
    "`/subscriptions/${encodeURIComponent(subscriptionId)}`",
  );
  const validation = cancelScope.indexOf(
    "validateBillingCardRecurrenceCancellationTarget(",
  );
  const remove = cancelScope.indexOf('{ method: "DELETE" }');
  assert.ok(get > 0);
  assert.ok(validation > get);
  assert.ok(remove > validation);
  assert.equal((cancelScope.match(/error\.status === 404/g) || []).length, 2);
  assert.match(
    cancelScope.slice(0, validation),
    /error\.status === 404[\s\S]*failJob\(job, "permanent", "provider_subscription_not_verified"\)/,
  );
  assert.doesNotMatch(
    cancelScope.slice(0, validation),
    /completeCancelJob/,
    "a preflight 404 cannot prove that the subscription was removed",
  );
  assert.match(
    cancelScope.slice(validation),
    /method: "DELETE"[\s\S]*error\.status === 404[\s\S]*completeCancelJob\(job, "already_absent"\)/,
    "DELETE 404 is idempotent only after the exact GET matched the frozen tuple",
  );

  const exact = validateBillingCardRecurrenceCancellationTarget({
    subscription: {
      id: "sub_1",
      status: "ACTIVE",
      customer: "cus_1",
      billingType: "CREDIT_CARD",
      cycle: "MONTHLY",
      value: 297,
      nextDueDate: "2026-09-04",
      externalReference: "vimob-card:pay_1",
    },
    subscriptionId: "sub_1",
    externalReference: "vimob-card:pay_1",
    customerId: "cus_1",
    amount: 297,
    billingPeriodMonths: 1,
    nextDueDate: "2026-09-04",
  });
  assert.equal(exact.outcome, "active");

  const conflict = validateBillingCardRecurrenceCancellationTarget({
    subscription: {
      id: "sub_1",
      status: "ACTIVE",
      customer: "cus_other",
      billingType: "CREDIT_CARD",
      cycle: "MONTHLY",
      value: 297,
      nextDueDate: "2026-09-04",
      externalReference: "vimob-card:pay_1",
    },
    subscriptionId: "sub_1",
    externalReference: "vimob-card:pay_1",
    customerId: "cus_1",
    amount: 297,
    billingPeriodMonths: 1,
    nextDueDate: "2026-09-04",
  });
  assert.equal(conflict.outcome, "conflict");
});
