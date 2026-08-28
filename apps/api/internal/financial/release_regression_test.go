package financial

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type financialRegressionRow struct {
	value any
	err   error
}

func (row financialRegressionRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	values := []any{row.value}
	if len(dest) > 1 {
		var ok bool
		values, ok = row.value.([]any)
		if !ok || len(values) != len(dest) {
			return errors.New("unexpected scan destination count")
		}
	}
	for index, target := range dest {
		if err := assignFinancialRegressionValue(target, values[index]); err != nil {
			return err
		}
	}
	return nil
}

func assignFinancialRegressionValue(destination any, value any) error {
	switch target := destination.(type) {
	case *bool:
		value, ok := value.(bool)
		if !ok {
			return errors.New("expected bool row")
		}
		*target = value
	case *string:
		value, ok := value.(string)
		if !ok {
			return errors.New("expected string row")
		}
		*target = value
	case *[]byte:
		value, ok := value.([]byte)
		if !ok {
			return errors.New("expected json row")
		}
		*target = value
	case *int:
		value, ok := value.(int)
		if !ok {
			return errors.New("expected int row")
		}
		*target = value
	case *float64:
		value, ok := value.(float64)
		if !ok {
			return errors.New("expected float row")
		}
		*target = value
	default:
		return errors.New("unexpected scan destination")
	}
	return nil
}

type financialRegressionExec struct {
	rows        []financialRegressionRow
	queries     []string
	queryArgs   [][]any
	execQueries []string
	execArgs    [][]any
	tags        []pgconn.CommandTag
}

func (exec *financialRegressionExec) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	exec.queries = append(exec.queries, query)
	exec.queryArgs = append(exec.queryArgs, args)
	if len(exec.rows) == 0 {
		return financialRegressionRow{err: errors.New("unexpected query")}
	}
	row := exec.rows[0]
	exec.rows = exec.rows[1:]
	return row
}

func (exec *financialRegressionExec) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	exec.execQueries = append(exec.execQueries, query)
	exec.execArgs = append(exec.execArgs, args)
	if len(exec.tags) > 0 {
		tag := exec.tags[0]
		exec.tags = exec.tags[1:]
		return tag, nil
	}
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

func TestFinancialConflictIsHTTP409(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/contracts/id/activate", nil)

	writeFinancialError(recorder, request, ErrConflict)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusConflict)
	}
	if !strings.Contains(recorder.Body.String(), "financial_state_conflict") {
		t.Fatalf("body = %s, want conflict code", recorder.Body.String())
	}
}

func TestActivateContractRejectsNonDraftBeforeAnyWrite(t *testing.T) {
	organizationID := "11111111-1111-4111-8111-111111111111"
	contractID := "22222222-2222-4222-8222-222222222222"
	exec := &financialRegressionExec{rows: []financialRegressionRow{{value: []byte(`{
		"id":"22222222-2222-4222-8222-222222222222",
		"organization_id":"11111111-1111-4111-8111-111111111111",
		"status":"active",
		"brokers":[]
	}`)}}}
	repo := Repository{}

	err := repo.activateContractWithExec(context.Background(), exec, tenant.Context{
		OrganizationID: organizationID,
		UserID:         "33333333-3333-4333-8333-333333333333",
	}, contractID, true)

	if !errors.Is(err, ErrConflict) {
		t.Fatalf("error = %v, want ErrConflict", err)
	}
	if len(exec.execQueries) != 0 {
		t.Fatalf("writes = %d, want 0", len(exec.execQueries))
	}
	if len(exec.queries) != 1 || !strings.Contains(strings.ToLower(exec.queries[0]), "for update of c") {
		t.Fatalf("contract was not locked before state validation: %#v", exec.queries)
	}
}

