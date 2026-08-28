package tenant

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestResolverQueriesLoadOrganizationBillingState(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	repositorySource := string(source)

	for _, column := range []string{
		"o.subscription_status",
		"o.subscription_type",
		"o.trial_ends_at",
		"o.billing_grace_until",
	} {
		if got := strings.Count(repositorySource, column); got < 3 {
			t.Errorf("resolver query references %s %d times, want at least 3 (membership, cache refresh and superadmin organization)", column, got)
		}
	}
}

func TestBillingSnapshotAppliesNullableTimestamps(t *testing.T) {
	trialEndsAt := time.Date(2026, time.July, 30, 12, 0, 0, 0, time.UTC)
	graceUntil := trialEndsAt.Add(72 * time.Hour)
	snapshot := billingSnapshot{
		Status:      " overdue ",
		Type:        " paid ",
		TrialEndsAt: pgtype.Timestamptz{Time: trialEndsAt, Valid: true},
		GraceUntil:  pgtype.Timestamptz{Time: graceUntil, Valid: true},
	}
	var tenantContext Context

	snapshot.applyToContext(&tenantContext)

	if tenantContext.SubscriptionStatus != "overdue" || tenantContext.SubscriptionType != "paid" {
		t.Fatalf("billing values = %q/%q, want overdue/paid", tenantContext.SubscriptionStatus, tenantContext.SubscriptionType)
	}
	if tenantContext.TrialEndsAt == nil || !tenantContext.TrialEndsAt.Equal(trialEndsAt) {
		t.Fatalf("trial end = %v, want %v", tenantContext.TrialEndsAt, trialEndsAt)
	}
	if tenantContext.BillingGraceUntil == nil || !tenantContext.BillingGraceUntil.Equal(graceUntil) {
		t.Fatalf("grace end = %v, want %v", tenantContext.BillingGraceUntil, graceUntil)
	}

	billingSnapshot{Status: "active", Type: "paid"}.applyToContext(&tenantContext)
	if tenantContext.TrialEndsAt != nil || tenantContext.BillingGraceUntil != nil {
		t.Fatal("null database timestamps must clear stale billing timestamps")
	}
}
