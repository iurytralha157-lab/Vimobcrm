package leads

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Run the actual policy refresh and worker loops against an independent job
// clock/state model. The first 50 refresh candidates belong to a busy queue;
// the warning/due candidate is job 51 in a different, available queue.
// No pool, environment configuration or database is involved.
type candidatePolicyTx struct {
	redistributionReloadTx
	older          []redistributionLockedJobRow
	busyQueue      string
	now            time.Time
	dueAt          time.Time
	warningAt      time.Time
	policyWrites   int
	policyCASMiss  bool
	refreshSkipped int
	policyScope    []any
}

type candidatePolicyRows struct {
	pgx.Rows
	rows  []redistributionLockedJobRow
	index int
}

func (rows *candidatePolicyRows) Next() bool { rows.index++; return rows.index <= len(rows.rows) }
func (*candidatePolicyRows) Close()          {}
func (*candidatePolicyRows) Err() error      { return nil }
func (rows *candidatePolicyRows) Scan(dest ...any) error {
	return rows.rows[rows.index-1].Scan(dest...)
}

func newCandidatePolicyTx(kind string, timeout, warning, max int) *candidatePolicyTx {
	job := redistributionJobLockFixture()
	job.AttemptCount = 0
	start := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	job.EnrolledAt = start
	clockMinutes := 25
	if kind == "warning" {
		clockMinutes = 18
	}
	tx := &candidatePolicyTx{
		redistributionReloadTx: redistributionReloadTx{
			listed:          redistributionLockedJobRow{job: job, metadata: []byte(`{}`)},
			locked:          redistributionLockedJobRow{job: job, metadata: []byte(`{}`)},
			currentAssignee: job.CurrentAssignedUserID, currentDeal: "open",
			queueSettings: []byte(fmt.Sprintf(`{"enable_redistribution":true,"redistribution_timeout_minutes":%d,"redistribution_warning_minutes":%d,"redistribution_max_attempts":%d}`, timeout, warning, max)),
		},
		busyQueue: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		now:       start.Add(time.Duration(clockMinutes) * time.Minute),
		dueAt:     start.Add(20 * time.Minute), warningAt: start.Add(15 * time.Minute),
	}
	for index := 0; index < leadRedistributionBatchLimit; index++ {
		older := job
		older.ID = fmt.Sprintf("bbbbbbbb-bbbb-4bbb-8bbb-%012d", index+1)
		older.LeadID = fmt.Sprintf("cccccccc-cccc-4ccc-8ccc-%012d", index+1)
		older.RoundRobinID = tx.busyQueue
		tx.older = append(tx.older, redistributionLockedJobRow{job: older, metadata: []byte(`{}`)})
	}
	return tx
}

func (tx *candidatePolicyTx) Query(ctx context.Context, query string, args ...any) (pgx.Rows, error) {
	if strings.Contains(query, "order by j.updated_at, j.id limit") {
		return &candidatePolicyRows{rows: tx.older}, nil
	}
	return tx.redistributionReloadTx.Query(ctx, query, args...)
}

func (tx *candidatePolicyTx) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	switch {
	case strings.Contains(query, "for no key update skip locked") && fmt.Sprint(args[1]) == tx.busyQueue:
		tx.refreshSkipped++
		return redistributionStringRow{err: pgx.ErrNoRows}
	case strings.Contains(query, "for update of j"):
		eligible := !tx.dueAt.After(tx.now)
		if strings.Contains(query, "j.warning_sent_at is null") {
			eligible = !tx.warningAt.IsZero() && !tx.warningAt.After(tx.now) && tx.dueAt.After(tx.now)
		}
		if !eligible {
			return redistributionLockedJobRow{err: pgx.ErrNoRows}
		}
		return tx.locked
	case strings.Contains(query, "select round_robin_id::text") && strings.Contains(query, "from public.lead_redistribution_jobs"):
		return redistributionReloadRow(func(dest ...any) error {
			job := tx.locked.job
			*(dest[0].(*string)), *(dest[1].(*string)) = job.RoundRobinID, job.CurrentAssignedUserID
			*(dest[2].(*int)), *(dest[3].(*int)) = job.AttemptCount, job.MaxAttempts
			*(dest[4].(*int)), *(dest[5].(*int)) = job.TimeoutMinutes, job.WarningMinutes
			*(dest[6].(*time.Time)) = job.EnrolledAt
			return nil
		})
	case strings.Contains(query, "select coalesce(settings, '{}'::jsonb)::text"):
		return redistributionJSONRow{value: tx.queueSettings}
	case strings.Contains(query, "with target_lead as"):
		return redistributionBoolRow{value: false}
	case strings.Contains(query, "private.preview_round_robin_redistribution_candidate("):
		return redistributionSelectionRow{memberID: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", userID: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}
	case strings.Contains(query, "information_schema.columns"):
		return redistributionBoolRow{value: true}
	default:
		return tx.redistributionReloadTx.QueryRow(ctx, query, args...)
	}
}

