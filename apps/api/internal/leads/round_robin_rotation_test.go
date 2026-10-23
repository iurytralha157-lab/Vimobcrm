package leads

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestRedistributionPreviewDoesNotFallbackWhenDatabaseRejects(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		err    error
		reason string
	}{
		{name: "no eligible alternative", err: pgx.ErrNoRows, reason: "no_next_member"},
		{name: "stale owner", err: errors.New("round_robin_rotation_stale_owner")},
		{name: "migration missing", err: errors.New("function does not exist")},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			queryer := &roundRobinSelectionQueryer{t: t, rows: []pgx.Row{roundRobinSelectionRow{err: testCase.err}}}
			selection, reason, err := (Repository{}).selectRoundRobinMemberForRedistribution(context.Background(), queryer, "org", "lead", "queue", "owner", "team")
			if reason != testCase.reason || selection != (roundRobinSelection{}) {
				t.Fatalf("selection=%#v reason=%q", selection, reason)
			}
			if errors.Is(testCase.err, pgx.ErrNoRows) {
				if err != nil {
					t.Fatal(err)
				}
			} else if !errors.Is(err, testCase.err) {
				t.Fatalf("database error must be returned, got %v", err)
			}
			if len(queryer.queries) != 1 {
				t.Fatal("must not fall back to the historical selector")
			}
		})
	}
}

func TestManualRedistributionDoesNotPickAnotherQueueWhenNoMember(t *testing.T) {
	queryer := &roundRobinSelectionQueryer{t: t, rows: []pgx.Row{
		roundRobinSelectionRow{values: []string{"queue"}},
		roundRobinSelectionRow{err: pgx.ErrNoRows},
	}}
	selection, reason, err := (Repository{}).selectRoundRobinMember(context.Background(), queryer, "org", leadSnapshot{ID: "lead", AssignedUserID: "owner"})
	if err != nil || reason != "no_member" || selection != (roundRobinSelection{}) {
		t.Fatalf("selection=%#v reason=%q error=%v", selection, reason, err)
	}
	if len(queryer.queries) != 2 {
		t.Fatal("empty queue must not trigger another queue search")
	}
}
