import {
  type AsaasPayment,
  asaasRequest,
  AsaasRequestError,
  type AsaasSubscription,
  type BillingPaymentCancellationJob,
  type BillingSubscriptionCancellationJob,
  claimBillingPaymentCheckoutCancellationJobs,
  claimBillingSubscriptionCheckoutCancellationJobs,
  failBillingPaymentCheckoutCancellation,
  failBillingSubscriptionCheckoutCancellation,
  finalizeBillingPaymentCheckoutCancellation,
  finalizeBillingSubscriptionCheckoutCancellation,
  jsonResponse,
  markBillingPaymentCheckoutCancellationDeleteStarted,
  reconcileAsaasPaymentSnapshot,
} from "../_shared/asaas.ts";
import {
  asaasCheckoutPaymentIntegrity,
  asaasSubscriptionCycle,
  billingPaymentCancellationAction,
  providerFailureIsDeterministic,
} from "../_shared/asaas-billing-intent.ts";
import {
  type BillingCardRecurrenceJob,
  claimBillingCardRecurrenceJobs,
  failBillingCardRecurrenceJob,
  markBillingCardRecurrenceProviderRequestStarted,
  recoverBillingCardRecurrence,
  succeedBillingCardRecurrenceJob,
  validateBillingCardRecurrenceCancellationTarget,
  validateBillingCardRecurrenceCandidates,
} from "../_shared/asaas-card-recurrence.ts";
import {
  openBillingCardCredential,
  openBillingSubscriptionCardCredential,
} from "../_shared/asaas-card-credential.ts";
import {
  type BillingSubscriptionCardUpdateFailureClass,
  type BillingSubscriptionCardUpdateJob,
  claimBillingSubscriptionCardUpdateJobs,
  failBillingSubscriptionCardUpdateJob,
  markBillingSubscriptionCardUpdateProviderRequestStarted,
  succeedBillingSubscriptionCardUpdateJob,
} from "../_shared/asaas-subscription-card-update.ts";
import { authorizePrivateWorkerRequest } from "../_shared/private-worker-auth.ts";
import { billingOrganizationIsUnavailable } from "../_shared/billing-organization-state.ts";

// A job can require two provider calls and each call has a 75-second timeout.
// The small batch starts concurrently, so no claimed item waits behind another
// item before its first provider request. The ten-minute lease leaves ample
// headroom for both provider calls and the final lease-CAS RPC.
const MAX_BATCH_SIZE = 5;
const JOB_LEASE_SECONDS = 600;
// A cancellation can require four sequential provider observations at the
// 75-second request deadline. Match the database's ten-minute fencing window
// so a slow but healthy run keeps ownership through final reconciliation.
const CANCELLATION_LEASE_SECONDS = 600;

type AsaasDeleteResponse = {
  id?: string;
  deleted?: boolean;
};

class PaymentCancellationProcessingError extends Error {
  constructor(
    readonly failureClass: "retryable" | "permanent",
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = "PaymentCancellationProcessingError";
  }
}

class BillingOrganizationUnavailableError extends Error {
  constructor() {
    super("Billing organization is inactive or being cleaned up.");
    this.name = "BillingOrganizationUnavailableError";
  }
}

function paymentCancellationFailure(error: unknown) {
  if (error instanceof PaymentCancellationProcessingError) {
    return {
      failureClass: error.failureClass,
      errorCode: error.errorCode,
    } as const;
  }
  // A bad/rotated platform credential is an infrastructure outage. It must
  // redrive with the existing bounded attempt budget, not push every tenant
  // payment to manual review on the first 401/403.
  if (
    error instanceof AsaasRequestError &&
    (error.status === 401 || error.status === 403)
  ) {
    return {
      failureClass: "retryable",
      errorCode: "provider_auth_unavailable",
    } as const;
  }
  if (
    error instanceof AsaasRequestError &&
    providerFailureIsDeterministic(error.status)
  ) {
    return {
      failureClass: "permanent",
      errorCode: "provider_cancellation_request_rejected",
    } as const;
  }
  return {
    failureClass: "retryable",
    errorCode: "provider_cancellation_request_ambiguous",
  } as const;
}

function retryAfterSeconds(attempts: number) {
  const exponent = Math.min(Math.max(attempts - 1, 0), 7);
  return Math.min(3600, 30 * 2 ** exponent);
}

function subscriptionCardUpdateFailure(
  error: unknown,
  phase: "preflight" | "provider_put" = "preflight",
): {
  failureClass: BillingSubscriptionCardUpdateFailureClass;
  errorCode: string;
} {
  if (error instanceof AsaasRequestError) {
    if (error.status === 404) {
      return {
        failureClass: "not_found",
        errorCode: "provider_subscription_not_found",
      };
    }
    if ([401, 403, 409, 425, 429].includes(error.status)) {
      return {
        failureClass: "retryable",
        errorCode: error.status === 401 || error.status === 403
          ? "provider_auth_unavailable"
          : "provider_subscription_update_unavailable",
      };
    }
    if (error.status === 408 || error.status >= 500) {
      return {
        // After the PUT marker, a timeout/5xx cannot prove that Asaas did not
        // apply the token. Persist the ambiguity so a later deterministic
        // rejection cannot falsely downgrade the job to a clean failure.
        failureClass: phase === "provider_put" ? "ambiguous" : "retryable",
        errorCode: "provider_subscription_update_ambiguous",
      };
    }
    if (error.status === 400 || error.status === 422) {
      return {
        failureClass: "permanent",
        errorCode: "provider_subscription_card_rejected",
      };
    }
    return {
      failureClass: "ambiguous",
      errorCode: "provider_subscription_update_unclassified",
    };
  }
  return {
    failureClass: phase === "provider_put" ? "ambiguous" : "retryable",
    errorCode: "provider_subscription_update_ambiguous",
  };
}

