package billing

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

const paymentCheckoutCapabilityMigration = "20260804101153_secure_billing_payment_checkout_capabilities.sql"

func TestPaymentCheckoutCapabilityTableIsPaymentScopedAndServiceOnly(t *testing.T) {
	t.Parallel()

	source := paymentCheckoutCapabilityMigrationSQL(t)
	for _, required := range []string{
		"create table if not exists public.billing_payment_checkout_capabilities",
		"payment_id uuid primary key",
		"asaas_payment_id text not null unique",
		"checkout_token text not null unique default encode(extensions.gen_random_bytes(32), 'hex')",
		"attempt_lease_id uuid",
		"attempt_lease_expires_at timestamptz",
		"attempt_window_started_at timestamptz",
		"attempt_window_count integer not null default 0",
		"check (checkout_token ~ '^[0-9a-f]{64}$')",
		"attempt_window_count between 0 and 5",
		"foreign key (payment_id, asaas_payment_id, organization_id)",
		"foreign key (payment_id, billing_intent_id)",
		"alter table public.billing_payment_checkout_capabilities enable row level security",
		"revoke all privileges on table public.billing_payment_checkout_capabilities from public, anon, authenticated, service_role",
		"grant select, insert, update, delete on table public.billing_payment_checkout_capabilities to service_role",
		"create index if not exists subscriptions_provider_subscription_org_idx on public.subscriptions (provider_subscription_id, organization_id) where provider_subscription_id is not null",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("payment checkout capability security contract is missing %q", required)
		}
	}

	if strings.Contains(source, "on table public.billing_payment_checkout_capabilities to anon") ||
		strings.Contains(source, "on table public.billing_payment_checkout_capabilities to authenticated") {
		t.Fatal("browser roles must never receive capability table privileges")
	}
}

func TestPaymentCheckoutCapabilityResolverUsesImmutableBillingSnapshot(t *testing.T) {
	t.Parallel()

	source := paymentCheckoutCapabilityMigrationSQL(t)
	resolve := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.resolve_billing_payment_checkout_capability",
	)
	snapshot := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"private.resolve_billing_payment_checkout_snapshot",
	)

	for _, required := range []string{
		"payment.billing_intent_id is not distinct from capability.billing_intent_id",
		"private.billing_payment_checkout_is_resolvable(payment.id)",
		"v_plan_id := v_capability.plan_id",
		"v_billing_period_months := v_capability.billing_period_months",
		"v_amount := v_capability.amount",
		"'plan_id', v_plan_id",
		"'billing_period_months', v_billing_period_months",
		"'amount', v_amount",
		"'snapshot_source', v_capability.snapshot_source",
	} {
		if !strings.Contains(resolve, required) {
			t.Fatalf("capability billing snapshot contract is missing %q", required)
		}
	}

	for _, required := range []string{
		"from private.billing_checkout_intents as intent",
		"abs(v_payment.value - intent.amount) <= 0.01",
		"v_subscription_count = 1",
		"v_subscription_count > 1",
		"p_allow_legacy_catalog",
		"organization_row.pending_plan_id is null",
		"join public.admin_subscription_plans as plan",
		"plan.price * organization_row.subscription_billing_period_months",
		"'legacy_catalog'::text",
	} {
		if !strings.Contains(snapshot, required) {
			t.Fatalf("capability snapshot issuance contract is missing %q", required)
		}
	}

	for _, forbidden := range []string{"admin_subscription_plans", ".price"} {
		if strings.Contains(resolve, forbidden) {
			t.Fatalf("capability resolver must not infer the historical charge from %q", forbidden)
		}
	}
}

func TestPaymentCheckoutCardAttemptLeaseIsAtomicAndRateLimited(t *testing.T) {
	t.Parallel()

	source := paymentCheckoutCapabilityMigrationSQL(t)
	claim := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.claim_billing_payment_checkout_attempt",
	)
	release := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.release_billing_payment_checkout_attempt",
	)

	advisoryLock := strings.Index(claim, "perform private.lock_asaas_billing_resources")
	paymentLock := strings.Index(claim, "from public.asaas_payments as payment")
	capabilityLock := strings.Index(claim, "from public.billing_payment_checkout_capabilities as capability")
	cancellationLock := strings.Index(claim, "from private.billing_subscription_checkout_cancellations as cancellation")
	if advisoryLock < 0 || paymentLock <= advisoryLock || capabilityLock <= paymentLock || cancellationLock <= capabilityLock {
		t.Fatal("card attempt claim must lock provider advisory, payment, capability, then cancellation")
	}
	for _, required := range []string{
		"for update",
		"private.billing_payment_checkout_is_actionable(v_payment.status)",
		"capability.billing_intent_id is not distinct from v_payment.billing_intent_id",
		"v_capability.attempt_lease_expires_at > v_now",
		"'outcome', 'busy'",
		"interval '15 minutes'",
		"v_window_count >= 5",
		"'outcome', 'rate_limited'",
		"interval '300 seconds'",
		"'busy_reason', 'subscription_cancellation'",
		"'busy_reason', 'payment_cancellation'",
		"v_cancellation_finalized_at is not null",
		"revoked_at = coalesce(revoked_at, v_now)",
		"attempt_window_count = v_window_count + 1",
		"'outcome', 'claimed'",
	} {
		if !strings.Contains(claim, required) {
			t.Fatalf("card attempt claim contract is missing %q", required)
		}
	}

	for _, required := range []string{
		"capability.payment_id = p_payment_id",
		"capability.asaas_payment_id = v_provider_payment_id",
		"capability.attempt_lease_id = p_lease_id",
		"attempt_lease_id = null",
		"attempt_lease_expires_at = null",
		"'outcome', 'released'",
	} {
		if !strings.Contains(release, required) {
			t.Fatalf("card attempt release contract is missing %q", required)
		}
	}
}

