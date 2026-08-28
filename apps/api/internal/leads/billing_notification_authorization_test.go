package leads

import (
	"strings"
	"testing"
)

func TestBillingNotificationDispatchAuthorizationQueryContract(t *testing.T) {
	required := []string{
		"membership.organization_id = $1::uuid",
		"membership.user_id = $2::uuid",
		"membership.is_active = true",
		"coalesce(account.is_active, true) = true",
		"lower(coalesce(membership.role, 'user')) in ('owner', 'admin')",
		"permission_override.permission_key = 'settings_billing'",
		"permission_override.allowed = true",
		"permission.key = 'settings_billing'",
	}
	for _, fragment := range required {
		if !strings.Contains(billingNotificationDispatchAuthorizationQuery, fragment) {
			t.Fatalf("billing dispatch authorization query is missing %q", fragment)
		}
	}
}

func TestBillingNotificationDispatchAuthorizationIsRecheckedForEveryNonReceiptEvent(t *testing.T) {
	for _, eventKey := range []string{
		"billing_payment_created",
		"billing_due_today",
		" BILLING_CARD_REFUSED ",
		"billing_payment_cancelled",
	} {
		if !requiresCurrentBillingNotificationAuthorization(eventKey) {
			t.Fatalf("event %q must recheck settings_billing immediately before dispatch", eventKey)
		}
	}

	for _, eventKey := range []string{"billing_payment_receipt", "deal_won", ""} {
		if requiresCurrentBillingNotificationAuthorization(eventKey) {
			t.Fatalf("event %q must keep its separate delivery policy", eventKey)
		}
	}
}

func TestBillingNotificationVisibilityHidesEveryBillingRowAfterPermissionRevocation(t *testing.T) {
	visibility := billingNotificationVisibilitySQL("$8", "$9")
	for _, fragment := range []string{
		"membership.organization_id = $8::uuid",
		"membership.user_id = $9::uuid",
		"metadata ->> 'event_key'",
		"lower(coalesce(type, '')) <> 'billing'",
		"<> 'billing_'",
	} {
		if !strings.Contains(visibility, fragment) {
			t.Fatalf("billing notification visibility guard is missing %q", fragment)
		}
	}
	if strings.Contains(visibility, "= 'billing_payment_receipt'") {
		t.Fatal("legacy user-backed receipts must not bypass current billing authorization")
	}
}

func TestNotificationAPIRedactsAuthenticationCredentials(t *testing.T) {
	metadata := map[string]any{
		"email_confirmation_url": "https://auth.example/confirm?token=secret",
		"event_key":              "onboarding_welcome",
		"variables": map[string]any{
			"email_confirmation_url": "https://auth.example/confirm?token=nested-secret",
			"organization_name":      "Vimob",
		},
	}

	redacted := redactNotificationMetadataForAPI(metadata)
	if _, exists := redacted["email_confirmation_url"]; exists {
		t.Fatal("top-level authentication credential leaked through notification API")
	}
	variables := mapFromAny(redacted["variables"])
	if _, exists := variables["email_confirmation_url"]; exists {
		t.Fatal("nested authentication credential leaked through notification API")
	}
	if variables["organization_name"] != "Vimob" {
		t.Fatal("non-secret notification variables must be preserved")
	}
}