async function failSubscriptionCardUpdate(
  job: BillingSubscriptionCardUpdateJob,
  failureClass: BillingSubscriptionCardUpdateFailureClass,
  errorCode: string,
) {
  const result = await failBillingSubscriptionCardUpdateJob({
    job,
    failureClass,
    errorCode,
    retryAfterSeconds: retryAfterSeconds(job.attempts),
  });
  if (
    ![
      "retry",
      "cancelled",
      "failed",
      "manual_review",
      "already_finalized",
      "lost_claim",
    ].includes(result.outcome)
  ) {
    throw new Error(
      `unexpected subscription card update failure outcome: ${result.outcome}`,
    );
  }
  return result;
}

function subscriptionCardUpdateSnapshotIsExact(
  job: BillingSubscriptionCardUpdateJob,
  subscription: AsaasSubscription | null,
): subscription is AsaasSubscription {
  return Boolean(
    subscription &&
      subscription.id === job.provider_subscription_id &&
      subscription.customer === job.provider_customer_id &&
      subscription.status?.trim().toUpperCase() === "ACTIVE" &&
      subscription.deleted !== true,
  );
}

async function processSubscriptionCardUpdateJob(
  job: BillingSubscriptionCardUpdateJob,
) {
  if (
    !job.job_id || !job.organization_id || !job.subscription_row_id ||
    !job.provider_subscription_id || !job.provider_customer_id ||
    !job.provider_card_credential || !job.job_lease_id ||
    !Number.isInteger(job.generation) || job.generation < 1 ||
    !["settled_payment", "saved_only"].includes(job.mode)
  ) {
    await failSubscriptionCardUpdate(
      job,
      "permanent",
      "subscription_card_update_job_invalid",
    );
    return;
  }

  let credential: Awaited<
    ReturnType<typeof openBillingSubscriptionCardCredential>
  >;
  try {
    credential = await openBillingSubscriptionCardCredential({
      jobId: job.job_id,
      providerSubscriptionId: job.provider_subscription_id,
      ciphertext: job.provider_card_credential,
    });
  } catch {
    await failSubscriptionCardUpdate(
      job,
      "permanent",
      "sealed_subscription_card_credential_invalid",
    );
    return;
  }

  let currentSubscription: AsaasSubscription;
  try {
    currentSubscription = await asaasRequest<AsaasSubscription>(
      `/subscriptions/${encodeURIComponent(job.provider_subscription_id)}`,
    );
  } catch (error) {
    const failure = subscriptionCardUpdateFailure(error);
    await failSubscriptionCardUpdate(
      job,
      failure.failureClass,
      failure.errorCode,
    );
    return;
  }
  if (!subscriptionCardUpdateSnapshotIsExact(job, currentSubscription)) {
    await failSubscriptionCardUpdate(
      job,
      "permanent",
      "provider_subscription_update_target_mismatch",
    );
    return;
  }

  const marker = await markBillingSubscriptionCardUpdateProviderRequestStarted({
    job,
  });
  if (billingOrganizationIsUnavailable(marker)) {
    throw new BillingOrganizationUnavailableError();
  }
  if (marker.outcome !== "proceed") {
    // `already_started` can mean another invocation still owns the exact same
    // lease. Never issue a concurrent PUT. A later lease may replay the same
    // sealed token after the durable fence authorizes it.
    if (
      ![
        "already_started",
        "already_succeeded",
        "already_finalized",
        "cancelled",
        "manual_review",
        "lost_claim",
      ].includes(marker.outcome)
    ) {
      throw new Error(
        `unexpected subscription card update marker: ${marker.outcome}`,
      );
    }
    return;
  }

  let updatedSubscription: AsaasSubscription | null;
  try {
    updatedSubscription = await asaasRequest<AsaasSubscription | null>(
      `/subscriptions/${
        encodeURIComponent(job.provider_subscription_id)
      }/creditCard`,
      {
        method: "PUT",
        body: JSON.stringify({
          creditCardToken: credential.creditCardToken,
          remoteIp: credential.remoteIp,
        }),
      },
    );
  } catch (error) {
    const failure = subscriptionCardUpdateFailure(error, "provider_put");
    await failSubscriptionCardUpdate(
      job,
      failure.failureClass,
      failure.errorCode,
    );
    return;
  }

  // Never infer provider success merely from a 2xx. The acknowledgement must
  // bind to the exact active subscription/customer frozen in the job.
  if (!subscriptionCardUpdateSnapshotIsExact(job, updatedSubscription)) {
    await failSubscriptionCardUpdate(
      job,
      "ambiguous",
      "provider_subscription_update_response_mismatch",
    );
    return;
  }

  const completion = await succeedBillingSubscriptionCardUpdateJob({
    job,
    providerSnapshot: {
      id: updatedSubscription.id,
      customer: updatedSubscription.customer,
      status: updatedSubscription.status,
      billingType: updatedSubscription.billingType,
      observed_at: new Date().toISOString(),
    },
  });
  if (
    ![
      "succeeded",
      "already_succeeded",
      "manual_review",
    ].includes(completion.outcome)
  ) {
    throw new Error(
      `unexpected subscription card update completion: ${completion.outcome}`,
    );
  }
}