func TestSubscriptionCancellationAndPaymentAttemptAreMutuallyExclusive(t *testing.T) {
	t.Parallel()

	source := paymentCheckoutCapabilityMigrationSQL(t)
	claim := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.claim_billing_subscription_checkout_cancellation",
	)
	finalize := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.finalize_billing_subscription_checkout_cancellation",
	)
	jobs := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.claim_billing_subscription_checkout_cancellation_jobs",
	)

	for name, function := range map[string]string{
		"claim":    claim,
		"finalize": finalize,
	} {
		advisoryLock := strings.Index(function, "perform private.lock_asaas_billing_resources")
		if advisoryLock < 0 {
			t.Fatalf("%s must acquire provider advisory locks", name)
		}
		lockedSection := function[advisoryLock:]
		paymentLock := strings.Index(lockedSection, "from public.asaas_payments as payment")
		capabilityLock := strings.Index(lockedSection, "from public.billing_payment_checkout_capabilities as capability")
		cancellationLock := strings.Index(lockedSection, "from private.billing_subscription_checkout_cancellations as cancellation")
		intentLock := strings.Index(lockedSection, "from private.billing_checkout_intents as intent")
		if paymentLock < 0 || capabilityLock <= paymentLock || cancellationLock <= capabilityLock || intentLock <= cancellationLock {
			t.Fatalf("%s must lock payment, capability, cancellation, then intent after provider advisory locks", name)
		}
	}

	for _, required := range []string{
		"provider_payment_id text, provider_subscription_id text not null unique",
		"provider_customer_id text not null, external_reference text not null, amount numeric(10, 2) not null, billing_period_months integer not null, next_due_date date",
		"p_lease_seconds integer default 600",
		"v_capability.attempt_lease_expires_at > v_now",
		"'busy_reason', 'payment_attempt'",
		"private.billing_subscription_checkout_cancellations.provider_payment_id is not distinct from excluded.provider_payment_id",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("cancellation fence contract is missing %q", required)
		}
	}

	for _, required := range []string{
		"returns table ( organization_id uuid, intent_id uuid, provider_payment_id text, reconciliation_payment_id text, provider_subscription_id text, provider_customer_id text, external_reference text, amount numeric(10, 2), billing_period_months integer, next_due_date date, claim_token uuid, lease_expires_at timestamptz )",
		"v_claim ->> 'reconciliation_payment_id'",
		"cancellation.finalized_at is null",
		"cancellation.lease_expires_at <= clock_timestamp()",
		"public.claim_billing_subscription_checkout_cancellation(",
		"coalesce(v_claim ->> 'outcome', '') = 'claimed'",
	} {
		if !strings.Contains(jobs, required) {
			t.Fatalf("cancellation recovery worker contract is missing %q", required)
		}
	}
	if strings.Contains(jobs, "for update") {
		t.Fatal("the recovery candidate scan must not take a cancellation row lock before provider advisory locks")
	}

	for _, required := range []string{
		"revoked_at = coalesce(revoked_at, now())",
		"attempt_lease_id = null",
		"attempt_lease_expires_at = null",
		"and billing_intent_id = p_intent_id",
	} {
		if !strings.Contains(finalize, required) {
			t.Fatalf("cancellation finalizer must terminally fence the checkout bearer: missing %q", required)
		}
	}
}

