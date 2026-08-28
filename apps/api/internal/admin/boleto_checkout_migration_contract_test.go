package admin

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestBoletoCheckoutMigrationAcceptsBoletoAcrossTheIntentContract(t *testing.T) {
	sql := boletoCheckoutMigrationSQL(t)

	for _, required := range []string{
		"drop constraint if exists billing_checkout_intents_billing_method_check",
		"check (billing_method in ('pix', 'boleto', 'credit_card'))",
		"v_method not in ('pix', 'boleto', 'credit_card')",
		"v_amount := round(v_plan.price * v_period, 2)",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("boleto checkout contract is missing %q", required)
		}
	}
}

func TestBoletoCheckoutMigrationBindsOneOffMethodsToTheirPayment(t *testing.T) {
	sql := boletoCheckoutMigrationSQL(t)
	registerProvider := boletoMigrationFunction(t, sql, "public.register_billing_checkout_provider")
	storePayment := boletoMigrationFunction(t, sql, "public.store_billing_checkout_payment")

	for _, required := range []string{
		"v_intent.billing_method in ('pix', 'boleto') and v_payment_id is null",
		"v_intent.provider_payment_id is not null",
		"v_payment_id is distinct from v_intent.provider_payment_id",
	} {
		if !strings.Contains(registerProvider, required) {
			t.Fatalf("boleto provider registration contract is missing %q", required)
		}
	}

	for _, required := range []string{
		"v_intent.billing_method in ('pix', 'boleto')",
		"v_intent.provider_payment_id <> v_payment_id",
		"v_billing_type <> v_intent.billing_method",
		"provider payment belongs to a different billing intent",
	} {
		if !strings.Contains(storePayment, required) {
			t.Fatalf("boleto payment persistence contract is missing %q", required)
		}
	}
}

func TestBoletoCheckoutMigrationCancelsAndTracksBoletoLikePix(t *testing.T) {
	sql := boletoCheckoutMigrationSQL(t)
	cancelIntent := boletoMigrationFunction(t, sql, "public.cancel_billing_checkout_intent")
	confirmationTrigger := boletoMigrationFunction(t, sql, "private.confirm_billing_checkout_from_payment")

	if !strings.Contains(cancelIntent, "billing_method in ('pix', 'boleto')") {
		t.Fatal("boleto cancellation must close the matching one-off intent")
	}

	if strings.Count(confirmationTrigger, "billing_method in ('pix', 'boleto')") < 2 {
		t.Fatal("payment trigger must handle both terminal and overdue boleto states")
	}

	for _, required := range []string{
		"'canceled'",
		"'cancelled'",
		"'deleted'",
		"= 'overdue'",
	} {
		if !strings.Contains(confirmationTrigger, required) {
			t.Fatalf("boleto payment trigger is missing status contract %q", required)
		}
	}
}

func TestBoletoCheckoutMigrationKeepsBillingRPCsServiceOnly(t *testing.T) {
	sql := boletoCheckoutMigrationSQL(t)

	for _, functionName := range []string{
		"public.reserve_billing_checkout_intent",
		"public.register_billing_checkout_provider",
		"public.store_billing_checkout_payment",
		"public.cancel_billing_checkout_intent",
	} {
		if !strings.Contains(sql, "revoke all on function "+functionName) {
			t.Fatalf("missing revoke for %s", functionName)
		}
		grant := boletoMigrationStatement(t, sql, "grant execute on function "+functionName)
		if !strings.Contains(grant, "to service_role") {
			t.Fatalf("missing service-role grant for %s", functionName)
		}
	}

	if !strings.Contains(sql, "revoke all on function private.confirm_billing_checkout_from_payment() from public, anon, authenticated, service_role") {
		t.Fatal("private payment trigger function must remain unavailable to API roles")
	}
}

func boletoCheckoutMigrationSQL(t *testing.T) string {
	t.Helper()

	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to resolve test source path")
	}
	migrationPath := filepath.Clean(filepath.Join(
		filepath.Dir(sourceFile),
		"..", "..", "..", "..",
		"supabase", "migrations", "20260803182722_add_boleto_checkout.sql",
	))
	payload, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read boleto checkout migration: %v", err)
	}

	return strings.ToLower(strings.Join(strings.Fields(string(payload)), " "))
}

func boletoMigrationFunction(t *testing.T, sql string, functionName string) string {
	t.Helper()

	startMarker := "create or replace function " + functionName
	start := strings.Index(sql, startMarker)
	if start < 0 {
		t.Fatalf("migration function %s is missing", functionName)
	}
	endMarker := "revoke all on function " + functionName
	end := strings.Index(sql[start:], endMarker)
	if end < 0 {
		t.Fatalf("migration function %s terminator is missing", functionName)
	}

	return sql[start : start+end]
}

func boletoMigrationStatement(t *testing.T, sql string, marker string) string {
	t.Helper()

	start := strings.Index(sql, marker)
	if start < 0 {
		t.Fatalf("migration statement %q is missing", marker)
	}
	end := strings.Index(sql[start:], ";")
	if end < 0 {
		t.Fatalf("migration statement %q is not terminated", marker)
	}

	return sql[start : start+end]
}
