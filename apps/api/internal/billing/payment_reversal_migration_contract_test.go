package billing

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

const paymentReversalMigration = "20260804032351_harden_asaas_payment_reversal_states.sql"

func TestPaymentReversalMigrationSuspendsEveryBlockingAsaasState(t *testing.T) {
	t.Parallel()

	source := paymentReversalMigrationSQL(t)
	webhook := paymentReversalFunction(t, source, "public.reconcile_asaas_payment_webhook")
	snapshot := paymentReversalFunction(t, source, "private.apply_asaas_billing_snapshot")

	for _, status := range []string{
		"refunded",
		"refund_requested",
		"refund_in_progress",
		"partially_refunded",
		"received_in_cash_undone",
		"chargeback_requested",
		"chargeback_dispute",
		"awaiting_chargeback_reversal",
	} {
		if !strings.Contains(webhook, "'"+status+"'") {
			t.Fatalf("webhook reversal contract is missing %q", status)
		}
		if !strings.Contains(snapshot, "'"+status+"'") {
			t.Fatalf("snapshot reversal contract is missing %q", status)
		}
	}

	if !strings.Contains(webhook, "v_new_organization_status := 'suspended'") {
		t.Fatal("webhook reversals must suspend organization access")
	}
	if !strings.Contains(snapshot, "v_new_status := 'suspended'") {
		t.Fatal("periodic reversals must suspend organization access")
	}
	if !strings.Contains(snapshot, "greatest( v_org.billing_last_reconciled_at, v_org.asaas_last_event_at ) > v_observed_at") {
		t.Fatal("periodic reconciliation must reject observations older than either organization cursor")
	}
	if !strings.Contains(webhook, "greatest( asaas_last_event_at, billing_last_reconciled_at ) > v_event_at") {
		t.Fatal("webhook reconciliation must reject events older than either organization cursor")
	}

	cancelledGuard := strings.Index(webhook, "v_current_organization_status in ( 'suspended', 'cancelled', 'canceled' )")
	paidTransition := strings.Index(webhook, "v_payment_status in ('confirmed', 'received', 'received_in_cash')")
	if cancelledGuard < 0 || paidTransition < 0 || cancelledGuard > paidTransition {
		t.Fatal("webhook must preserve cancelled organizations before considering a paid transition")
	}
	if !strings.Contains(snapshot, "v_org.subscription_status in ('cancelled', 'canceled', 'suspended')") {
		t.Fatal("periodic reconciliation must preserve terminal organizations")
	}
}

func TestCheckoutConfirmationDistinguishesRenewalsAndTerminalTenants(t *testing.T) {
	t.Parallel()

	source := paymentReversalMigrationSQL(t)
	confirmation := paymentReversalFunction(
		t,
		source,
		"private.confirm_billing_checkout_intent",
	)

	for _, required := range []string{
		"if v_intent.status = 'confirmed' then",
		"v_intent.provider_payment_id = v_payment_id",
		"'outcome', 'already_confirmed'",
		"v_org.subscription_status in ('suspended', 'cancelled', 'canceled')",
		"'outcome', 'terminal_state'",
		"'outcome', 'stale_observation'",
		"v_org.billing_last_reconciled_at",
		"'outcome', 'amount_mismatch'",
	} {
		if !strings.Contains(confirmation, required) {
			t.Fatalf("checkout confirmation hardening is missing %q", required)
		}
	}

	confirmedGuard := strings.Index(confirmation, "if v_intent.status = 'confirmed' then")
	originalPaymentGuard := strings.Index(confirmation, "v_intent.provider_payment_id = v_payment_id")
	alreadyConfirmed := strings.Index(confirmation, "'outcome', 'already_confirmed'")
	terminalGuard := strings.Index(confirmation, "v_org.subscription_status in ('suspended', 'cancelled', 'canceled')")
	pendingAmountCheck := strings.LastIndex(confirmation, "abs(v_intent.amount - p_paid_amount) > 0.01")
	if confirmedGuard < 0 || originalPaymentGuard < confirmedGuard ||
		alreadyConfirmed < originalPaymentGuard || terminalGuard < alreadyConfirmed ||
		pendingAmountCheck < terminalGuard {
		t.Fatal("renewals must bypass the original amount check while pending intents remain fail-closed")
	}
}

