package leads

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
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

func TestRedistributionHasHumanActivityCoversAllIdleSignals(t *testing.T) {
	t.Parallel()

	queryer := &redistributionActivityQueryer{row: redistributionBoolRow{value: true}}
	job := redistributionJob{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		LeadID:         "22222222-2222-4222-8222-222222222222",
		EnrolledAt:     time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC),
	}

	hasActivity, err := (Repository{}).redistributionHasHumanActivity(context.Background(), queryer, job)
	if err != nil {
		t.Fatalf("redistribution human activity: %v", err)
	}
	if !hasActivity {
		t.Fatal("expected human activity to stop redistribution")
	}

	if len(queryer.args) != 3 {
		t.Fatalf("args = %d, want 3", len(queryer.args))
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
		"wm.sender_user_id is not null",
		"al.user_id is not null",
	}
	for _, fragment := range requiredFragments {
		if !strings.Contains(queryer.sql, fragment) {
			t.Fatalf("expected activity SQL to contain %q", fragment)
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
