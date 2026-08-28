import type { BillingPeriodMonths } from "./asaas-billing-intent.ts";
import {
  asaasSubscriptionCycle,
  providerFailureIsDeterministic,
} from "./asaas-billing-intent.ts";
import {
  type AsaasPayment,
  asaasRequest,
  AsaasRequestError,
  type AsaasSubscription,
  getSupabaseAdmin,
} from "./asaas.ts";
import { openBillingCardCredential } from "./asaas-card-credential.ts";
import { billingOrganizationIsUnavailable } from "./billing-organization-state.ts";

export type BillingCardRecurrenceState =
  | "prepared"
  | "creating"
  | "recovering"
  | "completed"
  | "failed"
  | "cancelled";

export type PublicBillingCardRecurrenceState = {
  recurrence_saved: boolean;
  recurrence_processing: boolean;
  recurrence_save_failed: boolean;
  requires_payment_method_update: boolean;
};

export function publicBillingCardRecurrenceState(
  status: BillingCardRecurrenceState | null | undefined,
): PublicBillingCardRecurrenceState | null {
  if (status === "completed") {
    return {
      recurrence_saved: true,
      recurrence_processing: false,
      recurrence_save_failed: false,
      requires_payment_method_update: false,
    };
  }
  if (["prepared", "creating", "recovering"].includes(status || "")) {
    return {
      recurrence_saved: false,
      recurrence_processing: true,
      recurrence_save_failed: false,
      requires_payment_method_update: false,
    };
  }
  if (status === "failed" || status === "cancelled") {
    return {
      recurrence_saved: false,
      recurrence_processing: false,
      recurrence_save_failed: true,
      requires_payment_method_update: true,
    };
  }
  return null;
}

export type BillingCardRecurrencePrepare = {
  outcome: string;
  status?: BillingCardRecurrenceState;
  credential_stored?: boolean;
  capture_request_started?: boolean;
  capture_request_started_at?: string | null;
  external_reference?: string;
  provider_subscription_id?: string | null;
};

export type BillingCardRecurrenceClaim = {
  outcome: string;
  payment_id?: string;
  status?: BillingCardRecurrenceState;
  action?: "create_or_recover" | "recover_only" | "none";
  lease_id?: string;
  retry_after_seconds?: number;
  external_reference?: string;
  customer_id?: string;
  amount?: number;
  billing_period_months?: BillingPeriodMonths;
  next_due_date?: string;
  plan_id?: string;
  provider_subscription_id?: string | null;
  subscription_id?: string | null;
  provider_card_credential?: string | null;
};

export type BillingCardRecurrenceCompletion = {
  outcome: string;
  status?: BillingCardRecurrenceState;
  provider_subscription_id?: string | null;
  subscription_id?: string | null;
};

export type BillingCardRecurrenceTerminalization = {
  outcome:
    | "failed"
    | "already_failed"
    | "already_completed"
    | "provision_not_found"
    | "payment_not_found"
    | "state_not_terminalizable"
    | "invalid_input";
  status?: BillingCardRecurrenceState;
};

type AsaasSubscriptionList = {
  data?: AsaasSubscription[];
  hasMore?: boolean;
};

export type BillingCardRecurrenceRecovery =
  | { outcome: "not_found" }
  | { outcome: "found"; subscription: AsaasSubscription }
  | { outcome: "conflict"; reason: string };

export type BillingCardRecurrenceJob = {
  outcome: "claimed";
  action: "create" | "cancel";
  mode: "create_or_recover" | "recover_only" | "cancel";
  payment_id: string;
  provider_payment_id: string;
  organization_id: string;
  billing_intent_id?: string | null;
  worker_id: string;
  job_lease_id: string;
  lock_expires_at?: string;
  attempts: number;
  max_attempts: number;
  external_reference: string;
  customer_id: string;
  amount: number;
  billing_period_months: BillingPeriodMonths;
  next_due_date: string;
  provider_subscription_id?: string | null;
  provider_card_credential?: string | null;
  card_last4?: string | null;
};

