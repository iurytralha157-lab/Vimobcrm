package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// All seven legacy/durable families are real rows in the disposable schema.
// Each in-flight state must roll back the entire correction; the final call
// cancels only safe queued work and projects its canonical message first.
func TestLocalWhatsAppPhoneChangePreservesEveryWorkFence(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := outboundHardeningFixture(t, ctx, db, repo, "phone-seven-work-fences")
	var globalAgentID string
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		for _, table := range []string{"public.automation_effect_dispatches", "public.automation_execution_steps", "public.automation_executions", "public.automation_event_outbox", "public.automation_flow_versions", "public.automations", "public.ai_outbox_messages", "public.ai_jobs", "public.outbox_messages", "public.jobs", "public.ai_agents"} {
			if _, err := db.Pool().Exec(cleanupCtx, "delete from "+table+" where organization_id=$1::uuid", f.organizationID); err != nil {
				t.Errorf("cleanup seven-family %s: %v", table, err)
			}
		}
		if globalAgentID != "" {
			if _, err := db.Pool().Exec(cleanupCtx, `delete from public.ai_global_agents where id=$1::uuid`, globalAgentID); err != nil {
				t.Errorf("cleanup synthetic global agent: %v", err)
			}
		}
	})
	queued := queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic old safe queue", ClientMessageID: f.suffix + "-safe-intent"})
	work := createPhoneWorkFixture(t, ctx, db.Pool(), f)
	globalAgentID = work.agent
	if _, err := db.Pool().Exec(ctx, `update public.leads set phone='5511888866666' where id=$1::uuid`, f.leadID); err != nil {
		t.Fatal(err)
	}
	request := phoneConfirmationRequest(f, "5511888866666")
	for _, scenario := range []struct{ table, id, inFlight, safe string }{
		{"outbox_messages", work.legacy, "processing", "pending"},
		{"ai_jobs", work.aiJob, "processing", "pending"},
		{"jobs", work.job, "processing", "queued"},
		{"ai_outbox_messages", work.aiOutbox, "sending", "approved"},
		{"automation_event_outbox", work.event, "processing", "pending"},
		{"automation_executions", work.execution, "running", "waiting"},
		{"automation_effect_dispatches", work.dispatch, "sending", "succeeded"},
	} {
		t.Run(scenario.table, func(t *testing.T) {
			if _, err := db.Pool().Exec(ctx, "update public."+scenario.table+" set status=$2 where id=$1::uuid", scenario.id, scenario.inFlight); err != nil {
				t.Fatal(err)
			}
			if _, err := repo.StartConversation(ctx, f.tenant, request); !errors.Is(err, ErrConversationSendInFlight) {
				t.Fatalf("%s in-flight failed to block transition: %v", scenario.table, err)
			}
			assertPhoneOldRouteUntouched(t, ctx, db.Pool(), f)
			var stillQueued string
			if err := db.Pool().QueryRow(ctx, `select status from public.whatsapp_messages where id=$1::uuid`, queued.Message.ID).Scan(&stillQueued); err != nil || stillQueued != "queued" {
				t.Fatalf("failed transition partially terminalized queue: %s %v", stillQueued, err)
			}
			if _, err := db.Pool().Exec(ctx, "update public."+scenario.table+" set status=$2 where id=$1::uuid", scenario.id, scenario.safe); err != nil {
				t.Fatal(err)
			}
		})
	}
	opened, err := repo.StartConversation(ctx, f.tenant, request)
	if err != nil || opened.ID == f.conversationID {
		t.Fatalf("safe queued families prevented transition: %+v %v", opened, err)
	}
	for _, scenario := range []struct{ table, id, want string }{
		{"outbox_messages", work.legacy, "failed"}, {"ai_jobs", work.aiJob, "cancelled"}, {"jobs", work.job, "cancelled"},
		{"ai_outbox_messages", work.aiOutbox, "cancelled"}, {"automation_event_outbox", work.event, "dead_letter"},
		{"automation_executions", work.execution, "cancelled"}, {"automation_execution_steps", work.step, "cancelled"},
		{"automation_effect_dispatches", work.dispatch, "succeeded"}, {"whatsapp_messages", queued.Message.ID, "failed"},
	} {
		var state string
		if err := db.Pool().QueryRow(ctx, "select status from public."+scenario.table+" where id=$1::uuid", scenario.id).Scan(&state); err != nil || state != scenario.want {
			t.Errorf("%s safe terminal state %s want%s: %v", scenario.table, state, scenario.want, err)
		}
	}
}