async function failJob(
  job: BillingCardRecurrenceJob,
  failureClass: "deterministic" | "ambiguous" | "permanent",
  errorCode: string,
) {
  return await failBillingCardRecurrenceJob({
    job,
    failureClass,
    errorCode,
    retryAfterSeconds: retryAfterSeconds(job.attempts),
  });
}

function recurrenceClaim(job: BillingCardRecurrenceJob) {
  return {
    outcome: "claimed",
    payment_id: job.payment_id,
    lease_id: job.job_lease_id,
    external_reference: job.external_reference,
    customer_id: job.customer_id,
    amount: job.amount,
    billing_period_months: job.billing_period_months,
    next_due_date: job.next_due_date,
    provider_subscription_id: job.provider_subscription_id,
    provider_card_credential: job.provider_card_credential,
    card_last4: job.card_last4,
  } as const;
}

async function completeCreateJob(
  job: BillingCardRecurrenceJob,
  subscription: AsaasSubscription,
) {
  const completion = await succeedBillingCardRecurrenceJob({
    job,
    providerResult: { ...subscription },
  });
  if (
    ![
      "succeeded",
      "already_succeeded",
      "completed",
      "already_completed",
    ].includes(completion.outcome)
  ) {
    throw new Error(`unexpected create completion: ${completion.outcome}`);
  }
}

async function processCreateJob(job: BillingCardRecurrenceJob) {
  let recovery;
  try {
    recovery = await recoverBillingCardRecurrence(recurrenceClaim(job));
  } catch {
    await failJob(job, "deterministic", "preflight_lookup_failed");
    return;
  }
  if (recovery.outcome === "conflict") {
    await failJob(job, "permanent", "provider_subscription_conflict");
    return;
  }
  if (recovery.outcome === "found") {
    await completeCreateJob(job, recovery.subscription);
    return;
  }
  if (job.mode === "recover_only") {
    await failJob(job, "ambiguous", "provider_create_not_visible");
    return;
  }
  if (!job.provider_card_credential) {
    await failJob(job, "permanent", "sealed_credential_missing");
    return;
  }

  let credential: Awaited<ReturnType<typeof openBillingCardCredential>>;
  try {
    credential = await openBillingCardCredential({
      paymentId: job.payment_id,
      providerPaymentId: job.provider_payment_id,
      ciphertext: job.provider_card_credential,
    });
  } catch {
    await failJob(job, "permanent", "sealed_credential_invalid");
    return;
  }

  let subscription: AsaasSubscription;
  const requestMarker = await markBillingCardRecurrenceProviderRequestStarted({
    job,
  });
  if (billingOrganizationIsUnavailable(requestMarker)) {
    throw new BillingOrganizationUnavailableError();
  }
  if (requestMarker.outcome !== "started") {
    // Never POST after losing the lease or when a previous request may already
    // have started. The next claim will recover by exact externalReference.
    if (requestMarker.outcome === "already_started") {
      await failJob(job, "ambiguous", "provider_create_already_started");
    }
    return;
  }
  try {
    subscription = await asaasRequest<AsaasSubscription>("/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        customer: job.customer_id,
        billingType: "CREDIT_CARD",
        value: job.amount,
        nextDueDate: job.next_due_date,
        cycle: asaasSubscriptionCycle(job.billing_period_months),
        description: "Vimob - Assinatura",
        externalReference: job.external_reference,
        creditCardToken: credential.creditCardToken,
        remoteIp: credential.remoteIp,
      }),
    });
  } catch (error) {
    if (
      error instanceof AsaasRequestError &&
      providerFailureIsDeterministic(error.status)
    ) {
      await failJob(job, "permanent", "provider_create_rejected");
      return;
    }
    await failJob(job, "ambiguous", "provider_create_ambiguous");
    return;
  }

  const validation = validateBillingCardRecurrenceCandidates({
    subscriptions: [subscription],
    externalReference: job.external_reference,
    customerId: job.customer_id,
    amount: job.amount,
    billingPeriodMonths: job.billing_period_months,
    nextDueDate: job.next_due_date,
  });
  if (validation.outcome !== "found") {
    await failJob(job, "ambiguous", "provider_create_response_mismatch");
    return;
  }
  await completeCreateJob(job, validation.subscription);
}

async function completeCancelJob(
  job: BillingCardRecurrenceJob,
  outcome: "deleted" | "already_absent",
) {
  const completion = await succeedBillingCardRecurrenceJob({
    job,
    providerResult: {
      subscription_id: job.provider_subscription_id,
      outcome,
    },
  });
  if (
    !["succeeded", "already_succeeded", "cancelled"].includes(
      completion.outcome,
    )
  ) {
    throw new Error(`unexpected cancel completion: ${completion.outcome}`);
  }
}

async function recurrenceSubscriptionDeletionIsVisible(
  job: BillingCardRecurrenceJob,
) {
  const subscriptionId = job.provider_subscription_id?.trim() || "";
  try {
    const subscription = await asaasRequest<AsaasSubscription>(
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    );
    const validation = validateBillingCardRecurrenceCancellationTarget({
      subscription,
      subscriptionId,
      externalReference: job.external_reference,
      customerId: job.customer_id,
      amount: job.amount,
      billingPeriodMonths: job.billing_period_months,
      nextDueDate: job.next_due_date,
    });
    return validation.outcome === "already_absent";
  } catch (error) {
    if (error instanceof AsaasRequestError && error.status === 404) return true;
    throw error;
  }
}