function normalizedText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validIsoDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function numberMatches(value: unknown, expected: number) {
  return typeof value === "number" && Number.isFinite(value) &&
    Math.abs(value - expected) <= 0.01;
}

export function billingCardRecurrenceRecoveryPath(input: {
  externalReference: string;
  customerId: string;
}) {
  const query = new URLSearchParams({
    externalReference: input.externalReference,
    customer: input.customerId,
    includeDeleted: "true",
    limit: "100",
    offset: "0",
  });
  return `/subscriptions?${query.toString()}`;
}

export function validateBillingCardRecurrenceCandidates(input: {
  subscriptions: AsaasSubscription[];
  hasMore?: boolean;
  externalReference: string;
  customerId: string;
  amount: number;
  billingPeriodMonths: BillingPeriodMonths;
  nextDueDate: string;
}): BillingCardRecurrenceRecovery {
  if (input.hasMore) {
    return {
      outcome: "conflict",
      reason: "provider_result_is_ambiguous",
    };
  }

  const candidates = input.subscriptions.filter((subscription) =>
    normalizedText(subscription.externalReference) ===
      input.externalReference &&
    normalizedText(subscription.customer) === input.customerId
  );
  if (candidates.length === 0) return { outcome: "not_found" };
  if (candidates.length !== 1) {
    return {
      outcome: "conflict",
      reason: "multiple_provider_subscriptions",
    };
  }

  const subscription = candidates[0];
  const expectedCycle = asaasSubscriptionCycle(input.billingPeriodMonths);
  const status = normalizedText(subscription.status).toUpperCase();
  if (
    !subscription.id || subscription.deleted === true ||
    status !== "ACTIVE" ||
    normalizedText(subscription.billingType).toUpperCase() !== "CREDIT_CARD" ||
    normalizedText(subscription.cycle).toUpperCase() !== expectedCycle ||
    !numberMatches(subscription.value, input.amount) ||
    !validIsoDate(subscription.nextDueDate) ||
    subscription.nextDueDate !== input.nextDueDate
  ) {
    return {
      outcome: "conflict",
      reason: "provider_subscription_does_not_match_quote",
    };
  }

  return { outcome: "found", subscription };
}

export function validateBillingCardRecurrenceCancellationTarget(input: {
  subscription: AsaasSubscription;
  subscriptionId: string;
  externalReference: string;
  customerId: string;
  amount: number;
  billingPeriodMonths: BillingPeriodMonths;
  nextDueDate: string;
}) {
  const subscription = input.subscription;
  const status = normalizedText(subscription.status).toUpperCase();
  const tupleMatches = normalizedText(subscription.id) ===
      input.subscriptionId &&
    normalizedText(subscription.externalReference) ===
      input.externalReference &&
    normalizedText(subscription.customer) === input.customerId &&
    normalizedText(subscription.billingType).toUpperCase() === "CREDIT_CARD" &&
    normalizedText(subscription.cycle).toUpperCase() ===
      asaasSubscriptionCycle(input.billingPeriodMonths) &&
    numberMatches(subscription.value, input.amount) &&
    validIsoDate(subscription.nextDueDate) &&
    subscription.nextDueDate === input.nextDueDate;
  if (!tupleMatches) return { outcome: "conflict" as const };
  if (
    subscription.deleted === true ||
    ["INACTIVE", "EXPIRED"].includes(status)
  ) return { outcome: "already_absent" as const };
  return { outcome: "active" as const };
}

