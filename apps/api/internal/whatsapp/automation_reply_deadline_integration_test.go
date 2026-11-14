package whatsapp

import (
	"context"
	"testing"
	"time"
)

func TestLocalAutomationReplyDeadlineFencesUncommittedIngress(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	database := openLocalOutboundDatabase(t, ctx)
	pool := database.Pool()
	fixture := createLocalSharedOutboundFixture(t, ctx, pool, "automation-reply-deadline")
	configureAutomationReplyFixture(t, ctx, pool, fixture)

	var executionID string
	if err := pool.QueryRow(ctx, `
		with automation as (
		  insert into public.automations(organization_id,name,is_active,trigger_type,trigger_config,flow_definition)
		  values($1::uuid,'Synthetic reply deadline',false,'manual','{}','{}') returning id
		), flow as (
		  insert into public.automation_flow_versions(automation_id,organization_id,version,trigger_type,trigger_config,
		    graph,graph_checksum,first_node_key,requires_review,created_by)
		  select id,$1::uuid,1,'manual','{}',
		    '{"nodes":[{"id":"delay","type":"delay","config":{"stop_on_reply":true}}],"connections":[]}',
		    id::text,'delay',false,$2::uuid from automation returning id,automation_id
		), execution as (
		  insert into public.automation_executions(automation_id,flow_version_id,organization_id,lead_id,conversation_id,
		    status,current_node_key,next_execution_at,attempt_count)
		  select automation_id,id,$1::uuid,$3::uuid,$4::uuid,'waiting','delay',now()-interval '1 second',1
		  from flow returning id,flow_version_id
		)
		insert into public.automation_execution_steps(execution_id,organization_id,flow_version_id,node_key,node_type,
		  status,attempt,started_at)
		select id,$1::uuid,flow_version_id,'delay','delay','waiting',1,now()-interval '1 minute'
		from execution returning execution_id::text
	`, fixture.organizationID, fixture.userID, fixture.leadID, fixture.conversationID).Scan(&executionID); err != nil {
		t.Fatal(err)
	}

	ingress, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = ingress.Rollback(ctx) }()
	if _, err := ingress.Exec(ctx, `select private.lock_whatsapp_automation_reply_scope($1::uuid,$2::uuid)`,
		fixture.organizationID, fixture.leadID); err != nil {
		t.Fatal(err)
	}
	if _, err := ingress.Exec(ctx, `
		with inbox as (
		  insert into public.whatsapp_webhook_inbox(organization_id,session_id,event_key,event_type,payload,
		    processing_lane,status,created_at,processing_epoch)
		  select organization_id,$2::uuid,$5,'message',
		    '{"__vimob_ingress":{"routing_snapshot":{"version":1}}}',
		    'live','pending',next_execution_at - interval '1 second',1
		  from public.automation_executions where organization_id=$1::uuid and id=$6::uuid
		  returning id,created_at
		)
		insert into private.whatsapp_automation_pending_replies(organization_id,session_id,conversation_id,lead_id,
		  binding_id,account_generation,inbox_id,provider_message_id,provider_occurred_at,inbox_accepted_at,hold_until)
		select $1::uuid,$2::uuid,$3::uuid,$4::uuid,binding.id,session.automation_reply_generation,inbox.id,$5,
		  inbox.created_at - interval '1 second',inbox.created_at,inbox.created_at + interval '30 seconds'
		from inbox join public.whatsapp_sessions session on session.id=$2::uuid and session.organization_id=$1::uuid
		join public.whatsapp_conversation_lead_bindings binding on binding.conversation_id=$3::uuid
		 and binding.organization_id=$1::uuid and binding.session_id=$2::uuid and binding.lead_id=$4::uuid
		 and binding.active_to is null and not binding.stale
	`, fixture.organizationID, fixture.sessionID, fixture.conversationID, fixture.leadID, fixture.suffix, executionID); err != nil {
		t.Fatal(err)
	}

	readElapsed := func() string {
		t.Helper()
		checkCtx, cancelCheck := context.WithTimeout(ctx, 2*time.Second)
		defer cancelCheck()
		var status string
		if err := pool.QueryRow(checkCtx, `select public.resume_automation_delay($1::uuid,$2::uuid,'elapsed')->>'status'`,
			fixture.organizationID, executionID).Scan(&status); err != nil {
			t.Fatal(err)
		}
		return status
	}
	if status := readElapsed(); status != "reply_pending" {
		t.Fatalf("elapsed crossed uncommitted ingress fence: %q", status)
	}
	if err := ingress.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if status := readElapsed(); status != "reply_pending" {
		t.Fatalf("elapsed ignored committed reply candidate: %q", status)
	}
	if _, err := pool.Exec(ctx, `delete from private.whatsapp_automation_pending_replies
		where organization_id=$1::uuid and session_id=$2::uuid and provider_message_id=$3`,
		fixture.organizationID, fixture.sessionID, fixture.suffix); err != nil {
		t.Fatal(err)
	}
	if status := readElapsed(); status != "completed" {
		t.Fatalf("wait failed to expire after the candidate was discarded: %q", status)
	}
}
