package leads

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

type redistributionActivityQueryer struct {
	sql  string
	args []any
	row  pgx.Row
}

func (queryer *redistributionActivityQueryer) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	queryer.sql = sql
	queryer.args = args
	return queryer.row
}

type redistributionBoolRow struct {
	value bool
	err   error
}

func (row redistributionBoolRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	*(dest[0].(*bool)) = row.value
	return nil
}

type redistributionAvailabilityRow struct {
	hasAlternative bool
	nextAt         time.Time
	err            error
}

func (row redistributionAvailabilityRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	*(dest[0].(*bool)) = row.hasAlternative
	*(dest[1].(*pgtype.Timestamptz)) = pgtype.Timestamptz{
		Time:  row.nextAt,
		Valid: !row.nextAt.IsZero(),
	}
	return nil
}

type redistributionExecutor struct {
	sql  string
	args []any
	err  error
}

type redistributionSelectionRow struct {
	memberID string
	userID   string
	err      error
}

func (row redistributionSelectionRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	*(dest[0].(*string)) = row.memberID
	*(dest[1].(*string)) = row.userID
	return nil
}

type redistributionJSONRow struct {
	value []byte
	err   error
}

func (row redistributionJSONRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	*(dest[0].(*[]byte)) = append([]byte(nil), row.value...)
	return nil
}

type redistributionStringRow struct {
	value string
	err   error
}

func (row redistributionStringRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	*(dest[0].(*string)) = row.value
	return nil
}

type redistributionQueryExecutor struct {
	rows       []pgx.Row
	queries    []string
	queryArgs  [][]any
	execSQL    []string
	execArgs   [][]any
	execErrs   []error
	execTags   []pgconn.CommandTag
	operations []string
}

func (store *redistributionQueryExecutor) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	store.queries = append(store.queries, sql)
	store.queryArgs = append(store.queryArgs, args)
	store.operations = append(store.operations, "query:"+sql)
	if len(store.rows) == 0 {
		return redistributionBoolRow{err: errors.New("unexpected redistribution query")}
	}
	row := store.rows[0]
	store.rows = store.rows[1:]
	return row
}

func (store *redistributionQueryExecutor) Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	store.execSQL = append(store.execSQL, sql)
	store.execArgs = append(store.execArgs, arguments)
	store.operations = append(store.operations, "exec:"+sql)
	tag := pgconn.NewCommandTag("UPDATE 1")
	if len(store.execTags) > 0 {
		tag = store.execTags[0]
		store.execTags = store.execTags[1:]
	}
	var err error
	if len(store.execErrs) > 0 {
		err = store.execErrs[0]
		store.execErrs = store.execErrs[1:]
	}
	return tag, err
}

func (executor *redistributionExecutor) Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	executor.sql = sql
	executor.args = arguments
	return pgconn.CommandTag{}, executor.err
}

func TestInitialDistributionMetadataFlagParsingIsSafe(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		raw       string
		want      bool
		wantAllow bool
	}{
		{name: "boolean true", raw: `{"initial_distribution_pending":true}`, want: true},
		{name: "legacy string true", raw: `{"initial_distribution_pending":"yes"}`, want: true},
		{name: "legacy numeric true", raw: `{"initial_distribution_pending":1}`, want: true},
		{name: "assigned redistribution", raw: `{"initial_distribution_pending":true,"allow_assigned_redistribution":true}`, want: true, wantAllow: true},
		{name: "allow without initial marker", raw: `{"allow_assigned_redistribution":true}`, wantAllow: true},
		{name: "boolean false", raw: `{"initial_distribution_pending":false}`, want: false},
		{name: "unknown value", raw: `{"initial_distribution_pending":"sometimes"}`, want: false},
		{name: "non object", raw: `[]`, want: false},
		{name: "invalid json", raw: `{`, want: false},
		{name: "trailing json", raw: `{} {}`, want: false},
		{name: "empty", raw: ``, want: false},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, gotAllow := redistributionJobFlagsFromMetadata([]byte(test.raw))
			if got != test.want {
				t.Fatalf("initial distribution flag for %q = %t, want %t", test.raw, got, test.want)
			}
			if gotAllow != test.wantAllow {
				t.Fatalf("allowAssignedRedistribution(%q) = %t, want %t", test.raw, gotAllow, test.wantAllow)
			}
		})
	}
}

func TestBackendDistributionResultParsingIsSafe(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		raw     string
		want    bool
		wantErr bool
	}{
		{name: "success", raw: `{"success":true,"assigned_user_id":"user"}`, want: true},
		{name: "legacy success string", raw: `{"success":"yes"}`, want: true},
		{name: "legacy success number", raw: `{"success":1}`, want: true},
		{name: "not successful", raw: `{"success":false,"reason":"no_available_members"}`},
		{name: "missing success", raw: `{"reason":"no_available_members"}`},
		{name: "invalid success type", raw: `{"success":[]}`, wantErr: true},
		{name: "null success", raw: `{"success":null}`, wantErr: true},
		{name: "invalid json", raw: `{`, wantErr: true},
		{name: "non object", raw: `[]`, wantErr: true},
		{name: "null", raw: `null`, wantErr: true},
		{name: "trailing json", raw: `{} {}`, wantErr: true},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, err := parseBackendDistributionSuccess([]byte(test.raw))
			if (err != nil) != test.wantErr {
				t.Fatalf("parseBackendDistributionSuccess(%q) error = %v, wantErr %t", test.raw, err, test.wantErr)
			}
			if got != test.want {
				t.Fatalf("parseBackendDistributionSuccess(%q) = %t, want %t", test.raw, got, test.want)
			}
		})
	}
}

