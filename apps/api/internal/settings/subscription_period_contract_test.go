package settings

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSubscriptionOverviewExposesContractedPeriodAndRenewalTotal(t *testing.T) {
	t.Parallel()

	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to resolve test source path")
	}

	repositoryPath := filepath.Join(filepath.Dir(sourceFile), "repository.go")
	payload, err := os.ReadFile(repositoryPath)
	if err != nil {
		t.Fatalf("read settings repository: %v", err)
	}
	repositorySource := strings.ToLower(string(payload))

	for _, required := range []string{
		"'subscription_billing_period_months', o.subscription_billing_period_months",
		"'subscription_renewal_value', round(",
		"coalesce(o.subscription_value, current_plan.price, 0)::numeric",
		"* o.subscription_billing_period_months",
	} {
		if !strings.Contains(repositorySource, required) {
			t.Fatalf("subscription renewal contract is missing %q", required)
		}
	}
}