export async function recoverBillingCardRecurrence(
  claim: BillingCardRecurrenceClaim,
): Promise<BillingCardRecurrenceRecovery> {
  if (
    !claim.external_reference || !claim.customer_id ||
    typeof claim.amount !== "number" || !claim.billing_period_months ||
    !claim.next_due_date
  ) {
    return { outcome: "conflict", reason: "invalid_recurrence_claim" };
  }

  const result = await asaasRequest<AsaasSubscriptionList>(
    billingCardRecurrenceRecoveryPath({
      externalReference: claim.external_reference,
      customerId: claim.customer_id,
    }),
  );
  return validateBillingCardRecurrenceCandidates({
    subscriptions: result.data || [],
    hasMore: result.hasMore,
    externalReference: claim.external_reference,
    customerId: claim.customer_id,
    amount: claim.amount,
    billingPeriodMonths: claim.billing_period_months,
    nextDueDate: claim.next_due_date,
  });
}

export type StoredBillingCardRecurrenceResult = {
  saved: boolean;
  processing: boolean;
  subscriptionId: string | null;
  code: string;
  message: string;
};

function storedRecurrenceResult(
  input: Partial<StoredBillingCardRecurrenceResult>,
): StoredBillingCardRecurrenceResult {
  const result = {
    saved: false,
    processing: false,
    subscriptionId: null,
    code: "recurrence_not_saved",
    ...input,
  };
  return {
    ...result,
    message: input.message ||
      (result.saved
        ? "Pagamento concluido e cartao salvo para as proximas cobrancas."
        : result.processing
        ? "Pagamento confirmado. A renovacao automatica esta sendo preparada."
        : "Pagamento confirmado. Cadastre o cartao novamente antes da proxima cobranca."),
  };
}

function recurrenceClaimIsComplete(claim: BillingCardRecurrenceClaim) {
  return ["completed", "already_completed"].includes(claim.outcome) &&
    Boolean(claim.provider_subscription_id || claim.subscription_id);
}

/**
 * Creates the future subscription only after the payment is authoritatively
 * paid. The provider token and original payer IP stay inside one AES-GCM
 * envelope and are cleared by the SQL state machine after completion/failure.
 */