func TestBackendDistributionResultIncludesCanonicalAssignee(t *testing.T) {
	t.Parallel()

	result, err := parseBackendDistributionResult([]byte(`{
		"success": true,
		"assigned_user_id": "  22222222-2222-4222-8222-222222222222  "
	}`))
	if err != nil {
		t.Fatalf("parse backend distribution result: %v", err)
	}
	if !result.Success || result.AssignedUserID != "22222222-2222-4222-8222-222222222222" {
		t.Fatalf("parsed result = %#v", result)
	}
	if _, err := parseBackendDistributionResult([]byte(`{"success":true,"assigned_user_id":[]}`)); err == nil {
		t.Fatal("non-string assigned_user_id must fail closed")
	}
}

func TestInitialDistributionNeverReceivesWarning(t *testing.T) {
	t.Parallel()

	if redistributionJobShouldReceiveWarning(redistributionJob{InitialDistributionPending: true}) {
		t.Fatal("initial managed WhatsApp distribution must not emit a redistribution warning")
	}
	if !redistributionJobShouldReceiveWarning(redistributionJob{}) {
		t.Fatal("ordinary redistribution job must keep its warning behavior")
	}
}

func TestManagedWhatsAppInitialDistributionStopsBeforeCanonicalSuccess(t *testing.T) {
	t.Parallel()

	store := &redistributionQueryExecutor{rows: []pgx.Row{
		redistributionBoolRow{value: true},
		redistributionSelectionRow{
			memberID: "44444444-4444-4444-8444-444444444444",
			userID:   "55555555-5555-4555-8555-555555555555",
		},
		redistributionJSONRow{value: []byte(`{"success":true}`)},
	}}
	job := redistributionJob{
		ID:                         "11111111-1111-4111-8111-111111111111",
		OrganizationID:             "22222222-2222-4222-8222-222222222222",
		LeadID:                     "33333333-3333-4333-8333-333333333333",
		RoundRobinID:               "66666666-6666-4666-8666-666666666666",
		InitialDistributionPending: true,
	}

	err := (Repository{}).processManagedWhatsAppInitialDistribution(
		context.Background(),
		store,
		job,
		leadSnapshot{DealStatus: "open"},
	)
	if err != nil {
		t.Fatalf("process initial distribution: %v", err)
	}
	if len(store.queries) != 3 {
		t.Fatalf("queries = %d, want queue lock, selector and canonical distributor", len(store.queries))
	}
	if !strings.Contains(store.queries[2], "public.distribute_lead_from_backend") {
		t.Fatalf("expected canonical backend distributor, SQL = %q", store.queries[2])
	}
	if len(store.execSQL) != 1 {
		t.Fatalf("execs = %d, want initial job stop before canonical call", len(store.execSQL))
	}
	if len(store.operations) != 4 || !strings.HasPrefix(store.operations[0], "query:") || !strings.HasPrefix(store.operations[1], "query:") || !strings.HasPrefix(store.operations[2], "exec:") || !strings.HasPrefix(store.operations[3], "query:") {
		t.Fatalf("operation order = %#v, want queue lock, eligibility query, job stop, canonical query", store.operations)
	}
	if len(store.execArgs[0]) != 3 || store.execArgs[0][1] != "stopped" || store.execArgs[0][2] != "initial_distribution_completed" {
		t.Fatalf("unexpected stop args: %#v", store.execArgs[0])
	}
	if len(store.queryArgs[2]) != 7 {
		t.Fatalf("canonical args = %d, want 7", len(store.queryArgs[2]))
	}
	if preserve, ok := store.queryArgs[2][4].(bool); !ok || preserve {
		t.Fatalf("preserve assignee = %#v, want false", store.queryArgs[2][4])
	}
	if source := store.queryArgs[2][5]; source != "whatsapp" {
		t.Fatalf("source = %#v, want whatsapp", source)
	}
	expectedKey := "managed-whatsapp-pending:" + job.ID + ":attempt_1"
	if key := store.queryArgs[2][2]; key != expectedKey {
		t.Fatalf("idempotency key = %#v, want %q", key, expectedKey)
	}
	for _, sql := range append(append([]string{}, store.queries...), store.execSQL...) {
		if strings.Contains(sql, "public.lead_action_facts") || strings.Contains(sql, "redistribution_count") || strings.Contains(sql, "auto_redistribution") {
			t.Fatalf("initial assignment must not be treated as redistribution: %q", sql)
		}
	}
}