func TestPaymentReversalMigrationPersistsThePolledPaymentAtomically(t *testing.T) {
	t.Parallel()

	source := paymentReversalMigrationSQL(t)
	withPayment := paymentReversalFunction(
		t,
		source,
		"private.apply_asaas_billing_snapshot_with_payment",
	)

	for _, required := range []string{
		"add column if not exists last_provider_observed_at timestamptz",
		"perform private.lock_asaas_billing_resources",
		"from public.asaas_payments payment",
		"for update",
		"provider payment belongs to a different organization",
		"provider payment belongs to a different customer",
		"provider payment belongs to a different subscription",
		"provider payment id is required for a paid or reversal snapshot",
		"set last_provider_observed_at = v_observed_at",
		"v_result := private.apply_asaas_billing_snapshot",
		"insert into public.asaas_payments",
		"on conflict (asaas_payment_id) do update",
		"p_latest_payment_due_date date",
		"due_date = coalesce(excluded.due_date, public.asaas_payments.due_date)",
		"last_provider_observed_at = excluded.last_provider_observed_at",
		"public.asaas_payments.organization_id = excluded.organization_id",
		"public.asaas_payments.last_webhook_event_at",
		"public.asaas_payments.last_provider_observed_at",
		"get diagnostics v_persisted = row_count",
		"provider payment snapshot lost its identity or ordering race",
		"v_confirmation := private.confirm_billing_checkout_intent",
		"'confirmed', 'already_confirmed', 'intent_not_found', 'terminal_state'",
		"billing intent confirmation failed",
	} {
		if !strings.Contains(source, required) && !strings.Contains(withPayment, required) {
			t.Fatalf("polled payment persistence contract is missing %q", required)
		}
	}

	applyIndex := strings.Index(withPayment, "v_result := private.apply_asaas_billing_snapshot")
	confirmIndex := strings.Index(withPayment, "v_confirmation := private.confirm_billing_checkout_intent")
	persistIndex := strings.Index(withPayment, "insert into public.asaas_payments")
	cursorAdvanceIndex := strings.Index(withPayment, "set last_provider_observed_at = v_observed_at")
	organizationBarrier := strings.Index(withPayment, "v_org.asaas_last_event_at ) > v_observed_at")
	if organizationBarrier < 0 || cursorAdvanceIndex < 0 || applyIndex < 0 ||
		confirmIndex < 0 || persistIndex < 0 ||
		organizationBarrier > cursorAdvanceIndex || cursorAdvanceIndex > applyIndex ||
		applyIndex > confirmIndex || confirmIndex > persistIndex {
		t.Fatal("polling must pass both stale barriers and align the payment cursor before applying, confirming and persisting")
	}

	if !strings.Contains(source, "revoke all on function private.apply_asaas_billing_snapshot_with_payment") ||
		!strings.Contains(source, ") from public, anon, authenticated, service_role") {
		t.Fatal("the private polling function must remain unavailable to API roles")
	}
}

