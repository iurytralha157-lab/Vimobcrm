package financial

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type financialReferenceValidationExec struct {
	exists      bool
	queries     []string
	args        [][]any
	execQueries []string
	execArgs    [][]any
}

func (exec *financialReferenceValidationExec) Exec(
	_ context.Context,
	query string,
	args ...any,
) (pgconn.CommandTag, error) {
	exec.execQueries = append(exec.execQueries, query)
	exec.execArgs = append(exec.execArgs, args)
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func (exec *financialReferenceValidationExec) QueryRow(
	_ context.Context,
	query string,
	args ...any,
) pgx.Row {
	exec.queries = append(exec.queries, query)
	exec.args = append(exec.args, args)
	return financialReferenceValidationRow{exists: exec.exists}
}

type financialReferenceValidationRow struct {
	exists bool
}

func (row financialReferenceValidationRow) Scan(dest ...any) error {
	*(dest[0].(*bool)) = row.exists
	return nil
}

func TestFinancialReferenceValidationSkipsAbsentRelations(t *testing.T) {
	exec := &financialReferenceValidationExec{exists: true}

	err := validateFinancialEntryReferences(
		context.Background(),
		exec,
		"11111111-1111-4111-8111-111111111111",
		map[string]any{"description": "Receita"},
	)
	if err != nil {
		t.Fatalf("validate references: %v", err)
	}
	if len(exec.queries) != 0 {
		t.Fatalf("queries = %d, want 0", len(exec.queries))
	}
}

func TestFinancialReferenceValidationRejectsMalformedUUID(t *testing.T) {
	exec := &financialReferenceValidationExec{exists: true}

	err := validateContractReferences(
		context.Background(),
		exec,
		"11111111-1111-4111-8111-111111111111",
		map[string]any{"property_id": "not-a-uuid"},
	)
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}
	if len(exec.queries) != 0 {
		t.Fatalf("queries = %d, want 0", len(exec.queries))
	}
}

func TestFinancialReferenceValidationScopesRelationToOrganization(t *testing.T) {
	organizationID := "11111111-1111-4111-8111-111111111111"
	propertyID := "22222222-2222-4222-8222-222222222222"
	exec := &financialReferenceValidationExec{exists: true}

	err := validateContractReferences(
		context.Background(),
		exec,
		organizationID,
		map[string]any{"property_id": propertyID},
	)
	if err != nil {
		t.Fatalf("validate references: %v", err)
	}
	if len(exec.queries) != 1 {
		t.Fatalf("queries = %d, want 1", len(exec.queries))
	}
	if !strings.Contains(exec.queries[0], "organization_id = $1::uuid") {
		t.Fatalf("query does not scope the property by organization: %s", exec.queries[0])
	}
	if len(exec.args[0]) != 2 || exec.args[0][0] != organizationID || exec.args[0][1] != propertyID {
		t.Fatalf("query args = %#v, want organization and property IDs", exec.args[0])
	}
}

func TestFinancialReferenceValidationRejectsCrossTenantRelation(t *testing.T) {
	exec := &financialReferenceValidationExec{exists: false}

	err := validateFinancialEntryReferences(
		context.Background(),
		exec,
		"11111111-1111-4111-8111-111111111111",
		map[string]any{"broker_id": "22222222-2222-4222-8222-222222222222"},
	)
	if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("error = %v, want tenant access denied", err)
	}
	if len(exec.queries) != 1 || !strings.Contains(exec.queries[0], "is_active = true") {
		t.Fatalf("active membership query was not used: %#v", exec.queries)
	}
}

func TestReplaceContractBrokersUsesBaselineColumnsAndActiveMembership(t *testing.T) {
	exec := &financialReferenceValidationExec{exists: true}
	contractID := "33333333-3333-4333-8333-333333333333"
	userID := "22222222-2222-4222-8222-222222222222"

	err := replaceContractBrokers(
		context.Background(),
		exec,
		"11111111-1111-4111-8111-111111111111",
		contractID,
		[]map[string]any{{
			"user_id":               userID,
			"commission_percentage": 5.0,
			"role":                  "closer",
		}},
	)
	if err != nil {
		t.Fatalf("replace brokers: %v", err)
	}
	if len(exec.queries) != 1 || !strings.Contains(exec.queries[0], "is_active = true") {
		t.Fatalf("active membership query was not used: %#v", exec.queries)
	}
	if len(exec.execQueries) != 2 {
		t.Fatalf("exec queries = %d, want delete and insert", len(exec.execQueries))
	}
	insertQuery := exec.execQueries[1]
	if strings.Contains(insertQuery, "commission_value") || strings.Contains(insertQuery, "role") {
		t.Fatalf("insert uses columns absent from the baseline schema: %s", insertQuery)
	}
	if !strings.Contains(insertQuery, "contract_id, user_id, commission_percentage") {
		t.Fatalf("insert does not use the baseline broker columns: %s", insertQuery)
	}
	if len(exec.execArgs[1]) != 3 || exec.execArgs[1][0] != contractID || exec.execArgs[1][1] != userID {
		t.Fatalf("insert args = %#v, want contract, user and percentage", exec.execArgs[1])
	}
}

func TestCommissionStatusAliasesPreserveLegacyRows(t *testing.T) {
	tests := map[string][]string{
		"forecast":  {"forecast", "prevista"},
		"prevista":  {"forecast", "prevista"},
		"pending":   {"pending", "pendente"},
		"aprovada":  {"approved", "aprovada"},
		"paid":      {"paid", "paga"},
		"cancelada": {"cancelled", "cancelada"},
	}
	for input, want := range tests {
		got, ok := commissionStatusAliases(input)
		if !ok {
			t.Fatalf("status %q was rejected", input)
		}
		if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
			t.Fatalf("status %q aliases = %#v, want %#v", input, got, want)
		}
	}
	if _, ok := commissionStatusAliases("unknown"); ok {
		t.Fatal("unknown commission status must be rejected")
	}
}