func TestManagedWhatsAppInitialDistributionReopensAfterCanonicalMiss(t *testing.T) {
	t.Parallel()

	nextAt := time.Now().UTC().Add(2 * time.Hour).Truncate(time.Second)
	store := &redistributionQueryExecutor{rows: []pgx.Row{
		redistributionBoolRow{value: true},
		redistributionSelectionRow{
			memberID: "44444444-4444-4444-8444-444444444444",
			userID:   "55555555-5555-4555-8555-555555555555",
		},
		redistributionJSONRow{value: []byte(`{"success":false,"reason":"no_available_members"}`)},
		redistributionStringRow{err: pgx.ErrNoRows},
		redistributionAvailabilityRow{hasAlternative: true, nextAt: nextAt},
	}}
	job := redistributionJob{
		ID:                         "11111111-1111-4111-8111-111111111111",
		OrganizationID:             "22222222-2222-4222-8222-222222222222",
		LeadID:                     "33333333-3333-4333-8333-333333333333",
		RoundRobinID:               "66666666-6666-4666-8666-666666666666",
		AttemptCount:               3,
		InitialDistributionPending: true,
	}

	err := (Repository{}).processManagedWhatsAppInitialDistribution(
		context.Background(),
		store,
		job,
		leadSnapshot{DealStatus: "open"},
	)
	if err != nil {
		t.Fatalf("process initial distribution: %v", err)
	}
	if len(store.execSQL) != 2 {
		t.Fatalf("execs = %d, want stop then reopen", len(store.execSQL))
	}
	reopenSQL := store.execSQL[1]
	for _, fragment := range []string{
		"set status = 'pending'",
		"due_at = $2::timestamptz",
		"warning_due_at = null",
		"warning_sent_at = null",
		"stopped_at = null",
		"'initial_distribution_pending', true",
	} {
		if !strings.Contains(reopenSQL, fragment) {
			t.Fatalf("expected reopen SQL to contain %q", fragment)
		}
	}
	for _, forbidden := range []string{"redistribution_count", "auto_redistribution"} {
		if strings.Contains(reopenSQL, forbidden) {
			t.Fatalf("initial retry must not count as redistribution; found %q", forbidden)
		}
	}
	if got := store.execArgs[1][1].(time.Time); !got.Equal(nextAt) {
		t.Fatalf("retry at = %s, want next availability %s", got, nextAt)
	}
	if got := store.execArgs[1][2]; got != 4 {
		t.Fatalf("initial attempt count = %#v, want 4", got)
	}
}

func TestManagedWhatsAppInitialDistributionUsesExistingActiveJobAfterCanonicalMiss(t *testing.T) {
	t.Parallel()

	activeJobID := "88888888-8888-4888-8888-888888888888"
	store := &redistributionQueryExecutor{rows: []pgx.Row{
		redistributionBoolRow{value: true},
		redistributionSelectionRow{
			memberID: "44444444-4444-4444-8444-444444444444",
			userID:   "55555555-5555-4555-8555-555555555555",
		},
		redistributionJSONRow{value: []byte(`{"success":false,"reason":"no_available_members"}`)},
		redistributionStringRow{value: activeJobID},
	}}
	job := redistributionJob{
		ID:                         "11111111-1111-4111-8111-111111111111",
		OrganizationID:             "22222222-2222-4222-8222-222222222222",
		LeadID:                     "33333333-3333-4333-8333-333333333333",
		RoundRobinID:               "66666666-6666-4666-8666-666666666666",
		InitialDistributionPending: true,
	}

	err := (Repository{}).processManagedWhatsAppInitialDistribution(
		context.Background(),
		store,
		job,
		leadSnapshot{DealStatus: "open"},
	)
	if err != nil {
		t.Fatalf("process canonical miss with active retry job: %v", err)
	}
	if len(store.execSQL) != 2 {
		t.Fatalf("execs = %d, want special-job stop and active-job acceleration", len(store.execSQL))
	}
	if got := store.execArgs[1]; len(got) != 3 || got[0] != job.OrganizationID || got[1] != job.LeadID || got[2] != activeJobID {
		t.Fatalf("accelerated active-job scope = %#v", got)
	}
	if !strings.Contains(store.execSQL[1], "due_at = now()") || !strings.Contains(store.execSQL[1], "stopped_at = null") {
		t.Fatal("existing active job must be accelerated and normalized")
	}
}

func TestManagedWhatsAppInitialDistributionStopsBeforeCanonicalWhenQueueIsInactive(t *testing.T) {
	t.Parallel()

	store := &redistributionQueryExecutor{rows: []pgx.Row{
		redistributionBoolRow{err: pgx.ErrNoRows},
	}}
	job := redistributionJob{
		ID:                         "11111111-1111-4111-8111-111111111111",
		OrganizationID:             "22222222-2222-4222-8222-222222222222",
		LeadID:                     "33333333-3333-4333-8333-333333333333",
		RoundRobinID:               "66666666-6666-4666-8666-666666666666",
		InitialDistributionPending: true,
	}

	err := (Repository{}).processManagedWhatsAppInitialDistribution(
		context.Background(),
		store,
		job,
		leadSnapshot{DealStatus: "open"},
	)
	if err != nil {
		t.Fatalf("process inactive queue: %v", err)
	}
	if len(store.queries) != 1 || strings.Contains(store.queries[0], "distribute_lead_from_backend") {
		t.Fatalf("inactive queue must stop before selector/canonical, queries = %#v", store.queries)
	}
	if len(store.execArgs) != 1 || store.execArgs[0][2] != "round_robin_inactive" {
		t.Fatalf("inactive queue must leave the special job stopped, exec args = %#v", store.execArgs)
	}
}

