package admin

import (
	"os"
	"strings"
	"testing"
)

func TestPublicConfirmationResendIsRateLimitedAndAccountEnumerationSafe(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("onboarding_confirmation.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	lookup := strings.Index(source, "repo.pendingPublicSignupConfirmationRecipient(")
	link := strings.Index(source, "repo.resendPublicSignupEmailConfirmation(")
	if lookup < 0 || link < 0 || lookup >= link {
		t.Fatalf("confirmation resend must authorize the pending account before Auth resend: lookup=%d resend=%d", lookup, link)
	}
	for _, required := range []string{
		`"onboarding_confirmation_resend_ip"`,
		`"onboarding_confirmation_resend_email"`,
		`"onboarding_confirmation_resend_email_cooldown"`,
		"auth_user.email_confirmed_at is null",
		"auth_user.raw_app_meta_data ->> 'provisioning_source' = 'public_onboarding'",
		"auth_user.raw_app_meta_data ->> 'signup_attempt_id' = organization.signup_attempt_id::text",
		"organization.signup_attempt_email",
		"organization.created_by = auth_user.id",
		"public.admin_subscription_plans",
		"repo.resendPublicSignupEmailConfirmation(ctx, recipient.Email)",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("confirmation resend contract is missing %q", required)
		}
	}
	if strings.Contains(source, `"magiclink"`) || strings.Contains(source, `"recovery"`) || strings.Contains(source, "insert into public.notifications") {
		t.Fatal("confirmation resend must delegate only to Auth signup resend and must not create a manual-link outbox")
	}
}

func TestPublicConfirmationResendHandlerOverwritesIPAndReturnsGenericAcceptance(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("handler.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (handler Handler) PublicResendOnboardingEmailConfirmation(")
	end := strings.Index(source[start:], "func (handler Handler) PublicCheckoutPlan(")
	if start < 0 || end < 0 {
		t.Fatal("could not isolate public confirmation resend handler")
	}
	handler := source[start : start+end]
	resolve := strings.Index(handler, "publicClientIPResolver.Resolve(r)")
	repositoryCall := strings.Index(handler, "handler.repo.ResendPublicSignupEmailConfirmation(")
	accepted := strings.Index(handler, "http.StatusAccepted")
	if resolve < 0 || repositoryCall < 0 || accepted < 0 || resolve >= repositoryCall {
		t.Fatalf("unsafe resend handler order: resolve=%d repository=%d accepted=%d", resolve, repositoryCall, accepted)
	}
	if !strings.Contains(handler, "Se existir um cadastro aguardando confirmacao") {
		t.Fatal("resend response must not disclose whether the account exists")
	}
}
