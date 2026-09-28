package leads

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type roundRobinSelectionQueryer struct {
	t       *testing.T
	queries []string
	args    [][]any
	rows    []pgx.Row
}

func (queryer *roundRobinSelectionQueryer) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	queryer.t.Helper()
	queryer.queries = append(queryer.queries, sql)
	queryer.args = append(queryer.args, args)

	if len(queryer.rows) == 0 {
		queryer.t.Fatal("unexpected round-robin query")
	}

	row := queryer.rows[0]
	queryer.rows = queryer.rows[1:]
	return row
}

func TestPendingLeadDistributionQueuePrefersLatestFailedQueueOverIntakeOrigin(t *testing.T) {
	const organizationID = "44444444-4444-4444-8444-444444444444"
	const leadID = "55555555-5555-4555-8555-555555555555"
	const latestQueueID = "11111111-1111-4111-8111-111111111111"
	queryer := &roundRobinSelectionQueryer{
		t:    t,
		rows: []pgx.Row{roundRobinSelectionRow{values: []string{"lead_distribution_pending", "no_available_members", latestQueueID}}},
	}
	queueID, err := (Repository{}).pendingLeadDistributionQueue(context.Background(), queryer, organizationID, leadSnapshot{
		ID:   leadID,
		Data: map[string]any{"origin_round_robin_id": "22222222-2222-4222-8222-222222222222"},
	})
	if err != nil || queueID == nil || *queueID != latestQueueID {
		t.Fatalf("retry queue = %v, error = %v; want latest pending queue", queueID, err)
	}
	if len(queryer.queries) != 1 || !strings.Contains(queryer.queries[0], "organization_id = $1::uuid") || !strings.Contains(queryer.queries[0], "lead_id = $2::uuid") {
		t.Fatalf("retry lookup must be scoped to organization and lead: %#v", queryer.queries)
	}
	if got := queryer.args[0]; len(got) != 2 || got[0] != organizationID || got[1] != leadID {
		t.Fatalf("retry lookup arguments = %#v", got)
	}
}

func TestPendingLeadDistributionQueueDoesNotReopenRoutingAfterNoMatchingQueue(t *testing.T) {
	queryer := &roundRobinSelectionQueryer{
		t:    t,
		rows: []pgx.Row{roundRobinSelectionRow{values: []string{"lead_distribution_pending", "no_matching_queue", ""}}},
	}
	queueID, err := (Repository{}).pendingLeadDistributionQueue(context.Background(), queryer, "44444444-4444-4444-8444-444444444444", leadSnapshot{
		ID:   "55555555-5555-4555-8555-555555555555",
		Data: map[string]any{"origin_round_robin_id": "22222222-2222-4222-8222-222222222222"},
	})
	if err != nil || queueID != nil {
		t.Fatalf("no-matching-queue retry = %v, error = %v; want frozen no-queue", queueID, err)
	}
}

func TestPendingLeadDistributionQueueUsesLegacyFailureBeforeOrigin(t *testing.T) {
	const failedQueueID = "11111111-1111-4111-8111-111111111111"
	queryer := &roundRobinSelectionQueryer{
		t: t,
		rows: []pgx.Row{
			roundRobinSelectionRow{err: pgx.ErrNoRows},
			roundRobinSelectionRow{values: []string{"no_available_members", failedQueueID}},
		},
	}
	queueID, err := (Repository{}).pendingLeadDistributionQueue(context.Background(), queryer, "44444444-4444-4444-8444-444444444444", leadSnapshot{
		ID:   "55555555-5555-4555-8555-555555555555",
		Data: map[string]any{"origin_round_robin_id": "22222222-2222-4222-8222-222222222222"},
	})
	if err != nil || queueID == nil || *queueID != failedQueueID {
		t.Fatalf("legacy retry queue = %v, error = %v; want failed queue", queueID, err)
	}
	if len(queryer.queries) != 2 || !strings.Contains(queryer.queries[1], "from public.round_robin_logs") {
		t.Fatalf("legacy failure lookup was not used: %#v", queryer.queries)
	}
}

func TestPendingLeadDistributionQueueFallsBackToImmutableOrigin(t *testing.T) {
	const originQueueID = "22222222-2222-4222-8222-222222222222"
	queryer := &roundRobinSelectionQueryer{
		t:    t,
		rows: []pgx.Row{roundRobinSelectionRow{values: []string{"lead_assigned", "", "11111111-1111-4111-8111-111111111111"}}},
	}
	queueID, err := (Repository{}).pendingLeadDistributionQueue(context.Background(), queryer, "44444444-4444-4444-8444-444444444444", leadSnapshot{
		ID:   "55555555-5555-4555-8555-555555555555",
		Data: map[string]any{"origin_round_robin_id": originQueueID},
	})
	if err != nil || queueID == nil || *queueID != originQueueID {
		t.Fatalf("fallback queue = %v, error = %v; want immutable origin", queueID, err)
	}
}

func TestRetryPreservesLeadTeamForScopedLeader(t *testing.T) {
	teamID := "11111111-1111-4111-8111-111111111111"
	otherTeamID := "22222222-2222-4222-8222-222222222222"
	leader := tenant.Context{MemberRole: "leader", LedTeamIDs: []string{teamID}}
	current := leadSnapshot{TeamID: teamID}
	if !retryPreservesLeadTeam(leader, current, distribution.Result{Success: true, TeamID: &teamID}) {
		t.Fatal("leader's team assignment should be allowed")
	}
	if retryPreservesLeadTeam(leader, current, distribution.Result{Success: true, TeamID: &otherTeamID}) {
		t.Fatal("leader must not move the lead to another team through queue retry")
	}
	if retryPreservesLeadTeam(leader, current, distribution.Result{Success: true}) {
		t.Fatal("leader must not erase team scope through queue retry")
	}
	if !retryPreservesLeadTeam(tenant.Context{MemberRole: "admin"}, current, distribution.Result{Success: true, TeamID: &otherTeamID}) {
		t.Fatal("administrator may use a queue that targets another team")
	}
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
