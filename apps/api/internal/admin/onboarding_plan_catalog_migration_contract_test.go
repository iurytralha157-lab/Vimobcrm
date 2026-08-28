package admin

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestOnboardingPlanCatalogMigrationKeepsBackendQuoteAuthoritative(t *testing.T) {
	sql := onboardingPlanCatalogMigrationSQL(t)

	for _, required := range []string{
		"p_expected_plan_id uuid",
		"p_expected_monthly_price numeric",
		"abs(p_expected_monthly_price - v_plan.price) > 0.01",
		"'outcome', 'quote_changed'",
		"v_amount := round(v_plan.price * v_period, 2)",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("billing quote contract is missing %q", required)
		}
	}
}

func TestOnboardingPlanCatalogMigrationAdvancesRenewalsFromCurrentPayment(t *testing.T) {
	sql := onboardingPlanCatalogMigrationSQL(t)
	start := strings.Index(sql, "create or replace function public.reconcile_asaas_payment_webhook_with_period_intent")
	if start < 0 {
		t.Fatal("period-aware payment reconciler is missing")
	}
	end := strings.Index(sql[start:], "revoke all on function public.reconcile_asaas_payment_webhook_with_period_intent")
	if end < 0 {
		t.Fatal("period-aware payment reconciler terminator is missing")
	}
	reconciler := sql[start : start+end]

	for _, required := range []string{
		"coalesce(v_result ->> 'outcome', '') = 'processed'",
		"coalesce(v_confirmation ->> 'outcome', '') not in",
		"p_payment ->> 'duedate'",
		"v_period_anchor + make_interval(months => v_billing_period_months)",
		"subscription_row.billing_period_months in (1, 6, 12)",
		"next_billing_date = greatest",
		"current_period_end = greatest",
	} {
		if !strings.Contains(reconciler, required) {
			t.Fatalf("renewal period contract is missing %q", required)
		}
	}

	if strings.Contains(reconciler, "v_intent.confirmed_at + make_interval") {
		t.Fatal("renewals must not be anchored to the first intent confirmation")
	}
}

func TestOnboardingPlanCatalogMigrationPreventsSubscriptionEventsFromReceding(t *testing.T) {
	sql := onboardingPlanCatalogMigrationSQL(t)
	start := strings.Index(sql, "create or replace function public.reconcile_asaas_subscription_webhook_with_period_intent")
	if start < 0 {
		t.Fatal("period-aware subscription reconciler is missing")
	}
	end := strings.Index(sql[start:], "revoke all on function public.reconcile_asaas_subscription_webhook_with_period_intent")
	if end < 0 {
		t.Fatal("period-aware subscription reconciler terminator is missing")
	}
	reconciler := sql[start : start+end]

	for _, required := range []string{
		"coalesce(v_result ->> 'outcome', '') = 'processed'",
		"'subscription_created'",
		"'subscription_updated'",
		"select max(subscription_row.current_period_end::date)",
		"next_billing_date = coalesce",
		"greatest(",
	} {
		if !strings.Contains(reconciler, required) {
			t.Fatalf("subscription period contract is missing %q", required)
		}
	}
}

func onboardingPlanCatalogMigrationSQL(t *testing.T) string {
	t.Helper()

	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to resolve test source path")
	}
	migrationPath := filepath.Clean(filepath.Join(
		filepath.Dir(sourceFile),
		"..", "..", "..", "..",
		"supabase", "migrations", "20260802153202_align_onboarding_plan_catalog.sql",
	))
	payload, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read onboarding plan catalog migration: %v", err)
	}

	return strings.ToLower(string(payload))
}