func TestActivateContractUsesConditionalDraftTransition(t *testing.T) {
	organizationID := "11111111-1111-4111-8111-111111111111"
	contractID := "22222222-2222-4222-8222-222222222222"
	exec := &financialRegressionExec{rows: []financialRegressionRow{{value: []byte(`{
		"id":"22222222-2222-4222-8222-222222222222",
		"organization_id":"11111111-1111-4111-8111-111111111111",
		"status":"draft",
		"value":100,
		"down_payment":0,
		"installments":1,
		"contract_number":"CTR-1",
		"brokers":[]
	}`)}}}
	repo := Repository{}

	err := repo.activateContractWithExec(context.Background(), exec, tenant.Context{
		OrganizationID: organizationID,
		UserID:         "33333333-3333-4333-8333-333333333333",
	}, contractID, true)

	if err != nil {
		t.Fatalf("activate draft contract: %v", err)
	}
	if len(exec.execQueries) != 3 {
		t.Fatalf("writes = %d, want status update, trigger cleanup and one receivable", len(exec.execQueries))
	}
	if !strings.Contains(exec.execQueries[0], "and status = 'draft'") {
		t.Fatalf("activation update is not state-guarded: %s", exec.execQueries[0])
	}
	if !strings.Contains(exec.execQueries[1], "delete from public.commissions") || !strings.Contains(exec.execQueries[1], "transaction_timestamp()") {
		t.Fatalf("skipCommissions did not clean only transaction-created legacy rows: %s", exec.execQueries[1])
	}
	if !strings.Contains(exec.execQueries[2], "insert into public.financial_entries") {
		t.Fatalf("contract receivable was not generated: %s", exec.execQueries[2])
	}
}

func TestEnsureDraftContractRejectsActiveAndMissingContracts(t *testing.T) {
	active := &financialRegressionExec{rows: []financialRegressionRow{{value: "active"}}}
	if err := ensureDraftContract(context.Background(), active, "org", "contract"); !errors.Is(err, ErrConflict) {
		t.Fatalf("active error = %v, want ErrConflict", err)
	}

	missing := &financialRegressionExec{rows: []financialRegressionRow{{err: pgx.ErrNoRows}}}
	if err := ensureDraftContract(context.Background(), missing, "org", "contract"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing error = %v, want ErrNotFound", err)
	}
}

func TestCommissionRegenerationFailsClosedForProtectedState(t *testing.T) {
	protected := &financialRegressionExec{rows: []financialRegressionRow{{value: true}}}
	err := ensureCommissionRegenerationSafe(context.Background(), protected, "org", "contract")
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("error = %v, want ErrConflict", err)
	}
	if len(protected.queries) != 1 || !strings.Contains(strings.ToLower(protected.queries[0]), "for update") {
		t.Fatalf("protected rows were not locked: %#v", protected.queries)
	}
	protectedEntry := &financialRegressionExec{rows: []financialRegressionRow{{value: false}, {value: true}}}
	if err := ensureCommissionRegenerationSafe(context.Background(), protectedEntry, "org", "contract"); !errors.Is(err, ErrConflict) {
		t.Fatalf("protected financial entry error = %v, want ErrConflict", err)
	}

	safe := &financialRegressionExec{rows: []financialRegressionRow{{value: false}, {value: false}}}
	if err := ensureCommissionRegenerationSafe(context.Background(), safe, "org", "contract"); err != nil {
		t.Fatalf("safe regeneration rejected: %v", err)
	}
}

func TestCommissionRegenerationCancelsInsteadOfDeletingHistory(t *testing.T) {
	exec := &financialRegressionExec{}
	_, err := regenerateContractCommissions(context.Background(), exec, tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "33333333-3333-4333-8333-333333333333",
	}, map[string]any{
		"id":    "22222222-2222-4222-8222-222222222222",
		"value": 100.0,
	}, nil)
	if err != nil {
		t.Fatalf("regenerate commissions: %v", err)
	}
	if len(exec.execQueries) != 2 {
		t.Fatalf("writes = %d, want two cancellation updates", len(exec.execQueries))
	}
	for _, query := range exec.execQueries {
		lower := strings.ToLower(query)
		if strings.Contains(lower, "delete from") || !strings.Contains(lower, "set status = 'cancelled'") {
			t.Fatalf("regeneration must preserve rows and history: %s", query)
		}
		if !strings.Contains(lower, "organization_id = $1::uuid") {
			t.Fatalf("regeneration write is not tenant-scoped: %s", query)
		}
	}
}