func TestManagedWhatsAppInitialDistributionKeepsRetryingWithoutMembers(t *testing.T) {
	t.Parallel()

	startedAt := time.Now().UTC()
	store := &redistributionQueryExecutor{rows: []pgx.Row{
		redistributionBoolRow{value: true},
		redistributionSelectionRow{err: pgx.ErrNoRows},
		redistributionAvailabilityRow{hasAlternative: false},
	}}
	job := redistributionJob{
		ID:             "11111111-1111-4111-8111-111111111111",
		OrganizationID: "22222222-2222-4222-8222-222222222222",
		LeadID:         "33333333-3333-4333-8333-333333333333",
		RoundRobinID:   "66666666-6666-4666-8666-666666666666",
		AttemptCount:   6,
	}

	err := (Repository{}).processManagedWhatsAppInitialDistribution(
		context.Background(),
		store,
		job,
		leadSnapshot{DealStatus: "open"},
	)
	if err != nil {
		t.Fatalf("process initial distribution: %v", err)
	}
	if len(store.queries) != 3 {
		t.Fatalf("queries = %d, want active queue lock, selector and availability lookup", len(store.queries))
	}
	if strings.Contains(strings.Join(store.queries, "\n"), "distribute_lead_from_backend") {
		t.Fatal("canonical distributor must not be called before the eligibility selector finds a member")
	}
	if !strings.Contains(store.queries[0], "coalesce(queue.is_active, true) = true") {
		t.Fatalf("first query must lock and validate the active queue, SQL = %q", store.queries[0])
	}
	if !strings.Contains(store.queries[0], "for share") {
		t.Fatalf("active queue must remain stable through the retry update, SQL = %q", store.queries[0])
	}
	if len(store.execSQL) != 1 {
		t.Fatalf("execs = %d, want durable pending retry", len(store.execSQL))
	}
	retryAt := store.execArgs[0][1].(time.Time)
	minimum := startedAt.Add(leadInitialDistributionRetryDelay)
	maximum := time.Now().UTC().Add(leadInitialDistributionRetryDelay + time.Second)
	if retryAt.Before(minimum) || retryAt.After(maximum) {
		t.Fatalf("retry at = %s, want approximately five minutes", retryAt)
	}
	if got := store.execArgs[0][2]; got != 7 {
		t.Fatalf("initial attempt count = %#v, want 7", got)
	}
}

func TestManagedWhatsAppInitialDistributionStopsForInactiveQueue(t *testing.T) {
	t.Parallel()

	store := &redistributionQueryExecutor{rows: []pgx.Row{
		redistributionBoolRow{err: pgx.ErrNoRows},
	}}
	job := redistributionJob{
		ID:             "11111111-1111-4111-8111-111111111111",
		OrganizationID: "22222222-2222-4222-8222-222222222222",
		LeadID:         "33333333-3333-4333-8333-333333333333",
		RoundRobinID:   "66666666-6666-4666-8666-666666666666",
	}

	err := (Repository{}).processManagedWhatsAppInitialDistribution(
		context.Background(),
		store,
		job,
		leadSnapshot{DealStatus: "open"},
	)
	if err != nil {
		t.Fatalf("process inactive initial distribution: %v", err)
	}
	if len(store.queries) != 1 {
		t.Fatalf("queries = %d, want queue status before selector", len(store.queries))
	}
	if len(store.execArgs) != 1 || store.execArgs[0][2] != "round_robin_inactive" {
		t.Fatalf("inactive queue must stop the pending job, exec args = %#v", store.execArgs)
	}
}

func TestManagedWhatsAppInitialDistributionPropagatesCanonicalSQLError(t *testing.T) {
	t.Parallel()

	expectedErr := errors.New("canonical SQL failed")
	store := &redistributionQueryExecutor{rows: []pgx.Row{
		redistributionBoolRow{value: true},
		redistributionSelectionRow{
			memberID: "44444444-4444-4444-8444-444444444444",
			userID:   "55555555-5555-4555-8555-555555555555",
		},
		redistributionJSONRow{err: expectedErr},
	}}
	job := redistributionJob{
		ID:             "11111111-1111-4111-8111-111111111111",
		OrganizationID: "22222222-2222-4222-8222-222222222222",
		LeadID:         "33333333-3333-4333-8333-333333333333",
		RoundRobinID:   "66666666-6666-4666-8666-666666666666",
	}

	err := (Repository{}).processManagedWhatsAppInitialDistribution(
		context.Background(),
		store,
		job,
		leadSnapshot{DealStatus: "open"},
	)
	if !errors.Is(err, expectedErr) {
		t.Fatalf("error = %v, want %v so caller rolls the transaction back", err, expectedErr)
	}
	if len(store.execSQL) != 1 {
		t.Fatalf("execs = %d, want only the transactional pre-call stop", len(store.execSQL))
	}
}

func TestManagedWhatsAppInitialDistributionStopsWhenAlreadyAssigned(t *testing.T) {
	t.Parallel()

	store := &redistributionQueryExecutor{}
	job := redistributionJob{ID: "11111111-1111-4111-8111-111111111111"}
	err := (Repository{}).processManagedWhatsAppInitialDistribution(
		context.Background(),
		store,
		job,
		leadSnapshot{AssignedUserID: "22222222-2222-4222-8222-222222222222", DealStatus: "open"},
	)
	if err != nil {
		t.Fatalf("process assigned initial job: %v", err)
	}
	if len(store.queries) != 0 {
		t.Fatalf("assigned lead must not be redistributed; queries = %d", len(store.queries))
	}
	if len(store.execArgs) != 1 || store.execArgs[0][2] != "assignee_changed" {
		t.Fatalf("unexpected stop args: %#v", store.execArgs)
	}
}

