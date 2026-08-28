package settings

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestManagedBillingPlanChangeMigrationContract(t *testing.T) {
	t.Parallel()

	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to resolve test source path")
	}
	migrationPath := filepath.Join(
		filepath.Dir(sourceFile),
		"..", "..", "..", "..",
		"supabase", "migrations", "20260804023420_schedule_managed_billing_plan_changes.sql",
	)
	payload, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read managed plan change migration: %v", err)
	}
	source := strings.ToLower(string(payload))

	for _, required := range []string{
		"create table if not exists private.billing_plan_changes",
		"billing_plan_changes_one_active_per_org_idx",
		"billing_plan_changes_organization_idx",
		"billing_plan_changes_from_plan_idx",
		"billing_plan_changes_target_plan_idx",
		"billing_plan_changes_requested_by_idx",
		"where status in ('provider_updating', 'scheduled', 'applying')",
		"alter table private.billing_plan_changes enable row level security",
		"revoke all on table private.billing_plan_changes",
		"private.apply_scheduled_billing_plan_change()",
		"plan_change.status in ('provider_updating', 'scheduled')",
		"and new.due_date >= plan_change.effective_on",
		"and new.due_date >= plan_change.provider_request_started_at::date",
		"and abs(new.value - plan_change.amount) <= 0.01",
		"plan_change.status = 'applying'",
		"subscription_value = round(",
		"v_change.amount / v_change.billing_period_months",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("managed plan change migration is missing %q", required)
		}
	}
	if strings.Contains(source, "and coalesce(plan.is_active, true) = true") {
		t.Fatal("an accepted scheduled change must still apply after its target plan is hidden")
	}
}

func TestSettingsRepositoryReceivesAsaasPlanChangeConfiguration(t *testing.T) {
	t.Parallel()

	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to resolve test source path")
	}
	appPath := filepath.Join(filepath.Dir(sourceFile), "..", "app", "app.go")
	payload, err := os.ReadFile(appPath)
	if err != nil {
		t.Fatalf("read API app composition: %v", err)
	}
	source := string(payload)
	for _, required := range []string{
		"AsaasURL:            cfg.Asaas.APIURL",
		"AsaasAPIKey:         cfg.Asaas.APIKey",
		"AsaasRequestTimeout: cfg.Asaas.RequestTimeout",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("settings repository composition is missing %q", required)
		}
	}
}
