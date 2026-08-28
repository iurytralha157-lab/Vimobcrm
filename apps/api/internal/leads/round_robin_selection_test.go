package leads

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type roundRobinSelectionQueryer struct {
	t       *testing.T
	queries []string
	rows    []pgx.Row
}

func (queryer *roundRobinSelectionQueryer) QueryRow(_ context.Context, sql string, _ ...any) pgx.Row {
	queryer.t.Helper()
	queryer.queries = append(queryer.queries, sql)

	if len(queryer.rows) == 0 {
		queryer.t.Fatal("unexpected round-robin query")
	}

	row := queryer.rows[0]
	queryer.rows = queryer.rows[1:]
	return row
}

func (queryer *roundRobinSelectionQueryer) Begin(context.Context) (pgx.Tx, error) {
	return nil, errors.New("unexpected Begin call")
}

func (queryer *roundRobinSelectionQueryer) Commit(context.Context) error {
	return errors.New("unexpected Commit call")
}

func (queryer *roundRobinSelectionQueryer) Rollback(context.Context) error {
	return errors.New("unexpected Rollback call")
}

func (queryer *roundRobinSelectionQueryer) CopyFrom(context.Context, pgx.Identifier, []string, pgx.CopyFromSource) (int64, error) {
	return 0, errors.New("unexpected CopyFrom call")
}

func (queryer *roundRobinSelectionQueryer) SendBatch(context.Context, *pgx.Batch) pgx.BatchResults {
	queryer.t.Fatal("unexpected SendBatch call")
	return nil
}

func (queryer *roundRobinSelectionQueryer) LargeObjects() pgx.LargeObjects {
	queryer.t.Fatal("unexpected LargeObjects call")
	return pgx.LargeObjects{}
}

func (queryer *roundRobinSelectionQueryer) Prepare(context.Context, string, string) (*pgconn.StatementDescription, error) {
	return nil, errors.New("unexpected Prepare call")
}

func (queryer *roundRobinSelectionQueryer) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, errors.New("unexpected Exec call")
}

func (queryer *roundRobinSelectionQueryer) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("unexpected Query call")
}

func (queryer *roundRobinSelectionQueryer) Conn() *pgx.Conn {
	queryer.t.Fatal("unexpected Conn call")
	return nil
}

type roundRobinSelectionRow struct {
	values []string
	err    error
}

func (row roundRobinSelectionRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	if len(dest) != len(row.values) {
		return errors.New("unexpected round-robin scan destination count")
	}
	for index, value := range row.values {
		target, ok := dest[index].(*string)
		if !ok {
			return errors.New("unexpected round-robin scan destination type")
		}
		*target = value
	}
	return nil
}

func TestSelectRoundRobinMemberLocksQueueBeforeSelectingCandidate(t *testing.T) {
	queryer := &roundRobinSelectionQueryer{
		t: t,
		rows: []pgx.Row{
			roundRobinSelectionRow{values: []string{"11111111-1111-4111-8111-111111111111"}},
			roundRobinSelectionRow{values: []string{
				"22222222-2222-4222-8222-222222222222",
				"33333333-3333-4333-8333-333333333333",
			}},
		},
	}

	selection, reason, err := (Repository{}).selectRoundRobinMember(
		context.Background(),
		queryer,
		"44444444-4444-4444-8444-444444444444",
		"55555555-5555-4555-8555-555555555555",
		"",
	)
	if err != nil {
		t.Fatalf("select round-robin member: %v", err)
	}
	if reason != "" {
		t.Fatalf("unexpected selection reason %q", reason)
	}
	if selection.RoundRobinID != "11111111-1111-4111-8111-111111111111" {
		t.Fatalf("round-robin id = %q", selection.RoundRobinID)
	}
	if selection.MemberID != "22222222-2222-4222-8222-222222222222" {
		t.Fatalf("member id = %q", selection.MemberID)
	}
	if selection.UserID != "33333333-3333-4333-8333-333333333333" {
		t.Fatalf("user id = %q", selection.UserID)
	}
	if len(queryer.queries) != 2 {
		t.Fatalf("query count = %d, want 2", len(queryer.queries))
	}

	queueQuery := strings.ToLower(queryer.queries[0])
	if !strings.Contains(queueQuery, "from public.round_robins") {
		t.Fatal("first query must resolve the round-robin queue")
	}
	if !strings.Contains(queueQuery, "for update") {
		t.Fatal("round-robin queue must be locked before candidate selection")
	}
	if !strings.Contains(strings.ToLower(queryer.queries[1]), "with entries as") {
		t.Fatal("candidate selection must happen only after the queue lock")
	}
}

func TestSelectRoundRobinMemberDoesNotSelectCandidateWithoutQueue(t *testing.T) {
	queryer := &roundRobinSelectionQueryer{
		t:    t,
		rows: []pgx.Row{roundRobinSelectionRow{err: pgx.ErrNoRows}},
	}

	selection, reason, err := (Repository{}).selectRoundRobinMember(
		context.Background(),
		queryer,
		"44444444-4444-4444-8444-444444444444",
		"",
		"",
	)
	if err != nil {
		t.Fatalf("select round-robin member: %v", err)
	}
	if reason != "no_queue" {
		t.Fatalf("selection reason = %q, want no_queue", reason)
	}
	if selection != (roundRobinSelection{}) {
		t.Fatalf("selection = %#v, want empty", selection)
	}
	if len(queryer.queries) != 1 {
		t.Fatalf("query count = %d, want 1", len(queryer.queries))
	}
	if !strings.Contains(strings.ToLower(queryer.queries[0]), "for update") {
		t.Fatal("queue lookup must retain the transactional lock contract")
	}
}
