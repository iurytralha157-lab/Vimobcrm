package leads

import (
	"strings"
	"testing"
	"time"
)

func TestQueueHistoryProjectionUsesPrivateWhitelistAndParticipantScope(t *testing.T) {
	sql := queueHistoryHydrationSQL
	for _, fragment := range []string{"from private.queue_runtime_events qe", "queue.organization_id=qe.organization_id",
		"'assignment_count'", "'round_number'", "'episode_id'", "'reason'", "'distribution_event_id'"} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("missing queue history context: %s", fragment)
		}
	}
	for _, alias := range []string{"previous_user", "next_user", "actor"} {
		if !strings.Contains(sql, leadHistoryParticipantSQL(alias, "qe.organization_id")) {
			t.Fatalf("unscoped actor: %s", alias)
		}
	}
	for _, unsafe := range []string{"to_jsonb(qe)", "'email'", "qe.metadata as", "'history_transition_key'", "'last_error_code'"} {
		if strings.Contains(sql, unsafe) {
			t.Fatalf("private internals exposed: %s", unsafe)
		}
	}
}

func TestQueueHistoryPageRejectsForeignPrivateRowsAndAcceptsNewCursorRank(t *testing.T) {
	at := historyPageTestCursor().OccurredAt
	for _, field := range []string{"organization_id", "lead_id"} {
		row := historyPageTestRow(7, 1, at)
		row.Data[field] = historyPageTestOtherOrg
		if _, err := reconstructLeadHistoryPage(leadHistoryPageResult{Events: []leadHistoryPageRow{row}, Lead: map[string]any{"id": historyPageTestLead}},
			historyPageTestOrg, historyPageTestLead, at.Add(time.Hour), 100); err == nil {
			t.Fatalf("foreign private row accepted: %s", field)
		}
	}
	cursor := historyPageTestCursor()
	cursor.SourceRank = 7
	encoded, err := encodeLeadHistoryPageCursor(cursor)
	if err != nil {
		t.Fatal(err)
	}
	if decoded, err := decodeLeadHistoryPageCursor(encoded); err != nil || decoded != cursor {
		t.Fatal("private source cursor rejected or changed")
	}
}
