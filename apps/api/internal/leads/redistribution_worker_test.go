package leads

import (
	"context"
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

func (executor *redistributionExecutor) Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	executor.sql = sql
	executor.args = arguments
	return pgconn.CommandTag{}, executor.err
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

func TestNextRoundRobinMemberAvailabilityUsesConfiguredSchedule(t *testing.T) {
	t.Parallel()

	expected := time.Date(2026, 7, 24, 8, 0, 0, 0, time.UTC)
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
