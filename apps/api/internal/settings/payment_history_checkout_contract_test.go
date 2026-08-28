package settings

import (
	"strings"
	"testing"
)

func TestPaymentHistoryOnlyExposesResolvableInternalCheckoutLinks(t *testing.T) {
	required := []string{
		"private.billing_payment_checkout_is_resolvable(p.id)",
		"coalesce(intent.plan_id, capability.plan_id)",
		"p.bank_slip_registration_cancelled_due_date is not distinct from p.due_date",
		"'DUNNING_REQUESTED'",
		"'DUNNING_RECEIVED'",
		"'/checkout/' || capability.checkout_token",
		"'/comprovantes/' || receipt.verification_token::text",
		"receipt.organization_id = p.organization_id",
	}
	for _, fragment := range required {
		if !strings.Contains(paymentHistoryFrom+paymentHistoryProjection, fragment) {
			t.Fatalf("payment history checkout contract is missing %q", fragment)
		}
	}

	for _, forbidden := range []string{"invoice_url", "provider_payment_reference", "payer_tax_id"} {
		if strings.Contains(paymentHistoryProjection, forbidden) {
			t.Fatalf("payment history must never expose provider or payer field %q", forbidden)
		}
	}
}