export async function provisionStoredBillingCardRecurrence(input: {
  paymentId: string;
  payment: AsaasPayment;
  planName?: string | null;
  claim?: BillingCardRecurrenceClaim;
}): Promise<StoredBillingCardRecurrenceResult> {
  const paymentId = input.paymentId;
  if (!paymentId) return storedRecurrenceResult({});

  let claim: BillingCardRecurrenceClaim;
  try {
    claim = input.claim || await claimBillingCardRecurrence({
      paymentId,
      providerPaymentId: input.payment.id,
    });
  } catch {
    return storedRecurrenceResult({
      processing: true,
      code: "recurrence_recovering",
    });
  }

  if (billingOrganizationIsUnavailable(claim)) {
    return storedRecurrenceResult({
      processing: false,
      code: "organization_inactive",
      message:
        "Pagamento confirmado. A renovacao automatica nao esta disponivel.",
    });
  }

  if (recurrenceClaimIsComplete(claim)) {
    return storedRecurrenceResult({
      saved: true,
      subscriptionId: claim.provider_subscription_id ||
        claim.subscription_id || null,
      code: "recurrence_saved",
    });
  }
  if (claim.outcome === "busy") {
    return storedRecurrenceResult({
      processing: true,
      code: "recurrence_recovering",
    });
  }

  if (claim.outcome === "recovering") {
    let recovery: BillingCardRecurrenceRecovery;
    try {
      recovery = await recoverBillingCardRecurrence(claim);
    } catch {
      return storedRecurrenceResult({
        processing: true,
        code: "recurrence_recovering",
      });
    }
    if (recovery.outcome === "found") {
      try {
        const completion = await reconcileBillingCardRecurrenceSubscription(
          recovery.subscription,
        );
        if (["completed", "already_completed"].includes(completion.outcome)) {
          return storedRecurrenceResult({
            saved: true,
            subscriptionId: completion.provider_subscription_id ||
              completion.subscription_id || recovery.subscription.id,
            code: "recurrence_saved",
          });
        }
      } catch {
        // Deterministic externalReference recovery remains retry-safe.
      }
    }
    return storedRecurrenceResult({
      processing: recovery.outcome !== "conflict",
      code: recovery.outcome === "conflict"
        ? "recurrence_manual_review"
        : "recurrence_recovering",
    });
  }

  if (claim.outcome !== "claimed" || !claim.lease_id) {
    return storedRecurrenceResult({
      processing: ["payment_not_reconciled", "payment_not_paid"].includes(
        claim.outcome,
      ),
    });
  }

  const identity = {
    paymentId,
    providerPaymentId: input.payment.id,
    leaseId: claim.lease_id,
  };
  let recovery: BillingCardRecurrenceRecovery;
  try {
    recovery = await recoverBillingCardRecurrence(claim);
  } catch (error) {
    await markBillingCardRecurrenceRecovering({
      ...identity,
      error: error instanceof Error ? error.message : "provider lookup failed",
    }).catch(() => undefined);
    return storedRecurrenceResult({
      processing: true,
      code: "recurrence_recovering",
    });
  }
  if (recovery.outcome === "conflict") {
    await failBillingCardRecurrence({
      ...identity,
      error: recovery.reason,
    }).catch(() => undefined);
    return storedRecurrenceResult({ code: "recurrence_manual_review" });
  }
  if (recovery.outcome === "found") {
    try {
      const completion = await completeBillingCardRecurrence({
        ...identity,
        subscription: recovery.subscription,
      });
      if (["completed", "already_completed"].includes(completion.outcome)) {
        return storedRecurrenceResult({
          saved: true,
          subscriptionId: completion.provider_subscription_id ||
            completion.subscription_id || recovery.subscription.id,
          code: "recurrence_saved",
        });
      }
    } catch {
      await markBillingCardRecurrenceRecovering({
        ...identity,
        error: "local completion failed",
      }).catch(() => undefined);
    }
    return storedRecurrenceResult({
      processing: true,
      code: "recurrence_recovering",
    });
  }

  if (
    !claim.external_reference || !claim.customer_id ||
    typeof claim.amount !== "number" || !claim.billing_period_months ||
    !claim.next_due_date || !claim.provider_card_credential
  ) {
    await failBillingCardRecurrence({
      ...identity,
      error: "incomplete encrypted recurrence claim",
    }).catch(() => undefined);
    return storedRecurrenceResult({ code: "recurrence_manual_review" });
  }

  let credential: Awaited<ReturnType<typeof openBillingCardCredential>>;
  try {
    credential = await openBillingCardCredential({
      paymentId,
      providerPaymentId: input.payment.id,
      ciphertext: claim.provider_card_credential,
    });
  } catch {
    await failBillingCardRecurrence({
      ...identity,
      error: "encrypted provider credential is invalid",
    }).catch(() => undefined);
    return storedRecurrenceResult({ code: "recurrence_manual_review" });
  }

  let subscription: AsaasSubscription;
  try {
    subscription = await asaasRequest<AsaasSubscription>("/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        customer: claim.customer_id,
        billingType: "CREDIT_CARD",
        value: claim.amount,
        nextDueDate: claim.next_due_date,
        cycle: asaasSubscriptionCycle(claim.billing_period_months),
        description: `Vimob - ${input.planName || "Assinatura"}`,
        externalReference: claim.external_reference,
        creditCardToken: credential.creditCardToken,
        remoteIp: credential.remoteIp,
      }),
    });
  } catch (error) {
    if (
      error instanceof AsaasRequestError &&
      providerFailureIsDeterministic(error.status)
    ) {
      await failBillingCardRecurrence({
        ...identity,
        error: error.message,
      }).catch(() => undefined);
      return storedRecurrenceResult({ code: "recurrence_card_not_saved" });
    }
    await markBillingCardRecurrenceRecovering({
      ...identity,
      error: error instanceof Error ? error.message : "provider result unknown",
    }).catch(() => undefined);
    return storedRecurrenceResult({
      processing: true,
      code: "recurrence_recovering",
    });
  }

  const validation = validateBillingCardRecurrenceCandidates({
    subscriptions: [subscription],
    externalReference: claim.external_reference,
    customerId: claim.customer_id,
    amount: claim.amount,
    billingPeriodMonths: claim.billing_period_months,
    nextDueDate: claim.next_due_date,
  });
  if (validation.outcome !== "found") {
    await markBillingCardRecurrenceRecovering({
      ...identity,
      error: validation.outcome === "conflict"
        ? validation.reason
        : "provider subscription response is empty",
    }).catch(() => undefined);
    return storedRecurrenceResult({
      processing: true,
      code: "recurrence_recovering",
    });
  }
  try {
    const completion = await completeBillingCardRecurrence({
      ...identity,
      subscription: validation.subscription,
    });
    if (["completed", "already_completed"].includes(completion.outcome)) {
      return storedRecurrenceResult({
        saved: true,
        subscriptionId: completion.provider_subscription_id ||
          completion.subscription_id || validation.subscription.id,
        code: "recurrence_saved",
      });
    }
  } catch {
    await markBillingCardRecurrenceRecovering({
      ...identity,
      error: "local completion failed",
    }).catch(() => undefined);
  }
  return storedRecurrenceResult({
    processing: true,
    code: "recurrence_recovering",
  });
}

