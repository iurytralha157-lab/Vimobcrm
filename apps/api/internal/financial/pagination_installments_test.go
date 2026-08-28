package financial

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestFinancialListPaginationIsBoundedAndAdditive(t *testing.T) {
	args := []any{"organization"}
	clause, err := financialListPaginationSQL(url.Values{}, &args)
	if err != nil {
		t.Fatalf("default pagination: %v", err)
	}
	if clause != "limit $2::int offset $3::int" || len(args) != 3 || args[1] != defaultFinancialListLimit || args[2] != 0 {
		t.Fatalf("default pagination = %q %#v", clause, args)
	}

	args = []any{"organization", "filter"}
	clause, err = financialListPaginationSQL(url.Values{"limit": {"50"}, "offset": {"100"}}, &args)
	if err != nil {
		t.Fatalf("explicit pagination: %v", err)
	}
	if clause != "limit $3::int offset $4::int" || args[2] != 50 || args[3] != 100 {
		t.Fatalf("explicit pagination = %q %#v", clause, args)
	}

	for _, values := range []url.Values{
		{"limit": {"0"}},
		{"limit": {"501"}},
		{"offset": {"-1"}},
		{"offset": {"invalid"}},
	} {
		if _, err := financialListPaginationSQL(values, &[]any{}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("pagination %#v error = %v, want invalid input", values, err)
		}
	}
}

func TestFinancialInstallmentsPreserveCentsAndAvoidZeroRows(t *testing.T) {
	values, err := splitFinancialCents(10_000, 0, 3)
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	if len(values) != 3 || values[0] != 3_334 || values[1] != 3_333 || values[2] != 3_333 {
		t.Fatalf("split = %#v", values)
	}
	if _, err := splitFinancialCents(1, 0, 2); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("zero-cent installment error = %v", err)
	}
	values, err = splitFinancialCents(10_000, 10_000, 12)
	if err != nil || len(values) != 0 {
		t.Fatalf("fully paid split = %#v, %v", values, err)
	}
}

func TestContractReceivablesUseDatabaseCivilCalendarAndExactCents(t *testing.T) {
	exec := &financialRegressionExec{}
	err := createContractReceivables(
		context.Background(),
		exec,
		tenant.Context{
			OrganizationID: "11111111-1111-4111-8111-111111111111",
			UserID:         "22222222-2222-4222-8222-222222222222",
		},
		"33333333-3333-4333-8333-333333333333",
		"CTR-2026-00001",
		100,
		0,
		3,
	)
	if err != nil {
		t.Fatalf("create receivables: %v", err)
	}
	if len(exec.execQueries) != 3 {
		t.Fatalf("insert count = %d, want 3", len(exec.execQueries))
	}
	wantAmounts := []string{"33.34", "33.33", "33.33"}
	for index, query := range exec.execQueries {
		if !strings.Contains(query, "current_date + make_interval") {
			t.Fatalf("installment %d does not use database civil date: %s", index, query)
		}
		if got := exec.execArgs[index][3]; got != wantAmounts[index] {
			t.Fatalf("installment %d amount = %#v, want %q", index, got, wantAmounts[index])
		}
	}

	fullyPaid := &financialRegressionExec{}
	err = createContractReceivables(
		context.Background(),
		fullyPaid,
		tenant.Context{
			OrganizationID: "11111111-1111-4111-8111-111111111111",
			UserID:         "22222222-2222-4222-8222-222222222222",
		},
		"33333333-3333-4333-8333-333333333333",
		"CTR-2026-00002",
		100,
		100,
		12,
	)
	if err != nil {
		t.Fatalf("fully paid receivables: %v", err)
	}
	if len(fullyPaid.execQueries) != 1 || !strings.Contains(fullyPaid.execQueries[0], "'Entrada'") {
		t.Fatalf("fully paid contract created zero installments: %#v", fullyPaid.execQueries)
	}
}
