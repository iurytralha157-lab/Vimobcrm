package settings

import (
	"testing"
	"time"
)

func TestRequiresManagedPlanChange(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name               string
		subscriptionType   string
		subscriptionStatus string
		currentPlanID      string
		targetPlanID       string
		providerID         string
		currentConsistent  bool
		want               bool
	}{
		{
			name:               "active paid subscription without provider subscription uses guarded checkout",
			subscriptionType:   "paid",
			subscriptionStatus: "active",
			currentPlanID:      "plan-a",
			targetPlanID:       "plan-b",
			want:               false,
		},
		{
			name:               "active paid provider subscription changing plans is managed",
			subscriptionType:   "paid",
			subscriptionStatus: "active",
			currentPlanID:      "plan-a",
			targetPlanID:       "plan-b",
			providerID:         "sub-existing",
			currentConsistent:  true,
			want:               true,
		},
		{
			name:               "provider linked overdue subscription cannot schedule a managed change",
			subscriptionType:   "paid",
			subscriptionStatus: "overdue",
			currentPlanID:      "plan-a",
			targetPlanID:       "plan-b",
			providerID:         "sub-existing",
			want:               false,
		},
		{
			name:               "the current plan remains idempotent",
			subscriptionType:   " PAID ",
			subscriptionStatus: " ACTIVE ",
			currentPlanID:      "plan-a",
			targetPlanID:       "PLAN-A",
			want:               false,
		},
		{
			name:               "pending checkout can choose another plan",
			subscriptionType:   "paid",
			subscriptionStatus: "pending_payment",
			currentPlanID:      "plan-a",
			targetPlanID:       "plan-b",
			want:               false,
		},
		{
			name:               "free account can upgrade",
			subscriptionType:   "free",
			subscriptionStatus: "active",
			currentPlanID:      "plan-free",
			targetPlanID:       "plan-paid",
			want:               false,
		},
		{
			name:               "missing current plan is outside the managed-change rule",
			subscriptionType:   "paid",
			subscriptionStatus: "active",
			targetPlanID:       "plan-paid",
			want:               false,
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := requiresManagedPlanChange(
				test.subscriptionType,
				test.subscriptionStatus,
				test.currentPlanID,
				test.targetPlanID,
				test.providerID,
				test.currentConsistent,
			); got != test.want {
				t.Fatalf("requiresManagedPlanChange() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestPaidPlanSelectionIsIdempotentOnlyForActiveCurrentPlan(t *testing.T) {
	t.Parallel()

	if !isIdempotentPaidPlanSelection(" PAID ", " ACTIVE ", "plan-a", "PLAN-A", true) {
		t.Fatal("re-selecting the active paid plan must be idempotent")
	}
	if isIdempotentPaidPlanSelection("paid", "overdue", "plan-a", "plan-a", true) {
		t.Fatal("a non-active same-plan selection must require regularization")
	}
	if isIdempotentPaidPlanSelection("paid", "active", "", "", false) {
		t.Fatal("missing plan identifiers cannot be treated as an idempotent selection")
	}
	if isIdempotentPaidPlanSelection("paid", "active", "plan-a", "plan-a", false) {
		t.Fatal("an inconsistent current plan cannot be treated as idempotent")
	}
}

func TestBlocksProviderPlanChangeUntilCurrentContractIsActive(t *testing.T) {
	t.Parallel()

	for _, status := range []string{"overdue", "past_due", "blocked", "suspended", "cancelled"} {
		status := status
		t.Run(status, func(t *testing.T) {
			t.Parallel()
			if !blocksProviderPlanChange("paid", status, "plan-a", "plan-b", "sub-existing", true) {
				t.Fatalf("provider-linked %s subscription must be regularized before changing plans", status)
			}
		})
	}

	if blocksProviderPlanChange("paid", "active", "plan-a", "plan-b", "sub-existing", true) {
		t.Fatal("an active provider-linked subscription can use the managed change flow")
	}
	if blocksProviderPlanChange("paid", "overdue", "plan-a", "plan-b", "", true) {
		t.Fatal("a provider-less account stays in the guarded checkout recovery flow")
	}
	if !blocksProviderPlanChange("paid", "overdue", "plan-a", "plan-a", "sub-existing", true) {
		t.Fatal("a same-plan provider selection is not idempotent until the contract is active")
	}
	if !blocksProviderPlanChange("paid", "active", "", "plan-b", "sub-existing", false) {
		t.Fatal("a provider-linked subscription without a current plan must fail closed")
	}
	if !blocksProviderPlanChange("paid", "active", "plan-orphan", "plan-b", "sub-existing", false) {
		t.Fatal("a provider-linked subscription with an inconsistent current plan must fail closed")
	}
	if !blocksProviderPlanChange("paid", "active", "plan-a", "plan-a", "sub-existing", true) {
		t.Fatal("the guard must prevent a same-plan request from falling through to checkout")
	}
	for _, subscriptionType := range []string{"trial", "free", ""} {
		subscriptionType := subscriptionType
		t.Run("provider linked inconsistent type "+subscriptionType, func(t *testing.T) {
			t.Parallel()
			if !blocksProviderPlanChange(subscriptionType, "active", "plan-a", "plan-b", "sub-existing", true) {
				t.Fatalf("provider-linked subscription type %q must fail closed", subscriptionType)
			}
		})
	}
}

func TestSubscriptionStatusWhilePlanPending(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name               string
		subscriptionType   string
		subscriptionStatus string
		want               string
	}{
		{
			name:               "free access remains available while upgrade awaits payment",
			subscriptionType:   "free",
			subscriptionStatus: "active",
			want:               "active",
		},
		{
			name:               "paid access without provider subscription remains active during replacement checkout",
			subscriptionType:   "paid",
			subscriptionStatus: "active",
			want:               "active",
		},
		{
			name:               "trial access remains available while upgrade awaits payment",
			subscriptionType:   "trial",
			subscriptionStatus: "trial",
			want:               "trial",
		},
		{
			name:               "blocked contracts remain in billing recovery only",
			subscriptionType:   "paid",
			subscriptionStatus: "blocked",
			want:               "pending_payment",
		},
		{
			name:               "input normalization cannot bypass staging",
			subscriptionType:   " FREE ",
			subscriptionStatus: " ACTIVE ",
			want:               "active",
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := subscriptionStatusWhilePlanPending(
				test.subscriptionType,
				test.subscriptionStatus,
			); got != test.want {
				t.Fatalf("subscriptionStatusWhilePlanPending() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestAsaasCycleForBillingPeriod(t *testing.T) {
	t.Parallel()

	for months, expected := range map[int]string{
		1:  "MONTHLY",
		6:  "SEMIANNUALLY",
		12: "YEARLY",
	} {
		if got := asaasCycleForBillingPeriod(months); got != expected {
			t.Fatalf("asaasCycleForBillingPeriod(%d) = %q, want %q", months, got, expected)
		}
	}
}

func TestNormalizeProviderDateRejectsUnexpectedValues(t *testing.T) {
	t.Parallel()

	if got := normalizeProviderDate(" 2026-09-05 "); got != "2026-09-05" {
		t.Fatalf("valid date = %q", got)
	}
	for _, value := range []string{"", "05/09/2026", "2026-13-40", time.Now().Format(time.RFC3339)} {
		if got := normalizeProviderDate(value); got != "" {
			t.Fatalf("normalizeProviderDate(%q) = %q, want empty", value, got)
		}
	}
}

func TestSameManagedPlanChangeMakesRetryIdempotent(t *testing.T) {
	t.Parallel()

	if !sameManagedPlanChange(
		"plan-target",
		"sub-existing",
		6,
		1782,
		"PLAN-TARGET",
		"SUB-EXISTING",
		6,
		1782,
	) {
		t.Fatal("the exact durable request must be reused")
	}
	if sameManagedPlanChange(
		"plan-target",
		"sub-existing",
		6,
		1782,
		"plan-other",
		"sub-existing",
		6,
		1782,
	) {
		t.Fatal("a different target plan must not reuse the active change")
	}
}