func TestPaymentReversalMigrationKeepsManagedPlanChangesTerminalSafe(t *testing.T) {
	t.Parallel()

	source := paymentReversalMigrationSQL(t)
	planChange := paymentReversalFunction(
		t,
		source,
		"private.apply_scheduled_billing_plan_change",
	)

	for _, required := range []string{
		"select organization.subscription_status, greatest( organization.asaas_last_event_at, organization.billing_last_reconciled_at ) into v_organization_status, v_organization_cursor",
		"for update",
		"v_organization_status in ('suspended', 'cancelled', 'canceled')",
		"greatest( new.last_webhook_event_at, new.last_provider_observed_at )",
		"v_payment_cursor is null",
		"v_organization_cursor > v_payment_cursor",
		"and subscription_status not in ('suspended', 'cancelled', 'canceled')",
		"new.due_date >= plan_change.effective_on",
		"abs(new.value - plan_change.amount) <= 0.01",
	} {
		if !strings.Contains(planChange, required) {
			t.Fatalf("managed plan-change terminal guard is missing %q", required)
		}
	}

	cursorGuard := strings.Index(planChange, "v_organization_cursor > v_payment_cursor")
	applyingTransition := strings.Index(planChange, "set status = 'applying'")
	if cursorGuard < 0 || applyingTransition < 0 || cursorGuard > applyingTransition {
		t.Fatal("managed plan changes must reject stale payment cursors before entering applying")
	}
}

func TestPaymentReversalMigrationCancelsUnsentReceiptDeliveries(t *testing.T) {
	t.Parallel()

	source := paymentReversalMigrationSQL(t)
	invalidation := paymentReversalFunction(
		t,
		source,
		"private.invalidate_billing_receipt_delivery_from_payment",
	)

	for _, required := range []string{
		"'receipt_invalidated', true",
		"'receipt_invalidation_status', v_status",
		"'whatsapp_dispatch_required', false",
		"'required', false",
		"else 'skipped'",
		"metadata ->> 'event_key' = 'billing_payment_receipt'",
		"metadata ->> 'payment_id' = new.id::text",
	} {
		if !strings.Contains(invalidation, required) {
			t.Fatalf("receipt invalidation contract is missing %q", required)
		}
	}

	if !strings.Contains(source, "create trigger asaas_payments_invalidate_billing_receipt_delivery") {
		t.Fatal("payment reversals must trigger receipt delivery invalidation")
	}
}

func TestAsaasWebhookRunbookIncludesEveryReversalEvent(t *testing.T) {
	t.Parallel()

	root := paymentReversalRepositoryRoot(t)
	payload, err := os.ReadFile(filepath.Join(root, "supabase", "functions", "README.md"))
	if err != nil {
		t.Fatalf("read Asaas webhook runbook: %v", err)
	}
	runbook := strings.ToUpper(string(payload))
	for _, event := range []string{
		"PAYMENT_REFUNDED",
		"PAYMENT_REFUND_REQUESTED",
		"PAYMENT_REFUND_IN_PROGRESS",
		"PAYMENT_PARTIALLY_REFUNDED",
		"PAYMENT_RECEIVED_IN_CASH_UNDONE",
		"PAYMENT_CHARGEBACK_REQUESTED",
		"PAYMENT_CHARGEBACK_DISPUTE",
		"PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
	} {
		if !strings.Contains(runbook, "`"+event+"`") {
			t.Fatalf("Asaas webhook runbook is missing %s", event)
		}
	}
}

func paymentReversalMigrationSQL(t *testing.T) string {
	t.Helper()

	root := paymentReversalRepositoryRoot(t)
	payload, err := os.ReadFile(filepath.Join(root, "supabase", "migrations", paymentReversalMigration))
	if err != nil {
		t.Fatalf("read payment reversal migration: %v", err)
	}
	return strings.ToLower(strings.Join(strings.Fields(string(payload)), " "))
}

func paymentReversalRepositoryRoot(t *testing.T) string {
	t.Helper()

	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to resolve test source path")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(sourceFile), "..", "..", "..", ".."))
}

func paymentReversalFunction(t *testing.T, source string, name string) string {
	t.Helper()

	startMarker := "create or replace function " + name
	start := strings.Index(source, startMarker)
	if start < 0 {
		t.Fatalf("migration function %s is missing", name)
	}
	endMarker := "revoke all on function " + name
	end := strings.Index(source[start:], endMarker)
	if end < 0 {
		t.Fatalf("migration function %s terminator is missing", name)
	}
	return source[start : start+end]
}
