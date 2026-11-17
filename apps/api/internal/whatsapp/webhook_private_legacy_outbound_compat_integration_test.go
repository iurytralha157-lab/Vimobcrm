package whatsapp

import (
	"errors"
	"fmt"
	"testing"
)

func TestPrivateLegacyOutboundPreservesOrdinaryCanonicalReplay(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	for _, enabled := range []bool{false, true} {
		for _, managed := range []bool{false, true} {
			t.Run(fmt.Sprintf("enabled-%t-managed-%t", enabled, managed), func(t *testing.T) {
				repo, f := newPrivateCollisionFixture(t, ctx, db, "outbound-ordinary", false, 0)
				repo.privateLegacyOutboundEnabled = enabled
				other := newWebhookDependencyFixture(t, ctx, db, "outbound-ordinary-foreign")
				frozen := f
				frozen.privateID, frozen.privateJID, frozen.privatePN = f.conversationID, f.remoteJID, f.phone
				root := insertFrozenLegacyOutbound(t, ctx, repo, frozen, "ordinary", evolutionWebhookLaneLive)
				if _, err := db.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox
				 set payload=jsonb_set(payload,'{data,metadata}',jsonb_build_object('private_collision_route',jsonb_build_object('kind',$2::text)))
				 where id=$1::uuid`, root, nativePrivateLegacyOutboundMarker); err != nil {
					t.Fatal(err)
				}
				providerID, clientID := f.suffix+"-outbound-ordinary", f.suffix+"-ordinary-client"
				var canonicalID string
				if err := db.Pool().QueryRow(ctx, `insert into public.whatsapp_messages
				 (organization_id,session_id,conversation_id,lead_id,message_id,provider_message_id,client_message_id,
				  content,remote_jid,from_me,direction,status,capture_state,metadata)
				 values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$5,$6,'Synthetic original canonical',$7,
				 true,'outbound','sent','captured','{"ordinary_legacy":true}'::jsonb) returning id::text`,
					f.organizationID, f.sessionID, f.conversationID, f.leadID, providerID, clientID, f.remoteJID).Scan(&canonicalID); err != nil {
					t.Fatal(err)
				}
				if managed {
					if _, err := db.Pool().Exec(ctx, `insert into public.whatsapp_outbox
					 (organization_id,session_id,conversation_id,message_id,client_message_id,recipient_jid,message_type,payload,
					 provider_message_id,status,attempts,locked_at,locked_by)
					 values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,'text','{}'::jsonb,$7,'processing',1,now(),'synthetic-worker')`,
						f.organizationID, f.sessionID, f.conversationID, canonicalID, clientID, f.remoteJID, providerID); err != nil {
						t.Fatal(err)
					}
				}
				before := privateCollisionEffects(t, ctx, db, f)
				processCaptureIsolationInbox(t, ctx, repo, root)
				var canonical, reconciled bool
				if err := db.Pool().QueryRow(ctx, `select
				 exists(select 1 from public.whatsapp_messages where id=$1::uuid and organization_id=$2::uuid
				  and session_id=$3::uuid and conversation_id=$4::uuid and lead_id=$5::uuid and provider_message_id=$6
				  and from_me and direction='outbound' and status='sent' and capture_state='captured'
				  and content='Synthetic original canonical' and metadata->>'ordinary_legacy'='true'
				  and not (metadata ? 'private_collision_route')),
				 not $7::boolean or exists(select 1 from public.whatsapp_outbox where organization_id=$2::uuid
				  and session_id=$3::uuid and message_id=$1::uuid and provider_message_id=$6 and status='sent')`,
					canonicalID, f.organizationID, f.sessionID, f.conversationID, f.leadID, providerID, managed).Scan(&canonical, &reconciled); err != nil || !canonical || !reconciled {
					t.Fatalf("ordinary replay canonical=%t reconciled=%t error=%v", canonical, reconciled, err)
				}
				if after := privateCollisionEffects(t, ctx, db, f); after != before {
					t.Fatalf("ordinary replay repeated operational effects: %v -> %v", before, after)
				}
				if _, err := repo.ListMessages(ctx, other.tenant, f.conversationID, MessageFilter{Limit: 20}); !errors.Is(err, ErrConversationNotFound) {
					t.Fatalf("foreign tenant read ordinary canonical: %v", err)
				}
			})
		}
	}
}

func TestPrivateLegacyOutboundMarkedReaderRejectsInvalidProof(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	for _, state := range []string{"snapshot-hash", "scrubbed", "invalid-envelope", "foreign-scope"} {
		t.Run(state, func(t *testing.T) {
			repo, f := newPrivateCollisionFixture(t, ctx, db, "outbound-reader-"+state, false, 0)
			repo.privateLegacyOutboundEnabled = true
			seedLegacyOutboundPrivateHistory(t, ctx, db, f)
			root := insertFrozenLegacyOutbound(t, ctx, repo, f, "root", evolutionWebhookLaneLive)
			processCaptureIsolationInbox(t, ctx, repo, root)
			repo.privateLegacyOutboundEnabled = false
			providerID := f.suffix + "-outbound-root"
			if state == "snapshot-hash" {
				if _, err := db.Pool().Exec(ctx, `update public.whatsapp_messages
				 set metadata=jsonb_set(metadata,'{private_collision_route,snapshot_md5}','"invalid"'::jsonb)
				 where organization_id=$1::uuid and session_id=$2::uuid and provider_message_id=$3`, f.organizationID, f.sessionID, providerID); err != nil {
					t.Fatal(err)
				}
			} else if state == "scrubbed" {
				if _, err := db.Pool().Exec(ctx, `update public.whatsapp_messages
				 set content=null,unlinked_retention_scrubbed_at=now()
				 where organization_id=$1::uuid and session_id=$2::uuid and provider_message_id=$3`, f.organizationID, f.sessionID, providerID); err != nil {
					t.Fatal(err)
				}
			}
			before := privateCollisionEffects(t, ctx, db, f)
			if state == "invalid-envelope" || state == "foreign-scope" {
				tx, err := db.Pool().Begin(ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer rollbackWebhookTx(tx)
				var payload []byte
				if err := tx.QueryRow(ctx, `select payload from public.whatsapp_webhook_inbox where id=$1::uuid`, root).Scan(&payload); err != nil {
					t.Fatal(err)
				}
				decoded, err := decodeNativeEvolutionPayload(payload)
				if err != nil {
					t.Fatal(err)
				}
				message := extractNativeEvolutionMessages(decoded)[0]
				session := nativeEvolutionSession{ID: f.sessionID, OrganizationID: f.organizationID, OwnerUserID: f.userID}
				snapshot, err := nativeIngressRoutingSnapshotForMessage(payload, session, message)
				if err != nil {
					t.Fatal(err)
				}
				stored, err := findNativeEvolutionStoredMessageIdentity(ctx, tx, session, message)
				if err != nil || stored.ID == "" || stored.PrivateCollisionKind != nativePrivateLegacyOutboundMarker {
					t.Fatalf("marked canonical missing: %v", err)
				}
				if state == "invalid-envelope" {
					message.FromMe = false
				} else {
					other := newWebhookDependencyFixture(t, ctx, db, "outbound-reader-foreign")
					session.OrganizationID, session.ID, session.OwnerUserID = other.organizationID, other.sessionID, other.userID
				}
				if _, handled, err := ensureNativePrivateLegacyOutboundConversation(ctx, tx, session, message, stored, snapshot); handled || !errors.Is(err, ErrConversationBindingChanged) {
					t.Fatalf("invalid marked reader handled=%t error=%v", handled, err)
				}
				if err := tx.Rollback(ctx); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := db.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox set status='retry',next_attempt_at=now() where id=$1::uuid`, root); err != nil {
					t.Fatal(err)
				}
				items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
				if err != nil || len(items) != 1 || items[0].ID != root {
					t.Fatalf("marked reader claim count=%d error=%v", len(items), err)
				}
				if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
					t.Fatal(err)
				}
				assertRouteClaimState(t, ctx, db.Pool(), root, "retry", items[0].Attempts)
			}
			var preserved bool
			if err := db.Pool().QueryRow(ctx, `select lead_id is null and capture_state='unlinked_ephemeral'
			 and from_me and direction='outbound' and case when $4='scrubbed'
			 then content is null and unlinked_retention_scrubbed_at is not null else content='Synthetic external echo' end
			 from public.whatsapp_messages where organization_id=$1::uuid and session_id=$2::uuid and provider_message_id=$3`,
				f.organizationID, f.sessionID, providerID, state).Scan(&preserved); err != nil || !preserved {
				t.Fatalf("invalid reader changed canonical: preserved=%t error=%v", preserved, err)
			}
			if after := privateCollisionEffects(t, ctx, db, f); after != before {
				t.Fatalf("invalid reader changed operational effects: %v -> %v", before, after)
			}
		})
	}
}
