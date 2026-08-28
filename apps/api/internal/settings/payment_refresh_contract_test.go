package settings

import (
	"os"
	"strings"
	"testing"
)

func TestPaymentRefreshRouteKeepsBillingPermissionAndAccessRecovery(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("../app/app.go")
	if err != nil {
		t.Fatalf("read app routes: %v", err)
	}
	text := string(source)
	route := `"POST /v1/settings/subscription/payments/{id}/refresh"`
	guardedRoute := route + `, withPermission(permissions.SettingsBilling, http.HandlerFunc(settingsHandler.RefreshSubscriptionPayment))`
	if !strings.Contains(text, guardedRoute) {
		t.Fatalf("payment refresh route must be guarded by SettingsBilling")
	}
	if strings.Count(text, route) < 2 {
		t.Fatalf("payment refresh route must also remain in the billing access allowlist")
	}
}

func TestPaymentHistoryProjectionIsTenantScopedAndClientSafe(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read settings repository: %v", err)
	}
	text := string(source)
	projectionStart := strings.Index(text, "const paymentHistoryProjection")
	projectionEnd := strings.Index(text, "func (repo Repository) listPaymentHistory")
	if projectionStart < 0 || projectionEnd <= projectionStart {
		t.Fatal("payment history projection contract was not found")
	}
	projection := text[projectionStart:projectionEnd]
	for _, forbidden := range []string{"invoice_url", "net_value"} {
		if strings.Contains(projection, forbidden) {
			t.Fatalf("customer-facing payment projection exposes %s", forbidden)
		}
	}
	for _, required := range []string{
		"billing_payment_checkout_capabilities",
		"capability.revoked_at is null",
		"capability.expires_at > now()",
		"'/checkout/'",
	} {
		if !strings.Contains(projection, required) {
			t.Fatalf("payment history projection is missing %q", required)
		}
	}

	for _, scopedPredicate := range []string{
		"where p.organization_id = $1::uuid",
		"and p.id = $2::uuid",
	} {
		if !strings.Contains(text, scopedPredicate) {
			t.Fatalf("payment lookup is missing tenant predicate %q", scopedPredicate)
		}
	}
}

func TestPaymentRefreshUsesOrderedSnapshotAndSafeUnavailableState(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read settings repository: %v", err)
	}
	text := string(source)
	methodStart := strings.Index(text, "func (repo Repository) RefreshSubscriptionPayment")
	if methodStart < 0 {
		t.Fatal("payment refresh method contract was not found")
	}
	methodEnd := strings.Index(text[methodStart:], "func (repo Repository) UpdateSubscriptionBilling")
	if methodEnd < 0 {
		t.Fatal("payment refresh method contract was not found")
	}
	method := text[methodStart : methodStart+methodEnd]

	observedIndex := strings.Index(method, "observedAt := time.Now().UTC()")
	requestIndex := strings.Index(method, "getPayment(ctx, local.AsaasPaymentID)")
	if observedIndex < 0 || requestIndex < 0 || observedIndex >= requestIndex {
		t.Fatal("provider observation timestamp must be captured before the HTTP read")
	}
	for _, required := range []string{
		"validateAsaasPaymentSnapshot",
		"public.reconcile_asaas_payment_snapshot",
		"'settings_payment_refresh'",
		"PaymentSyncStateProviderUnavailable",
		"item.CheckoutURL = nil",
		`case "applied", "stale", "stale_snapshot":`,
	} {
		if !strings.Contains(method, required) {
			t.Fatalf("payment refresh contract is missing %q", required)
		}
	}
	if strings.Contains(method, `"error", providerErr`) {
		t.Fatal("payment refresh must not log the provider response payload")
	}
}
