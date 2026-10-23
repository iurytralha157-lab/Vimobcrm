package leads

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type agendaHistoryRecordingTx struct {
	pgx.Tx
	t       *testing.T
	actor   tenant.Context
	queries []string
	args    [][]any
}

func (tx *agendaHistoryRecordingTx) SendBatch(_ context.Context, batch *pgx.Batch) pgx.BatchResults {
	tx.t.Helper()
	if len(batch.QueuedQueries) != 10 {
		tx.t.Fatalf("legacy history lost other sources: %d", len(batch.QueuedQueries))
	}
	rows := make([][]byte, len(batch.QueuedQueries))
	for i, item := range batch.QueuedQueries {
		tx.queries = append(tx.queries, item.SQL)
		tx.args = append(tx.args, item.Arguments)
		if agendaHistoryMaxBind(item.SQL) != len(item.Arguments) {
			tx.t.Fatalf("query %d bind mismatch args=%d max=%d", i, len(item.Arguments), agendaHistoryMaxBind(item.SQL))
		}
		if item.Arguments[0] != tx.actor.OrganizationID || item.Arguments[1] != historyPageTestLead {
			tx.t.Fatal("history crossed organization/lead")
		}
		rows[i] = []byte(`[]`)
		if i == 3 || i == 4 {
			rows[i] = []byte(`{}`)
		}
	}
	return &historyScopeBatch{rows: rows}
}

func (tx *agendaHistoryRecordingTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	return historyScopeRow{scan: func(dest ...any) error {
		if query == "select clock_timestamp()" {
			*dest[0].(*time.Time) = historyPageTestCursor().SnapshotAt
			return nil
		}
		tx.queries = append(tx.queries, query)
		tx.args = append(tx.args, args)
		if agendaHistoryMaxBind(query) != len(args) {
			tx.t.Fatalf("paged bind mismatch args=%d max=%d", len(args), agendaHistoryMaxBind(query))
		}
		if args[0] != tx.actor.OrganizationID || args[1] != historyPageTestLead {
			tx.t.Fatal("paged history crossed organization/lead")
		}
		raw, err := json.Marshal(leadHistoryPageResult{Lead: map[string]any{"id": historyPageTestLead}})
		*dest[0].(*[]byte) = raw
		return err
	}}
}

func TestAgendaHistoryLegacyQueriesEnforceAgendaAccessBeforeHydratingActors(t *testing.T) {
	for _, role := range []string{"user", "admin", "owner", "superadmin", "module off", "view revoked"} {
		t.Run(role, func(t *testing.T) {
			actor := agendaHistoryTestActor()
			switch role {
			case "admin", "owner":
				actor.MemberRole = role
			case "superadmin":
				actor.IsSuperAdmin = true
			case "module off":
				actor.EnabledModules = nil
			case "view revoked":
				actor.Permissions = nil
			}
			tx := &agendaHistoryRecordingTx{t: t, actor: actor}
			if _, err := (Repository{}).leadHistoryRawInSnapshot(context.Background(), tx, actor, historyPageTestLead); err != nil {
				t.Fatal(err)
			}
			readable := role != "module off" && role != "view revoked"
			for _, index := range []int{0, 1, 8} {
				if strings.Contains(tx.queries[index], "from public.schedule_events history_schedule") != readable {
					t.Fatalf("legacy query %d omitted Agenda ACL or looked up disabled details", index)
				}
			}
			for _, index := range []int{0, 1} {
				if !strings.Contains(tx.queries[index], "'user_id',null") || !strings.Contains(tx.queries[index], "'metadata','{}'::jsonb") {
					t.Fatalf("legacy query %d lost generic privacy projection", index)
				}
			}
			if strings.Count(tx.queries[8], "schedule_event_id") < 3 {
				t.Fatal("legacy user union still hydrates protected Agenda actors")
			}
			if !strings.Contains(tx.queries[8], "audit.entity_id::text = $2::text") {
				t.Fatal("legacy user union compares text audit IDs against an inferred UUID parameter")
			}
			if strings.Contains(tx.queries[2], "schedule_events") || strings.Contains(tx.queries[7], "schedule_events") {
				t.Fatal("Agenda change reached entry/audit logs")
			}
		})
	}
}

func TestAgendaHistoryPagedReadPassesActorAndPreservesOtherPageArguments(t *testing.T) {
	for _, role := range []string{"user", "admin", "owner", "superadmin", "module off", "view revoked"} {
		t.Run(role, func(t *testing.T) {
			actor := agendaHistoryTestActor()
			switch role {
			case "admin", "owner":
				actor.MemberRole = role
			case "superadmin":
				actor.IsSuperAdmin = true
			case "module off":
				actor.EnabledModules = nil
			case "view revoked":
				actor.Permissions = nil
			}
			tx := &agendaHistoryRecordingTx{t: t, actor: actor}
			response, err := readLeadHistoryPageInSnapshot(context.Background(), tx, actor.OrganizationID, historyPageTestLead, LeadHistoryPageFilter{PageSize: 17}, actor)
			if err != nil || response.Pagination.HasOlder || response.Pagination.NextCursor != nil {
				t.Fatalf("page contract changed: %+v %v", response, err)
			}
			if len(tx.queries) != 1 || tx.args[0][6] != 17 || tx.args[0][7] != 18 {
				t.Fatal("page limits changed during Agenda projection")
			}
			if len(tx.args[0]) == 9 && tx.args[0][8] != actor.UserID {
				t.Fatal("page bound a different actor")
			}
			readable := role != "module off" && role != "view revoked"
			if strings.Contains(tx.queries[0], "from public.schedule_events history_schedule") != readable {
				t.Fatal("page ignored current Agenda access")
			}
		})
	}
}
