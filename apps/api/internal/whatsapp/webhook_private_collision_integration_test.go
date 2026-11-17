package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type privateCollisionFixture struct {
	sessionConversationLockFixture
	privateID  string
	privateJID string
	privatePN  string
	epoch      int
}

func newPrivateCollisionFixture(t *testing.T, ctx context.Context, db *dbpkg.Postgres, label string, distinctPN bool, epoch int) (Repository, privateCollisionFixture) {
	t.Helper()
	f := privateCollisionFixture{sessionConversationLockFixture: createSessionConversationLockFixture(t, ctx, db.Pool(), label), epoch: epoch}
	t.Cleanup(func() { cleanupSessionConversationLockFixture(t, db.Pool(), f.sessionConversationLockFixture) })
	if epoch == 1 {
		if _, err := db.Pool().Exec(ctx, `insert into private.whatsapp_webhook_session_cutovers(session_id,active_epoch,cutover_at)
		 values($1::uuid,1,now()-interval '10 minutes')`, f.sessionID); err != nil {
			t.Fatal(err)
		}
	}
	cleanupStoredPNBusiness(t, db, f.organizationID)
	f.privatePN = f.phone[:4] + f.phone[5:]
	if distinctPN {
		f.privatePN = "5511980000101"
		if _, err := db.Pool().Exec(ctx, `update public.leads set phone=$2 where id=$1::uuid`, f.leadID, f.privatePN); err != nil {
			t.Fatal(err)
		}
	}
	f.privateJID = f.privatePN + "@s.whatsapp.net"
	if err := db.Pool().QueryRow(ctx, `insert into public.whatsapp_conversations(organization_id,session_id,remote_jid,contact_phone,contact_name)
	 values($1::uuid,$2::uuid,$3,$4,'Synthetic private collision') returning id::text`, f.organizationID, f.sessionID, f.privateJID, f.privatePN).Scan(&f.privateID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_sessions
	 set advanced_settings='{"token":"synthetic-private-token","webhook_token":"synthetic-private-hook"}'::jsonb where id=$1::uuid`, f.sessionID); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(db, nil, StorageConfig{PrivateCollisionCaptureEnabled: true, LegacyNativeCompatEnabled: true})
	repo.functions.webhookProcessorMode = webhookProcessorNative
	repo.functions.webhookRolloutSessionIDs = []string{"*"}
	return repo, f
}

func acceptPrivateCollisionText(t *testing.T, ctx context.Context, repo Repository, f privateCollisionFixture, label, lane string) (evolutionWebhookReceipt, evolutionWebhookEnvelope) {
	t.Helper()
	now := time.Now().UTC()
	occurred := now
	if lane == evolutionWebhookLaneBacklog {
		occurred = now.Add(-time.Hour)
	}
	payload, err := json.Marshal(map[string]any{"event": "message", "data": map[string]any{
		"Info":    map[string]any{"ID": f.suffix + "-" + label, "Chat": f.privateJID, "SenderPN": f.privateJID, "IsFromMe": false, "Timestamp": occurred.Format(time.RFC3339Nano)},
		"Message": map[string]any{"conversation": "Synthetic private " + label},
	}})
	if err != nil {
		t.Fatal(err)
	}
	envelope := evolutionWebhookEnvelope{SessionID: f.sessionID, InstanceToken: "synthetic-private-token", WebhookHeaderTokens: []string{"synthetic-private-hook"}, EventType: "message", Payload: payload, ReceivedAt: now}
	// The retained production rows use the pre-v1 lead-match capture shape.
	// Admit that immutable shape as fixture data, then use the real worker.
	eventKey := evolutionWebhookEventKey(f.sessionID, payload)
	providerID, route := f.suffix+"-"+label, "phone:"+f.privatePN
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackWebhookTx(tx)
	var sequence int64
	if err := tx.QueryRow(ctx, `select nextval('public.whatsapp_webhook_routing_ingress_sequence')`).Scan(&sequence); err != nil {
		t.Fatal(err)
	}
	snapshot := map[string]any{
		"version": 1, "organization_id": f.organizationID, "session_id": f.sessionID, "provider_message_id": providerID,
		"inbox_event_key": eventKey, "processing_lane": lane, "processing_epoch": f.epoch, "routing_key": route, "ingress_sequence": sequence,
		"state": "lead_match", "target_mode": "snapshot", "conversation_id": f.privateID, "event_lead_id": f.leadID,
		"current_lead_id": nil, "active_binding_id": nil, "quarantine_reason": nil, "context_kind": "organic", "context_proof": nil,
		"unlinked_capture_policy": nil, "binding_eligible": true, "managed_message_distribution": false, "managed_event_pending": false, "managed_event_handled": false,
	}
	var predecessorID, predecessorKey, predecessorLane string
	err = tx.QueryRow(ctx, `select provider_message_id,inbox_event_key,processing_lane from public.whatsapp_webhook_routing_snapshots
	 where organization_id=$1::uuid and session_id=$2::uuid and processing_epoch=$4 and routing_key=$3
	 order by ingress_sequence desc limit 1`, f.organizationID, f.sessionID, route, f.epoch).Scan(&predecessorID, &predecessorKey, &predecessorLane)
	if err == nil {
		snapshot["state"], snapshot["target_mode"], snapshot["event_lead_id"] = "predecessor_inherit", "inherit_predecessor", nil
		snapshot["predecessor_provider_message_id"], snapshot["predecessor_inbox_event_key"], snapshot["predecessor_processing_lane"] = predecessorID, predecessorKey, predecessorLane
	} else if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatal(err)
	}
	encodedSnapshot, _ := json.Marshal(snapshot)
	var body map[string]any
	if err := json.Unmarshal(payload, &body); err != nil {
		t.Fatal(err)
	}
	body["__vimob_ingress"] = map[string]any{"epoch_capable": true, "routing_key": route,
		"routing_snapshot": map[string]any{"version": 1, "messages": []map[string]any{snapshot}}}
	encodedPayload, _ := json.Marshal(body)
	if _, err := tx.Exec(ctx, `insert into public.whatsapp_webhook_routing_snapshots
	 (organization_id,session_id,provider_message_id,inbox_event_key,processing_lane,routing_key,ingress_sequence,binding_eligible,target_mode,snapshot,processing_epoch,predecessor_provider_message_id)
	 values($1::uuid,$2::uuid,$3,$4,$5,$6,$7,true,$8,$9::jsonb,$10,nullif($11,''))`, f.organizationID, f.sessionID, providerID, eventKey, lane, route, sequence, snapshot["target_mode"], string(encodedSnapshot), f.epoch, predecessorID); err != nil {
		t.Fatal(err)
	}
	var receipt evolutionWebhookReceipt
	if err := tx.QueryRow(ctx, `insert into public.whatsapp_webhook_inbox(organization_id,session_id,provider,event_key,event_type,payload,processing_epoch,processing_lane,status,next_attempt_at,provider_occurred_at)
	 values($1::uuid,$2::uuid,'evolution_go',$3,'message',$4::jsonb,$7,$5,'pending',now(),$6) returning id::text`,
		f.organizationID, f.sessionID, eventKey, string(encodedPayload), lane, occurred, f.epoch).Scan(&receipt.ID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return receipt, envelope
}

func privateCollisionEffects(t *testing.T, ctx context.Context, db *dbpkg.Postgres, f privateCollisionFixture) [8]int {
	t.Helper()
	var result [8]int
	err := db.Pool().QueryRow(ctx, `select
	 (select count(*) from public.lead_entry_events where organization_id=$1::uuid),
	 (select count(*) from public.whatsapp_inbound_logs where organization_id=$1::uuid),
	 (select count(*) from public.automation_event_outbox where organization_id=$1::uuid),
	 (select count(*) from public.notifications where organization_id=$1::uuid),
	 (select count(*) from private.notification_deliveries where organization_id=$1::uuid),
	 (select count(*) from public.whatsapp_outbox where organization_id=$1::uuid),
	 (select count(*) from public.lead_action_facts where organization_id=$1::uuid),
	 (select sum(coalesce(unread_count,0))::int from public.whatsapp_conversations where organization_id=$1::uuid)`, f.organizationID).
		Scan(&result[0], &result[1], &result[2], &result[3], &result[4], &result[5], &result[6], &result[7])
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestPrivateCollisionCapturesRootSuccessorAndRetryOnFrozenRoute(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	for _, distinctPN := range []bool{false, true} {
		for _, lane := range []string{evolutionWebhookLaneLive, evolutionWebhookLaneBacklog} {
			label := lane + "-variant"
			epoch := 0
			if distinctPN {
				label = lane + "-distinct"
				epoch = 1
			}
			t.Run(label, func(t *testing.T) {
				repo, f := newPrivateCollisionFixture(t, ctx, db, label, distinctPN, epoch)
				root, original := acceptPrivateCollisionText(t, ctx, repo, f, "root", lane)
				child, _ := acceptPrivateCollisionText(t, ctx, repo, f, "child", lane)
				var snapshotHash string
				if err := db.Pool().QueryRow(ctx, `select md5(payload::text) from public.whatsapp_webhook_inbox where id=$1::uuid`, root.ID).Scan(&snapshotHash); err != nil {
					t.Fatal(err)
				}
				before := privateCollisionEffects(t, ctx, db, f)
				processCaptureIsolationInbox(t, ctx, repo, root.ID)
				repo.privateCollisionCaptureEnabled = false
				processCaptureIsolationInbox(t, ctx, repo, child.ID)
				if after := privateCollisionEffects(t, ctx, db, f); after != before {
					t.Fatalf("private recovery changed lead effects: %v -> %v", before, after)
				}
				var rows, privateRows, outcomes int
				var unchanged, oldBinding, sourcePrivate bool
				if err := db.Pool().QueryRow(ctx, `select
				 (select count(*) from public.whatsapp_messages where organization_id=$1::uuid),
				 (select count(*) from public.whatsapp_messages where organization_id=$1::uuid and conversation_id=$2::uuid
				  and lead_id is null and capture_state='unlinked_ephemeral' and content like 'Synthetic private %'
				  and metadata#>>'{private_collision_route,kind}'=$6),
				 (select count(*) from public.whatsapp_webhook_routing_outcomes where organization_id=$1::uuid),
				 (select md5(payload::text)=$5 from public.whatsapp_webhook_inbox where id=$4::uuid),
				 (select lead_id=$3::uuid from public.whatsapp_conversations where id=$7::uuid),
				 (select lead_id is null from public.whatsapp_conversations where id=$2::uuid)`,
					f.organizationID, f.privateID, f.leadID, root.ID, snapshotHash, nativePrivateCollisionMarker, f.conversationID).
					Scan(&rows, &privateRows, &outcomes, &unchanged, &oldBinding, &sourcePrivate); err != nil {
					t.Fatal(err)
				}
				if rows != 2 || privateRows != 2 || outcomes != 2 || !unchanged || !oldBinding || !sourcePrivate {
					t.Fatalf("private canonical result=%d/%d/%d/%v/%v/%v", rows, privateRows, outcomes, unchanged, oldBinding, sourcePrivate)
				}
				page, err := repo.ListMessages(ctx, f.tenant, f.privateID, MessageFilter{Limit: 20})
				if err != nil || len(page.Messages) != 2 {
					t.Fatalf("owner cannot read recovered body: %#v/%v", page, err)
				}
				duplicate, err := repo.AcceptEvolutionWebhook(ctx, original)
				if err != nil || !duplicate.Duplicate || duplicate.ID != root.ID {
					t.Fatalf("provider replay changed exact receipt: %#v/%v", duplicate, err)
				}
				if _, err := db.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox set status='retry',attempts=0,next_attempt_at=now() where id=$1::uuid`, root.ID); err != nil {
					t.Fatal(err)
				}
				processCaptureIsolationInbox(t, ctx, repo, root.ID)
				if after := privateCollisionEffects(t, ctx, db, f); after != before {
					t.Fatalf("exact retry created effects: %v -> %v", before, after)
				}
			})
		}
	}
}

