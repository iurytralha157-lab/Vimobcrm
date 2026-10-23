package leads

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

type redistributionQueueGateQueryer struct {
	rows      []pgx.Row
	queries   []string
	arguments [][]any
}

func (queryer *redistributionQueueGateQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	queryer.queries = append(queryer.queries, query)
	queryer.arguments = append(queryer.arguments, append([]any(nil), args...))
	if len(queryer.rows) == 0 {
		return redistributionStringRow{err: errors.New("unexpected queue query")}
	}
	row := queryer.rows[0]
	queryer.rows = queryer.rows[1:]
	return row
}

func TestRedistributionQueueLockAllowsMissingQueueStopAndSkipsBusyIntake(t *testing.T) {
	for _, scenario := range []struct {
		name string
		rows []pgx.Row
		want bool
	}{
		{"available", []pgx.Row{redistributionStringRow{value: "44444444-4444-4444-8444-444444444444"}}, true},
		{"intake holds share lock", []pgx.Row{redistributionStringRow{err: pgx.ErrNoRows}, redistributionBoolRow{value: true}}, false},
		{"queue removed", []pgx.Row{redistributionStringRow{err: pgx.ErrNoRows}, redistributionBoolRow{value: false}}, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			job := redistributionJobLockFixture()
			queryer := &redistributionQueueGateQueryer{rows: scenario.rows}
			got, err := lockRedistributionQueueBeforeLead(context.Background(), queryer, job)
			if err != nil || got != scenario.want {
				t.Fatalf("queue gate = %v, %v; want %v", got, err, scenario.want)
			}
			if !strings.Contains(queryer.queries[0], "for no key update skip locked") {
				t.Fatal("the eventual write lock must be acquired without waiting on an intake")
			}
			for _, args := range queryer.arguments {
				if fmt.Sprint(args[0]) != job.OrganizationID || fmt.Sprint(args[1]) != job.RoundRobinID {
					t.Fatalf("queue lock crossed job/tenant scope: %#v", args)
				}
			}
		})
	}
}

func TestRedistributionWarningIsRenewedOnlyWhenItsPolicyOrAttemptChanges(t *testing.T) {
	job := redistributionJobLockFixture()
	first := redistributionWarningDedupeKey(job)
	job.TimeoutMinutes = 40
	job.WarningMinutes = 10
	changedPolicy := redistributionWarningDedupeKey(job)
	if first == changedPolicy {
		t.Fatal("an operator's new deadline must not reuse the old notification key")
	}
	job.MaxAttempts = 100
	if redistributionWarningDedupeKey(job) != changedPolicy {
		t.Fatal("availability deferral and max attempts must not generate repeated warning notifications")
	}
	job.AttemptCount++
	if redistributionWarningDedupeKey(job) == changedPolicy {
		t.Fatal("a later transfer is a new warning episode")
	}
	currentAttempt := redistributionWarningDedupeKey(job)
	job.EnrolledAt = job.EnrolledAt.AddDate(0, 0, 1)
	if redistributionWarningDedupeKey(job) == currentAttempt {
		t.Fatal("re-enrollment must not inherit warnings from a previous inactivity cycle")
	}
}
