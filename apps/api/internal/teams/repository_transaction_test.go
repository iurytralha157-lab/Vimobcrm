package teams

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	transactionTestOrganizationID = "11111111-1111-4111-8111-111111111111"
	transactionTestUserID         = "22222222-2222-4222-8222-222222222222"
	transactionTestTeamID         = "33333333-3333-4333-8333-333333333333"
)

func TestUpdateRollsBackWhenRoundRobinTeamSyncFails(t *testing.T) {
	syncFailure := errors.New("round robin team sync failed")
	tx := &teamMutationTestTx{roundRobinQueryErr: syncFailure}
	repo := Repository{
		beginMutationTx: func(context.Context) (pgx.Tx, error) {
			return tx, nil
		},
	}

	emptyMembers := []TeamMemberInput{}
	_, err := repo.Update(
		context.Background(),
		tenant.Context{
			OrganizationID: transactionTestOrganizationID,
			UserID:         transactionTestUserID,
			MemberRole:     "admin",
		},
		transactionTestTeamID,
		UpdateTeamRequest{Members: emptyMembers},
	)

	if !errors.Is(err, syncFailure) {
		t.Fatalf("Update() error = %v, want sync failure", err)
	}
	if !containsSQL(tx.querySQL, "from public.round_robin_members rrm") {
		t.Fatal("round-robin sync was not called")
	}
	if !containsSQL(tx.execSQL, "delete from public.team_members") {
		t.Fatal("team members must be mutated before round-robin synchronization")
	}
	if tx.commitCalls != 0 {
		t.Fatalf("Commit() calls = %d, want 0", tx.commitCalls)
	}
	if tx.rollbackCalls != 1 {
		t.Fatalf("Rollback() calls = %d, want 1", tx.rollbackCalls)
	}
}

func TestRoundRobinTeamSyncPropagatesLockedTenantQueryFailure(t *testing.T) {
	queryFailure := errors.New("round-robin lock failed")
	tx := &teamMutationTestTx{queryErr: queryFailure}

	err := syncRoundRobinWithTeam(
		context.Background(),
		tx,
		transactionTestOrganizationID,
		transactionTestTeamID,
		[]string{transactionTestUserID},
	)

	if !errors.Is(err, queryFailure) {
		t.Fatalf("sync error = %v, want query failure", err)
	}
	if len(tx.querySQL) != 1 {
		t.Fatalf("sync query calls = %d, want 1", len(tx.querySQL))
	}
	if len(tx.queryArgs) != 1 || len(tx.queryArgs[0]) != 2 {
		t.Fatalf("sync query args = %#v, want organization and team IDs", tx.queryArgs)
	}
	if tx.queryArgs[0][0] != transactionTestOrganizationID || tx.queryArgs[0][1] != transactionTestTeamID {
		t.Fatalf("sync query args = %#v, want tenant-scoped IDs", tx.queryArgs[0])
	}
	query := strings.ToLower(tx.querySQL[0])
	for _, fragment := range []string{
		"rr.organization_id = $1::uuid",
		"rrm.team_id = $2::uuid",
		"order by rr.id, rrm.position, rrm.id",
		"for update of rr, rrm",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("sync query must contain %q\n%s", fragment, query)
		}
	}
}

func containsSQL(statements []string, fragment string) bool {
	fragment = strings.ToLower(fragment)
	for _, statement := range statements {
		if strings.Contains(strings.ToLower(statement), fragment) {
			return true
		}
	}
	return false
}

type teamMutationTestTx struct {
	commitCalls        int
	rollbackCalls      int
	execSQL            []string
	querySQL           []string
	queryArgs          [][]any
	queryErr           error
	roundRobinQueryErr error
}

func (tx *teamMutationTestTx) Begin(context.Context) (pgx.Tx, error) {
	return tx, nil
}

func (tx *teamMutationTestTx) Commit(context.Context) error {
	tx.commitCalls++
	return nil
}

func (tx *teamMutationTestTx) Rollback(context.Context) error {
	tx.rollbackCalls++
	return nil
}

func (tx *teamMutationTestTx) CopyFrom(
	context.Context,
	pgx.Identifier,
	[]string,
	pgx.CopyFromSource,
) (int64, error) {
	panic("unexpected CopyFrom call")
}

func (tx *teamMutationTestTx) SendBatch(context.Context, *pgx.Batch) pgx.BatchResults {
	panic("unexpected SendBatch call")
}

func (tx *teamMutationTestTx) LargeObjects() pgx.LargeObjects {
	panic("unexpected LargeObjects call")
}

func (tx *teamMutationTestTx) Prepare(
	context.Context,
	string,
	string,
) (*pgconn.StatementDescription, error) {
	panic("unexpected Prepare call")
}

func (tx *teamMutationTestTx) Exec(
	_ context.Context,
	sql string,
	_ ...any,
) (pgconn.CommandTag, error) {
	tx.execSQL = append(tx.execSQL, sql)
	return pgconn.NewCommandTag("DELETE 1"), nil
}

func (tx *teamMutationTestTx) Query(
	_ context.Context,
	sql string,
	args ...any,
) (pgx.Rows, error) {
	tx.querySQL = append(tx.querySQL, sql)
	tx.queryArgs = append(tx.queryArgs, append([]any(nil), args...))
	if tx.roundRobinQueryErr != nil && strings.Contains(strings.ToLower(sql), "from public.round_robin_members rrm") {
		return nil, tx.roundRobinQueryErr
	}
	if tx.queryErr != nil {
		return nil, tx.queryErr
	}
	return teamMutationEmptyRows{}, nil
}

func (tx *teamMutationTestTx) QueryRow(_ context.Context, sql string, _ ...any) pgx.Row {
	if strings.Contains(strings.ToLower(sql), "from public.teams") && strings.Contains(strings.ToLower(sql), "for update") {
		return teamMutationStringRow(transactionTestTeamID)
	}
	return teamMutationBooleanRow(true)
}

func (tx *teamMutationTestTx) Conn() *pgx.Conn {
	return nil
}

type teamMutationBooleanRow bool

func (row teamMutationBooleanRow) Scan(dest ...any) error {
	if len(dest) != 1 {
		return errors.New("unexpected scan destination count")
	}
	value, ok := dest[0].(*bool)
	if !ok {
		return errors.New("unexpected scan destination type")
	}
	*value = bool(row)
	return nil
}

type teamMutationStringRow string

func (row teamMutationStringRow) Scan(dest ...any) error {
	if len(dest) != 1 {
		return errors.New("unexpected scan destination count")
	}
	value, ok := dest[0].(*string)
	if !ok {
		return errors.New("unexpected scan destination type")
	}
	*value = string(row)
	return nil
}

type teamMutationEmptyRows struct{}

func (teamMutationEmptyRows) Close() {}

func (teamMutationEmptyRows) Err() error {
	return nil
}

func (teamMutationEmptyRows) CommandTag() pgconn.CommandTag {
	return pgconn.CommandTag{}
}

func (teamMutationEmptyRows) FieldDescriptions() []pgconn.FieldDescription {
	return nil
}

func (teamMutationEmptyRows) Next() bool {
	return false
}

func (teamMutationEmptyRows) Scan(...any) error {
	return pgx.ErrNoRows
}

func (teamMutationEmptyRows) Values() ([]any, error) {
	return nil, pgx.ErrNoRows
}

func (teamMutationEmptyRows) RawValues() [][]byte {
	return nil
}

func (teamMutationEmptyRows) Conn() *pgx.Conn {
	return nil
}