func TestBillingCardRecurrenceStateIsDurableExactAndServiceOnly(t *testing.T) {
	t.Parallel()

	source := paymentCheckoutCapabilityMigrationSQL(t)
	for _, required := range []string{
		"create table if not exists private.billing_card_recurrence_provisions",
		"payment_id uuid primary key",
		"billing_intent_id uuid not null",
		"plan_id uuid not null",
		"billing_period_months integer not null",
		"amount numeric(10, 2) not null",
		"provider_customer_id text not null",
		"next_due_date date not null",
		"external_reference text not null unique",
		"status text not null default 'prepared'",
		"constraint billing_card_recurrence_status_check",
		"'cancelled'",
		"job_action text not null default 'create'",
		"job_status text not null default 'waiting'",
		"job_lock_expires_at timestamptz",
		"job_locked_by text",
		"job_lease_id uuid",
		"job_max_attempts integer not null default 8",
		"external_reference = ( 'vimob:billing-card-recurrence:' || payment_id::text )",
		"foreign key (payment_id, provider_payment_id, organization_id)",
		"foreign key (payment_id, billing_intent_id)",
		"alter table private.billing_card_recurrence_provisions enable row level security",
		"revoke all privileges on table private.billing_card_recurrence_provisions from public, anon, authenticated, service_role",
		"grant select, insert, update, delete on table private.billing_card_recurrence_provisions to service_role",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("card recurrence durability contract is missing %q", required)
		}
	}
}

func TestBillingCardRecurrencePrepareAndClaimAreFailClosed(t *testing.T) {
	t.Parallel()

	source := paymentCheckoutCapabilityMigrationSQL(t)
	prepare := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.prepare_billing_card_recurrence",
	)
	claim := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.claim_billing_card_recurrence",
	)
	preparePaymentLock := strings.Index(prepare, "from public.asaas_payments as payment")
	prepareProvisionLock := strings.Index(prepare, "from private.billing_card_recurrence_provisions as provision")
	prepareIntentLock := strings.Index(prepare, "from private.billing_checkout_intents as intent")
	if preparePaymentLock < 0 || prepareProvisionLock <= preparePaymentLock || prepareIntentLock <= prepareProvisionLock {
		t.Fatal("card recurrence prepare must lock payment, existing provision, then immutable intent")
	}

	for _, required := range []string{
		"private.billing_payment_checkout_is_actionable(v_payment.status) or private.billing_payment_checkout_is_paid(v_payment.status)",
		"from private.billing_checkout_intents as intent",
		"v_intent.provider_payment_id is distinct from v_payment.asaas_payment_id",
		"v_intent.provider_customer_id is distinct from v_payment.asaas_customer_id",
		"abs(v_intent.amount - v_payment.value) > 0.01",
		"private.billing_card_recurrence_external_reference(v_payment.id)",
		"greatest( current_date, coalesce(v_payment.due_date, current_date) ) + make_interval(months => v_intent.billing_period_months)",
		"on conflict (payment_id) do nothing",
		"'outcome', 'immutable_tuple_mismatch'",
		"'credential_stored', v_provision.provider_card_credential is not null",
	} {
		if !strings.Contains(prepare, required) {
			t.Fatalf("card recurrence prepare contract is missing %q", required)
		}
	}

	paymentLock := strings.Index(claim, "from public.asaas_payments as payment")
	provisionLock := strings.Index(claim, "from private.billing_card_recurrence_provisions as provision")
	if paymentLock < 0 || provisionLock <= paymentLock {
		t.Fatal("card recurrence claim must lock payment before recurrence state")
	}
	for _, required := range []string{
		"private.billing_payment_checkout_is_paid(v_payment.status)",
		"v_payment.asaas_subscription_id is not null",
		"v_provision.status = 'recovering'",
		"'action', 'recover_only'",
		"v_provision.status = 'creating'",
		"last_error = coalesce(last_error, 'creation_lease_expired')",
		"v_provision.status not in ('prepared', 'failed')",
		"interval '15 minutes'",
		"v_window_count >= 5",
		"interval '2 minutes'",
		"'action', 'create_or_recover'",
		"'external_reference', v_provision.external_reference",
		"'next_due_date', v_provision.next_due_date",
	} {
		if !strings.Contains(claim, required) {
			t.Fatalf("card recurrence claim contract is missing %q", required)
		}
	}
}

func TestBillingCardRecurrenceProviderWrapperAndReversalTargetAreExact(t *testing.T) {
	t.Parallel()

	source := paymentCheckoutCapabilityMigrationSQL(t)
	claimByProvider := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.claim_billing_card_recurrence_by_provider_payment",
	)
	for _, required := range []string{
		"where payment.asaas_payment_id = v_provider_payment_id",
		"public.claim_billing_card_recurrence( v_payment_id, v_provider_payment_id ) || jsonb_build_object('payment_id', v_payment_id)",
	} {
		if !strings.Contains(claimByProvider, required) {
			t.Fatalf("provider recurrence wrapper contract is missing %q", required)
		}
	}

	reversal := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.get_billing_card_recurrence_reversal_target",
	)
	advisory := strings.Index(reversal, "private.lock_asaas_billing_resources(")
	paymentRow := strings.Index(reversal, "from public.asaas_payments as payment")
	if advisory < 0 || paymentRow <= advisory {
		t.Fatal("recurrence reversal must lock provider keys before its exact payment row")
	}
	for _, required := range []string{
		"where provision.provider_payment_id = v_provider_payment_id",
		"v_provision.status <> 'completed'",
		"private.billing_payment_checkout_is_reversal(v_payment_status)",
		"'outcome', 'target'",
		"'provider_subscription_id', v_provision.provider_subscription_id",
		"'provider_customer_id', v_provision.provider_customer_id",
		"'external_reference', v_provision.external_reference",
		"'amount', v_provision.amount",
		"'billing_period_months', v_provision.billing_period_months",
		"'next_due_date', v_provision.next_due_date",
	} {
		if !strings.Contains(reversal, required) {
			t.Fatalf("recurrence reversal target contract is missing %q", required)
		}
	}
	if strings.Contains(reversal, "provider_subscription_snapshot") || strings.Contains(reversal, "raw_event") {
		t.Fatal("recurrence reversal target must not expose raw provider snapshots")
	}
}