func TestManagedWhatsAppAssignedReentryCanRetryCanonicalDistribution(t *testing.T) {
	t.Parallel()

	currentUserID := "22222222-2222-4222-8222-222222222222"
	enrolledAt := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	store := &redistributionQueryExecutor{rows: []pgx.Row{
		redistributionBoolRow{value: false},
		redistributionBoolRow{value: true},
		redistributionSelectionRow{
			memberID: "44444444-4444-4444-8444-444444444444",
			userID:   "55555555-5555-4555-8555-555555555555",
		},
		redistributionJSONRow{value: []byte(`{"success":true,"assigned_user_id":"55555555-5555-4555-8555-555555555555"}`)},
	}}
	job := redistributionJob{
		ID:                          "11111111-1111-4111-8111-111111111111",
		OrganizationID:              "33333333-3333-4333-8333-333333333333",
		LeadID:                      "66666666-6666-4666-8666-666666666666",
		RoundRobinID:                "77777777-7777-4777-8777-777777777777",
		CurrentAssignedUserID:       currentUserID,
		EnrolledAt:                  enrolledAt,
		InitialDistributionPending:  true,
		AllowAssignedRedistribution: true,
	}

	err := (Repository{}).processManagedWhatsAppInitialDistribution(
		context.Background(),
		store,
		job,
		leadSnapshot{AssignedUserID: currentUserID, DealStatus: "open"},
	)
	if err != nil {
		t.Fatalf("process assigned reentry: %v", err)
	}
	if len(store.queries) != 4 {
		t.Fatalf("queries = %d, want human activity, queue lock, eligibility and canonical distribution", len(store.queries))
	}
	if !strings.Contains(store.queries[0], "public.lead_action_facts") {
		t.Fatalf("first query must check human activity, SQL = %q", store.queries[0])
	}
	if len(store.queryArgs[0]) != 5 || store.queryArgs[0][2] != enrolledAt {
		t.Fatalf("human activity args = %#v, want enrollment boundary", store.queryArgs[0])
	}
	if excluded := store.queryArgs[2][2]; excluded != currentUserID {
		t.Fatalf("eligibility excluded user = %#v, want current assignee", excluded)
	}
	if len(store.execArgs) != 1 || store.execArgs[0][2] != "initial_distribution_completed" {
		t.Fatalf("unexpected stop args: %#v", store.execArgs)
	}
	if !strings.Contains(store.queries[3], "public.distribute_lead_from_backend") || store.queryArgs[3][4] != false {
		t.Fatalf("assigned reentry must use canonical bridge with preserve=false: SQL=%q args=%#v", store.queries[3], store.queryArgs[3])
	}
}

func TestManagedWhatsAppAssignedReentryAcceleratesCanonicalJobWhenAssigneeDidNotChange(t *testing.T) {
	t.Parallel()

	currentUserID := "22222222-2222-4222-8222-222222222222"
	activeJobID := "88888888-8888-4888-8888-888888888888"
	store := &redistributionQueryExecutor{rows: []pgx.Row{
		redistributionBoolRow{value: false},
		redistributionBoolRow{value: true},
		redistributionSelectionRow{
			memberID: "44444444-4444-4444-8444-444444444444",
			userID:   "55555555-5555-4555-8555-555555555555",
		},
		redistributionJSONRow{value: []byte(`{"success":true,"assigned_user_id":"22222222-2222-4222-8222-222222222222"}`)},
		redistributionStringRow{value: activeJobID},
	}}
	job := redistributionJob{
		ID:                          "11111111-1111-4111-8111-111111111111",
		OrganizationID:              "33333333-3333-4333-8333-333333333333",
		LeadID:                      "66666666-6666-4666-8666-666666666666",
		RoundRobinID:                "77777777-7777-4777-8777-777777777777",
		CurrentAssignedUserID:       currentUserID,
		EnrolledAt:                  time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC),
		InitialDistributionPending:  true,
		AllowAssignedRedistribution: true,
	}

	err := (Repository{}).processManagedWhatsAppInitialDistribution(
		context.Background(),
		store,
		job,
		leadSnapshot{AssignedUserID: currentUserID, DealStatus: "open"},
	)
	if err != nil {
		t.Fatalf("process same-assignee canonical result: %v", err)
	}
	if len(store.queries) != 5 {
		t.Fatalf("queries = %d, want human activity, queue lock, selector, canonical and active-job lookup", len(store.queries))
	}
	activeLookupSQL := store.queries[4]
	for _, fragment := range []string{
		"job.organization_id = $1::uuid",
		"job.lead_id = $2::uuid",
		"job.id <> $3::uuid",
		"status in ('pending', 'warning_sent')",
		"for update",
	} {
		if !strings.Contains(activeLookupSQL, fragment) {
			t.Fatalf("active-job lookup must contain %q, SQL = %q", fragment, activeLookupSQL)
		}
	}
	if len(store.execSQL) != 2 {
		t.Fatalf("execs = %d, want special-job stop and canonical-job acceleration", len(store.execSQL))
	}
	accelerationSQL := store.execSQL[1]
	for _, fragment := range []string{
		"status = 'pending'",
		"due_at = now()",
		"warning_due_at = null",
		"warning_sent_at = null",
		"organization_id = $1::uuid",
		"lead_id = $2::uuid",
		"id = $3::uuid",
	} {
		if !strings.Contains(accelerationSQL, fragment) {
			t.Fatalf("canonical job acceleration must contain %q, SQL = %q", fragment, accelerationSQL)
		}
	}
	if got := store.execArgs[1]; len(got) != 3 || got[0] != job.OrganizationID || got[1] != job.LeadID || got[2] != activeJobID {
		t.Fatalf("canonical job acceleration scope = %#v", got)
	}
}

