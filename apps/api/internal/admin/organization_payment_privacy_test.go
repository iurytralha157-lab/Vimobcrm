package admin

import (
	"strings"
	"testing"
)

func TestAdminOrganizationPaymentsExposeOnlyTheVimobReadModel(t *testing.T) {
	for _, required := range []string{
		"'id', p.id::text",
		"'status', coalesce(p.status, '')",
		"'value', p.value",
		"'billing_type', p.billing_type",
		"'due_date', p.due_date",
		"'payment_date', p.payment_date",
	} {
		if !strings.Contains(listOrganizationPaymentsSQL, required) {
			t.Fatalf("admin payment read model is missing %q", required)
		}
	}

	for _, forbidden := range []string{
		"to_jsonb(p)",
		"invoice_url",
		"net_value",
		"asaas_payment_id",
		"asaas_customer_id",
		"asaas_subscription_id",
	} {
		if strings.Contains(strings.ToLower(listOrganizationPaymentsSQL), forbidden) {
			t.Fatalf("admin payment read model must not expose provider-only field %q", forbidden)
		}
	}
}
