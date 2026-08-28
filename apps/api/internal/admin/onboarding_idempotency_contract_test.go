package admin

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPublicSignupClaimsAttemptBeforeAuthMutation(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("onboarding.go")
	if err != nil {
		t.Fatalf("read onboarding source: %v", err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) PublicOnboardingSignup(")
	end := strings.Index(source[start:], "func (repo Repository) publicSignupResultForAttempt(")
	if start < 0 || end < 0 {
		t.Fatal("could not isolate public onboarding signup")
	}
	signup := source[start : start+end]

	validation := strings.Index(signup, "validatePublicOnboardingSignupRequest(request)")
	optimisticReplay := strings.Index(signup, "repo.publicSignupResultForAttempt(")
	ipLimit := strings.Index(signup, `"onboarding_signup_ip"`)
	emailLimit := strings.Index(signup, `"onboarding_signup_email"`)
	claim := strings.Index(signup, "repo.claimPublicSignupAttempt(")
	claimedReplayRelative := strings.Index(signup[claim+1:], "repo.publicSignupResultForAttempt(")
	authMutation := strings.Index(signup, "repo.createPublicSignupAuthUser(")
	if validation < 0 || optimisticReplay < 0 || ipLimit < 0 || emailLimit < 0 || claim < 0 || claimedReplayRelative < 0 || authMutation < 0 {
		t.Fatalf(
			"signup idempotency contract is incomplete: validation=%d optimistic=%d ip=%d email=%d claim=%d replay=%d auth=%d",
			validation,
			optimisticReplay,
			ipLimit,
			emailLimit,
			claim,
			claimedReplayRelative,
			authMutation,
		)
	}
	claimedReplay := claim + 1 + claimedReplayRelative
	if !(validation < optimisticReplay && optimisticReplay < ipLimit && ipLimit < emailLimit && emailLimit < claim && claim < claimedReplay && claimedReplay < authMutation) {
		t.Fatalf(
			"unsafe signup order: validation=%d optimistic=%d ip=%d email=%d claim=%d replay=%d auth=%d",
			validation,
			optimisticReplay,
			ipLimit,
			emailLimit,
			claim,
			claimedReplay,
			authMutation,
		)
	}
}

func TestPublicSignupReplayIsBoundToEmailAndAuthoritativeResult(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("onboarding.go")
	if err != nil {
		t.Fatalf("read onboarding source: %v", err)
	}
	source := string(raw)
	claimRaw, err := os.ReadFile("onboarding_claim.go")
	if err != nil {
		t.Fatalf("read onboarding claim source: %v", err)
	}
	claimSource := string(claimRaw)
	for _, required := range []string{
		"where organization.signup_attempt_id = $1::uuid",
		"if storedEmail != email",
		"ErrSignupAttemptConflict",
		`"organizationId":  organizationID`,
		`"checkoutToken":             nullableText(checkoutToken)`,
		`"redirectTo":                redirectTo`,
		`"requiresPayment":           requiresPayment`,
		`"emailConfirmationRequired": true`,
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("public signup replay contract is missing %q", required)
		}
	}
	for _, required := range []string{
		"private.public_signup_attempt_claims",
		"lease_token = gen_random_uuid()",
		"lease_expires_at > clock_timestamp()",
		"lease_token = $3::uuid",
		"status = 'completed'",
	} {
		if !strings.Contains(claimSource, required) {
			t.Fatalf("public signup claim contract is missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"pg_advisory_xact_lock",
		"Pool().Acquire(",
		"httpClient.Do(",
	} {
		if strings.Contains(claimSource, forbidden) {
			t.Fatalf("public signup claim keeps an unsafe resource across work through %q", forbidden)
		}
	}
}

func TestPublicSignupKeepsCheckoutCapabilityOutsideMemberReadableOrganization(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("onboarding.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, forbidden := range []string{
		"o.checkout_token",
		"organization.checkout_token",
		"returning id::text, checkout_token",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("member-readable organization still exposes checkout capability through %q", forbidden)
		}
	}
	for _, required := range []string{
		"insert into public.organization_checkout_capabilities (organization_id)",
		"on conflict (organization_id) do update",
		"set checkout_token = organization_checkout_capabilities.checkout_token",
		"left join public.organization_checkout_capabilities as checkout_capability",
		"join public.organization_checkout_capabilities checkout_capability",
		"where checkout_capability.checkout_token = $1",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("checkout capability boundary is missing %q", required)
		}
	}

	organizationInsert := strings.Index(source, "insert into public.organizations (")
	capabilityInsert := strings.Index(source, "insert into public.organization_checkout_capabilities (organization_id)")
	profileInsert := strings.Index(source, "insert into public.users (")
	if organizationInsert < 0 || capabilityInsert < organizationInsert || profileInsert < capabilityInsert {
		t.Fatal("organization and its checkout capability must be created in the same onboarding transaction before the profile")
	}
}

func TestPublicSignupIdempotencyMigrationHasUniqueAttemptBoundary(t *testing.T) {
	t.Parallel()

	path := filepath.Join(
		"..", "..", "..", "..",
		"supabase", "migrations", "20260803215531_add_public_signup_idempotency.sql",
	)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read signup idempotency migration: %v", err)
	}
	sql := strings.ToLower(string(raw))
	for _, required := range []string{
		"add column if not exists signup_attempt_id uuid",
		"add column if not exists signup_attempt_email text",
		"add column if not exists signup_requires_payment boolean",
		"create unique index if not exists organizations_signup_attempt_id_unique",
		"where signup_attempt_id is not null",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("signup idempotency migration is missing %q", required)
		}
	}
}

