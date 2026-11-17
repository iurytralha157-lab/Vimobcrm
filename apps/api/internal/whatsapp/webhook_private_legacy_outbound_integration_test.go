package whatsapp

import (
	"context"
	"errors"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func seedLegacyOutboundPrivateHistory(t *testing.T, ctx context.Context, db *dbpkg.Postgres, f privateCollisionFixture) {
	t.Helper()
	if _, err := db.Pool().Exec(ctx, `insert into public.whatsapp_messages
	 (organization_id,session_id,conversation_id,provider_message_id,message_id,remote_jid,from_me,direction,status,message_type,sent_at,capture_state)
	 values($1::uuid,$2::uuid,$3::uuid,$4,$4,$5,true,'outbound','sent','text',now()-interval '1 hour','suppressed');
	 update public.whatsapp_messages set capture_state='unlinked_ephemeral',content='Synthetic existing private history'
	 where organization_id=$1::uuid and session_id=$2::uuid and provider_message_id=$4`, f.organizationID, f.sessionID, f.privateID, f.suffix+"-existing-history", f.privateJID); err != nil {
		t.Fatal(err)
	}
}

func insertFrozenLegacyOutbound(t *testing.T, ctx context.Context, repo Repository, f privateCollisionFixture, label, lane string) string {
	t.Helper()
	providerID, route := f.suffix+"-outbound-"+label, "jid:"+syntheticLegacyOutboundLID
	payload, message := syntheticLegacyOutbound(t, providerID, f.remoteJID)
	if !message.FromMe || message.UnsupportedID || message.ContactPhone == "" || message.IdentityPNConflict || message.MessageType != "text" || message.ProviderTimestampMissing {
		t.Fatal("synthetic actual-shape outbound did not retain the provider direction and PN")
	}
	eventKey := evolutionWebhookEventKey(f.sessionID, []byte(jsonb(payload)))
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackWebhookTx(tx)
	var sequence int64
	if err := tx.QueryRow(ctx, `select nextval('public.whatsapp_webhook_routing_ingress_sequence')`).Scan(&sequence); err != nil {
		t.Fatal(err)
	}
	snapshot := map[string]any{"version": 1, "organization_id": f.organizationID, "session_id": f.sessionID, "provider_message_id": providerID,
		"inbox_event_key": eventKey, "processing_lane": lane, "processing_epoch": f.epoch, "routing_key": route, "ingress_sequence": sequence,
		"state": "lead_match", "target_mode": "snapshot", "conversation_id": f.privateID, "event_lead_id": f.leadID,
		"current_lead_id": nil, "active_binding_id": nil, "quarantine_reason": nil, "context_kind": "organic", "context_proof": nil,
		"unlinked_capture_policy": nil, "binding_eligible": false, "managed_message_distribution": false, "managed_event_pending": false, "managed_event_handled": false}
	payload["__vimob_ingress"] = map[string]any{"epoch_capable": true, "routing_key": route, "routing_snapshot": map[string]any{"version": 1, "messages": []map[string]any{snapshot}}}
	if _, err := tx.Exec(ctx, `insert into public.whatsapp_webhook_routing_snapshots
	 (organization_id,session_id,provider_message_id,inbox_event_key,processing_lane,routing_key,ingress_sequence,binding_eligible,target_mode,snapshot,processing_epoch)
	 values($1::uuid,$2::uuid,$3,$4,$5,$6,$7,false,'snapshot',$8::jsonb,$9)`, f.organizationID, f.sessionID, providerID, eventKey, lane, route, sequence, jsonb(snapshot), f.epoch); err != nil {
		t.Fatal(err)
	}
	var id string
	if err := tx.QueryRow(ctx, `insert into public.whatsapp_webhook_inbox
	 (organization_id,session_id,provider,event_key,event_type,payload,processing_epoch,processing_lane,status,next_attempt_at,provider_occurred_at)
	 values($1::uuid,$2::uuid,'evolution_go',$3,'message',$4::jsonb,$5,$6,'pending',now(),$7) returning id::text`, f.organizationID, f.sessionID, eventKey, jsonb(payload), f.epoch, lane, time.Now().UTC()).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestPrivateLegacyOutboundCapturesExternalEchoSilently(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	for _, epoch := range []int{0, 1} {
		lane := evolutionWebhookLaneLive
		if epoch == 1 {
			lane = evolutionWebhookLaneBacklog
		}
		t.Run(lane, func(t *testing.T) {
			repo, f := newPrivateCollisionFixture(t, ctx, db, "legacy-outbound-"+lane, false, epoch)
			repo.privateLegacyOutboundEnabled = true
			other := newWebhookDependencyFixture(t, ctx, db, "legacy-outbound-foreign")
			seedLegacyOutboundPrivateHistory(t, ctx, db, f)
			before := privateCollisionEffects(t, ctx, db, f)
			root := insertFrozenLegacyOutbound(t, ctx, repo, f, "root", lane)
			child := insertFrozenLegacyOutbound(t, ctx, repo, f, "child", lane)
			var payloadHash string
			if err := db.Pool().QueryRow(ctx, `select md5(payload::text) from public.whatsapp_webhook_inbox where id=$1::uuid`, root).Scan(&payloadHash); err != nil {
				t.Fatal(err)
			}
			processCaptureIsolationInbox(t, ctx, repo, root)
			processCaptureIsolationInbox(t, ctx, repo, child)
			var bodies, snapshots, outcomes, outbox int
			var intact, private, occupied bool
			if err := db.Pool().QueryRow(ctx, `select
			 (select count(*)::int from public.whatsapp_messages where organization_id=$1::uuid and conversation_id=$2::uuid
			  and lead_id is null and capture_state='unlinked_ephemeral' and from_me=true and direction='outbound' and status='sent'
			  and content='Synthetic external echo' and metadata#>>'{private_collision_route,kind}'=$3 and metadata->>'whatsapp_event_binding_is_current'='false'),
			 (select count(*)::int from public.whatsapp_webhook_routing_snapshots where organization_id=$1::uuid and binding_eligible=false and snapshot->>'state'='lead_match'),
			 (select count(*)::int from public.whatsapp_webhook_routing_outcomes where organization_id=$1::uuid),
			 (select count(*)::int from public.whatsapp_outbox where organization_id=$1::uuid),
			 (select md5(payload::text)=$5 from public.whatsapp_webhook_inbox where id=$4::uuid),
			 (select lead_id is null from public.whatsapp_conversations where id=$2::uuid),
			 (select lead_id=$6::uuid from public.whatsapp_conversations where id=$7::uuid)`, f.organizationID, f.privateID, nativePrivateLegacyOutboundMarker, root, payloadHash, f.leadID, f.conversationID).
				Scan(&bodies, &snapshots, &outcomes, &outbox, &intact, &private, &occupied); err != nil {
				t.Fatal(err)
			}
			if bodies != 2 || snapshots != 2 || outcomes != 0 || outbox != 0 || !intact || !private || !occupied {
				t.Fatalf("external echo bodies=%d snapshots=%d outcomes=%d outbox=%d raw=%t private=%t binding=%t", bodies, snapshots, outcomes, outbox, intact, private, occupied)
			}
			page, err := repo.ListMessages(ctx, f.tenant, f.privateID, MessageFilter{Limit: 20})
			if err != nil || len(page.Messages) != 3 {
				t.Fatalf("owner history count=%d error=%v", len(page.Messages), err)
			}
			if _, err := repo.ListMessages(ctx, other.tenant, f.privateID, MessageFilter{Limit: 20}); !errors.Is(err, ErrConversationNotFound) {
				t.Fatalf("foreign tenant read echo: %v", err)
			}
			repo.privateLegacyOutboundEnabled = false
			if _, err := db.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox set status='retry',next_attempt_at=now() where id=$1::uuid`, root); err != nil {
				t.Fatal(err)
			}
			processCaptureIsolationInbox(t, ctx, repo, root)
			if after := privateCollisionEffects(t, ctx, db, f); after != before {
				t.Fatalf("external observation changed operational effects: %v -> %v", before, after)
			}
		})
	}
}
