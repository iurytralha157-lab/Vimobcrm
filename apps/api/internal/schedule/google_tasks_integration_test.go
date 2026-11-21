package schedule

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// The dedicated Agenda fixture has no managed queue leads. Execute the exact
// canonical ordinary-lead path instead of replacing access checks with a stub.
// Pool audience/auth prerequisites remain deliberately absent: inserting a
// managed runtime row fails loudly rather than granting pool access here.
func installScheduleOrdinaryLeadReadFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	source, err := os.ReadFile("../../../../supabase/migrations/20261015022536_queue_runtime_state_and_audience.sql")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	start := strings.Index(text, "create or replace function private.queue_pool_read_access(")
	if start < 0 {
		t.Fatal("canonical pool read prerequisite missing")
	}
	end := strings.Index(text[start:], "$function$;")
	if end < 0 {
		t.Fatal("canonical pool read prerequisite terminator missing")
	}
	if _, err := pool.Exec(ctx, `create schema if not exists private;
		create table if not exists private.queue_lead_runtime(organization_id uuid,lead_id uuid,state text,round_robin_id uuid);`+
		text[start:start+end+len("$function$;")]); err != nil {
		t.Fatalf("install literal ordinary-lead prerequisite: %v", err)
	}
}

func runScheduleGoogleTasksChecks(t *testing.T, f scheduleHardeningFixtureContext) {
	t.Run("Tasks metadata remains tenant scoped and durable across retype transfer and delete", func(t *testing.T) {
		if _, err := f.pool.Exec(f.ctx, `update public.google_calendar_tokens set routing_v2=true where organization_id=$1 and user_id=$2`, f.org, f.owner); err != nil {
			t.Fatal(err)
		}
		input, err := (CreateRequest{ClientRequestID: f.id(), Title: "Synthetic Tasks routing", UserID: f.owner, EventType: "task", StartTime: f.start, EndTime: f.start.Add(time.Hour), Visibility: "default"}).Validate(f.owner)
		if err != nil {
			t.Fatal(err)
		}
		event, err := f.repo.Create(f.ctx, f.ownerActor, input)
		if err != nil || event.GoogleSyncTarget == nil || *event.GoogleSyncTarget != "tasks" {
			t.Fatalf("task destination: %#v %v", event.GoogleSyncTarget, err)
		}
		linkID := f.id()
		if _, err := f.pool.Exec(f.ctx, `
			update public.schedule_events set google_task_id='synthetic-task' where id=$1;
			insert into public.google_tasks_links(id,organization_id,connection_id,vimob_event_id,schedule_event_id)
			select $2,$3,id,$1,$1 from public.google_calendar_tokens where organization_id=$3 and user_id=$4 limit 1;
		`, pgx.QueryExecModeSimpleProtocol, event.ID, linkID, f.org, f.owner); err != nil {
			t.Fatal(err)
		}
		visible, err := f.repo.Get(f.ctx, f.ownerActor, event.ID)
		if err != nil || visible.GoogleTaskID == nil || *visible.GoogleTaskID != "synthetic-task" || visible.GoogleEventID != nil {
			t.Fatalf("separate task identity: %#v %v", visible.GoogleTaskID, err)
		}
		other := f.ownerActor
		other.UserID = f.otherMember
		masked, err := f.repo.Get(f.ctx, other, event.ID)
		if err != nil || !masked.IsMasked || masked.GoogleTaskID != nil || masked.GoogleSyncTarget != nil || masked.GoogleEventID != nil {
			t.Fatalf("masked integration metadata leaked: %#v %v", masked, err)
		}
		foreign := f.ownerActor
		foreign.OrganizationID, foreign.UserID = f.otherOrg, f.otherTenantUser
		if _, err := f.repo.Get(f.ctx, foreign, event.ID); !errors.Is(err, ErrEventNotFound) {
			t.Fatalf("cross-tenant task read: %v", err)
		}
		meeting := "meeting"
		updated, err := f.repo.Update(f.ctx, f.ownerActor, event.ID, updateInput{EventType: patchString{Set: true, Value: &meeting}})
		if err != nil || updated.GoogleSyncTarget == nil || *updated.GoogleSyncTarget != "calendar" {
			t.Fatalf("activity to appointment routing: %#v %v", updated.GoogleSyncTarget, err)
		}
		task := "task"
		if _, err := f.repo.Update(f.ctx, f.ownerActor, event.ID, updateInput{EventType: patchString{Set: true, Value: &task}}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("appointment history restriction changed: %v", err)
		}
		if _, err := f.repo.Update(f.ctx, f.admin, event.ID, updateInput{UserID: patchString{Set: true, Value: &f.otherMember}}); err != nil {
			t.Fatal(err)
		}
		var payloadJSON []byte
		if err := f.pool.QueryRow(f.ctx, `select payload from public.google_calendar_sync_jobs where organization_id=$1 and schedule_event_id=$2 and action='push_delete' order by next_run_at desc limit 1`, f.org, event.ID).Scan(&payloadJSON); err != nil {
			t.Fatal(err)
		}
		var payload struct {
			Protocol int      `json:"protocol_version"`
			Owner    string   `json:"owner_user_id"`
			Links    []string `json:"task_link_ids"`
		}
		if err := json.Unmarshal(payloadJSON, &payload); err != nil || payload.Protocol != 2 || payload.Owner != f.owner || len(payload.Links) != 1 || payload.Links[0] != linkID {
			t.Fatalf("transfer lost old-owner cleanup: %s %v", payloadJSON, err)
		}
		if _, err := f.repo.Delete(f.ctx, f.admin, event.ID); err != nil {
			t.Fatal(err)
		}
		var retained bool
		if err := f.pool.QueryRow(f.ctx, `select schedule_event_id is null and vimob_event_id=$2::uuid from public.google_tasks_links where organization_id=$1 and id=$3`, f.org, event.ID, linkID).Scan(&retained); err != nil || !retained {
			t.Fatalf("hard delete discarded cleanup evidence: %v %v", retained, err)
		}
	})
}