func TestBillingCardRecurrenceCompletionLinksWithoutReclassifyingPaymentOrAccount(t *testing.T) {
	t.Parallel()

	source := paymentCheckoutCapabilityMigrationSQL(t)
	complete := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"private.complete_billing_card_recurrence_locked",
	)
	reconcile := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.reconcile_billing_card_recurrence_subscription",
	)

	for _, required := range []string{
		"v_external_reference is distinct from v_provision.external_reference",
		"v_customer_id is distinct from v_provision.provider_customer_id",
		"abs(v_amount - v_provision.amount) > 0.01",
		"v_cycle is distinct from v_expected_cycle",
		"v_next_due_date is distinct from v_provision.next_due_date",
		"v_billing_type is distinct from 'credit_card'",
		"v_provider_status is distinct from 'active'",
		"pg_catalog.pg_advisory_xact_lock",
		"update private.billing_checkout_intents set provider_subscription_id = v_subscription_id",
		"update public.organizations set asaas_customer_id = coalesce(asaas_customer_id, v_provision.provider_customer_id), asaas_subscription_id = v_subscription_id",
		"update public.subscriptions set plan_id = coalesce(plan_id, v_provision.plan_id)",
		"current_period_end = v_provision.next_due_date::timestamp at time zone 'utc'",
		"update private.billing_card_recurrence_provisions set status = 'completed'",
		"'outcome', 'completed'",
	} {
		if !strings.Contains(complete, required) {
			t.Fatalf("card recurrence completion contract is missing %q", required)
		}
	}

	if strings.Contains(complete, "update public.asaas_payments") {
		t.Fatal("a future recurrence must never be assigned to the paid one-off payment")
	}
	if strings.Contains(complete, "subscription_status =") {
		t.Fatal("recurrence completion must not reclassify the organization billing status")
	}

	for _, required := range []string{
		"^vimob:billing-card-recurrence:",
		"'outcome', 'not_applicable'",
		"'outcome', 'not_found'",
		"private.complete_billing_card_recurrence_locked( v_payment_id, v_provider_payment_id, null, p_subscription, false )",
	} {
		if !strings.Contains(reconcile, required) {
			t.Fatalf("card recurrence webhook reconciliation contract is missing %q", required)
		}
	}
}

func TestCheckoutPollingSnapshotWrapperIsExactAndServiceOnly(t *testing.T) {
	t.Parallel()

	source := paymentCheckoutCapabilityMigrationSQL(t)
	reconcile := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.reconcile_asaas_payment_snapshot",
	)

	for _, required := range []string{
		"where payment.asaas_payment_id = v_payment_id for update",
		"v_payment.organization_id is distinct from p_organization_id",
		"v_payment.asaas_customer_id is not null",
		"v_payment.asaas_subscription_id is not null",
		"from private.billing_checkout_intents as intent",
		"abs(v_expected_amount - p_payment_amount) > 0.01",
		"where organization_row.id = p_organization_id and nullif(btrim(coalesce(organization_row.asaas_customer_id, '')), '') = v_customer_id and nullif(btrim(coalesce(organization_row.asaas_subscription_id, '')), '') = v_subscription_id",
		"subscription.provider_customer_id = v_customer_id and subscription.provider_subscription_id = v_subscription_id",
		"v_expected_amount := round(v_plan.price * v_period, 2)",
		"on conflict (asaas_payment_id) do nothing",
		"'created', 'pending', 'awaiting_risk_analysis'",
		"'canceled', 'cancelled', 'deleted', 'bank_slip_cancelled'",
		"private.apply_asaas_billing_snapshot_with_payment( p_organization_id, v_customer_id, v_subscription_id, null::text, v_payment_id, v_status, p_payment_amount, p_payment_due_date, null::date, v_effective_observed_at, v_source )",
	} {
		if !strings.Contains(reconcile, required) {
			t.Fatalf("checkout polling reconciliation contract is missing %q", required)
		}
	}
}