export async function prepareBillingCardRecurrence(input: {
  paymentId: string;
  providerPaymentId: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "prepare_billing_card_recurrence",
    {
      p_payment_id: input.paymentId,
      p_provider_payment_id: input.providerPaymentId,
    },
  );
  if (error) throw error;
  return (data || { outcome: "invalid_input" }) as BillingCardRecurrencePrepare;
}

export async function claimBillingCardRecurrence(input: {
  paymentId: string;
  providerPaymentId: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "claim_billing_card_recurrence",
    {
      p_payment_id: input.paymentId,
      p_provider_payment_id: input.providerPaymentId,
    },
  );
  if (error) throw error;
  return (data || { outcome: "invalid_input" }) as BillingCardRecurrenceClaim;
}

export async function claimBillingCardRecurrenceByProviderPayment(
  providerPaymentId: string,
) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "claim_billing_card_recurrence_by_provider_payment",
    { p_provider_payment_id: providerPaymentId },
  );
  if (error) throw error;
  return (data || { outcome: "invalid_input" }) as BillingCardRecurrenceClaim;
}

export async function claimBillingCardRecurrenceJobs(input: {
  workerId: string;
  limit: number;
  leaseSeconds: number;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "claim_billing_card_recurrence_jobs",
    {
      p_worker_id: input.workerId,
      p_limit: input.limit,
      p_lease_seconds: input.leaseSeconds,
    },
  );
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as BillingCardRecurrenceJob[];
}

export async function succeedBillingCardRecurrenceJob(input: {
  job: BillingCardRecurrenceJob;
  providerResult: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "succeed_billing_card_recurrence_job",
    {
      p_payment_id: input.job.payment_id,
      p_provider_payment_id: input.job.provider_payment_id,
      p_worker_id: input.job.worker_id,
      p_job_lease_id: input.job.job_lease_id,
      p_provider_result: input.providerResult,
    },
  );
  if (error) throw error;
  return (data || { outcome: "invalid_input" }) as { outcome: string };
}

export async function markBillingCardRecurrenceProviderRequestStarted(input: {
  job: BillingCardRecurrenceJob;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "mark_billing_card_recurrence_provider_request_started",
    {
      p_payment_id: input.job.payment_id,
      p_worker_id: input.job.worker_id,
      p_job_lease_id: input.job.job_lease_id,
    },
  );
  if (error) throw error;
  return (data || { outcome: "invalid_input" }) as { outcome: string };
}