func TestPrivateCollisionRequiresCanonicalEpochRouteAndProtectsVisibility(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	repo, f := newPrivateCollisionFixture(t, ctx, db, "private-proof", true, 1)
	other := newWebhookDependencyFixture(t, ctx, db, "private-foreign")
	root, _ := acceptPrivateCollisionText(t, ctx, repo, f, "root", evolutionWebhookLaneLive)
	items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
	if err != nil || len(items) != 1 || items[0].ID != root.ID {
		t.Fatalf("claim private proof: %#v/%v", items, err)
	}
	payload, err := decodeNativeEvolutionPayload(items[0].Payload)
	if err != nil {
		t.Fatal(err)
	}
	message := extractNativeEvolutionMessages(payload)[0]
	session := nativeEvolutionSession{ID: f.sessionID, OrganizationID: f.organizationID, OwnerUserID: f.userID, privateCollisionCaptureEnabled: true}
	snapshot, err := nativeIngressRoutingSnapshotForMessage(items[0].Payload, session, message)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"processing_epoch", "routing_key", "conversation_id"} {
		t.Run(field, func(t *testing.T) {
			changed := *snapshot
			var raw map[string]any
			if err := json.Unmarshal(snapshot.RawSnapshot, &raw); err != nil {
				t.Fatal(err)
			}
			raw[field] = "forged-proof"
			changed.RawSnapshot, _ = json.Marshal(raw)
			tx, err := db.Pool().Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer rollbackWebhookTx(tx)
			if _, handled, err := ensureNativePrivateCollisionConversation(ctx, tx, session, message, nativeEvolutionStoredMessageIdentity{}, &changed); err == nil || handled {
				t.Fatalf("forged %s was accepted: handled=%v error=%v", field, handled, err)
			}
		})
	}
	if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ListMessages(ctx, other.tenant, f.privateID, MessageFilter{Limit: 20}); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("another organization read private message: %v", err)
	}
	tx, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackWebhookTx(tx)
	if _, err := tx.Exec(ctx, `set local role authenticated`); err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `update public.whatsapp_messages set metadata=metadata||'{"private_collision_route":{"kind":"spoof"}}'::jsonb where organization_id=$1::uuid`, f.organizationID)
	var denied *pgconn.PgError
	if !errors.As(err, &denied) || denied.Code != "42501" {
		t.Fatalf("untrusted client can modify private routing evidence: %v", err)
	}
}