func TestPublicSignupClaimMigrationHasFencedRecoverableLeases(t *testing.T) {
	t.Parallel()

	path := filepath.Join(
		"..", "..", "..", "..",
		"supabase", "migrations", "20260804020928_fix_public_signup_claim_leases.sql",
	)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read public signup claim migration: %v", err)
	}
	sql := strings.ToLower(string(raw))
	for _, required := range []string{
		"create table if not exists private.public_signup_attempt_claims",
		"attempt_id uuid primary key",
		"normalized_email text not null",
		"status in ('retryable', 'processing', 'compensating', 'completed')",
		"lease_token uuid",
		"lease_expires_at timestamptz",
		"where status in ('processing', 'compensating')",
		"insert into private.public_signup_attempt_claims",
		"from public.organizations as organization",
		"revoke all on table private.public_signup_attempt_claims",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("public signup claim migration is missing %q", required)
		}
	}
}

func TestPublicSignupSuccessResultUsesCanonicalPaymentContract(t *testing.T) {
	t.Parallel()

	const organizationID = "f46ce055-0b0a-480a-b956-8eaa2c16a5cd"
	const checkoutToken = "0123456789abcdef0123456789abcdef"

	if !isCanonicalCheckoutToken(checkoutToken) {
		t.Fatal("expected lowercase 32-hex checkout token to be canonical")
	}
	for _, invalid := range []string{
		"",
		"0123456789abcdef0123456789abcde",
		"0123456789ABCDEF0123456789ABCDEF",
		"0123456789abcdef0123456789abcdeg",
		"0123456789abcdef0123456789abcde\\",
	} {
		if isCanonicalCheckoutToken(invalid) {
			t.Fatalf("expected checkout token %q to be rejected", invalid)
		}
	}

	paid := publicSignupSuccessResult(organizationID, checkoutToken, "/checkout/"+checkoutToken, true)
	if paid["checkoutToken"] != checkoutToken || paid["redirectTo"] != "/checkout/"+checkoutToken || paid["requiresPayment"] != true {
		t.Fatalf("unexpected paid signup result: %#v", paid)
	}

	trial := publicSignupSuccessResult(organizationID, checkoutToken, "/checkout/"+checkoutToken, false)
	if trial["checkoutToken"] != nil || trial["redirectTo"] != "/select-organization" || trial["requiresPayment"] != false {
		t.Fatalf("unexpected trial signup result: %#v", trial)
	}
}

func TestPublicSignupNeverDeletesAuthAfterAmbiguousCommit(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("onboarding.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) PublicOnboardingSignup(")
	end := strings.Index(source[start:], "func (repo Repository) publicSignupResultForAttempt(")
	if start < 0 || end < 0 {
		t.Fatal("could not isolate public onboarding signup")
	}
	signup := source[start : start+end]

	commit := strings.Index(signup, "if commitErr := tx.Commit(ctx); commitErr != nil")
	commitReconciliation := strings.Index(signup, "repo.reconcilePublicSignupCommit(")
	if commit < 0 || commitReconciliation < commit {
		t.Fatal("ambiguous commit must reconcile the durable signup before returning")
	}
	markUncertain := strings.Index(signup[commit:], "claimOwnershipUncertain = true")
	if markUncertain < 0 || commit+markUncertain > commitReconciliation {
		t.Fatal("an ambiguous commit must suppress claim release before reconciliation")
	}

	cleanupStart := strings.Index(signup, "defer func() {")
	cleanupEnd := strings.Index(signup[cleanupStart:], "}()")
	if cleanupStart < 0 || cleanupEnd < 0 {
		t.Fatal("could not isolate attempt cleanup")
	}
	cleanup := signup[cleanupStart : cleanupStart+cleanupEnd]
	if !strings.Contains(cleanup, "if claimFinished || claimOwnershipUncertain") ||
		!strings.Contains(cleanup, "repo.releasePublicSignupAttempt(cleanupContext, attemptClaim)") {
		t.Fatal("attempt cleanup must release only a still-owned, uncommitted lease")
	}
	if strings.Contains(signup, "repo.deleteAuthUser(") {
		t.Fatal("public signup must never delete Auth after an ambiguous commit")
	}

	for _, required := range []string{
		"join public.users as profile",
		"join public.organization_members as membership",
		"organization.signup_attempt_id = $1::uuid",
		"organization.signup_attempt_email = $2",
		"organization.created_by = $3::uuid",
		"notification.metadata ->> 'event_key' = 'onboarding_welcome'",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("ambiguous commit reconciliation is missing %q", required)
		}
	}
}

func TestPublicCheckoutPlanDoesNotCarryEntitlementAcrossTrialDowngrade(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("onboarding.go")
	if err != nil {
		t.Fatalf("read onboarding source: %v", err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) PublicCheckoutPlan(")
	end := strings.Index(source[start:], "const activeSignupPlanSQL")
	if start < 0 || end <= 0 {
		t.Fatal("could not isolate PublicCheckoutPlan")
	}
	function := source[start : start+end]

	if strings.Contains(function, `intValue(organization["max_users"])`) {
		t.Fatal("public plan changes must not preserve a previous plan's max_users")
	}
	if !strings.Contains(function, `maxUsers := maxInt(intValue(plan["max_users"]), 1)`) {
		t.Fatal("public plan changes must derive max_users from the target plan")
	}
}
