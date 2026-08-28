package billing

import (
	"strings"
	"testing"
)

func TestBillingNotificationOutboxContract(t *testing.T) {
	requiredFragments := []string{
		"lower(coalesce(membership.role, 'user')) in ('owner', 'admin')",
		"permission.key = 'settings_billing'",
		"'billing_due_in_3_days'",
		"'billing_due_today'",
		"'billing_card_refused'",
		"'billing_overdue_5_days'",
		"'billing_payment_refunded'",
		"'REPROVED_BY_RISK_ANALYSIS'",
		"'DUNNING_REQUESTED'",
		"'DUNNING_RECEIVED'",
		"'REFUND_IN_PROGRESS'",
		"'PARTIALLY_REFUNDED'",
		"'RECEIVED_IN_CASH_UNDONE'",
		"'CHARGEBACK'",
		"'CHARGEBACK_REQUESTED'",
		"'CHARGEBACK_DISPUTE'",
		"'AWAITING_CHARGEBACK_REVERSAL'",
		"Boleto expirado: gere uma nova cobranca",
		"payment_event.bank_slip_registration_cancelled_due_date is not distinct from payment_event.due_date",
		"/settings?tab=subscription&billing=payments&payment=",
		"'whatsapp', jsonb_build_object('required', true, 'status', 'pending')",
		"'email', jsonb_build_object('required', true, 'status', 'pending')",
		"on conflict do nothing",
	}

	for _, fragment := range requiredFragments {
		if !strings.Contains(billingNotificationEnqueueQuery, fragment) {
			t.Fatalf("billing outbox query is missing %q", fragment)
		}
	}
}

func TestBillingNotificationLinksStayInsideVimob(t *testing.T) {
	if strings.Contains(billingNotificationEnqueueQuery, "invoice_url") {
		t.Fatal("billing notifications must not send users to the provider invoice URL")
	}
	if !strings.Contains(billingNotificationEnqueueQuery, "trim(trailing '/' from $1::text)") {
		t.Fatal("external messages must use the configured Vimob application URL")
	}
	for _, fragment := range []string{
		"public.billing_payment_checkout_capabilities",
		"checkout_capability.revoked_at is null",
		"checkout_capability.expires_at > now()",
		"private.billing_payment_checkout_is_resolvable(payment_event.id)",
		"'/checkout/' || checkout_capability.checkout_token",
		"or checkout_capability.checkout_token is not null",
	} {
		if !strings.Contains(billingNotificationEnqueueQuery, fragment) {
			t.Fatalf("actionable billing notifications must require a current Vimob checkout capability; missing %q", fragment)
		}
	}
}

func TestNewPaymentDoesNotDuplicateThreeDayReminder(t *testing.T) {
	if !strings.Contains(billingNotificationEnqueueQuery, "payment.created_at < now() - interval '48 hours'") {
		t.Fatal("a newly-created payment due in three days must not also enqueue the three-day reminder")
	}
}

func TestRiskAnalysisIsNotPresentedAsReadyForPayment(t *testing.T) {
	if strings.Contains(billingNotificationEnqueueQuery, "in ('PENDING', 'AWAITING_RISK_ANALYSIS')") {
		t.Fatal("a payment under risk analysis must not be announced as ready for payment")
	}
}

func TestConfirmedPaymentReceiptIsNotFannedOutByPeriodicBillingQuery(t *testing.T) {
	if strings.Contains(billingNotificationEnqueueQuery, "'billing_payment_confirmed'::text as event_key") {
		t.Fatal("confirmed payment delivery must come from the transactional receipt trigger, not a periodic fanout")
	}
}