func TestManagedWhatsAppAssignedReentryReopensSpecialJobWhenCanonicalAssigneeDidNotChange(t *testing.T) {
	t.Parallel()

	currentUserID := "22222222-2222-4222-8222-222222222222"
	store := &redistributionQueryExecutor{rows: []pgx.Row{
		redistributionBoolRow{value: false},
		redistributionBoolRow{value: true},
		redistributionSelectionRow{
			memberID: "44444444-4444-4444-8444-444444444444",
			userID:   "55555555-5555-4555-8555-555555555555",
		},
		redistributionJSONRow{value: []byte(`{"success":true,"assigned_user_id":"22222222-2222-4222-8222-222222222222"}`)},
		redistributionStringRow{err: pgx.ErrNoRows},
		redistributionAvailabilityRow{hasAlternative: false},
	}}
	job := redistributionJob{
		ID:                          "11111111-1111-4111-8111-111111111111",
		OrganizationID:              "33333333-3333-4333-8333-333333333333",
		LeadID:                      "66666666-6666-4666-8666-666666666666",
		RoundRobinID:                "77777777-7777-4777-8777-777777777777",
		CurrentAssignedUserID:       currentUserID,
		EnrolledAt:                  time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC),
		AttemptCount:                2,
		InitialDistributionPending:  true,
		AllowAssignedRedistribution: true,
	}

	err := (Repository{}).processManagedWhatsAppInitialDistribution(
		context.Background(),
		store,
		job,
		leadSnapshot{AssignedUserID: currentUserID, DealStatus: "open"},
	)
	if err != nil {
		t.Fatalf("process same-assignee result without canonical job: %v", err)
	}
	if len(store.execSQL) != 2 {
		t.Fatalf("execs = %d, want special-job stop and reopen", len(store.execSQL))
	}
	if !strings.Contains(store.execSQL[1], "set status = 'pending'") || store.execArgs[1][2] != 3 {
		t.Fatalf("special job must remain active for a later attempt: SQL=%q args=%#v", store.execSQL[1], store.execArgs[1])
	}
}

func TestManagedWhatsAppAssignedReentryReopensSpecialJobIfAccelerationLosesItsTarget(t *testing.T) {
	t.Parallel()

	currentUserID := "22222222-2222-4222-8222-222222222222"
	store := &redistributionQueryExecutor{
		rows: []pgx.Row{
			redistributionBoolRow{value: false},
			redistributionBoolRow{value: true},
			redistributionSelectionRow{
				memberID: "44444444-4444-4444-8444-444444444444",
				userID:   "55555555-5555-4555-8555-555555555555",
			},
			redistributionJSONRow{value: []byte(`{"success":true,"assigned_user_id":"22222222-2222-4222-8222-222222222222"}`)},
			redistributionStringRow{value: "88888888-8888-4888-8888-888888888888"},
			redistributionAvailabilityRow{hasAlternative: false},
		},
		execTags: []pgconn.CommandTag{
			pgconn.NewCommandTag("UPDATE 1"),
			pgconn.NewCommandTag("UPDATE 0"),
			pgconn.NewCommandTag("UPDATE 1"),
		},
	}
	job := redistributionJob{
		ID:                          "11111111-1111-4111-8111-111111111111",
		OrganizationID:              "33333333-3333-4333-8333-333333333333",
		LeadID:                      "66666666-6666-4666-8666-666666666666",
		RoundRobinID:                "77777777-7777-4777-8777-777777777777",
		CurrentAssignedUserID:       currentUserID,
		EnrolledAt:                  time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC),
		InitialDistributionPending:  true,
		AllowAssignedRedistribution: true,
	}

	err := (Repository{}).processManagedWhatsAppInitialDistribution(
		context.Background(),
		store,
		job,
		leadSnapshot{AssignedUserID: currentUserID, DealStatus: "open"},
	)
	if err != nil {
		t.Fatalf("process lost canonical job target: %v", err)
	}
	if len(store.execSQL) != 3 || !strings.Contains(store.execSQL[2], "set status = 'pending'") {
		t.Fatalf("special job must be reopened after a zero-row acceleration: %#v", store.execSQL)
	}
}

func TestReopenManagedWhatsAppInitialDistributionRequiresExistingSpecialJob(t *testing.T) {
	t.Parallel()

	store := &redistributionQueryExecutor{
		execTags: []pgconn.CommandTag{pgconn.NewCommandTag("UPDATE 0")},
	}
	err := (Repository{}).reopenManagedWhatsAppInitialDistribution(
		context.Background(),
		store,
		"11111111-1111-4111-8111-111111111111",
		time.Now().UTC(),
		1,
		[]byte(`{"success":false}`),
	)
	if err == nil || !strings.Contains(err.Error(), "could not be reopened") {
		t.Fatalf("zero-row reopen error = %v", err)
	}
}

func TestManagedWhatsAppAssignedReentryStopsAfterAssigneeChange(t *testing.T) {
	t.Parallel()

	store := &redistributionQueryExecutor{}
	job := redistributionJob{
		ID:                          "11111111-1111-4111-8111-111111111111",
		CurrentAssignedUserID:       "22222222-2222-4222-8222-222222222222",
		AllowAssignedRedistribution: true,
	}
	err := (Repository{}).processManagedWhatsAppInitialDistribution(
		context.Background(),
		store,
		job,
		leadSnapshot{AssignedUserID: "33333333-3333-4333-8333-333333333333", DealStatus: "open"},
	)
	if err != nil {
		t.Fatalf("process changed assigned reentry: %v", err)
	}
	if len(store.queries) != 0 {
		t.Fatalf("changed assignee must stop before activity/selection; queries = %d", len(store.queries))
	}
	if len(store.execArgs) != 1 || store.execArgs[0][2] != "assignee_changed" {
		t.Fatalf("unexpected stop args: %#v", store.execArgs)
	}
}