func TestPrivateCollisionInheritanceStopsAtManualBinding(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	repo, f := newPrivateCollisionFixture(t, ctx, db, "private-rebind", true, 1)
	root, _ := acceptPrivateCollisionText(t, ctx, repo, f, "root", evolutionWebhookLaneLive)
	child, _ := acceptPrivateCollisionText(t, ctx, repo, f, "child", evolutionWebhookLaneLive)
	processCaptureIsolationInbox(t, ctx, repo, root.ID)
	var newLead string
	if err := db.Pool().QueryRow(ctx, `insert into public.leads(organization_id,assigned_user_id,name,phone,source)
	 values($1::uuid,$2::uuid,'Synthetic newer lead','5511980000102','whatsapp') returning id::text`, f.organizationID, f.userID).Scan(&newLead); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `select public.activate_whatsapp_conversation_lead_binding($1::uuid,$2::uuid,$3::uuid,null)`, f.organizationID, f.privateID, newLead); err != nil {
		t.Fatal(err)
	}
	items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
	if err != nil || len(items) != 1 || items[0].ID != child.ID {
		t.Fatalf("claim private successor after rebind: %#v/%v", items, err)
	}
	if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
		t.Fatal(err)
	}
	assertRouteClaimState(t, ctx, db.Pool(), child.ID, "retry", 1)
	var leaked int
	if err := db.Pool().QueryRow(ctx, `select count(*) from public.whatsapp_messages where organization_id=$1::uuid and lead_id=$2::uuid`, f.organizationID, newLead).Scan(&leaked); err != nil || leaked != 0 {
		t.Fatalf("old inherited event crossed a manual binding: count=%d error=%v", leaked, err)
	}
	var privateBody string
	if err := db.Pool().QueryRow(ctx, `select content from public.whatsapp_messages where organization_id=$1::uuid and provider_message_id=$2`, f.organizationID, f.suffix+"-root").Scan(&privateBody); err != nil || privateBody == "" {
		t.Fatalf("rebind erased captured original body: %q/%v", privateBody, err)
	}
}