func TestPaymentWebhookUsesCanonicalSemanticOrderingOnTheRealEntryPoint(t *testing.T) {
	t.Parallel()

	source := paymentCheckoutCapabilityMigrationSQL(t)
	webhook := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.reconcile_asaas_payment_webhook",
	)

	for _, required := range []string{
		"perform private.lock_asaas_billing_resources(v_payment_id, v_subscription_id)",
		"private.correct_asaas_naive_event_timestamp(p_payload)",
		"private.asaas_payment_status_from_event",
		"v_event_at < v_cursor",
		"v_event_at = v_cursor",
		"private.asaas_payment_status_precedence(v_status)",
		"private.asaas_payment_status_precedence(v_prior_payment_status)",
		"private.asaas_organization_status_from_payment",
		"when 'payment_chargeback' then 'chargeback'",
		"when 'payment_reproved_by_risk_analysis' then 'reproved_by_risk_analysis'",
		"if v_status = 'refund_denied' and v_payment.id is not null then",
		"v_effective_paid_status := coalesce(v_effective_paid_status, 'refund_denied')",
		"private.billing_organization_access_causes",
		"private.reconcile_billing_payment_access_proof",
		"where provision.payment_id = v_payment.id",
		"refund_denied_unrelated_suspension",
		"asaas_last_event_received_at = v_received_at",
	} {
		if !strings.Contains(webhook, required) && !strings.Contains(source, required) {
			t.Fatalf("ordered payment webhook contract is missing %q", required)
		}
	}

	if !strings.Contains(source, "grant execute on function public.reconcile_asaas_payment_webhook") ||
		!strings.Contains(source, ") to service_role") {
		t.Fatal("ordered payment webhook must remain callable only by service_role")
	}
}

func TestRefundDeniedCannotUndoAnotherPaymentsSuspension(t *testing.T) {
	t.Parallel()

	source := paymentCheckoutCapabilityMigrationSQL(t)
	statusMapping := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"private.asaas_organization_status_from_payment",
	)

	for _, required := range []string{
		"when lower(btrim(coalesce(p_current_status, ''))) in ('active', 'trial') then p_current_status",
		"else coalesce(nullif(lower(btrim(p_current_status)), ''), 'pending_payment')",
	} {
		if !strings.Contains(statusMapping, required) {
			t.Fatalf("REFUND_DENIED organization status contract is missing %q", required)
		}
	}
	if strings.Contains(statusMapping, "when upper(btrim(coalesce(p_payment_status, ''))) = 'refund_denied' then 'active'") {
		t.Fatal("REFUND_DENIED must not reactivate an unrelated suspended payment unconditionally")
	}

	for _, required := range []string{
		"create table if not exists private.billing_organization_access_causes",
		"primary key (organization_id, provider_payment_id)",
		"revoke all privileges on table private.billing_organization_access_causes from public, anon, authenticated, service_role",
		"create or replace function private.reconcile_billing_payment_access_proof",
		"cause.provider_payment_id = v_payment.asaas_payment_id",
		"cause_payment.billing_intent_id = v_payment.billing_intent_id",
		"cause.payment_status in (",
		"return 'suspended'",
		"return 'overdue'",
		"return 'pending_payment'",
		"return 'active'",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("multi-payment access-cause contract is missing %q", required)
		}
	}
	if strings.Contains(source, "delete from private.billing_organization_access_causes where organization_id = p_organization_id") {
		t.Fatal("a paid observation must never delete every access cause for the organization")
	}
}

func TestDeletedPIXRestoreClaimFencesProviderPOSTWhileLocalStateIsActionable(t *testing.T) {
	t.Parallel()

	source := paymentCheckoutCapabilityMigrationSQL(t)
	claim := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.claim_billing_payment_restore",
	)

	paymentLock := strings.Index(claim, "from public.asaas_payments as payment")
	capabilityLock := strings.Index(claim, "from public.billing_payment_checkout_capabilities as capability")
	markerReplay := strings.Index(claim, "if v_started_at is not null then")
	alreadyRestored := strings.Index(claim, "if private.billing_payment_checkout_is_processing(v_status) or private.billing_payment_checkout_is_paid(v_status) then")
	if paymentLock < 0 || capabilityLock <= paymentLock {
		t.Fatal("PIX restore must lock the payment before its exact checkout capability")
	}
	if markerReplay < 0 || alreadyRestored <= markerReplay {
		t.Fatal("an irreversible restore marker must force GET-only recovery before any local status shortcut")
	}

	for _, required := range []string{
		"capability.payment_id = v_payment.id",
		"capability.asaas_payment_id = v_payment.asaas_payment_id",
		"capability.organization_id = v_payment.organization_id",
		"capability.billing_intent_id is not distinct from v_payment.billing_intent_id",
		"capability.checkout_token = v_checkout_token",
		"capability.revoked_at is null",
		"capability.expires_at > now()",
		"if not private.billing_payment_checkout_is_actionable(v_status) and v_status <> 'deleted' then",
		"private.billing_payment_checkout_is_actionable(payment.status) or upper(btrim(coalesce(payment.status, ''))) = 'deleted'",
		"'provider_request_started_at', v_started_at",
		"'status_before_restore', v_status",
		"'outcome', 'claimed'",
		"'outcome', 'recover_only'",
	} {
		if !strings.Contains(claim, required) {
			t.Fatalf("deleted PIX restore fencing contract is missing %q", required)
		}
	}

	if !strings.Contains(source, "grant execute on function public.claim_billing_payment_restore(uuid, text) to service_role") {
		t.Fatal("deleted PIX restore claim must remain service-role only")
	}
}

