package settings

import (
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestPaymentHistoryFallbackIsReadOnlyTenantScopedAndClientSafe(t *testing.T) {
	t.Parallel()

	query := paymentHistoryFallbackProjection + paymentHistoryFallbackFrom
	for _, required := range []string{
		"from public.asaas_payments p",
		"receipt.organization_id = p.organization_id",
		"'checkout_url', null",
		"'bank_slip_registration_cancelled', false",
		"'/comprovantes/' || receipt.verification_token::text",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("payment history fallback is missing %q", required)
		}
	}

	for _, forbidden := range []string{
		"billing_payment_checkout_capabilities",
		"private.",
		"invoice_url",
		"net_value",
		"payer_name",
		"payer_tax_id",
		"billing_email",
		"provider_payment_reference",
	} {
		if strings.Contains(query, forbidden) {
			t.Fatalf("payment history fallback must not expose or depend on %q", forbidden)
		}
	}

	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read settings repository: %v", err)
	}
	text := string(source)
	methodStart := strings.Index(text, "func (repo Repository) listPaymentHistory")
	methodEnd := strings.Index(text, "func scanPaymentHistoryRows")
	if methodStart < 0 || methodEnd <= methodStart {
		t.Fatal("payment history list method contract was not found")
	}
	method := text[methodStart:methodEnd]
	if count := strings.Count(method, "where p.organization_id = $1::uuid"); count != 2 {
		t.Fatalf("canonical and fallback history queries must both be tenant scoped, got %d predicates", count)
	}
}

func TestPaymentHistoryFallbackOnlyAcceptsKnownCheckoutSchemaDrift(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		err  error
		want bool
	}{
		{
			name: "missing checkout capability table",
			err: &pgconn.PgError{
				Code:      "42P01",
				TableName: "billing_payment_checkout_capabilities",
			},
			want: true,
		},
		{
			name: "missing checkout capability relation from postgres message",
			err: &pgconn.PgError{
				Code:    "42P01",
				Message: `relation "billing_payment_checkout_capabilities" does not exist`,
			},
			want: true,
		},
		{
			name: "missing schema qualified checkout capability relation",
			err: &pgconn.PgError{
				Code:    "42P01",
				Message: `relation "public.billing_payment_checkout_capabilities" does not exist`,
			},
			want: true,
		},
		{
			name: "missing cancellation timestamp",
			err: &pgconn.PgError{
				Code:       "42703",
				ColumnName: "bank_slip_registration_cancelled_at",
			},
			want: true,
		},
		{
			name: "missing cancellation due date",
			err: &pgconn.PgError{
				Code:       "42703",
				ColumnName: "bank_slip_registration_cancelled_due_date",
			},
			want: true,
		},
		{
			name: "missing checkout resolvability function",
			err: &pgconn.PgError{
				Code:    "42883",
				Message: "function private.billing_payment_checkout_is_resolvable(uuid) does not exist",
			},
			want: true,
		},
		{
			name: "unrelated missing table",
			err: &pgconn.PgError{
				Code:      "42P01",
				TableName: "billing_payment_receipts",
			},
			want: false,
		},
		{
			name: "unrelated missing table only mentions checkout capability in hint",
			err: &pgconn.PgError{
				Code:      "42P01",
				TableName: "other_table",
				Hint:      "compare with billing_payment_checkout_capabilities",
			},
			want: false,
		},
		{
			name: "unrelated missing column",
			err: &pgconn.PgError{
				Code:       "42703",
				ColumnName: "organization_id",
			},
			want: false,
		},
		{
			name: "unrelated database failure",
			err: &pgconn.PgError{
				Code:    "08006",
				Message: "connection failure",
			},
			want: false,
		},
		{name: "non postgres error", err: errors.New("boom"), want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := isPaymentHistoryCheckoutSchemaDrift(test.err); got != test.want {
				t.Fatalf("isPaymentHistoryCheckoutSchemaDrift() = %v, want %v", got, test.want)
			}
		})
	}
}
