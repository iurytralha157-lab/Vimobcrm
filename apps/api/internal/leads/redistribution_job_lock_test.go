package leads

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

type redistributionLockedJobRow struct {
	job      redistributionJob
	metadata []byte
	err      error
}

func (row redistributionLockedJobRow) Scan(destinations ...any) error {
	if row.err != nil {
		return row.err
	}
	if len(destinations) != 13 {
		return fmt.Errorf("job destinations = %d, want 13", len(destinations))
	}
	for index, value := range []string{row.job.ID, row.job.OrganizationID, row.job.LeadID, row.job.RoundRobinID, row.job.CurrentAssignedUserID} {
		*(destinations[index].(*string)) = value
	}
	*(destinations[5].(*int)) = row.job.AttemptCount
	*(destinations[6].(*int)) = row.job.MaxAttempts
	*(destinations[7].(*int)) = row.job.TimeoutMinutes
	*(destinations[8].(*int)) = row.job.WarningMinutes
	*(destinations[9].(*time.Time)) = row.job.EnrolledAt
	*(destinations[10].(*string)) = row.job.LeadName
	*(destinations[11].(*[]byte)) = append([]byte(nil), row.metadata...)
	*(destinations[12].(*string)) = row.job.RowVersion
	return nil
}

func redistributionJobLockFixture() redistributionJob {
	return redistributionJob{
		ID: "11111111-1111-4111-8111-111111111111", OrganizationID: "22222222-2222-4222-8222-222222222222",
		LeadID: "33333333-3333-4333-8333-333333333333", RoundRobinID: "44444444-4444-4444-8444-444444444444",
		CurrentAssignedUserID: "55555555-5555-4555-8555-555555555555",
		AttemptCount:          9, MaxAttempts: 10, TimeoutMinutes: 20, WarningMinutes: 5,
		EnrolledAt: time.Unix(1000, 0), LeadName: "Old name",
	}
}

func TestRedistributionJobLockReloadsResetFieldsAndLifecycle(t *testing.T) {
	t.Parallel()
	candidate := redistributionJobLockFixture()
	current := candidate
	current.RoundRobinID = "66666666-6666-4666-8666-666666666666"
	current.CurrentAssignedUserID = "77777777-7777-4777-8777-777777777777"
	current.AttemptCount, current.MaxAttempts, current.TimeoutMinutes, current.WarningMinutes = 0, 7, 35, 0
	current.EnrolledAt, current.LeadName = time.Unix(2000, 0), "Renamed lead"
	queryer := &redistributionActivityQueryer{row: redistributionLockedJobRow{
		job:      current,
		metadata: []byte(`{"initial_distribution_pending":true,"allow_assigned_redistribution":true,"source":"meta_lead_ads","entry_event_id":"88888888-8888-4888-8888-888888888888"}`),
	}}
	job, locked, err := (Repository{}).lockDueRedistributionJob(context.Background(), queryer, candidate)
	if err != nil || !locked {
		t.Fatalf("reload = %#v, %t, %v", job, locked, err)
	}
	current.InitialDistributionPending, current.AllowAssignedRedistribution, current.Source = true, true, "meta"
	current.EntryEventID = "88888888-8888-4888-8888-888888888888"
	if !reflect.DeepEqual(job, current) {
		t.Fatalf("locked job = %#v, want %#v", job, current)
	}
	if !reflect.DeepEqual(queryer.args, []any{candidate.ID, candidate.OrganizationID, candidate.LeadID}) {
		t.Fatalf("scope arguments = %#v", queryer.args)
	}
	for _, predicate := range []string{"j.organization_id = $2::uuid", "j.lead_id = $3::uuid", "j.due_at <= now()", "for update of j"} {
		if !strings.Contains(queryer.sql, predicate) {
			t.Fatalf("job lock lacks eligibility/scope predicate %q", predicate)
		}
	}
}

