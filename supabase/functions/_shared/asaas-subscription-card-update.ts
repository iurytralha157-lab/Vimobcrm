import { getSupabaseAdmin } from "./asaas.ts";

export type BillingSubscriptionCardUpdateMode =
  | "settled_payment"
  | "saved_only";

export type BillingSubscriptionCardUpdatePrepare = {
  outcome: string;
  job_id?: string;
  subscription_row_id?: string;
  subscription_id?: string;
  customer_id?: string;
  generation?: number;
  mode?: BillingSubscriptionCardUpdateMode;
  state?: "queued" | "succeeded" | "cancelled" | "failed" | "manual_review";
  status?: string;
  payment_id?: string | null;
  provider_payment_id?: string | null;
  payment_status?: string | null;
  manual_review_at?: string | null;
  aad?: string;
  busy_reason?: string;
};

export type BillingSubscriptionCardUpdateStore = {
  outcome: string;
  job_id?: string;
  generation?: number;
  status?: string;
  card_last4?: string;
  last_error_code?: string;
};

export type BillingSubscriptionCardUpdateCaptureMarker = {
  outcome: string;
  job_id?: string;
  payment_id?: string;
  provider_payment_id?: string;
  capture_request_started_at?: string;
  payment_status?: string;
  last_error_code?: string;
};

export type BillingSubscriptionCardUpdateFailureClass =
  | "retryable"
  | "permanent"
  | "not_found"
  | "ambiguous";

export type BillingSubscriptionCardUpdateJob = {
  job_id: string;
  organization_id: string;
  subscription_row_id: string;
  provider_subscription_id: string;
  provider_customer_id: string;
  generation: number;
  mode: BillingSubscriptionCardUpdateMode;
  payment_id: string | null;
  provider_payment_id: string | null;
  provider_card_credential: string;
  card_last4: string;
  job_lease_id: string;
  lease_expires_at: string;
  attempts: number;
  max_attempts: number;
  provider_request_started_at: string | null;
  claim_outcome: "claimed" | "replay";
  aad: string;
};

export type BillingSubscriptionCardUpdateProviderMarker = {
  outcome: string;
  job_id?: string;
  generation?: number;
  subscription_id?: string;
  provider_request_started_at?: string;
  provider_request_attempts?: number;
  last_error_code?: string;
};

export type BillingSubscriptionCardUpdateMutationResult = {
  outcome: string;
  job_id?: string;
  generation?: number;
  status?: string;
  card_last4?: string;
  last_error_code?: string;
  completed_at?: string;
  next_attempt_at?: string;
  replay_same_credential?: boolean;
};

export type BillingSubscriptionCardUpdateStatus = {
  outcome: string;
  job_id?: string;
  generation?: number;
  mode?: BillingSubscriptionCardUpdateMode;
  state?: "queued" | "succeeded" | "cancelled" | "failed" | "manual_review";
  status?: string;
  card_last4?: string;
  last_error_code?: string;
  next_attempt_at?: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
  cancelled_at?: string;
  manual_review_at?: string;
};

export async function prepareBillingSubscriptionCardUpdate(input: {
  jobId: string;
  organizationId: string;
  mode: BillingSubscriptionCardUpdateMode;
  paymentId?: string | null;
  providerPaymentId?: string | null;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "prepare_billing_subscription_card_update",
    {
      p_job_id: input.jobId,
      p_organization_id: input.organizationId,
      p_mode: input.mode,
      p_payment_id: input.paymentId || null,
      p_provider_payment_id: input.providerPaymentId || null,
    },
  );
  if (error) throw error;
  return (data ||
    { outcome: "invalid_request" }) as BillingSubscriptionCardUpdatePrepare;
}

export async function storeBillingSubscriptionCardUpdateCredential(input: {
  jobId: string;
  organizationId: string;
  generation: number;
  attemptLeaseId?: string | null;
  credentialCiphertext: string;
  cardLast4: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "store_billing_subscription_card_update_credential",
    {
      p_job_id: input.jobId,
      p_organization_id: input.organizationId,
      p_generation: input.generation,
      p_attempt_lease_id: input.attemptLeaseId || null,
      p_credential_ciphertext: input.credentialCiphertext,
      p_card_last4: input.cardLast4,
    },
  );
  if (error) throw error;
  return (data ||
    { outcome: "invalid_request" }) as BillingSubscriptionCardUpdateStore;
}