func TestPaymentCheckoutCapabilityLifecycleFollowsProviderState(t *testing.T) {
	t.Parallel()

	source := paymentCheckoutCapabilityMigrationSQL(t)
	syncFunction := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"private.sync_billing_payment_checkout_capability",
	)

	for _, required := range []string{
		"'created', 'pending', 'overdue'",
		"'dunning_requested', 'dunning_received', 'bank_slip_cancelled'",
		"'confirmed', 'received', 'received_in_cash'",
		"'canceled', 'cancelled', 'deleted'",
		"'refunded', 'refund_requested', 'refund_in_progress', 'refund_denied', 'partially_refunded'",
		"'reproved_by_risk_analysis'",
		"'chargeback', 'chargeback_requested', 'chargeback_dispute'",
		"then encode(extensions.gen_random_bytes(32), 'hex')",
		"private.resolve_billing_payment_checkout_snapshot( new.id, false )",
		"interval '90 days'",
		"set revoked_at = coalesce(revoked_at, now())",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("payment capability lifecycle contract is missing %q", required)
		}
	}

	if !strings.Contains(syncFunction, "if private.billing_payment_checkout_is_actionable(new.status)") ||
		!strings.Contains(syncFunction, "elsif private.billing_payment_checkout_is_terminal(new.status)") {
		t.Fatal("provider state changes must issue authorized links and revoke terminal links")
	}

	for _, required := range []string{
		"v_issue_authorized boolean := false",
		"or not private.billing_payment_checkout_is_actionable(old.status)",
		"if not v_issue_authorized then return new; end if",
		"checkout_token = encode(extensions.gen_random_bytes(32), 'hex')",
		"expires_at = least(expires_at, now() + interval '7 days')",
	} {
		if !strings.Contains(syncFunction, required) {
			t.Fatalf("absolute capability lifetime contract is missing %q", required)
		}
	}

	backfill := strings.Index(source, "cross join lateral private.resolve_billing_payment_checkout_snapshot( payment.id, true ) as snapshot where private.billing_payment_checkout_is_actionable(payment.status)")
	trigger := strings.Index(source, "create trigger sync_billing_payment_checkout_capability")
	if trigger < 0 || backfill < trigger {
		t.Fatal("the migration must install lifecycle synchronization before backfilling actionable payments")
	}
}

func TestPaymentCheckoutCapabilityRPCsAreServiceOnlyAndDoNotLeakTokens(t *testing.T) {
	t.Parallel()

	source := paymentCheckoutCapabilityMigrationSQL(t)
	resolve := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.resolve_billing_payment_checkout_capability",
	)
	ensure := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.ensure_billing_payment_checkout_capability",
	)

	for _, required := range []string{
		"capability.revoked_at is null",
		"capability.expires_at > now()",
		"private.billing_payment_checkout_is_actionable(payment.status)",
		"'outcome', 'not_found'",
		"'outcome', 'resolved'",
		"'organization_id', v_capability.organization_id",
		"'payment_id', v_capability.payment_id",
		"'billing_intent_id', v_capability.billing_intent_id",
	} {
		if !strings.Contains(resolve, required) {
			t.Fatalf("capability resolver contract is missing %q", required)
		}
	}
	if strings.Contains(resolve, "'checkout_token'") {
		t.Fatal("the resolver must never echo a raw capability token")
	}

	organizationGuard := strings.Index(ensure, "v_payment.organization_id is distinct from p_organization_id")
	firstMutation := strings.Index(ensure, "insert into public.billing_payment_checkout_capabilities")
	if organizationGuard < 0 || firstMutation < organizationGuard {
		t.Fatal("the ensure RPC must verify organization ownership before issuing a capability")
	}
	for _, required := range []string{
		"'outcome', 'payment_not_actionable'",
		"'outcome', 'ready'",
		"'checkout_token', v_capability.checkout_token",
		"'expires_at', v_capability.expires_at",
	} {
		if !strings.Contains(ensure, required) {
			t.Fatalf("capability issuance contract is missing %q", required)
		}
	}

	for _, signature := range []string{
		"public.resolve_billing_payment_checkout_capability(text)",
		"public.ensure_billing_payment_checkout_capability(uuid, uuid)",
		"public.claim_organization_checkout_card_attempt(uuid, text, text)",
		"public.claim_authenticated_organization_card_attempt(uuid, uuid, text)",
		"public.claim_billing_payment_card_attempt_guard(uuid, text, text)",
		"public.claim_billing_payment_checkout_attempt(uuid, text)",
		"public.release_billing_payment_checkout_attempt(uuid, text, uuid)",
		"public.prepare_billing_card_recurrence(uuid, text)",
		"public.store_billing_card_recurrence_credential(uuid, text, text, text)",
		"public.claim_billing_card_recurrence(uuid, text)",
		"public.claim_billing_card_recurrence_by_provider_payment(text)",
		"public.get_billing_card_recurrence_reversal_target(text)",
		"public.mark_billing_card_recurrence_recovering(uuid, text, uuid, text)",
		"public.fail_billing_card_recurrence(uuid, text, uuid, text)",
		"public.complete_billing_card_recurrence(uuid, text, uuid, jsonb)",
		"public.reconcile_billing_card_recurrence_subscription(jsonb)",
		"public.get_billing_checkout_state(uuid)",
	} {
		if !strings.Contains(source, "revoke all on function "+signature+" from public, anon, authenticated, service_role") ||
			!strings.Contains(source, "grant execute on function "+signature+" to service_role") {
			t.Fatalf("%s must be executable only by service_role", signature)
		}
	}

	reconcileSignature := "public.reconcile_asaas_payment_snapshot( uuid, text, text, text, text, numeric, date, timestamptz, text )"
	if !strings.Contains(source, "revoke all on function "+reconcileSignature+" from public, anon, authenticated, service_role") ||
		!strings.Contains(source, "grant execute on function "+reconcileSignature+" to service_role") {
		t.Fatal("payment snapshot reconciliation wrapper must be executable only by service_role")
	}
}