func TestRedistributionJobLockDiscardsExpiredOrMovedCandidatesAndPropagatesFailures(t *testing.T) {
	t.Parallel()
	databaseErr := errors.New("job scan failed")
	for _, kind := range []string{"warning", "due"} {
		for _, failure := range []error{pgx.ErrNoRows, databaseErr} {
			t.Run(kind+"/"+failure.Error(), func(t *testing.T) {
				candidate := redistributionJobLockFixture()
				queryer := &redistributionActivityQueryer{row: redistributionLockedJobRow{err: failure}}
				var job redistributionJob
				var locked bool
				var err error
				if kind == "warning" {
					job, locked, err = (Repository{}).lockWarningRedistributionJob(context.Background(), queryer, candidate)
				} else {
					job, locked, err = (Repository{}).lockDueRedistributionJob(context.Background(), queryer, candidate)
				}
				if locked || job != (redistributionJob{}) {
					t.Fatalf("ineligible candidate leaked: %#v, locked=%t", job, locked)
				}
				if errors.Is(failure, pgx.ErrNoRows) {
					if err != nil {
						t.Fatalf("expired/moved candidate error = %v", err)
					}
				} else if !errors.Is(err, databaseErr) {
					t.Fatalf("database error = %v", err)
				}
			})
		}
	}
}

// The transaction fake executes the actual worker loops. Query results change
// between the list snapshot and the locked row, with no pool/env/database.
type redistributionReloadTx struct {
	pgx.Tx
	listed           redistributionLockedJobRow
	locked           redistributionLockedJobRow
	currentAssignee  string
	currentDeal      string
	queries          []string
	queryArgs        [][]any
	executions       []redistributionReloadExecution
	queueSettings    []byte
	queueBusy        bool
	leadBusy         bool
	poolCheckPending bool
	poolCheckOrg     string
	poolCheckLead    string
}

type redistributionReloadExecution struct {
	query string
	args  []any
}

type redistributionReloadRow func(...any) error

func (row redistributionReloadRow) Scan(destinations ...any) error { return row(destinations...) }

func (tx *redistributionReloadTx) Query(_ context.Context, query string, args ...any) (pgx.Rows, error) {
	tx.queries = append(tx.queries, query)
	tx.queryArgs = append(tx.queryArgs, append([]any(nil), args...))
	return &redistributionReloadRows{row: tx.listed}, nil
}

func (tx *redistributionReloadTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.queries = append(tx.queries, query)
	tx.queryArgs = append(tx.queryArgs, append([]any(nil), args...))
	switch {
	case strings.Contains(query, "select private.queue_pool_read_access"):
		return redistributionReloadRow(func(destinations ...any) error {
			if !tx.poolCheckPending || len(args) != 3 || args[0] != tx.poolCheckOrg || args[1] != tx.poolCheckLead {
				return fmt.Errorf("worker pool check did not follow its exact tenant lead lock")
			}
			actor, ok := args[2].(*string)
			if !ok || actor != nil {
				return fmt.Errorf("worker pool mutation check must detect every audience")
			}
			tx.poolCheckPending = false
			*destinations[0].(**bool) = nil // These fixtures model legacy, non-pool jobs.
			return nil
		})
	case strings.Contains(query, "pg_try_advisory_xact_lock"):
		return redistributionBoolRow{value: true}
	case strings.Contains(query, "for no key update skip locked"):
		if tx.queueBusy {
			return redistributionStringRow{err: pgx.ErrNoRows}
		}
		return redistributionStringRow{value: fmt.Sprint(args[1])}
	case strings.Contains(query, "select exists"):
		return redistributionBoolRow{value: true}
	case strings.Contains(query, "for update of j"):
		return tx.locked
	case strings.Contains(query, "from public.leads l"):
		if tx.leadBusy {
			return redistributionStringRow{err: pgx.ErrNoRows}
		}
		return redistributionReloadRow(func(destinations ...any) error {
			if len(args) != 2 || !strings.Contains(query, "for no key update of l") {
				return fmt.Errorf("worker fixture requires the tenant lead write lock")
			}
			tx.poolCheckPending = true
			tx.poolCheckOrg, tx.poolCheckLead = fmt.Sprint(args[0]), fmt.Sprint(args[1])
			for _, destination := range destinations {
				switch value := destination.(type) {
				case *string:
					*value = ""
				case *pgtype.Text:
					*value = pgtype.Text{}
				case *[]byte:
					*value = []byte(`{}`)
				default:
					return fmt.Errorf("unexpected lead destination %T", destination)
				}
			}
			*(destinations[0].(*string)) = tx.listed.job.LeadID
			*(destinations[4].(*pgtype.Text)) = pgtype.Text{String: tx.currentAssignee, Valid: tx.currentAssignee != ""}
			*(destinations[8].(*string)) = tx.currentDeal
			return nil
		})
	case strings.Contains(query, "from public.round_robins"):
		return redistributionReloadRow(func(destinations ...any) error {
			*(destinations[0].(*bool)) = true
			*(destinations[1].(*[]byte)) = append([]byte(nil), tx.queueSettings...)
			return nil
		})
	default:
		return redistributionLockedJobRow{err: fmt.Errorf("unexpected worker query: %s", query)}
	}
}