export async function markBillingSubscriptionCardUpdateCaptureStarted(input: {
  jobId: string;
  organizationId: string;
  generation: number;
  attemptLeaseId: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "mark_billing_subscription_card_update_capture_started",
    {
      p_job_id: input.jobId,
      p_organization_id: input.organizationId,
      p_generation: input.generation,
      p_attempt_lease_id: input.attemptLeaseId,
    },
  );
  if (error) throw error;
  return (data ||
    {
      outcome: "invalid_request",
    }) as BillingSubscriptionCardUpdateCaptureMarker;
}

export async function failBillingSubscriptionCardUpdateCapture(input: {
  jobId: string;
  organizationId: string;
  generation: number;
  attemptLeaseId: string;
  errorCode: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "fail_billing_subscription_card_update_capture",
    {
      p_job_id: input.jobId,
      p_organization_id: input.organizationId,
      p_generation: input.generation,
      p_attempt_lease_id: input.attemptLeaseId,
      p_error_code: input.errorCode,
    },
  );
  if (error) throw error;
  return (data || {
    outcome: "invalid_request",
  }) as BillingSubscriptionCardUpdateMutationResult;
}

export async function abandonBillingSubscriptionCardUpdateJob(input: {
  jobId: string;
  organizationId: string;
  generation: number;
  attemptLeaseId?: string | null;
  errorCode: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "abandon_billing_subscription_card_update_job",
    {
      p_job_id: input.jobId,
      p_organization_id: input.organizationId,
      p_generation: input.generation,
      p_attempt_lease_id: input.attemptLeaseId || null,
      p_error_code: input.errorCode,
    },
  );
  if (error) throw error;
  return (data || {
    outcome: "invalid_request",
  }) as BillingSubscriptionCardUpdateMutationResult;
}

export async function getBillingSubscriptionCardUpdateStatus(input: {
  jobId: string;
  organizationId: string;
  expectedPaymentId?: string | null;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "get_billing_subscription_card_update_status",
    {
      p_job_id: input.jobId,
      p_organization_id: input.organizationId,
      p_expected_payment_id: input.expectedPaymentId || null,
    },
  );
  if (error) throw error;
  return (data || {
    outcome: "invalid_request",
  }) as BillingSubscriptionCardUpdateStatus;
}

export async function claimBillingSubscriptionCardUpdateJobs(input: {
  workerId: string;
  limit: number;
  leaseSeconds: number;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "claim_billing_subscription_card_update_jobs",
    {
      p_worker_id: input.workerId,
      p_limit: input.limit,
      p_lease_seconds: input.leaseSeconds,
    },
  );
  if (error) throw error;
  return (Array.isArray(data)
    ? data
    : []) as BillingSubscriptionCardUpdateJob[];
}

export async function markBillingSubscriptionCardUpdateProviderRequestStarted(
  input: { job: BillingSubscriptionCardUpdateJob },
) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "mark_billing_subscription_card_update_provider_request_started",
    {
      p_job_id: input.job.job_id,
      p_organization_id: input.job.organization_id,
      p_generation: input.job.generation,
      p_job_lease_id: input.job.job_lease_id,
    },
  );
  if (error) throw error;
  return (data || {
    outcome: "invalid_request",
  }) as BillingSubscriptionCardUpdateProviderMarker;
}

export async function succeedBillingSubscriptionCardUpdateJob(input: {
  job: BillingSubscriptionCardUpdateJob;
  providerSnapshot: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "succeed_billing_subscription_card_update_job",
    {
      p_job_id: input.job.job_id,
      p_organization_id: input.job.organization_id,
      p_generation: input.job.generation,
      p_job_lease_id: input.job.job_lease_id,
      p_provider_snapshot: input.providerSnapshot,
    },
  );
  if (error) throw error;
  return (data || {
    outcome: "invalid_request",
  }) as BillingSubscriptionCardUpdateMutationResult;
}

export async function failBillingSubscriptionCardUpdateJob(input: {
  job: BillingSubscriptionCardUpdateJob;
  failureClass: BillingSubscriptionCardUpdateFailureClass;
  errorCode: string;
  retryAfterSeconds?: number;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "fail_billing_subscription_card_update_job",
    {
      p_job_id: input.job.job_id,
      p_organization_id: input.job.organization_id,
      p_generation: input.job.generation,
      p_job_lease_id: input.job.job_lease_id,
      p_failure_class: input.failureClass,
      p_error_code: input.errorCode,
      p_retry_after_seconds: input.retryAfterSeconds || 30,
    },
  );
  if (error) throw error;
  return (data || {
    outcome: "invalid_request",
  }) as BillingSubscriptionCardUpdateMutationResult;
}
