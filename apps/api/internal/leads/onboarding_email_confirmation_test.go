package leads

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

func TestOnboardingEmailMakesConfirmationPrimaryAndKeepsCheckout(t *testing.T) {
	t.Parallel()

	client := newNotificationEmailClient(EmailConfig{AppURL: "https://app.vimobcrm.com.br"})
	confirmationURL := "https://project.supabase.co/auth/v1/verify?type=signup&token=secret"
	html := client.onboardingHTML(onboardingEmailPayload{
		RecipientName:        "Andre",
		Organization:         "Vimob Imoveis",
		PlanName:             "Pro",
		SignupPath:           "paid",
		CheckoutPath:         "/checkout/0123456789abcdef0123456789abcdef",
		EmailConfirmationURL: confirmationURL,
		TermsVersion:         "2026-06-15",
		PrivacyVersion:       "2026-06-15",
	})

	confirmation := strings.Index(html, "Revisar confirmação de e-mail")
	checkout := strings.Index(html, "Finalizar pagamento")
	if confirmation < 0 || checkout < 0 || confirmation > checkout {
		t.Fatalf("email actions are incomplete or out of order: confirmation=%d checkout=%d", confirmation, checkout)
	}
	if !strings.Contains(html, "https://app.vimobcrm.com.br/confirmar-email#confirmation_url=") {
		t.Fatal("safe confirmation landing is missing from the onboarding email")
	}
	if strings.Contains(html, "project.supabase.co/auth/v1/verify") {
		t.Fatal("single-use Auth action link must not be a directly prefetchable email href")
	}
}

func TestOnboardingEmailRefusesMissingConfirmationCredential(t *testing.T) {
	t.Parallel()

	client := newNotificationEmailClient(EmailConfig{})
	result := client.sendOnboarding(context.Background(), onboardingEmailPayload{
		RecipientEmail: "andre@example.com",
		IdempotencyKey: "vimob:onboarding_welcome:test:v1",
	})
	if result.Error != "onboarding_email_confirmation_url_invalid" {
		t.Fatalf("error = %q", result.Error)
	}
}

func TestOnboardingEmailAcceptsOnlyTheConfiguredSupabaseConfirmationOrigin(t *testing.T) {
	t.Parallel()

	client := newNotificationEmailClient(EmailConfig{
		AppURL:         "https://app.vimobcrm.com.br",
		AuthProjectURL: "https://project.supabase.co",
	})
	valid := "https://project.supabase.co/auth/v1/verify?type=signup&token=secret&redirect_to=" +
		url.QueryEscape("https://app.vimobcrm.com.br/login?emailConfirmation=success")
	if !client.isSafeEmailConfirmationURL(valid) {
		t.Fatal("the exact configured Supabase confirmation link was rejected")
	}

	for _, unsafe := range []string{
		"https://attacker.example/auth/v1/verify?type=signup&token=secret&redirect_to=" + url.QueryEscape("https://app.vimobcrm.com.br/login?emailConfirmation=success"),
		"https://project.supabase.co/auth/v1/verify?type=signup&token=secret&redirect_to=" + url.QueryEscape("https://attacker.example/login"),
		"https://project.supabase.co/auth/v1/verify?type=signup&redirect_to=" + url.QueryEscape("https://app.vimobcrm.com.br/login?emailConfirmation=success"),
	} {
		if client.isSafeEmailConfirmationURL(unsafe) {
			t.Fatalf("unsafe confirmation URL was accepted: %s", unsafe)
		}
	}
}

func TestWhatsAppDispatchNeverReceivesEmailConfirmationCredential(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("notification_dispatch_worker.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) dispatchPendingWhatsAppNotification(")
	end := strings.Index(source[start:], "func (repo Repository) resolveNotificationDeliveryRecipient(")
	if start < 0 || end < 0 {
		t.Fatal("could not isolate WhatsApp notification dispatcher")
	}
	dispatcher := source[start : start+end]
	deletion := strings.Index(dispatcher, `delete(variables, "email_confirmation_url")`)
	request := strings.Index(dispatcher, "DispatchNotificationRequest{")
	if deletion < 0 || request < 0 || deletion > request {
		t.Fatal("email confirmation credential must be deleted before building the WhatsApp request")
	}
}

func TestConfirmationResendUsesImmutableEmailSnapshotWithoutWhatsApp(t *testing.T) {
	t.Parallel()

	notification := pendingNotification{
		UserID: "00000000-0000-0000-0000-000000000001",
		Metadata: map[string]any{
			"recipient_name":  "Andre",
			"recipient_email": "andre@example.com",
		},
	}

	recipient, complete := immutableNotificationRecipientSnapshot(
		notification,
		"onboarding_email_confirmation",
		"email",
	)
	if !complete || recipient.Email != "andre@example.com" {
		t.Fatalf("confirmation resend did not use its immutable email snapshot: %#v, complete=%v", recipient, complete)
	}
	if _, whatsappComplete := immutableNotificationRecipientSnapshot(
		notification,
		"onboarding_email_confirmation",
		"whatsapp",
	); whatsappComplete {
		t.Fatal("confirmation resend must never authorize a WhatsApp delivery")
	}
}

func TestConfirmationCapabilityExpiresFailClosedAndIsScrubbedAfterTerminalDelivery(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.August, 4, 12, 0, 0, 0, time.UTC)
	metadata := map[string]any{
		"email_confirmation_expires_at": now.Add(time.Hour).Format(time.RFC3339),
		"variables": map[string]any{
			"email_confirmation_url": "https://project.supabase.co/auth/v1/verify?token=secret",
		},
	}
	if emailConfirmationCapabilityExpired(metadata, now) {
		t.Fatal("fresh confirmation capability was treated as expired")
	}
	if !emailConfirmationCapabilityExpired(metadata, now.Add(time.Hour)) {
		t.Fatal("expired confirmation capability must fail closed")
	}

	scrubbed := setNotificationChannelDispatch(metadata, "email", DispatchChannelResult{
		Enabled:   true,
		Attempted: true,
		OK:        true,
		Provider:  "resend",
	})
	if secret := stringFromMap(notificationVariables(scrubbed), "email_confirmation_url"); secret != "" {
		t.Fatal("accepted confirmation delivery retained its single-use credential")
	}
	if stringFromMap(scrubbed, "email_confirmation_scrubbed_at") == "" {
		t.Fatal("confirmation credential scrub was not audited")
	}
}