func TestPersistentCardAttemptGuardsCoverAuthenticatedAndPaymentFlows(t *testing.T) {
	t.Parallel()

	source := paymentCheckoutCapabilityMigrationSQL(t)
	for _, required := range []string{
		"create table if not exists private.billing_authenticated_org_card_attempt_limits",
		"primary key (organization_id, actor_user_id)",
		"create table if not exists private.billing_payment_card_attempt_limits",
		"payment_id uuid primary key references public.billing_payment_checkout_capabilities (payment_id)",
		"create table if not exists private.billing_ip_card_attempt_limits",
		"revoke all privileges on table private.billing_authenticated_org_card_attempt_limits from public, anon, authenticated, service_role",
		"revoke all privileges on table private.billing_payment_card_attempt_limits from public, anon, authenticated, service_role",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("persistent card guard contract is missing %q", required)
		}
	}

	authenticated := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.claim_authenticated_organization_card_attempt",
	)
	for _, required := range []string{
		"from public.organization_members as membership",
		"permission_override.permission_key = 'settings_billing'",
		"permission.key = 'settings_billing'",
		"v_ip_fingerprint !~ '^[0-9a-f]{64}$'",
		"on conflict (organization_id, actor_user_id) do update",
		"daily_window_count > 10",
		"private.increment_billing_ip_card_attempt_limit",
	} {
		if !strings.Contains(authenticated, required) {
			t.Fatalf("authenticated card guard contract is missing %q", required)
		}
	}

	payment := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.claim_billing_payment_card_attempt_guard",
	)
	for _, required := range []string{
		"payment.id = p_payment_id and payment.asaas_payment_id = v_provider_payment_id",
		"private.billing_payment_checkout_is_resolvable(v_payment.id)",
		"capability.revoked_at is not null",
		"on conflict (payment_id) do update",
		"daily_window_count > 10",
		"private.increment_billing_ip_card_attempt_limit",
		"'limit_scope', case",
	} {
		if !strings.Contains(payment, required) {
			t.Fatalf("payment card guard contract is missing %q", required)
		}
	}
	if strings.Contains(source, "release_billing_payment_card_attempt_guard") ||
		strings.Contains(source, "release_authenticated_organization_card_attempt") {
		t.Fatal("durable card-testing counters must have no release RPC")
	}
}