async function processCancelJob(job: BillingCardRecurrenceJob) {
  const subscriptionId = job.provider_subscription_id?.trim() || "";
  if (!subscriptionId) {
    await failJob(job, "permanent", "subscription_identity_missing");
    return;
  }

  let subscription: AsaasSubscription;
  try {
    subscription = await asaasRequest<AsaasSubscription>(
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    );
  } catch (error) {
    if (error instanceof AsaasRequestError && error.status === 404) {
      // Asaas uses 404 both for a missing resource and for a resource owned by
      // another account. Without a tuple-matching GET in this execution, the
      // worker must fail closed instead of recording a successful removal.
      await failJob(job, "permanent", "provider_subscription_not_verified");
      return;
    }
    await failJob(job, "deterministic", "cancel_preflight_failed");
    return;
  }

  const validation = validateBillingCardRecurrenceCancellationTarget({
    subscription,
    subscriptionId,
    externalReference: job.external_reference,
    customerId: job.customer_id,
    amount: job.amount,
    billingPeriodMonths: job.billing_period_months,
    nextDueDate: job.next_due_date,
  });
  if (validation.outcome === "conflict") {
    await failJob(job, "permanent", "cancel_target_mismatch");
    return;
  }
  if (validation.outcome === "already_absent") {
    await completeCancelJob(job, "already_absent");
    return;
  }

  try {
    await asaasRequest<AsaasSubscription>(
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { method: "DELETE" },
    );
  } catch (error) {
    if (error instanceof AsaasRequestError && error.status === 404) {
      await completeCancelJob(job, "already_absent");
      return;
    }
    if (
      error instanceof AsaasRequestError &&
      providerFailureIsDeterministic(error.status)
    ) {
      await failJob(job, "permanent", "provider_cancel_rejected");
      return;
    }
    await failJob(job, "ambiguous", "provider_cancel_ambiguous");
    return;
  }
  if (!(await recurrenceSubscriptionDeletionIsVisible(job))) {
    await failJob(job, "ambiguous", "provider_cancel_not_visible");
    return;
  }
  await completeCancelJob(job, "deleted");
}

async function processJob(job: BillingCardRecurrenceJob) {
  if (job.action === "create") return await processCreateJob(job);
  if (job.action === "cancel") return await processCancelJob(job);
  await failJob(job, "permanent", "unsupported_job_action");
}

async function checkoutCancellationSubscriptionState(
  job: BillingSubscriptionCancellationJob,
  input: { allowNotFoundAfterVerifiedMutation?: boolean } = {},
) {
  try {
    const subscription = await asaasRequest<AsaasSubscription>(
      `/subscriptions/${encodeURIComponent(job.provider_subscription_id)}`,
    );
    const validation = validateBillingCardRecurrenceCancellationTarget({
      subscription,
      subscriptionId: job.provider_subscription_id,
      externalReference: job.external_reference,
      customerId: job.provider_customer_id || "",
      amount: Number(job.amount),
      billingPeriodMonths: job.billing_period_months,
      nextDueDate: job.next_due_date || subscription.nextDueDate || "",
    });
    if (validation.outcome === "conflict") {
      throw new Error("Cancellation subscription snapshot does not match.");
    }
    return validation.outcome === "already_absent" ? "absent" : "active";
  } catch (error) {
    if (error instanceof AsaasRequestError && error.status === 404) {
      return input.allowNotFoundAfterVerifiedMutation
        ? "absent"
        : "unverified_missing";
    }
    throw error;
  }
}

async function reconcileCheckoutCancellationPayment(
  job: BillingSubscriptionCancellationJob,
) {
  // The immutable cancellation snapshot may predate the first subscription
  // invoice. SQL discovers and locks that late invoice separately so the
  // worker can reconcile it without rewriting the original claim tuple.
  const paymentId = job.reconciliation_payment_id?.trim() ||
    job.provider_payment_id?.trim() || "";
  if (!paymentId) return;

  let payment: AsaasPayment;
  const observedAt = new Date();
  try {
    payment = await asaasRequest<AsaasPayment>(
      `/payments/${encodeURIComponent(paymentId)}`,
    );
  } catch (error) {
    // This lookup is informational after the subscription deletion has been
    // independently proven. A payment 404 is not converted into local
    // deletion evidence; the SQL finalizer still checks the exact local row.
    if (error instanceof AsaasRequestError && error.status === 404) return;
    throw error;
  }

  const customerId = job.provider_customer_id?.trim() || "";
  const dueDate = payment.dueDate?.trim() || "";
  const status = payment.deleted === true
    ? "DELETED"
    : payment.status?.trim().toUpperCase() || "";
  if (
    !customerId || !dueDate || !status || payment.id !== paymentId ||
    (payment.subscription?.trim() &&
      payment.subscription.trim() !== job.provider_subscription_id)
  ) {
    throw new Error("Cancellation payment snapshot is incomplete.");
  }
  const integrity = asaasCheckoutPaymentIntegrity({
    expectedPaymentId: paymentId,
    expectedCustomerId: customerId,
    expectedSubscriptionId: job.provider_subscription_id,
    expectedBillingType: "CREDIT_CARD",
    expectedAmount: Number(job.amount),
    expectedDueDate: dueDate,
    expectedExternalReference: job.external_reference,
    providerPaymentId: payment.id,
    providerCustomerId: payment.customer,
    // Asaas may clear this link after the subscription deletion. The frozen
    // claim remains the exact local authority; a different non-empty id was
    // rejected above.
    providerSubscriptionId: job.provider_subscription_id,
    providerBillingType: payment.billingType,
    providerAmount: payment.value,
    providerDueDate: payment.dueDate,
    providerExternalReference: payment.externalReference,
    providerDeleted: payment.deleted,
  });
  if (integrity !== "valid" && integrity !== "deleted") {
    throw new PaymentCancellationProcessingError(
      "permanent",
      "provider_payment_tuple_mismatch",
      `Cancellation payment mismatch: ${integrity}`,
    );
  }

  const reconciliation = await reconcileAsaasPaymentSnapshot({
    organizationId: job.organization_id,
    providerPaymentId: paymentId,
    providerCustomerId: customerId,
    providerSubscriptionId: job.provider_subscription_id,
    paymentStatus: status,
    paymentAmount: Number(job.amount),
    paymentDueDate: dueDate,
    observedAt: observedAt.toISOString(),
    source: "edge_subscription_cancellation_worker",
  });
  const outcome = typeof reconciliation.outcome === "string"
    ? reconciliation.outcome
    : "unknown";
  if (outcome !== "applied") {
    throw new Error(`Cancellation payment was not reconciled: ${outcome}`);
  }
}