func TestManagedWhatsAppAssignedReentryStopsAfterHumanOutboundActivity(t *testing.T) {
	t.Parallel()

	currentUserID := "22222222-2222-4222-8222-222222222222"
	store := &redistributionQueryExecutor{rows: []pgx.Row{
		redistributionBoolRow{value: true},
	}}
	job := redistributionJob{
		ID:                          "11111111-1111-4111-8111-111111111111",
		OrganizationID:              "33333333-3333-4333-8333-333333333333",
		LeadID:                      "44444444-4444-4444-8444-444444444444",
		RoundRobinID:                "55555555-5555-4555-8555-555555555555",
		CurrentAssignedUserID:       currentUserID,
		EnrolledAt:                  time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC),
		AllowAssignedRedistribution: true,
	}
	err := (Repository{}).processManagedWhatsAppInitialDistribution(
		context.Background(),
		store,
		job,
		leadSnapshot{AssignedUserID: currentUserID, DealStatus: "open"},
	)
	if err != nil {
		t.Fatalf("process human-handled assigned reentry: %v", err)
	}
	if len(store.queries) != 1 || !strings.Contains(store.queries[0], "f.is_inbound = false") {
		t.Fatalf("expected only outbound human activity check, queries = %#v", store.queries)
	}
	if len(store.execArgs) != 1 || store.execArgs[0][2] != "human_action" {
		t.Fatalf("unexpected stop args: %#v", store.execArgs)
	}
}

func TestRedistributionHasHumanActivityOnlyCountsResponsibleActions(t *testing.T) {
	t.Parallel()

	queryer := &redistributionActivityQueryer{row: redistributionBoolRow{value: true}}
	job := redistributionJob{
		OrganizationID:        "11111111-1111-4111-8111-111111111111",
		LeadID:                "22222222-2222-4222-8222-222222222222",
		RoundRobinID:          "33333333-3333-4333-8333-333333333333",
		CurrentAssignedUserID: "44444444-4444-4444-8444-444444444444",
		EnrolledAt:            time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC),
	}

	hasActivity, err := (Repository{}).redistributionHasHumanActivity(context.Background(), queryer, job)
	if err != nil {
		t.Fatalf("redistribution human activity: %v", err)
	}
	if !hasActivity {
		t.Fatal("expected human activity to stop redistribution")
	}

	if len(queryer.args) != 5 {
		t.Fatalf("args = %d, want 5", len(queryer.args))
	}
	if queryer.args[3] != job.RoundRobinID || queryer.args[4] != job.CurrentAssignedUserID {
		t.Fatalf("system assignment correlation args = %#v", queryer.args)
	}

	requiredFragments := []string{
		"public.lead_action_facts",
		"public.activities",
		"public.lead_timeline_events",
		"public.whatsapp_messages",
		"public.lead_tasks",
		"public.schedule_events",
		"public.audit_logs",
		"f.is_automated = false",
		"f.is_inbound = false",
		"f.actor_user_id is not null",
		"f.action_type, '')) = 'whatsapp_outbound'",
		"lower(coalesce(f.source_type, '')) = 'activity'",
		"system_activity.id::text = f.source_id",
		"lower(coalesce(system_activity.type, '')) in ('assignee_changed', 'stage_change')",
		"coalesce(wm.from_me, false) = true",
		"lower(coalesce(a.type, '')) in ('assignee_changed', 'stage_change')",
		"public.round_robin_logs system_distribution",
		"system_distribution.assigned_user_id = nullif($5, '')::uuid",
		"system_distribution.created_at between a.created_at - interval '1 second' and a.created_at + interval '1 second'",
		"lower(coalesce(lte.event_type, '')) = 'lead_assigned'",
		"lte.metadata->>'distribution_type'",
		"lte.metadata->>'distribution_queue_id'",
		"lte.metadata->>'distribution_event_id'",
		"lower(coalesce(al.source, '')) = 'database_trigger'",
		"al.user_id is not null",
	}
	for _, fragment := range requiredFragments {
		if !strings.Contains(queryer.sql, fragment) {
			t.Fatalf("expected activity SQL to contain %q", fragment)
		}
	}

	forbiddenFragments := []string{
		"f.is_inbound = true",
		"l.last_contact_at",
		"lower(coalesce(wm.direction, 'inbound')) <> 'outbound'",
		"and wm.sender_user_id is not null",
	}
	for _, fragment := range forbiddenFragments {
		if strings.Contains(queryer.sql, fragment) {
			t.Fatalf("customer inbound activity must not stop redistribution; found %q", fragment)
		}
	}
}

func TestRedistributionWarningDedupeKeyChangesEveryAttempt(t *testing.T) {
	t.Parallel()

	job := redistributionJob{
		ID:                    "11111111-1111-4111-8111-111111111111",
		CurrentAssignedUserID: "22222222-2222-4222-8222-222222222222",
	}
	first := redistributionWarningDedupeKey(job)
	job.AttemptCount = 2
	third := redistributionWarningDedupeKey(job)
	if first == third {
		t.Fatal("warning dedupe key must be unique for each redistribution attempt")
	}
	if !strings.Contains(first, "attempt_0") || !strings.Contains(third, "attempt_2") {
		t.Fatalf("dedupe keys must identify the attempt: first=%q third=%q", first, third)
	}
}

func TestLockDueRedistributionJobRevalidatesCandidateUnderRowLock(t *testing.T) {
	t.Parallel()

	queryer := &redistributionActivityQueryer{row: redistributionBoolRow{value: true}}
	locked, err := (Repository{}).lockDueRedistributionJob(
		context.Background(),
		queryer,
		"11111111-1111-4111-8111-111111111111",
	)
	if err != nil {
		t.Fatalf("lock due redistribution job: %v", err)
	}
	if !locked {
		t.Fatal("expected active due job to be locked")
	}

	requiredFragments := []string{
		"status in ('pending', 'warning_sent')",
		"due_at <= now()",
		"for update",
	}
	for _, fragment := range requiredFragments {
		if !strings.Contains(queryer.sql, fragment) {
			t.Fatalf("expected job lock SQL to contain %q", fragment)
		}
	}
}

