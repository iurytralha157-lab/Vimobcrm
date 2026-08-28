package billing

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

const billingRenewalIntentMigration = "20260804033645_harden_billing_renewal_intent_confirmation.sql"

func TestBillingRenewalIntentConfirmationContract(t *testing.T) {
	t.Parallel()

	source := billingRenewalIntentMigrationSQL(t)
	confirmation := billingRenewalMigrationFunction(
		t,
		source,
		"private.confirm_billing_checkout_intent",
	)

	for _, required := range []string{
		"perform private.lock_asaas_billing_resources",
		"intent.provider_payment_id = v_payment_id",
		"intent.provider_subscription_id = v_subscription_id",
		"'outcome', 'identifier_mismatch'",
		"'outcome', 'amount_missing'",
		"'outcome', 'terminal_state'",
		"'outcome', 'stale_observation'",
		"payment.last_provider_observed_at",
		"v_org.billing_last_reconciled_at",
		"'suspended', 'cancelled', 'canceled'",
		"'renewal', true",
		"'renewal', false",
	} {
		if !strings.Contains(confirmation, required) {
			t.Fatalf("renewal intent contract is missing %q", required)
		}
	}

	confirmedIndex := strings.Index(confirmation, "if v_intent.status = 'confirmed' then")
	renewalIndex := strings.Index(confirmation, "if not v_original_payment then")
	originalAmountIndex := strings.Index(confirmation, "if p_paid_amount is null then")
	organizationUpdateIndex := strings.Index(confirmation, "update public.organizations")
	terminalIndex := strings.Index(confirmation, "'outcome', 'terminal_state'")
	if confirmedIndex < 0 || renewalIndex < confirmedIndex ||
		originalAmountIndex < renewalIndex || terminalIndex < originalAmountIndex ||
		organizationUpdateIndex < terminalIndex {
		t.Fatal("renewal, original amount and terminal guards are ordered unsafely")
	}

	if strings.Contains(confirmation, "provider_payment_id = v_payment_id ) or") {
		t.Fatal("payment and subscription identities must not be correlated by a permissive OR")
	}
	if !strings.Contains(source, "revoke all on function private.confirm_billing_checkout_intent") ||
		!strings.Contains(source, ") from public, anon, authenticated, service_role") {
		t.Fatal("private intent confirmation must remain unavailable to API roles")
	}
}

func TestBillingRenewalWebhookTreatsTerminalIntentAsNonFatal(t *testing.T) {
	t.Parallel()

	source := billingRenewalIntentMigrationSQL(t)
	wrapper := billingRenewalMigrationFunction(
		t,
		source,
		"public.reconcile_asaas_payment_webhook_with_period_intent",
	)

	allowIndex := strings.Index(wrapper, "'terminal_state'")
	periodBranchIndex := strings.Index(wrapper, "if coalesce(v_confirmation ->> 'outcome', '') in ( 'confirmed', 'already_confirmed' ) then")
	legacyBranchIndex := strings.Index(wrapper, "elsif coalesce(v_confirmation ->> 'outcome', '') = 'intent_not_found'")
	if allowIndex < 0 || periodBranchIndex < allowIndex || legacyBranchIndex < periodBranchIndex {
		t.Fatal("terminal outcomes must be accepted without entering intent or legacy period application")
	}

	if !strings.Contains(source, "grant execute on function public.reconcile_asaas_payment_webhook_with_period_intent") ||
		!strings.Contains(source, ") to service_role") {
		t.Fatal("the service-role webhook privilege must be preserved")
	}
}

func billingRenewalIntentMigrationSQL(t *testing.T) string {
	t.Helper()

	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to resolve test source path")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(sourceFile), "..", "..", "..", ".."))
	payload, err := os.ReadFile(filepath.Join(root, "supabase", "migrations", billingRenewalIntentMigration))
	if err != nil {
		t.Fatalf("read billing renewal intent migration: %v", err)
	}
	return strings.ToLower(strings.Join(strings.Fields(string(payload)), " "))
}

func billingRenewalMigrationFunction(t *testing.T, source string, name string) string {
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