func TestCommissionsByBrokerScopeRestrictsViewers(t *testing.T) {
	viewer := tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		Permissions:    []string{"financial_view"},
	}
	where, args := commissionsByBrokerScope(viewer)
	if !strings.Contains(where, "cm.user_id = $2::uuid") || len(args) != 2 || args[1] != viewer.UserID {
		t.Fatalf("viewer scope = %q %#v, want own commissions", where, args)
	}

	manager := viewer
	manager.Permissions = []string{"financial_manage"}
	where, args = commissionsByBrokerScope(manager)
	if strings.Contains(where, "cm.user_id") || len(args) != 1 {
		t.Fatalf("manager scope = %q %#v, want organization commissions", where, args)
	}
}

func TestDREMappingsJoinAndReferenceAreTenantScoped(t *testing.T) {
	if !strings.Contains(dreMappingsSelectSQL, "g.organization_id = m.organization_id") {
		t.Fatalf("DRE group join is not tenant-scoped: %s", dreMappingsSelectSQL)
	}

	exec := &financialReferenceValidationExec{exists: false}
	err := validateOptionalOrganizationReference(
		context.Background(),
		exec,
		"11111111-1111-4111-8111-111111111111",
		map[string]any{"group_id": "22222222-2222-4222-8222-222222222222"},
		"group_id",
		"dre_account_groups",
	)
	if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("cross-tenant DRE group error = %v, want access denied", err)
	}
	if len(exec.queries) != 1 || !strings.Contains(exec.queries[0], "organization_id = $1::uuid") {
		t.Fatalf("DRE group validation is not tenant-scoped: %#v", exec.queries)
	}
}

func TestContractJSONMatchesCommissionResponseContract(t *testing.T) {
	query := contractJSONSQL(true)
	parts := strings.SplitN(query, "'commissions'", 2)
	if len(parts) != 2 {
		t.Fatalf("contract JSON has no commissions section: %s", query)
	}
	commissionQuery := parts[1]
	for _, fragment := range []string{
		"'id', u.id::text",
		"'name', u.name",
		"'email', u.email",
		"'base_value', coalesce(cm.base_value, 0)",
		"'calculated_value', coalesce(cm.calculated_value, cm.amount, 0)",
	} {
		if !strings.Contains(commissionQuery, fragment) {
			t.Fatalf("contract JSON is missing %q: %s", fragment, query)
		}
	}
}

func TestContractCreatePayloadAlwaysStartsAsDraft(t *testing.T) {
	payload := map[string]any{
		"status":     "active",
		"created_by": "attacker",
	}
	prepareContractCreatePayload(payload, "33333333-3333-4333-8333-333333333333")

	if payload["status"] != "draft" {
		t.Fatalf("status = %#v, want draft", payload["status"])
	}
	if payload["created_by"] != "33333333-3333-4333-8333-333333333333" {
		t.Fatalf("created_by = %#v, want authenticated user", payload["created_by"])
	}
}

func TestNextContractNumberUsesBaselineSequenceColumns(t *testing.T) {
	exec := &financialRegressionExec{rows: []financialRegressionRow{{value: 7}}}
	number, err := (Repository{}).nextContractNumber(context.Background(), exec, "11111111-1111-4111-8111-111111111111")
	if err != nil {
		t.Fatalf("next contract number: %v", err)
	}
	if !strings.HasSuffix(number, "-00007") {
		t.Fatalf("number = %q, want sequence 00007", number)
	}
	if len(exec.queries) != 1 || strings.Contains(strings.ToLower(exec.queries[0]), "updated_at") {
		t.Fatalf("sequence query references columns absent from baseline: %#v", exec.queries)
	}
}

