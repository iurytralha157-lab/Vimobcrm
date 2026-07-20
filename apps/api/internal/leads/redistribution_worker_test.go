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