func (tx *candidatePolicyTx) Exec(ctx context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	if strings.Contains(query, "set timeout_minutes = $2") {
		tx.policyScope = append([]any(nil), args...)
		if tx.policyCASMiss {
			return pgconn.NewCommandTag("UPDATE 0"), nil
		}
		tx.policyWrites++
		tx.locked.job.TimeoutMinutes, tx.locked.job.WarningMinutes, tx.locked.job.MaxAttempts = args[1].(int), args[2].(int), args[3].(int)
		tx.dueAt = tx.locked.job.EnrolledAt.Add(time.Duration(args[1].(int)) * time.Minute)
		tx.warningAt = time.Time{}
		if args[2].(int) > 0 {
			tx.warningAt = tx.dueAt.Add(-time.Duration(args[2].(int)) * time.Minute)
		}
	}
	return tx.redistributionReloadTx.Exec(ctx, query, args...)
}

func (tx *candidatePolicyTx) executeLoop(kind string) error {
	repo := Repository{}
	if err := repo.refreshPendingRedistributionPolicies(context.Background(), tx); err != nil {
		return err
	}
	if kind == "warning" {
		return repo.processRedistributionWarnings(context.Background(), tx)
	}
	return repo.processDueRedistributions(context.Background(), tx)
}

func TestRedistributionCandidate51ReconcilesExtendedDeadlineBeforeWarningOrTransfer(t *testing.T) {
	for _, kind := range []string{"warning", "due"} {
		t.Run(kind, func(t *testing.T) {
			tx := newCandidatePolicyTx(kind, 40, 10, 10)
			if err := tx.executeLoop(kind); err != nil {
				t.Fatal(err)
			}
			if len(tx.executions) != 1 || !strings.Contains(tx.executions[0].query, "set timeout_minutes = $2") {
				t.Fatalf("extended deadline still sent a warning or transferred/stopped a lead: %#v", tx.executions)
			}
			if tx.refreshSkipped != 50 || tx.policyWrites != 1 {
				t.Fatalf("refreshSkipped=%d policyWrites=%d", tx.refreshSkipped, tx.policyWrites)
			}
			if !tx.dueAt.Equal(tx.locked.job.EnrolledAt.Add(40 * time.Minute)) {
				t.Fatalf("deadline=%s", tx.dueAt)
			}
		})
	}
}

func TestRedistributionCandidateOutsideRefreshUsesExpandedAttemptLimitForTransfer(t *testing.T) {
	tx := newCandidatePolicyTx("due", 20, 5, 100)
	tx.listed.job.AttemptCount, tx.locked.job.AttemptCount = 4, 4
	tx.listed.job.MaxAttempts, tx.locked.job.MaxAttempts = 5, 5
	if err := tx.executeLoop("due"); err != nil {
		t.Fatal(err)
	}
	transferred, continued := false, false
	for _, execution := range tx.executions {
		if strings.Contains(execution.query, "set assigned_user_id = $3") {
			transferred = true
		}
		if strings.Contains(execution.query, "set current_assigned_user_id = $2") {
			if strings.Contains(execution.query, "status = 'max_attempts_reached'") {
				t.Fatal("the old attempt limit stopped a job after the fifth transfer")
			}
			continued = execution.args[2] == 5 && strings.Contains(execution.query, "status = 'pending'")
		}
	}
	if !transferred || !continued || tx.locked.job.MaxAttempts != 100 {
		t.Fatalf("transferred=%t continued=%t max=%d", transferred, continued, tx.locked.job.MaxAttempts)
	}
	if tx.refreshSkipped != 50 || tx.policyWrites != 1 {
		t.Fatalf("refreshSkipped=%d policyWrites=%d", tx.refreshSkipped, tx.policyWrites)
	}
}

func TestRedistributionCandidatePolicyCASMissDoesNotWarnOrTransfer(t *testing.T) {
	tx := newCandidatePolicyTx("due", 40, 10, 100)
	tx.policyCASMiss = true
	if err := tx.executeLoop("due"); err != nil {
		t.Fatal(err)
	}
	if tx.policyWrites != 0 || len(tx.executions) != 0 {
		t.Fatalf("CAS miss performed an action: %#v", tx.executions)
	}
	if len(tx.policyScope) != 13 {
		t.Fatalf("policy CAS scope args=%#v", tx.policyScope)
	}
	job := tx.locked.job
	if tx.policyScope[4] != job.OrganizationID || tx.policyScope[5] != job.LeadID || tx.policyScope[6] != job.RoundRobinID || tx.policyScope[7] != job.AttemptCount || tx.policyScope[9] != job.CurrentAssignedUserID {
		t.Fatalf("policy CAS used stale or unscoped identity: %#v", tx.policyScope)
	}
}
