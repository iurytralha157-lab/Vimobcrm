package admin

import (
	"os"
	"strings"
	"testing"
)

func TestPublicSignupCommitsWelcomeOutboxTransactionally(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("onboarding.go")
	if err != nil {
		t.Fatalf("read onboarding source: %v", err)
	}
	source := string(raw)
	producerStart := strings.Index(source, "welcomeEmailDispatch :=")
	commit := strings.Index(source, "if commitErr := tx.Commit(ctx); commitErr != nil")
	if producerStart < 0 || commit < 0 || producerStart > commit {
		t.Fatal("welcome outbox must be inserted before the onboarding transaction commits")
	}

	for _, required := range []string{
		`"onboarding:welcome:" + createdOrganizationID`,
		`"onboarding_welcome"`,
		`"recipient_email"`,
		`"recipient_whatsapp"`,
		`"terms_version"`,
		`"privacy_version"`,
		`"email_confirmation_url"`,
		"welcomeEmailDispatch",
		"signupAuthUser.NeedsAuthConfirmationResend",
		`"supabase_auth_signup_resend_pending"`,
		`"whatsapp": map[string]any{"required": true, "status": "pending"}`,
		"insert into public.notifications",
		"on conflict do nothing",
	} {
		if !strings.Contains(source[producerStart:commit], required) {
			t.Fatalf("transactional welcome outbox is missing %q", required)
		}
	}
}

func TestReconciledSignupResendRunsOnlyAfterConfirmedCommit(t *testing.T) {
	t.Parallel()

	onboardingRaw, err := os.ReadFile("onboarding.go")
	if err != nil {
		t.Fatalf("read onboarding source: %v", err)
	}
	onboardingSource := string(onboardingRaw)
	commit := strings.Index(onboardingSource, "if commitErr := tx.Commit(ctx); commitErr != nil")
	ambiguousCommit := strings.Index(onboardingSource, "if committed {")
	committedReturn := strings.Index(onboardingSource, "return committedResult, nil")
	normalClaimFinished := -1
	if committedReturn >= 0 {
		normalClaimFinished = strings.Index(onboardingSource[committedReturn:], "claimFinished = true")
		if normalClaimFinished >= 0 {
			normalClaimFinished += committedReturn
		}
	}
	if commit < 0 || ambiguousCommit < 0 || committedReturn < 0 || normalClaimFinished < 0 {
		t.Fatalf(
			"could not isolate commit branches: commit=%d ambiguous=%d committedReturn=%d normalClaim=%d",
			commit,
			ambiguousCommit,
			committedReturn,
			normalClaimFinished,
		)
	}

	const resendCall = "repo.resendPublicSignupEmailConfirmationAfterCommit("
	if count := strings.Count(onboardingSource, resendCall); count != 2 {
		t.Fatalf("post-commit signup resend call count = %d, want 2", count)
	}
	ambiguousResend := strings.Index(onboardingSource[ambiguousCommit:committedReturn], resendCall)
	normalResend := strings.Index(onboardingSource[normalClaimFinished:], resendCall)
	if commit >= ambiguousCommit || ambiguousResend < 0 || normalResend < 0 {
		t.Fatalf(
			"signup resend is not fenced behind confirmed commits: commit=%d ambiguous=%d ambiguousResend=%d normalResend=%d",
			commit,
			ambiguousCommit,
			ambiguousResend,
			normalResend,
		)
	}

	authRaw, err := os.ReadFile("onboarding_auth.go")
	if err != nil {
		t.Fatalf("read onboarding auth source: %v", err)
	}
	authSource := string(authRaw)
	createStart := strings.Index(authSource, "func (repo Repository) createPublicSignupAuthUser(")
	createEnd := strings.Index(authSource, "func (repo Repository) requestPublicSignupAuthUser(")
	if createStart < 0 || createEnd <= createStart {
		t.Fatal("could not isolate Auth creation from its signup-link request")
	}
	if strings.Contains(authSource[createStart:createEnd], "resendPublicSignupEmailConfirmation(") {
		t.Fatal("reconciled Auth creation must not send confirmation before organization commit")
	}

	helperStart := strings.Index(authSource, "func (repo Repository) resendPublicSignupEmailConfirmationAfterCommit(")
	helperEnd := -1
	if helperStart >= 0 {
		helperEnd = strings.Index(authSource[helperStart:], "func validatePublicSignupEmailConfirmationURL(")
	}
	if helperStart < 0 || helperEnd < 0 {
		t.Fatal("could not isolate non-failing post-commit resend helper")
	}
	helper := authSource[helperStart : helperStart+helperEnd]
	for _, required := range []string{
		"context.WithoutCancel(ctx)",
		"repo.resendPublicSignupEmailConfirmation(resendContext, email)",
		"slog.ErrorContext(",
	} {
		if !strings.Contains(helper, required) {
			t.Fatalf("post-commit resend helper is missing %q", required)
		}
	}
	if strings.Contains(helper, "return err") {
		t.Fatal("a failed post-commit resend must not turn committed provisioning into a false failure")
	}
}