func TestCommissionStatusTransitionsAreConditional(t *testing.T) {
	tenantContext := tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "33333333-3333-4333-8333-333333333333",
	}
	for action, expectedState := range map[string]string{
		"approve": "('pending', 'pendente')",
		"pay":     "('approved', 'aprovada')",
		"cancel":  "('forecast', 'prevista', 'pending', 'pendente', 'approved', 'aprovada')",
	} {
		exec := &financialRegressionExec{rows: []financialRegressionRow{{value: []byte(`{"id":"commission"}`)}}}
		if _, err := updateCommissionStatusWithExec(context.Background(), exec, tenantContext, "22222222-2222-4222-8222-222222222222", action, CommissionStatusRequest{}); err != nil {
			t.Fatalf("%s transition: %v", action, err)
		}
		if len(exec.queries) != 1 || !strings.Contains(exec.queries[0], expectedState) {
			t.Fatalf("%s query is not state-guarded: %#v", action, exec.queries)
		}
	}

	conflict := &financialRegressionExec{rows: []financialRegressionRow{{err: pgx.ErrNoRows}}}
	_, err := updateCommissionStatusWithExec(context.Background(), conflict, tenantContext, "22222222-2222-4222-8222-222222222222", "pay", CommissionStatusRequest{})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("stale transition error = %v, want ErrConflict", err)
	}
}

func TestMarkEntryPaidIsStateGuardedAndRequiresExactValue(t *testing.T) {
	exec := &financialRegressionExec{rows: []financialRegressionRow{{value: []byte(`{"id":"entry"}`)}}}
	if _, err := markEntryPaidWithExec(context.Background(), exec, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", 100); err != nil {
		t.Fatalf("mark paid: %v", err)
	}
	if len(exec.queries) != 1 || !strings.Contains(exec.queries[0], "and amount = $3::numeric") || !strings.Contains(exec.queries[0], "'overdue'") {
		t.Fatalf("payment query is not state/value guarded: %#v", exec.queries)
	}

	conflict := &financialRegressionExec{rows: []financialRegressionRow{{err: pgx.ErrNoRows}}}
	_, err := markEntryPaidWithExec(context.Background(), conflict, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", 100)
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("stale payment error = %v, want ErrConflict", err)
	}
	for _, value := range []any{nil, 0, -1, "invalid"} {
		if _, ok := positiveFiniteNumber(value); ok {
			t.Fatalf("paid value %#v should be rejected", value)
		}
	}
}

func TestPaidAndCommissionEntriesAreImmutableInGenericMutation(t *testing.T) {
	paid := &financialRegressionExec{rows: []financialRegressionRow{{value: []any{"paid", "Venda", 100.0}}}}
	if _, err := lockMutableFinancialEntry(context.Background(), paid, "org", "entry"); !errors.Is(err, ErrConflict) {
		t.Fatalf("paid entry error = %v, want ErrConflict", err)
	}
	partiallyPaid := &financialRegressionExec{rows: []financialRegressionRow{{value: []any{"pending", "Venda", 25.0}}}}
	if _, err := lockMutableFinancialEntry(context.Background(), partiallyPaid, "org", "entry"); !errors.Is(err, ErrConflict) {
		t.Fatalf("partially paid entry error = %v, want ErrConflict", err)
	}

	commission := &financialRegressionExec{rows: []financialRegressionRow{{value: []any{"pending", "Comissão", 0.0}}}}
	if _, err := lockMutableFinancialEntry(context.Background(), commission, "org", "entry"); !errors.Is(err, ErrConflict) {
		t.Fatalf("commission entry error = %v, want ErrConflict", err)
	}

	mutable := &financialRegressionExec{rows: []financialRegressionRow{{value: []any{"pending", "Venda", 0.0}}}}
	state, err := lockMutableFinancialEntry(context.Background(), mutable, "org", "entry")
	if err != nil {
		t.Fatalf("lock mutable entry: %v", err)
	}
	if len(mutable.queries) != 1 || !strings.Contains(strings.ToLower(mutable.queries[0]), "for update") {
		t.Fatalf("entry was not locked: %#v", mutable.queries)
	}
	for _, payload := range []map[string]any{
		{"paid_value": 100},
		{"status": "paid"},
		{"category": "Comissao"},
	} {
		if err := validateFinancialEntryMutation(state, payload); !errors.Is(err, ErrConflict) {
			t.Fatalf("payload %#v error = %v, want ErrConflict", payload, err)
		}
	}
	if err := validateFinancialEntryMutation(state, map[string]any{"description": "Atualizada", "status": "pending"}); err != nil {
		t.Fatalf("ordinary pending update rejected: %v", err)
	}
}