func TestLockDueRedistributionJobSkipsStoppedCandidate(t *testing.T) {
	t.Parallel()

	queryer := &redistributionActivityQueryer{row: redistributionBoolRow{err: pgx.ErrNoRows}}
	locked, err := (Repository{}).lockDueRedistributionJob(
		context.Background(),
		queryer,
		"11111111-1111-4111-8111-111111111111",
	)
	if err != nil {
		t.Fatalf("lock stopped redistribution job: %v", err)
	}
	if locked {
		t.Fatal("stopped candidate must not be processed")
	}
}

func TestNextRoundRobinMemberAvailabilityUsesConfiguredSchedule(t *testing.T) {
	t.Parallel()

	expected := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Second)
	queryer := &redistributionActivityQueryer{
		row: redistributionAvailabilityRow{
			hasAlternative: true,
			nextAt:         expected,
		},
	}

	nextAt, hasAlternative, err := (Repository{}).nextRoundRobinMemberAvailability(
		context.Background(),
		queryer,
		"11111111-1111-4111-8111-111111111111",
		"22222222-2222-4222-8222-222222222222",
		"33333333-3333-4333-8333-333333333333",
		"44444444-4444-4444-8444-444444444444",
		leadRedistributionNoMemberDelay,
	)
	if err != nil {
		t.Fatalf("next round-robin availability: %v", err)
	}
	if !hasAlternative {
		t.Fatal("expected an alternative queue member")
	}
	if !nextAt.Equal(expected) {
		t.Fatalf("next availability = %s, want %s", nextAt, expected)
	}

	requiredFragments := []string{
		"public.member_availability",
		"generate_series(0, 7)",
		"candidates.user_id <> nullif($3, '')::uuid",
		"required_member.team_id = nullif($4, '')::uuid",
		"coalesce(rr.is_active, true) = true",
		"rr.settings->>'ignore_availability'",
		"public.organization_attention_settings attention_settings",
		"nullif(btrim(rr.settings->>'timezone'), '')",
		"btrim(attention_settings.timezone)",
		"where name = timezone_config.configured_timezone",
		") then timezone_config.configured_timezone",
		"else 'America/Sao_Paulo'",
		"now() at time zone eligible.timezone",
		") at time zone clock.timezone",
	}
	for _, fragment := range requiredFragments {
		if !strings.Contains(queryer.sql, fragment) {
			t.Fatalf("expected availability SQL to contain %q", fragment)
		}
	}
	if strings.Contains(queryer.sql, "user_activity_sessions") {
		t.Fatal("live browser presence must not be a hard eligibility requirement")
	}
}

func TestRedistributionSelectionHonorsQueueAvailabilitySettings(t *testing.T) {
	t.Parallel()

	queryer := &redistributionActivityQueryer{row: redistributionBoolRow{err: pgx.ErrNoRows}}
	_, _, _ = (Repository{}).selectRoundRobinMemberForRedistribution(
		context.Background(),
		queryer,
		"11111111-1111-4111-8111-111111111111",
		"22222222-2222-4222-8222-222222222222",
		"33333333-3333-4333-8333-333333333333",
		"",
	)

	for _, fragment := range []string{
		"coalesce(rr.is_active, true) = true",
		"rr.settings->>'ignore_availability'",
		"candidates.ignore_availability",
		"pg_catalog.pg_timezone_names",
		"public.organization_attention_settings attention_settings",
		"nullif(btrim(rr.settings->>'timezone'), '')",
		"btrim(attention_settings.timezone)",
		"where name = timezone_config.configured_timezone",
		") then timezone_config.configured_timezone",
		"else 'America/Sao_Paulo'",
		"now() at time zone candidates.timezone",
	} {
		if !strings.Contains(queryer.sql, fragment) {
			t.Fatalf("expected redistribution selection SQL to contain %q", fragment)
		}
	}
}

func TestDeferRedistributionRestartsTimerWithoutWarningSpamOrAttempt(t *testing.T) {
	t.Parallel()

	executor := &redistributionExecutor{}
	nextAvailableAt := time.Date(2026, 7, 24, 8, 0, 0, 0, time.UTC)
	err := (Repository{}).deferRedistributionJobUntilAvailability(
		context.Background(),
		executor,
		"11111111-1111-4111-8111-111111111111",
		nextAvailableAt,
		20,
		5,
	)
	if err != nil {
		t.Fatalf("defer redistribution: %v", err)
	}

	requiredFragments := []string{
		"set status = 'pending'",
		"due_at = $2::timestamptz + ($3::integer * interval '1 minute')",
		"then $2::timestamptz + (($3::integer - $4::integer) * interval '1 minute')",
		"warning_sent_at = null",
		"'waiting_for_available_member', true",
	}
	for _, fragment := range requiredFragments {
		if !strings.Contains(executor.sql, fragment) {
			t.Fatalf("expected defer SQL to contain %q", fragment)
		}
	}
	if strings.Contains(executor.sql, "attempt_count") {
		t.Fatal("waiting for another scheduled member must not consume a redistribution attempt")
	}
	if len(executor.args) != 4 {
		t.Fatalf("defer args = %d, want 4", len(executor.args))
	}
	if got := executor.args[1].(time.Time); !got.Equal(nextAvailableAt) {
		t.Fatalf("next availability = %s, want %s", got, nextAvailableAt)
	}
}