func (tx *redistributionReloadTx) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	tx.executions = append(tx.executions, redistributionReloadExecution{query: query, args: append([]any(nil), args...)})
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

type redistributionReloadRows struct {
	pgx.Rows
	row     redistributionLockedJobRow
	emitted bool
}

func (rows *redistributionReloadRows) Next() bool {
	if rows.emitted {
		return false
	}
	rows.emitted = true
	return true
}
func (*redistributionReloadRows) Close()     {}
func (*redistributionReloadRows) Err() error { return nil }
func (rows *redistributionReloadRows) Scan(destinations ...any) error {
	return rows.row.Scan(destinations...)
}

func assertRedistributionReloadStop(t *testing.T, tx *redistributionReloadTx, reason string) {
	t.Helper()
	if len(tx.executions) != 1 || len(tx.executions[0].args) != 3 || tx.executions[0].args[2] != reason {
		t.Fatalf("stop = %#v, want only %q", tx.executions, reason)
	}
}

func TestRedistributionWarningReloadReevaluatesTheInitialMarker(t *testing.T) {
	t.Parallel()
	for _, listedInitial := range []bool{false, true} {
		t.Run(fmt.Sprintf("listed_initial_%t", listedInitial), func(t *testing.T) {
			candidate := redistributionJobLockFixture()
			tx := &redistributionReloadTx{
				listed: redistributionLockedJobRow{job: candidate, metadata: []byte(fmt.Sprintf(`{"initial_distribution_pending":%t}`, listedInitial))},
				locked: redistributionLockedJobRow{job: candidate, metadata: []byte(fmt.Sprintf(`{"initial_distribution_pending":%t}`, !listedInitial))},
			}
			if err := (Repository{}).processRedistributionWarnings(context.Background(), tx); err != nil {
				t.Fatal(err)
			}
			if listedInitial {
				assertRedistributionReloadStop(t, tx, "assignee_changed")
			} else if len(tx.executions) != 0 {
				t.Fatalf("new initial retry emitted inactivity DML: %#v", tx.executions)
			}
		})
	}
}

func TestRedistributionDueReloadBranchesUsingLockedInitialMetadata(t *testing.T) {
	t.Parallel()
	candidate := redistributionJobLockFixture()
	current := candidate
	current.CurrentAssignedUserID = ""
	tx := &redistributionReloadTx{
		listed:      redistributionLockedJobRow{job: candidate, metadata: []byte(`{}`)},
		locked:      redistributionLockedJobRow{job: current, metadata: []byte(`{"initial_distribution_pending":true,"source":"meta_lead_ads"}`)},
		currentDeal: "won",
	}
	if err := (Repository{}).processDueRedistributions(context.Background(), tx); err != nil {
		t.Fatal(err)
	}
	// The stale inactivity branch would stop this row as "unassigned" first.
	assertRedistributionReloadStop(t, tx, "deal_closed")
}