export async function failBillingCardRecurrenceJob(input: {
  job: BillingCardRecurrenceJob;
  failureClass: "deterministic" | "ambiguous" | "permanent";
  errorCode: string;
  retryAfterSeconds: number;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "fail_billing_card_recurrence_job",
    {
      p_payment_id: input.job.payment_id,
      p_worker_id: input.job.worker_id,
      p_job_lease_id: input.job.job_lease_id,
      p_failure_class: input.failureClass,
      p_error_code: input.errorCode,
      p_retry_after_seconds: input.retryAfterSeconds,
    },
  );
  if (error) throw error;
  return (data || { outcome: "invalid_input" }) as { outcome: string };
}

export async function storeBillingCardRecurrenceCredential(input: {
  paymentId: string;
  providerPaymentId: string;
  attemptLeaseId: string;
  credentialCiphertext: string;
  cardLast4: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "store_billing_card_recurrence_credential",
    {
      p_payment_id: input.paymentId,
      p_provider_payment_id: input.providerPaymentId,
      p_attempt_lease_id: input.attemptLeaseId,
      p_credential_ciphertext: input.credentialCiphertext,
      p_card_last4: input.cardLast4,
    },
  );
  if (error) throw error;
  return (data || { outcome: "invalid_input" }) as {
    outcome: string;
  };
}

export async function markBillingCardCaptureRequestStarted(input: {
  paymentId: string;
  providerPaymentId: string;
  attemptLeaseId: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "mark_billing_card_capture_request_started",
    {
      p_payment_id: input.paymentId,
      p_provider_payment_id: input.providerPaymentId,
      p_attempt_lease_id: input.attemptLeaseId,
    },
  );
  if (error) throw error;
  return (data || { outcome: "invalid_input" }) as {
    outcome: string;
    payment_id?: string;
    provider_payment_id?: string;
    capture_request_started_at?: string;
  };
}

export async function completeBillingCardRecurrence(input: {
  paymentId: string;
  providerPaymentId: string;
  leaseId: string;
  subscription: AsaasSubscription;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "complete_billing_card_recurrence",
    {
      p_payment_id: input.paymentId,
      p_provider_payment_id: input.providerPaymentId,
      p_lease_id: input.leaseId,
      p_subscription: input.subscription,
    },
  );
  if (error) throw error;
  return (data ||
    { outcome: "invalid_input" }) as BillingCardRecurrenceCompletion;
}

export async function reconcileBillingCardRecurrenceSubscription(
  subscription: AsaasSubscription,
) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "reconcile_billing_card_recurrence_subscription",
    { p_subscription: subscription },
  );
  if (error) throw error;
  return (data ||
    { outcome: "not_found" }) as BillingCardRecurrenceCompletion;
}

export async function markBillingCardRecurrenceRecovering(input: {
  paymentId: string;
  providerPaymentId: string;
  leaseId: string;
  error: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "mark_billing_card_recurrence_recovering",
    {
      p_payment_id: input.paymentId,
      p_provider_payment_id: input.providerPaymentId,
      p_lease_id: input.leaseId,
      p_error: input.error.slice(0, 500),
    },
  );
  if (error) throw error;
  return (data ||
    { outcome: "invalid_input" }) as BillingCardRecurrenceCompletion;
}

export async function failBillingCardRecurrence(input: {
  paymentId: string;
  providerPaymentId: string;
  leaseId: string;
  error: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("fail_billing_card_recurrence", {
    p_payment_id: input.paymentId,
    p_provider_payment_id: input.providerPaymentId,
    p_lease_id: input.leaseId,
    p_error: input.error.slice(0, 500),
  });
  if (error) throw error;
  return (data ||
    { outcome: "invalid_input" }) as BillingCardRecurrenceCompletion;
}

export async function failPreparedBillingCardRecurrence(input: {
  paymentId: string;
  providerPaymentId: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "fail_prepared_billing_card_recurrence",
    {
      p_payment_id: input.paymentId,
      p_provider_payment_id: input.providerPaymentId,
    },
  );
  if (error) throw error;
  return (data || {
    outcome: "invalid_input",
  }) as BillingCardRecurrenceTerminalization;
}
