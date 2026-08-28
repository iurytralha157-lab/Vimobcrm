package billing

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

const billingIntentTriggerOrderingMigration = "20260804040714_harden_billing_intent_payment_trigger_ordering.sql"

func TestBillingIntentPaymentTriggerOrdersEveryBarrierBeforeMutation(t *testing.T) {
	t.Parallel()

	source := billingIntentTriggerOrderingMigrationSQL(t)
	for _, required := range []string{
		"v_payment_cursor timestamptz := greatest( new.last_webhook_event_at, new.last_provider_observed_at )",
		"if v_payment_cursor is null then return null",
		"perform private.lock_asaas_billing_resources",
		"intent.organization_id is distinct from new.organization_id",
		"from public.organizations organization",
		"organization.asaas_last_event_at",
		"organization.billing_last_reconciled_at",
		"for update",
		"v_organization_cursor > v_payment_cursor",
		"where id = v_intent.id and organization_id = new.organization_id",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("payment trigger ordering contract is missing %q", required)
		}
	}

	missingCursor := strings.Index(source, "if v_payment_cursor is null then")
	advisoryLock := strings.Index(source, "perform private.lock_asaas_billing_resources")
	intentLock := strings.Index(source, "select intent.*")
	organizationLock := strings.Index(source, "from public.organizations organization")
	staleBarrier := strings.Index(source, "v_organization_cursor > v_payment_cursor")
	firstMutation := strings.Index(source, "update private.billing_checkout_intents")
	if missingCursor < 0 || advisoryLock < missingCursor || intentLock < advisoryLock ||
		organizationLock < intentLock || staleBarrier < organizationLock ||
		firstMutation < staleBarrier {
		t.Fatal("required order is cursor presence -> advisory lock -> intent lock -> organization lock -> stale barrier -> mutation")
	}
}

func TestBillingIntentPaymentTriggerPreservesCurrentTerminalSemanticsAndPrivileges(t *testing.T) {
	t.Parallel()

	source := billingIntentTriggerOrderingMigrationSQL(t)
	for _, required := range []string{
		"'canceled', 'cancelled', 'deleted'",
		"billing_method in ('pix', 'boleto')",
		"status = 'cancelled'",
		"'credit_card_capture_refused', 'overdue', 'canceled', 'cancelled', 'deleted'",
		"perform private.confirm_billing_checkout_intent",
		"revoke all on function private.confirm_billing_checkout_from_payment() from public, anon, authenticated, service_role",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("payment trigger compatibility contract is missing %q", required)
		}
	}

	if strings.Contains(source, "drop trigger") || strings.Contains(source, "create trigger") {
		t.Fatal("the forward migration must preserve the existing trigger binding")
	}
}

func billingIntentTriggerOrderingMigrationSQL(t *testing.T) string {
	t.Helper()

	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to resolve test source path")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(sourceFile), "..", "..", "..", ".."))
	payload, err := os.ReadFile(filepath.Join(root, "supabase", "migrations", billingIntentTriggerOrderingMigration))
	if err != nil {
		t.Fatalf("read billing intent trigger ordering migration: %v", err)
	}
	return strings.ToLower(strings.Join(strings.Fields(string(payload)), " "))
}
