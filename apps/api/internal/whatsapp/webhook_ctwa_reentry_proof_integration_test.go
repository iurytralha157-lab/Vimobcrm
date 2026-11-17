package whatsapp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func insertFrozenCTWAReentry(t *testing.T, ctx context.Context, repo Repository, f sessionConversationLockFixture) string {
	t.Helper()
	now := time.Now().UTC()
	providerID, route := f.suffix+"-ctwa-proof", "phone:"+f.phone
	payload := map[string]any{"event": "message", "data": map[string]any{
		"Info": map[string]any{"ID": providerID, "Chat": f.remoteJID, "SenderPN": f.remoteJID, "Timestamp": now.Format(time.RFC3339Nano)},
		"Message": map[string]any{"extendedTextMessage": map[string]any{
			"text": "Synthetic CTWA reentry content",
			"contextInfo": map[string]any{"externalAdReply": map[string]any{
				"sourceType": "ad", "ctwaClid": "synthetic-new-click-20261117", "showAdAttribution": true,
			}},
		}},
	}}
	raw, _ := json.Marshal(payload)
	eventKey := evolutionWebhookEventKey(f.sessionID, raw)
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackWebhookTx(tx)
	var sequence int64
	var bindingID string
	if err := tx.QueryRow(ctx, `select nextval('public.whatsapp_webhook_routing_ingress_sequence'), id::text
		from public.whatsapp_conversation_lead_bindings
		where organization_id=$1::uuid and conversation_id=$2::uuid and active_to is null`, f.organizationID, f.conversationID).
		Scan(&sequence, &bindingID); err != nil {
		t.Fatal(err)
	}
	// Retained events already own this immutable intake decision. Admission's
	// current queue resolver must not replace that original target on replay.
	snapshot := map[string]any{
		"version": 1, "organization_id": f.organizationID, "session_id": f.sessionID, "provider_message_id": providerID,
		"inbox_event_key": eventKey, "processing_lane": "live", "processing_epoch": 1, "routing_key": route, "ingress_sequence": sequence,
		"state": "contextual_intake", "target_mode": "snapshot", "conversation_id": f.conversationID,
		"event_lead_id": f.leadID, "current_lead_id": f.leadID, "active_binding_id": bindingID,
		"context_kind": "contextual_intake", "context_proof": "canonical_intake_v1:evolution_ctwa_clid_v1",
		"binding_eligible": true, "managed_message_distribution": false, "managed_event_pending": false, "managed_event_handled": false,
	}
	payload["__vimob_ingress"] = map[string]any{"epoch_capable": true, "routing_key": route,
		"routing_snapshot": map[string]any{"version": 1, "messages": []map[string]any{snapshot}}}
	if _, err := tx.Exec(ctx, `insert into public.whatsapp_webhook_routing_snapshots
		(organization_id,session_id,provider_message_id,inbox_event_key,processing_lane,routing_key,ingress_sequence,binding_eligible,target_mode,snapshot,processing_epoch)
		values($1::uuid,$2::uuid,$3,$4,'live',$5,$6,true,'snapshot',$7::jsonb,1)`,
		f.organizationID, f.sessionID, providerID, eventKey, route, sequence, jsonb(snapshot)); err != nil {
		t.Fatal(err)
	}
	var id string
	if err := tx.QueryRow(ctx, `insert into public.whatsapp_webhook_inbox
		(organization_id,session_id,provider,event_key,event_type,payload,processing_epoch,processing_lane,status,next_attempt_at,provider_occurred_at)
		values($1::uuid,$2::uuid,'evolution_go',$3,'message',$4::jsonb,1,'live','pending',now(),$5) returning id::text`,
		f.organizationID, f.sessionID, eventKey, jsonb(payload), now).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestCTWAReentryPreservesInitialLeadCreationProof(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	for _, contract := range []string{"ctwa_ad_v1", "ctwa_ad_v2", ""} {
		t.Run(firstNonEmpty(contract, "unversioned"), func(t *testing.T) {
			f := newWebhookDependencyFixture(t, ctx, db, "ctwa-proof-reentry")
			other := newWebhookDependencyFixture(t, ctx, db, "ctwa-proof-other")
			repo := NewRepository(db, nil, StorageConfig{})
			configureCaptureIsolationFixture(t, ctx, repo, f)
			initialAttribution := map[string]any{
				"entry_point_conversion_source": "ctwa_ad",
				"source_referral":               map[string]any{"explicit_source_type": "ad", "entry_point_conversion_source": "ctwa_ad"},
			}
			initialMetadata := map[string]any{}
			if contract != "" {
				initialMetadata = map[string]any{
					"whatsapp_lead_creation_contract":    contract,
					"ctwa_confirmation_method":           "entry_point_ctwa_ad",
					"ctwa_ad_confirmed":                  true,
					"whatsapp_initial_provider_event_id": f.sessionID + ":synthetic-original-intake",
					"whatsapp_attribution":               initialAttribution,
				}
			}
			original := jsonb(initialMetadata)
			if _, err := db.Pool().Exec(ctx, `update public.leads set metadata=$3::jsonb
				where organization_id=$1::uuid and id=$2::uuid`, f.organizationID, f.leadID, original); err != nil {
				t.Fatal(err)
			}
			rootID := insertFrozenCTWAReentry(t, ctx, repo, f)
			items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
			if err != nil || len(items) != 1 || items[0].ID != rootID {
				t.Fatalf("frozen CTWA claim count=%d error=%v", len(items), err)
			}
			if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
				t.Fatal(err)
			}
			var status, lastError string
			if err := db.Pool().QueryRow(ctx, `select status,coalesce(last_error,'')
				from public.whatsapp_webhook_inbox where id=$1::uuid`, rootID).Scan(&status, &lastError); err != nil || status != "processed" {
				t.Fatalf("frozen CTWA replay status=%s processing_error=%s query_error=%v", status, lastError, err)
			}
			var metadataJSON, content, capture string
			var leadCount, entries, currentAttribution, foreignMessages int
			if err := db.Pool().QueryRow(ctx, `select lead.metadata::text, message.content, message.capture_state,
				(select count(*)::int from public.leads where organization_id=$1::uuid),
				(select count(*)::int from public.lead_entry_events where organization_id=$1::uuid
				 and provider_event_id='nonmanaged:'||$2::text||':'||$3),
				(select count(*)::int from public.lead_meta where organization_id=$1::uuid and lead_id=$4::uuid
				 and payload->>'ctwa_clid'='synthetic-new-click-20261117'),
				(select count(*)::int from public.whatsapp_messages where organization_id=$5::uuid)
				from public.whatsapp_messages message
				join public.leads lead on lead.organization_id=message.organization_id and lead.id=message.lead_id
				where message.organization_id=$1::uuid and message.session_id=$2::uuid and message.provider_message_id=$3`,
				f.organizationID, f.sessionID, f.suffix+"-ctwa-proof", f.leadID, other.organizationID).
				Scan(&metadataJSON, &content, &capture, &leadCount, &entries, &currentAttribution, &foreignMessages); err != nil {
				t.Fatal(err)
			}
			var stored map[string]any
			if err := json.Unmarshal([]byte(metadataJSON), &stored); err != nil {
				t.Fatal(err)
			}
			if contract != "" {
				for key, value := range initialMetadata {
					if jsonb(stored[key]) != jsonb(value) {
						t.Fatalf("CTWA reentry changed initial lead proof %s", key)
					}
				}
			} else if !strings.Contains(jsonb(stored["whatsapp_attribution"]), "synthetic-new-click-20261117") {
				t.Fatal("unversioned lead did not retain current CTWA attribution")
			}
			if leadCount != 1 || entries != 1 || currentAttribution != 1 || foreignMessages != 0 ||
				content != "Synthetic CTWA reentry content" || capture != "captured" {
				t.Fatalf("CTWA reentry effects leads=%d entries=%d currentAttribution=%d foreignMessages=%d content=%t capture=%s",
					leadCount, entries, currentAttribution, foreignMessages, content == "Synthetic CTWA reentry content", capture)
			}
		})
	}
}