async function processCheckoutCancellationJob(
  job: BillingSubscriptionCancellationJob,
) {
  if (
    !job.organization_id || !job.intent_id || !job.provider_subscription_id ||
    !job.provider_customer_id || !job.external_reference ||
    !(Number(job.amount) > 0) ||
    ![1, 6, 12].includes(job.billing_period_months) || !job.claim_token
  ) {
    throw new Error("Cancellation job snapshot is incomplete.");
  }

  const preflightState = await checkoutCancellationSubscriptionState(job);
  if (preflightState === "unverified_missing") {
    throw new PaymentCancellationProcessingError(
      "permanent",
      "provider_subscription_not_verified",
      "Provider subscription ownership could not be verified before cancellation.",
    );
  }
  if (preflightState === "active") {
    let deleteReturnedNotFound = false;
    try {
      await asaasRequest<AsaasSubscription>(
        `/subscriptions/${encodeURIComponent(job.provider_subscription_id)}`,
        { method: "DELETE" },
      );
    } catch (error) {
      if (error instanceof AsaasRequestError && error.status === 404) {
        deleteReturnedNotFound = true;
      } else {
        throw error;
      }
    }
    const postDeleteState = deleteReturnedNotFound
      ? "absent"
      : await checkoutCancellationSubscriptionState(job, {
        allowNotFoundAfterVerifiedMutation: true,
      });
    if (postDeleteState !== "absent") {
      throw new Error("Provider subscription deletion is not visible yet.");
    }
  }
  const providerDeletedAt = new Date();

  await reconcileCheckoutCancellationPayment(job);
  const finalization = await finalizeBillingSubscriptionCheckoutCancellation({
    organizationId: job.organization_id,
    intentId: job.intent_id,
    claimToken: job.claim_token,
    subscriptionId: job.provider_subscription_id,
    providerDeletedAt,
  });
  const outcome = finalization.outcome === "already_finalized"
    ? finalization.final_outcome
    : finalization.outcome;
  if (!["cancelled", "paid_without_recurrence"].includes(outcome || "")) {
    throw new Error(
      `Cancellation job was not finalized: ${finalization.outcome}`,
    );
  }
}

async function paymentCancellationObservation(
  job: BillingPaymentCancellationJob,
  source: string,
  input: { allowNotFoundAfterVerifiedMutation?: boolean } = {},
) {
  let payment: AsaasPayment;
  const observedAt = new Date();
  try {
    payment = await asaasRequest<AsaasPayment>(
      `/payments/${encodeURIComponent(job.provider_payment_id)}`,
    );
  } catch (error) {
    if (error instanceof AsaasRequestError && error.status === 404) {
      return input.allowNotFoundAfterVerifiedMutation
        ? { state: "missing" as const }
        : { state: "unverified_missing" as const };
    }
    throw error;
  }

  const integrity = asaasCheckoutPaymentIntegrity({
    expectedPaymentId: job.provider_payment_id,
    expectedCustomerId: job.provider_customer_id,
    expectedSubscriptionId: null,
    expectedBillingType: job.billing_type,
    expectedAmount: Number(job.amount),
    expectedDueDate: job.due_date,
    expectedExternalReference: job.external_reference,
    providerPaymentId: payment.id,
    providerCustomerId: payment.customer,
    providerSubscriptionId: payment.subscription,
    providerBillingType: payment.billingType,
    providerAmount: payment.value,
    providerDueDate: payment.dueDate,
    providerExternalReference: payment.externalReference,
    providerDeleted: payment.deleted,
  });
  if (integrity !== "valid" && integrity !== "deleted") {
    throw new Error(`Cancellation payment mismatch: ${integrity}`);
  }
  const status = integrity === "deleted"
    ? "DELETED"
    : payment.status?.trim().toUpperCase() || "";
  if (!status) {
    throw new PaymentCancellationProcessingError(
      "permanent",
      "provider_payment_status_missing",
      "Cancellation payment status is missing.",
    );
  }

  const reconciliation = await reconcileAsaasPaymentSnapshot({
    organizationId: job.organization_id,
    providerPaymentId: job.provider_payment_id,
    providerCustomerId: job.provider_customer_id,
    providerSubscriptionId: null,
    paymentStatus: status,
    paymentAmount: Number(job.amount),
    paymentDueDate: job.due_date,
    observedAt: observedAt.toISOString(),
    source,
  });
  const outcome = typeof reconciliation.outcome === "string"
    ? reconciliation.outcome
    : "unknown";
  // Never let an older observation authorize DELETE. The next fenced redrive
  // must reconcile a fresh provider snapshot (or terminalize for assistance).
  if (outcome !== "applied") {
    throw new PaymentCancellationProcessingError(
      outcome === "stale_snapshot" ? "retryable" : "permanent",
      outcome === "stale_snapshot"
        ? "provider_payment_snapshot_stale"
        : "provider_payment_reconciliation_mismatch",
      `Cancellation payment was not reconciled: ${outcome}`,
    );
  }
  if (integrity === "deleted") return { state: "deleted" as const };

  const action = billingPaymentCancellationAction({
    status,
    billingType: job.billing_type,
    deleted: false,
  });
  if (action === "settled") return { state: "paid" as const };
  if (action === "assisted") return { state: "assisted" as const };
  if (action === "cancelled") return { state: "deleted" as const };
  return { state: "active" as const };
}