func TestBillingReconciliationValidatesExactPaymentBeforeActivation(t *testing.T) {
	t.Parallel()

	source := paymentCheckoutCapabilityMigrationSQL(t)
	exact := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"private.apply_asaas_billing_snapshot_with_payment",
	)
	validation := strings.Index(exact, "from public.asaas_payments as payment")
	apply := strings.Index(exact, "private.persist_asaas_billing_snapshot_after_exact_validation(")
	if validation < 0 || apply <= validation {
		t.Fatal("subscription activation helper must run only after exact payment validation")
	}
	for _, required := range []string{
		"p_latest_payment_due_date is null",
		"v_payment.organization_id is distinct from p_organization_id",
		"'field', 'customer'",
		"'field', 'subscription'",
		"v_payment.value is distinct from p_latest_payment_amount",
		"v_intent.amount is distinct from p_latest_payment_amount",
		"'outcome', 'amount_mismatch'",
	} {
		if !strings.Contains(exact, required) {
			t.Fatalf("exact reconciliation gate is missing %q", required)
		}
	}

	method := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.reconcile_asaas_payment_method_change",
	)
	for _, required := range []string{
		"v_old_billing_type = v_new_billing_type",
		"v_new_status in ('confirmed', 'received', 'received_in_cash')",
		"'outcome', 'identifier_mismatch'",
		"'outcome', 'amount_mismatch'",
		"'outcome', 'snapshot_mismatch'",
		"private.apply_asaas_billing_snapshot_with_payment",
		"billing_type = v_new_billing_type",
		"upper(btrim(coalesce(payment.billing_type, ''))) = v_old_billing_type",
	} {
		if !strings.Contains(method, required) {
			t.Fatalf("payment method CAS contract is missing %q", required)
		}
	}
}

func TestRecurrenceCredentialIsSealedReleasedOnceAndCleared(t *testing.T) {
	t.Parallel()

	source := paymentCheckoutCapabilityMigrationSQL(t)
	for _, required := range []string{
		"provider_card_credential text",
		"card_last4 text",
		"provider_card_credential ~ '^v1[.][a-za-z0-9._-]+$'",
		"card_last4 ~ '^[0-9]{4}$'",
		"create trigger clear_billing_card_recurrence_credential_on_failure",
		"check (lower(btrim(role)) in ('owner', 'admin', 'manager', 'user'))",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("sealed recurrence credential contract is missing %q", required)
		}
	}

	store := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.store_billing_card_recurrence_credential",
	)
	for _, required := range []string{
		"p_credential_ciphertext text",
		"v_credential !~ '^v1[.][a-za-z0-9._-]+$'",
		"v_card_last4 !~ '^[0-9]{4}$'",
		"v_provision.provider_card_credential is not null",
		"'outcome', 'credential_conflict'",
		"provider_card_credential = v_credential",
	} {
		if !strings.Contains(store, required) {
			t.Fatalf("sealed credential store contract is missing %q", required)
		}
	}
	for _, forbidden := range []string{"p_remote_ip", "p_card_number", "p_cvv", "p_ccv", "p_provider_card_token"} {
		if strings.Contains(store, forbidden) {
			t.Fatalf("sealed credential store must not accept plaintext field %q", forbidden)
		}
	}

	claim := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.claim_billing_card_recurrence",
	)
	for _, required := range []string{
		"if v_provision.provider_card_credential is null",
		"provider_card_credential = null",
		"'provider_card_credential', v_provision.provider_card_credential",
		"private.billing_payment_checkout_is_paid(v_payment.status)",
	} {
		if !strings.Contains(claim, required) {
			t.Fatalf("one-time recurrence credential claim is missing %q", required)
		}
	}

	cleanup := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"private.clear_billing_card_recurrence_credential_on_failure",
	)
	for _, required := range []string{
		"private.billing_payment_checkout_is_terminal(v_status)",
		"v_status = 'credit_card_capture_refused'",
		"provider_card_credential = null",
		"last_error = 'payment_not_paid_terminal'",
	} {
		if !strings.Contains(cleanup, required) {
			t.Fatalf("terminal credential cleanup contract is missing %q", required)
		}
	}

	checkoutState := paymentCheckoutCapabilityMigrationFunction(
		t,
		source,
		"public.get_billing_checkout_state",
	)
	for _, required := range []string{
		"'bank_slip_registration_cancelled'",
		"'bank_slip_registration_cancelled_due_date'",
		"payment.bank_slip_registration_cancelled_due_date is not distinct from payment.due_date",
	} {
		if !strings.Contains(checkoutState, required) {
			t.Fatalf("safe checkout boleto state is missing %q", required)
		}
	}
	if strings.Contains(checkoutState, "raw_event") {
		t.Fatal("organization checkout state must never expose raw provider events")
	}
}

func paymentCheckoutCapabilityMigrationSQL(t *testing.T) string {
	t.Helper()

	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to resolve test source path")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(sourceFile), "..", "..", "..", ".."))
	payload, err := os.ReadFile(filepath.Join(root, "supabase", "migrations", paymentCheckoutCapabilityMigration))
	if err != nil {
		t.Fatalf("read payment checkout capability migration: %v", err)
	}
	return strings.ToLower(strings.Join(strings.Fields(string(payload)), " "))
}

func paymentCheckoutCapabilityMigrationFunction(t *testing.T, source string, name string) string {
	t.Helper()

	start := strings.Index(source, "create or replace function "+name)
	if start < 0 {
		t.Fatalf("migration function %s is missing", name)
	}
	end := strings.Index(source[start:], "revoke all on function "+name)
	if end < 0 {
		t.Fatalf("migration function %s terminator is missing", name)
	}
	return source[start : start+end]
}
