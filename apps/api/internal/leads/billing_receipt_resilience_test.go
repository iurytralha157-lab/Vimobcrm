package leads

import (
	"os"
	"strings"
	"testing"
)

func TestBillingReceiptDeliverySnapshotDoesNotRequireUser(t *testing.T) {
	t.Parallel()

	notification := pendingNotification{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		Metadata: map[string]any{
			"recipient_name":     "Financeiro",
			"recipient_email":    "financeiro@example.com",
			"recipient_whatsapp": "+5511999999999",
		},
	}

	email, emailComplete := immutableNotificationRecipientSnapshot(
		notification,
		"billing_payment_receipt",
		"email",
	)
	if !emailComplete || email.ID != "" || email.Email != "financeiro@example.com" {
		t.Fatalf("userless receipt email snapshot = %#v, complete=%v", email, emailComplete)
	}

	whatsapp, whatsappComplete := immutableNotificationRecipientSnapshot(
		notification,
		"billing_payment_receipt",
		"whatsapp",
	)
	if !whatsappComplete || whatsapp.ID != "" || whatsapp.WhatsApp != "+5511999999999" {
		t.Fatalf("userless receipt WhatsApp snapshot = %#v, complete=%v", whatsapp, whatsappComplete)
	}
}

func TestBillingReceiptDeliveryRequiresLiveConfirmedPayment(t *testing.T) {
	t.Parallel()

	for _, status := range []string{"RECEIVED", " confirmed ", "received_in_cash", "refund_denied"} {
		if !isConfirmedBillingReceiptPaymentStatus(status) {
			t.Fatalf("%q must allow receipt delivery", status)
		}
	}
	for _, status := range []string{
		"",
		"OVERDUE",
		"REFUNDED",
		"REFUND_IN_PROGRESS",
		"PARTIALLY_REFUNDED",
		"RECEIVED_IN_CASH_UNDONE",
		"CHARGEBACK_REQUESTED",
	} {
		if isConfirmedBillingReceiptPaymentStatus(status) {
			t.Fatalf("%q must cancel receipt delivery", status)
		}
	}
}

func TestBillingReceiptMigrationKeepsDeliveryAndVerificationFailClosed(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("../../../../supabase/migrations/20260804023027_harden_billing_receipt_delivery_state.sql")
	if err != nil {
		t.Fatalf("read billing receipt migration: %v", err)
	}
	source := string(raw)

	for _, required := range []string{
		"alter column user_id drop not null",
		"notifications_user_or_billing_receipt_check",
		"notifications_system_receipt_dedupe_idx",
		"notifications_billing_receipt_payment_unique_idx",
		"cancel_billing_payment_receipt_delivery",
		"receipt_delivery_cancelled_at",
		"payment_not_confirmed:",
		"ensure_billing_payment_receipt_delivery_after_payment",
		"set\n    user_id = null",
		"always system-owned and references no user",
		"membership.is_active = true",
		"coalesce(account.is_active, true) = true",
		"lower(coalesce(membership.role, '')) in ('owner', 'admin')",
		"Replace both its ownership and recipient snapshot",
		"'recipient_email', v_recipient_email",
		"'recipient_whatsapp', v_recipient_whatsapp",
		"delivery_contact_missing",
		"join public.asaas_payments payment on payment.id = receipt.payment_id",
		"'payment_state'",
		"'REFUNDED'",
		"'REFUND_IN_PROGRESS'",
		"'CHARGEBACK%'",
		"'valid', upper(coalesce(payment.status, '')) in",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("billing receipt hardening is missing %q", required)
		}
	}
	if strings.Contains(source, "DUNNING_RECEIVED") {
		t.Fatal("credit-bureau dunning must never be treated as a confirmed payment")
	}

	workerRaw, err := os.ReadFile("notification_dispatch_worker.go")
	if err != nil {
		t.Fatalf("read notification worker: %v", err)
	}
	worker := string(workerRaw)
	for _, required := range []string{
		"coalesce(user_id::text, '')",
		"nullif($2, '')::uuid",
		"for update of payment, notification, receipt",
		"private.cancel_billing_payment_receipt_delivery(",
		"SkipPersistence",
	} {
		if !strings.Contains(worker, required) {
			t.Fatalf("notification worker cannot process userless receipts: missing %q", required)
		}
	}
}