async function finalizePaymentCancellationJob(input: {
  job: BillingPaymentCancellationJob;
  result: "deleted" | "not_found" | "paid";
  deletedAt?: Date | null;
}) {
  const finalization = await finalizeBillingPaymentCheckoutCancellation({
    organizationId: input.job.organization_id,
    intentId: input.job.intent_id,
    claimToken: input.job.claim_token,
    providerPaymentId: input.job.provider_payment_id,
    providerDeleteResult: input.result,
    providerDeletedAt: input.deletedAt || null,
  });
  const outcome = finalization.outcome === "already_finalized"
    ? finalization.final_outcome
    : finalization.outcome;
  if (
    ![
      "cancelled",
      "paid_before_delete",
      "paid_after_delete",
    ].includes(outcome || "")
  ) {
    throw new Error(
      `Payment cancellation was not finalized: ${finalization.outcome}`,
    );
  }
  return outcome;
}

async function processPaymentCancellationJob(
  job: BillingPaymentCancellationJob,
) {
  if (
    !job.organization_id || !job.intent_id || !job.payment_row_id ||
    !job.provider_payment_id || !job.provider_customer_id ||
    !job.external_reference || !(Number(job.amount) > 0) ||
    !["PIX", "BOLETO"].includes(job.billing_type) || !job.due_date ||
    !job.claim_token
  ) {
    throw new Error("Payment cancellation job snapshot is incomplete.");
  }

  const preflight = await paymentCancellationObservation(
    job,
    "edge_payment_cancellation_worker_preflight",
  );
  if (preflight.state === "unverified_missing") {
    throw new PaymentCancellationProcessingError(
      "permanent",
      "provider_payment_not_verified",
      "Provider payment ownership could not be verified before cancellation.",
    );
  }
  if (preflight.state === "paid") {
    await finalizePaymentCancellationJob({ job, result: "paid" });
    return;
  }
  if (preflight.state === "assisted") {
    throw new PaymentCancellationProcessingError(
      "permanent",
      "provider_payment_status_requires_assistance",
      "Payment cancellation requires manual reconciliation.",
    );
  }
  if (preflight.state === "deleted") {
    await finalizePaymentCancellationJob({
      job,
      result: job.claim_outcome === "recover_only" ? "deleted" : "not_found",
      deletedAt: new Date(),
    });
    return;
  }

  // Final lease/token/paid-state CAS immediately before the irreversible
  // provider boundary. `already_started` is recover-only: a second DELETE is
  // forbidden even after a crash or ambiguous provider acknowledgement.
  const deleteStart = await markBillingPaymentCheckoutCancellationDeleteStarted(
    {
      organizationId: job.organization_id,
      intentId: job.intent_id,
      claimToken: job.claim_token,
      providerPaymentId: job.provider_payment_id,
    },
  );
  if (billingOrganizationIsUnavailable(deleteStart)) {
    return "deferred" as const;
  }
  if (deleteStart.outcome === "paid_before_delete") return;
  if (deleteStart.outcome === "busy") {
    // SQL defers this claim without consuming the destructive retry budget
    // while the exact provider payment is still processing.
    return "deferred" as const;
  }
  if (deleteStart.outcome === "already_cancelled") {
    return "processed" as const;
  }
  if (deleteStart.outcome === "manual_review") {
    throw new PaymentCancellationProcessingError(
      "permanent",
      "provider_payment_delete_fence_mismatch",
      "Provider payment deletion fence requires assisted review.",
    );
  }
  if (deleteStart.outcome === "already_started") {
    throw new PaymentCancellationProcessingError(
      "retryable",
      "provider_payment_delete_outcome_unknown",
      "A prior provider payment deletion request is still reconciling.",
    );
  }
  if (deleteStart.outcome !== "proceed") {
    throw new PaymentCancellationProcessingError(
      "retryable",
      "provider_payment_delete_fence_lost",
      `Provider payment deletion fence failed: ${deleteStart.outcome}`,
    );
  }

  let deleteResult: "deleted" | "not_found" = "deleted";
  try {
    const deletion = await asaasRequest<AsaasDeleteResponse>(
      `/payments/${encodeURIComponent(job.provider_payment_id)}`,
      { method: "DELETE" },
    );
    if (
      deletion.id !== job.provider_payment_id || deletion.deleted !== true
    ) {
      throw new PaymentCancellationProcessingError(
        "permanent",
        "provider_payment_delete_response_invalid",
        "Provider payment deletion response is invalid.",
      );
    }
  } catch (error) {
    if (error instanceof AsaasRequestError && error.status === 404) {
      deleteResult = "not_found";
    } else {
      throw error;
    }
  }
  const providerDeletedAt = new Date();

  const postDelete = await paymentCancellationObservation(
    job,
    "edge_payment_cancellation_worker_post_delete",
    { allowNotFoundAfterVerifiedMutation: true },
  );
  if (postDelete.state === "paid") {
    await finalizePaymentCancellationJob({
      job,
      result: deleteResult,
      deletedAt: providerDeletedAt,
    });
    return;
  }
  if (
    postDelete.state !== "missing" && postDelete.state !== "deleted"
  ) {
    throw new PaymentCancellationProcessingError(
      "retryable",
      "provider_payment_delete_not_visible",
      "Provider payment deletion is not visible yet.",
    );
  }
  await finalizePaymentCancellationJob({
    job,
    result: postDelete.state === "missing" ? "not_found" : deleteResult,
    deletedAt: providerDeletedAt,
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(
      { success: false, error: "Metodo nao permitido." },
      405,
    );
  }

  if (!authorizePrivateWorkerRequest(request)) {
    return jsonResponse({ success: false, error: "Nao autorizado." }, 401);
  }

  let requestedBatch = MAX_BATCH_SIZE;
  try {
    const body = await request.json() as { batch_size?: unknown };
    if (
      typeof body.batch_size === "number" && Number.isInteger(body.batch_size)
    ) {
      requestedBatch = body.batch_size;
    }
  } catch {
    return jsonResponse({ success: false, error: "JSON invalido." }, 400);
  }
  const batchSize = Math.min(Math.max(requestedBatch, 1), MAX_BATCH_SIZE);
  const workerId = `edge:${crypto.randomUUID()}`;

  const jobs: BillingCardRecurrenceJob[] = [];
  const subscriptionCardUpdateJobs: BillingSubscriptionCardUpdateJob[] = [];
  const paymentCancellationJobs: BillingPaymentCancellationJob[] = [];
  const cancellationJobs: BillingSubscriptionCancellationJob[] = [];
  let claimFailures = 0;
  type WorkerQueue =
    | "recurrence"
    | "subscription_card_update"
    | "subscription_cancellation"
    | "payment_cancellation";
  const queues: WorkerQueue[] = [
    "recurrence",
    "subscription_card_update",
    "subscription_cancellation",
    "payment_cancellation",
  ];
  const rotation = Math.floor(Date.now() / 60_000) % queues.length;
  const queueOrder = [...queues.slice(rotation), ...queues.slice(0, rotation)];
  const unavailableQueues = new Set<WorkerQueue>();
  let consecutiveEmptyClaims = 0;
  let queueIndex = 0;
  let totalClaimed = 0;

  // The batch limit is global, not per table. A round-robin one-row claim
  // prevents a busy queue from starving the other billing state machines and
  // guarantees every claimed lease starts provider work immediately below.
  while (
    totalClaimed < batchSize && consecutiveEmptyClaims < queueOrder.length
  ) {
    const queue = queueOrder[queueIndex % queueOrder.length];
    queueIndex += 1;
    if (unavailableQueues.has(queue)) {
      consecutiveEmptyClaims += 1;
      continue;
    }
    try {
      let claimedCount = 0;
      if (queue === "recurrence") {
        const claimed = await claimBillingCardRecurrenceJobs({
          workerId,
          limit: 1,
          leaseSeconds: JOB_LEASE_SECONDS,
        });
        jobs.push(...claimed);
        claimedCount = claimed.length;
      } else if (queue === "subscription_card_update") {
        const claimed = await claimBillingSubscriptionCardUpdateJobs({
          workerId,
          limit: 1,
          leaseSeconds: JOB_LEASE_SECONDS,
        });
        subscriptionCardUpdateJobs.push(...claimed);
        claimedCount = claimed.length;
      } else if (queue === "subscription_cancellation") {
        const claimed = await claimBillingSubscriptionCheckoutCancellationJobs(
          {
            workerId,
            limit: 1,
            leaseSeconds: CANCELLATION_LEASE_SECONDS,
          },
        );
        cancellationJobs.push(...claimed);
        claimedCount = claimed.length;
      } else {
        const claimed = await claimBillingPaymentCheckoutCancellationJobs({
          workerId,
          limit: 1,
          leaseSeconds: CANCELLATION_LEASE_SECONDS,
        });
        paymentCancellationJobs.push(...claimed);
        claimedCount = claimed.length;
      }
      if (claimedCount > 1) {
        throw new Error(`Worker queue ${queue} exceeded its claim limit.`);
      }
      totalClaimed += claimedCount;
      consecutiveEmptyClaims = claimedCount === 0
        ? consecutiveEmptyClaims + 1
        : 0;
    } catch (error) {
      unavailableQueues.add(queue);
      claimFailures += 1;
      consecutiveEmptyClaims += 1;
      console.error("Billing worker queue claim failed.", {
        queue,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  const outcomeTasks = jobs.map(async (job) => {
    try {
      await processJob(job);
      return "processed" as const;
    } catch (error) {
      if (error instanceof BillingOrganizationUnavailableError) {
        return "deferred" as const;
      }
      console.error("Card recurrence job lease will be recovered.", {
        paymentId: job.payment_id,
        action: job.action,
        message: error instanceof Error ? error.message : "unknown",
      });
      return "failed" as const;
    }
  });
  const subscriptionCardUpdateTasks = subscriptionCardUpdateJobs.map(
    async (job) => {
      try {
        await processSubscriptionCardUpdateJob(job);
        return "processed" as const;
      } catch (error) {
        if (error instanceof BillingOrganizationUnavailableError) {
          return "deferred" as const;
        }
        console.error("Subscription card update job lease will be recovered.", {
          jobId: job.job_id,
          organizationId: job.organization_id,
          message: error instanceof Error ? error.message : "unknown",
        });
        return "failed" as const;
      }
    },
  );
  const cancellationTasks = cancellationJobs.map(
    async (job) => {
      try {
        await processCheckoutCancellationJob(job);
        return "processed" as const;
      } catch (error) {
        const failure = paymentCancellationFailure(error);
        let failureOutcome:
          | Awaited<
            ReturnType<typeof failBillingSubscriptionCheckoutCancellation>
          >
          | null = null;
        try {
          failureOutcome = await failBillingSubscriptionCheckoutCancellation({
            organizationId: job.organization_id,
            intentId: job.intent_id,
            claimToken: job.claim_token,
            failureClass: failure.failureClass,
            errorCode: failure.errorCode,
          });
        } catch (failureError) {
          console.error(
            "Subscription cancellation failure could not be fenced.",
            {
              intentId: job.intent_id,
              message: failureError instanceof Error
                ? failureError.message
                : "unknown",
            },
          );
        }
        const finalOutcome = failureOutcome?.outcome === "already_finalized"
          ? failureOutcome.final_outcome
          : failureOutcome?.outcome;
        if (
          ["cancelled", "paid_without_recurrence"].includes(finalOutcome || "")
        ) {
          return "processed" as const;
        }
        console.error("Subscription cancellation claim was classified.", {
          intentId: job.intent_id,
          failureClass: failure.failureClass,
          errorCode: failure.errorCode,
          outcome: finalOutcome || "failure_rpc_failed",
          message: error instanceof Error ? error.message : "unknown",
        });
        return finalOutcome === "manual_review"
          ? "manual_review" as const
          : "failed" as const;
      }
    },
  );
  const paymentCancellationTasks = paymentCancellationJobs.map(
    async (job) => {
      try {
        const result = await processPaymentCancellationJob(job);
        return result === "deferred"
          ? "deferred" as const
          : "processed" as const;
      } catch (error) {
        const failure = paymentCancellationFailure(error);
        let failureOutcome:
          | Awaited<
            ReturnType<typeof failBillingPaymentCheckoutCancellation>
          >
          | null = null;
        try {
          failureOutcome = await failBillingPaymentCheckoutCancellation({
            organizationId: job.organization_id,
            intentId: job.intent_id,
            claimToken: job.claim_token,
            failureClass: failure.failureClass,
            errorCode: failure.errorCode,
          });
        } catch (failureError) {
          console.error("Payment cancellation failure could not be fenced.", {
            intentId: job.intent_id,
            message: failureError instanceof Error
              ? failureError.message
              : "unknown",
          });
        }
        const finalOutcome = failureOutcome?.outcome === "already_finalized"
          ? failureOutcome.final_outcome
          : failureOutcome?.outcome;
        if (
          [
            "cancelled",
            "paid_before_delete",
            "paid_after_delete",
          ].includes(finalOutcome || "")
        ) {
          return "processed" as const;
        }
        console.error("Payment cancellation claim was classified.", {
          intentId: job.intent_id,
          failureClass: failure.failureClass,
          errorCode: failure.errorCode,
          outcome: finalOutcome || "failure_rpc_failed",
          message: error instanceof Error ? error.message : "unknown",
        });
        return finalOutcome === "manual_review"
          ? "manual_review" as const
          : "failed" as const;
      }
    },
  );
  const allOutcomes = await Promise.all([
    ...outcomeTasks,
    ...subscriptionCardUpdateTasks,
    ...cancellationTasks,
    ...paymentCancellationTasks,
  ]);
  const processed = allOutcomes.filter((outcome) =>
    outcome === "processed"
  ).length;
  const manualReview =
    allOutcomes.filter((outcome) => outcome === "manual_review").length;
  const deferred =
    allOutcomes.filter((outcome) => outcome === "deferred").length;
  const failed = allOutcomes.length - processed - deferred + claimFailures;

  return jsonResponse({
    success: failed === 0,
    claimed: jobs.length + subscriptionCardUpdateJobs.length +
      cancellationJobs.length +
      paymentCancellationJobs.length,
    processed,
    failed,
    deferred,
    manual_review: manualReview,
    recurrence_claimed: jobs.length,
    subscription_card_updates_claimed: subscriptionCardUpdateJobs.length,
    payment_cancellations_claimed: paymentCancellationJobs.length,
    subscription_cancellations_claimed: cancellationJobs.length,
  });
});
