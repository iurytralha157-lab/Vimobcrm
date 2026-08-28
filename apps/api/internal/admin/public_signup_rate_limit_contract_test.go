package admin

import (
	"os"
	"strings"
	"testing"
)

func TestPublicSignupAppliesServerIdentityLimitsBeforeAuthAdmin(t *testing.T) {
	onboardingRaw, err := os.ReadFile("onboarding.go")
	if err != nil {
		t.Fatal(err)
	}
	onboarding := string(onboardingRaw)
	start := strings.Index(onboarding, "func (repo Repository) PublicOnboardingSignup(")
	if start < 0 {
		t.Fatal("could not locate public onboarding signup")
	}
	end := strings.Index(onboarding[start:], "func (repo Repository) PublicCheckoutPlan(")
	if end < 0 {
		t.Fatal("could not isolate public onboarding signup")
	}
	signup := onboarding[start : start+end]

	ipLimit := strings.Index(signup, `"onboarding_signup_ip"`)
	emailLimit := strings.Index(signup, `"onboarding_signup_email"`)
	authCreate := strings.Index(signup, "repo.createPublicSignupAuthUser(")
	if ipLimit < 0 || emailLimit < 0 || authCreate < 0 {
		t.Fatal("public signup is missing its server-side limiter or auth creation")
	}
	if !(ipLimit < emailLimit && emailLimit < authCreate) {
		t.Fatalf(
			"unsafe public signup order: ip=%d email=%d auth=%d",
			ipLimit,
			emailLimit,
			authCreate,
		)
	}
}

func TestPublicSignupHandlerOverwritesClientSuppliedNetworkIdentity(t *testing.T) {
	handlerRaw, err := os.ReadFile("handler.go")
	if err != nil {
		t.Fatal(err)
	}
	handler := string(handlerRaw)
	start := strings.Index(handler, "func (handler Handler) PublicOnboardingSignup(")
	if start < 0 {
		t.Fatal("could not locate public onboarding handler")
	}
	end := strings.Index(handler[start:], "func (handler Handler) PublicCheckoutPlan(")
	if end < 0 {
		t.Fatal("could not isolate public onboarding handler")
	}
	signup := handler[start : start+end]

	resolve := strings.Index(signup, "publicClientIPResolver.Resolve(r)")
	repositoryCall := strings.Index(signup, "handler.repo.PublicOnboardingSignup(")
	if resolve < 0 || repositoryCall < 0 || resolve >= repositoryCall {
		t.Fatal("public signup does not replace client-supplied IP before the repository call")
	}
}

func TestPublicIngressLimiterHasAForwardReconciliationMigration(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("../../../../supabase/migrations/20260804030810_reconcile_public_ingress_rate_limit_foundation.sql")
	if err != nil {
		t.Fatalf("read forward ingress limiter migration: %v", err)
	}
	source := strings.ToLower(string(raw))
	for _, required := range []string{
		"create unlogged table if not exists private.public_ingress_rate_limits",
		"create or replace function private.check_public_ingress_rate_limit(",
		"create or replace function private.cleanup_public_ingress_rate_limits()",
		"revoke all on table private.public_ingress_rate_limits",
		"on conflict (scope, subject_hash, window_started_at)",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("forward ingress limiter migration is missing %q", required)
		}
	}
}
