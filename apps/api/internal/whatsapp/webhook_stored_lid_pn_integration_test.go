package whatsapp

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

// A previously bound physical LID is valid legacy state. Its persisted PN must
// remain identity evidence even when a new callback supplies a different PN.
// These fixtures use the existing opt-in loopback-only database guard.
func TestStoredLIDPNAdmissionRejectsPersistedIdentityConflict(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	for _, attended := range []bool{false, true} {
		name := "unattended"
		if attended {
			name = "captured"
		}
		t.Run(name, func(t *testing.T) {
			f := newWebhookDependencyFixture(t, ctx, db, "stored-lid-"+name)
			t.Cleanup(func() {
				cleanup, cancel := context.WithTimeout(context.Background(), 8*time.Second)
				defer cancel()
				for _, sql := range []string{
					`delete from public.whatsapp_inbound_logs where organization_id=$1::uuid`,
					`delete from private.realtime_events where organization_id=$1::uuid`,
					`delete from private.notification_deliveries where organization_id=$1::uuid`,
					`delete from public.notifications where organization_id=$1::uuid`,
					`delete from public.whatsapp_messages where organization_id=$1::uuid`,
				} {
					if _, err := db.Pool().Exec(cleanup, sql, f.organizationID); err != nil {
						t.Error(err)
					}
				}
			})
			repo := NewRepository(db, nil, StorageConfig{})
			repo.functions.webhookProcessorMode = webhookProcessorNative
			if attended {
				if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID,
					attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
					t.Fatal(err)
				}
			}
			const lid = "777777777000001@lid"
			const newPN = "5511988881111@s.whatsapp.net"
			if _, err := db.Pool().Exec(ctx, `
				update public.whatsapp_sessions set advanced_settings='{"token":"synthetic-stored-pn","webhook_token":"synthetic-stored-hook"}'::jsonb where id=$1::uuid;
				update public.whatsapp_conversations set remote_jid=$3 where id=$2::uuid;
				insert into public.whatsapp_contact_identity_aliases(organization_id,session_id,alias_jid,canonical_jid,contact_phone)
				values($4::uuid,$1::uuid,$5,$3,$6)
				on conflict(organization_id,session_id,alias_jid) do update set canonical_jid=excluded.canonical_jid`, f.sessionID, f.conversationID, lid, f.organizationID, f.remoteJID, normalizeDigits(f.remoteJID)); err != nil {
				t.Fatal(err)
			}
			var historicalID string
			historicalPath := f.organizationID + "/" + f.sessionID + "/synthetic-history.txt"
			if err := db.Pool().QueryRow(ctx, `insert into public.whatsapp_messages(
				organization_id,session_id,conversation_id,lead_id,message_id,provider_message_id,
				remote_jid,from_me,direction,status,message_type,content,capture_state,media_storage_path)
				values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$5,$6,false,'inbound','received','document',
				'preserved historical content','captured',$7) returning id::text`,
				f.organizationID, f.sessionID, f.conversationID, f.leadID, f.suffix+"-history", lid, historicalPath).Scan(&historicalID); err != nil {
				t.Fatal(err)
			}
			before := contactPNBusinessCounts(t, ctx, db.Pool(), f.organizationID)
			badID := f.suffix + "-conflicting"
			payload, _ := json.Marshal(map[string]any{"event": "message", "data": map[string]any{
				"Info": map[string]any{"ID": badID, "Chat": lid, "SenderPN": newPN,
					"Timestamp": time.Now().UTC().Format(time.RFC3339Nano)},
				"Message": map[string]any{"conversation": "must never enter the existing card"},
			}})
			receipt, err := repo.AcceptEvolutionWebhook(ctx, evolutionWebhookEnvelope{SessionID: f.sessionID,
				InstanceToken: "synthetic-stored-pn", WebhookHeaderTokens: []string{"synthetic-stored-hook"},
				EventType: "message", Payload: payload, ReceivedAt: time.Now().UTC()})
			if err != nil {
				t.Fatal(err)
			}
			items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
			if err != nil || len(items) != 1 || items[0].ID != receipt.ID {
				t.Fatalf("durable conflict claim=%d/%v", len(items), err)
			}
			if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
				t.Fatal(err)
			}
			var messages, aliases, snapshots, outcomes int
			var capture, reason, raw string
			if err := db.Pool().QueryRow(ctx, `select
				(select count(*) from public.whatsapp_messages where organization_id=$1::uuid and provider_message_id=$3),
				(select coalesce(max(capture_state),'') from public.whatsapp_messages where organization_id=$1::uuid and provider_message_id=$3),
				(select count(*) from public.whatsapp_contact_identity_aliases where organization_id=$1::uuid and alias_jid=$4),
				(select count(*) from public.whatsapp_webhook_routing_snapshots where organization_id=$1::uuid and provider_message_id=$3),
				(select count(*) from public.whatsapp_webhook_routing_outcomes where organization_id=$1::uuid and provider_message_id=$3),
				coalesce(payload#>>'{__vimob_ingress,identity_quarantine_reason}',''),payload#>>'{data,Message,conversation}'
				from public.whatsapp_webhook_inbox where id=$2::uuid`, f.organizationID, receipt.ID, badID, newPN).
				Scan(&messages, &capture, &aliases, &snapshots, &outcomes, &reason, &raw); err != nil {
				t.Fatal(err)
			}
			if messages != 0 || aliases != 0 || snapshots != 0 || outcomes != 0 || reason != whatsappPNRouteConflictReason || raw == "" {
				t.Fatalf("persisted LID PN was ignored: messages=%d capture=%s aliases=%d snapshots=%d outcomes=%d reason=%s rawRetained=%t",
					messages, capture, aliases, snapshots, outcomes, reason, raw != "")
			}
			if after := contactPNBusinessCounts(t, ctx, db.Pool(), f.organizationID); after != before {
				t.Fatalf("conflict changed business state: before=%v after=%v", before, after)
			}
			var historicalContent, historicalLead, path string
			if err := db.Pool().QueryRow(ctx, `select content,lead_id::text,media_storage_path from public.whatsapp_messages
				where id=$1::uuid and organization_id=$2::uuid and session_id=$3::uuid and capture_state='captured'`,
				historicalID, f.organizationID, f.sessionID).Scan(&historicalContent, &historicalLead, &path); err != nil ||
				historicalContent != "preserved historical content" || historicalLead != f.leadID || path != historicalPath {
				t.Fatalf("immutable historical lead/content/media changed: %v", err)
			}
		})
	}
}