type phoneWorkFixture struct{ legacy, aiJob, job, aiOutbox, event, execution, step, dispatch, agent string }

func createPhoneWorkFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, f sessionConversationLockFixture) phoneWorkFixture {
	t.Helper()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	var agent, automation, version string
	if err := tx.QueryRow(ctx, `insert into public.ai_global_agents(slug,name,is_active)values($1,'Synthetic inactive test agent',false)returning id::text`, f.suffix).Scan(&agent); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `insert into public.automations(organization_id,name,trigger_type,is_active)values($1::uuid,'Synthetic phone retirement','manual',false)returning id::text`, f.organizationID).Scan(&automation); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `insert into public.automation_flow_versions(organization_id,automation_id,version,trigger_type,graph,graph_checksum,first_node_key)
	 values($1::uuid,$2::uuid,1,'manual','{"nodes":[],"edges":[]}','synthetic-phone-test','start')returning id::text`, f.organizationID, automation).Scan(&version); err != nil {
		t.Fatal(err)
	}
	result := phoneWorkFixture{agent: agent}
	rows := []struct {
		query string
		args  []any
		id    *string
	}{
		{`insert into public.outbox_messages(organization_id,session_id,conversation_id,content,status)values($1::uuid,$2::uuid,$3::uuid,'Synthetic legacy queued','pending')returning id::text`, []any{f.organizationID, f.sessionID, f.conversationID}, &result.legacy},
		{`insert into public.ai_jobs(organization_id,agent_id,conversation_id,status)values($1::uuid,$2::uuid,$3::uuid,'pending')returning id::text`, []any{f.organizationID, agent, f.conversationID}, &result.aiJob},
		{`insert into public.jobs(organization_id,job_type,payload,status)values($1::uuid,'whatsapp_ai_autoreply',jsonb_build_object('conversationId',$2::text),'queued')returning id::text`, []any{f.organizationID, f.conversationID}, &result.job},
		{`insert into public.ai_outbox_messages(organization_id,agent_id,conversation_id,content,status)values($1::uuid,$2::uuid,$3::uuid,'Synthetic AI queued','approved')returning id::text`, []any{f.organizationID, agent, f.conversationID}, &result.aiOutbox},
		{`insert into public.automation_event_outbox(organization_id,event_type,aggregate_type,aggregate_id,dedupe_key,conversation_id,status)values($1::uuid,'manual','conversation',$2::uuid,$3,$2::uuid,'pending')returning id::text`, []any{f.organizationID, f.conversationID, f.suffix}, &result.event},
		{`insert into public.automation_executions(organization_id,automation_id,conversation_id,lead_id,flow_version_id,status)values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'waiting')returning id::text`, []any{f.organizationID, automation, f.conversationID, f.leadID, version}, &result.execution},
	}
	for index, row := range rows {
		if err := tx.QueryRow(ctx, row.query, row.args...).Scan(row.id); err != nil {
			t.Fatal(fmt.Errorf("work fixture row%d: %w", index, err))
		}
	}
	if err := tx.QueryRow(ctx, `insert into public.automation_execution_steps(organization_id,execution_id,flow_version_id,node_key,node_type,status)
	 values($1::uuid,$2::uuid,$3::uuid,'synthetic-wait','action','waiting')returning id::text`, f.organizationID, result.execution, version).Scan(&result.step); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `insert into public.automation_effect_dispatches(organization_id,execution_id,node_key,effect_key,effect_type,status)
	 values($1::uuid,$2::uuid,'synthetic-send',$3,'send_whatsapp','succeeded')returning id::text`, f.organizationID, result.execution, f.suffix).Scan(&result.dispatch); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return result
}