func TestRedistributionDueReloadUsesTheCurrentQueueAndAttemptCount(t *testing.T) {
	t.Parallel()
	candidate := redistributionJobLockFixture()
	candidate.AttemptCount = 0
	current := candidate
	current.RoundRobinID = "66666666-6666-4666-8666-666666666666"
	current.AttemptCount = 5
	tx := &redistributionReloadTx{
		listed:          redistributionLockedJobRow{job: candidate, metadata: []byte(`{}`)},
		locked:          redistributionLockedJobRow{job: current, metadata: []byte(`{}`)},
		currentAssignee: current.CurrentAssignedUserID, currentDeal: "open",
		queueSettings: []byte(`{"enable_redistribution":true,"redistribution_max_attempts":5}`),
	}
	if err := (Repository{}).processDueRedistributions(context.Background(), tx); err != nil {
		t.Fatal(err)
	}
	if len(tx.executions) != 0 {
		t.Fatalf("queue drift changed a job without locking its new queue first: %#v", tx.executions)
	}
	// A subsequent tick sees the new queue in its candidate list and may decide
	// from the current attempt count after locking that queue before the lead.
	tx.listed = redistributionLockedJobRow{job: current, metadata: []byte(`{}`)}
	tx.queries, tx.queryArgs = nil, nil
	if err := (Repository{}).processDueRedistributions(context.Background(), tx); err != nil {
		t.Fatal(err)
	}
	assertRedistributionReloadStop(t, tx, "max_attempts_reached")
	for index, query := range tx.queries {
		// Job reload also contains a managed-queue exclusion subquery, scoped
		// by its three job/organization/lead arguments. Only queue lookups take
		// the organization/queue pair asserted here.
		if strings.Contains(query, "from public.round_robins") && !strings.Contains(query, "from public.lead_redistribution_jobs") && !reflect.DeepEqual(tx.queryArgs[index], []any{current.OrganizationID, current.RoundRobinID}) {
			t.Fatalf("stale queue check arguments: %#v", tx.queryArgs[index])
		}
	}
}

func TestRedistributionReloadLoopsKeepJobsPendingWhileEitherIntakeLockIsBusy(t *testing.T) {
	for _, kind := range []string{"warning", "due"} {
		for _, held := range []string{"queue", "lead"} {
			t.Run(kind+"/"+held, func(t *testing.T) {
				candidate := redistributionJobLockFixture()
				tx := &redistributionReloadTx{
					listed:    redistributionLockedJobRow{job: candidate, metadata: []byte(`{}`)},
					locked:    redistributionLockedJobRow{job: candidate, metadata: []byte(`{}`)},
					queueBusy: held == "queue", leadBusy: held == "lead",
				}
				var err error
				if kind == "warning" {
					err = (Repository{}).processRedistributionWarnings(context.Background(), tx)
				} else {
					err = (Repository{}).processDueRedistributions(context.Background(), tx)
				}
				if err != nil || len(tx.executions) != 0 {
					t.Fatalf("busy %s produced DML instead of leaving the retry pending: %v, %#v", held, err, tx.executions)
				}
				for _, query := range tx.queries {
					if strings.Contains(query, "for update of j") && !strings.Contains(query, "skip locked") {
						t.Fatalf("busy intake reached the job lock: %s", query)
					}
				}
			})
		}
	}
}

func TestRedistributionReloadLoopsSkipCandidatesThatNoLongerQualify(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{"warning", "due"} {
		t.Run(kind, func(t *testing.T) {
			tx := &redistributionReloadTx{
				listed: redistributionLockedJobRow{job: redistributionJobLockFixture(), metadata: []byte(`{}`)},
				locked: redistributionLockedJobRow{err: pgx.ErrNoRows},
			}
			var err error
			if kind == "warning" {
				err = (Repository{}).processRedistributionWarnings(context.Background(), tx)
			} else {
				err = (Repository{}).processDueRedistributions(context.Background(), tx)
			}
			if err != nil || len(tx.executions) != 0 {
				t.Fatalf("expired candidate = %v, DML=%#v", err, tx.executions)
			}
		})
	}
}
