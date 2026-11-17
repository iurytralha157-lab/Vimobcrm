package whatsapp

import (
	"context"
	"testing"
)

func TestPrivateLegacyOutboundRejectsChangedScopeAndManagedSends(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	for _, state := range []string{"disabled", "wrong-recipient", "missing-recipient", "history-missing", "owner-other", "foreign-event-lead", "managed-provider", "managed-client", "managed-legacy", "managed-canonical"} {
		t.Run(state, func(t *testing.T) {
			repo, f := newPrivateCollisionFixture(t, ctx, db, "outbound-guard-"+state, false, 0)
			repo.privateLegacyOutboundEnabled = state != "disabled"
			if state != "history-missing" {
				seedLegacyOutboundPrivateHistory(t, ctx, db, f)
			}
			frozen := f
			if state == "owner-other" || state == "foreign-event-lead" {
				other := newWebhookDependencyFixture(t, ctx, db, "outbound-other-owner")
				if state == "foreign-event-lead" {
					frozen.leadID = other.leadID
				} else {
					if _, err := db.Pool().Exec(ctx, `insert into public.organization_members(organization_id,user_id,role,is_active)
					 values($1::uuid,$2::uuid,'admin',true);update public.whatsapp_sessions set owner_user_id=$2::uuid where id=$3::uuid`, f.organizationID, other.userID, f.sessionID); err != nil {
						t.Fatal(err)
					}
					t.Cleanup(func() {
						if _, err := db.Pool().Exec(context.Background(), `update public.whatsapp_sessions set owner_user_id=$2::uuid where id=$1::uuid`, f.sessionID, f.userID); err != nil {
							t.Error(err)
						}
					})
				}
			}
			root := insertFrozenLegacyOutbound(t, ctx, repo, frozen, "blocked", evolutionWebhookLaneLive)
			providerID := f.suffix + "-outbound-blocked"
			if state == "wrong-recipient" || state == "missing-recipient" {
				if _, err := db.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox set payload=case when $2='wrong-recipient'
				 then jsonb_set(payload,'{data,Info,RecipientAlt}','"5511980000102@s.whatsapp.net"'::jsonb)
				 else payload#-'{data,Info,RecipientAlt}' end where id=$1::uuid`, root, state); err != nil {
					t.Fatal(err)
				}
			}
			if state == "managed-provider" || state == "managed-client" || state == "managed-canonical" {
				var pending string
				pendingProvider := f.suffix + "-pending-origin"
				if state == "managed-canonical" {
					pendingProvider = providerID
				}
				if err := db.Pool().QueryRow(ctx, `insert into public.whatsapp_messages
				 (organization_id,session_id,conversation_id,provider_message_id,message_id,client_message_id,from_me,direction,status,message_type,capture_state)
				 values($1::uuid,$2::uuid,$3::uuid,$4,$4,$5,true,'outbound','pending','text','suppressed') returning id::text`,
					f.organizationID, f.sessionID, f.privateID, pendingProvider, f.suffix+"-pending-client").Scan(&pending); err != nil {
					t.Fatal(err)
				}
				if state != "managed-canonical" {
					outboxProvider, client := providerID, f.suffix+"-pending-client"
					if state == "managed-client" {
						outboxProvider, client = "", providerID
					}
					if _, err := db.Pool().Exec(ctx, `insert into public.whatsapp_outbox
					 (organization_id,session_id,conversation_id,message_id,client_message_id,recipient_jid,message_type,payload,provider_message_id,status)
					 values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,'text','{}'::jsonb,nullif($7,''),'pending')`,
						f.organizationID, f.sessionID, f.privateID, pending, client, f.privateJID, outboxProvider); err != nil {
						t.Fatal(err)
					}
				}
			} else if state == "managed-legacy" {
				if _, err := db.Pool().Exec(ctx, `insert into public.outbox_messages
				 (organization_id,session_id,conversation_id,content,status,sent_message_id)
				 values($1::uuid,$2::uuid,$3::uuid,'Synthetic managed echo','pending',$4)`, f.organizationID, f.sessionID, f.privateID, providerID); err != nil {
					t.Fatal(err)
				}
			}
			before := privateCollisionEffects(t, ctx, db, f)
			items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
			if err != nil || len(items) != 1 || items[0].ID != root {
				t.Fatalf("guarded echo claim count=%d error=%v", len(items), err)
			}
			if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
				t.Fatal(err)
			}
			if state == "wrong-recipient" {
				// A contradictory PN uses the existing audited identity quarantine.
				assertRouteClaimState(t, ctx, db.Pool(), root, "processed", 1)
				var quarantined bool
				if err := db.Pool().QueryRow(ctx, `select exists(select 1 from public.whatsapp_webhook_inbox inbox
				 join private.whatsapp_webhook_ignored_events ignored on ignored.organization_id=inbox.organization_id
				 and ignored.session_id=inbox.session_id and ignored.event_key=inbox.event_key
				 where inbox.id=$1::uuid and ignored.reason=$2 and inbox.payload#>>'{data,Message,conversation}'='Synthetic external echo')
				 and not exists(select 1 from public.whatsapp_messages where organization_id=$3::uuid and provider_message_id=$4)`, root, whatsappPNRouteConflictReason, f.organizationID, providerID).Scan(&quarantined); err != nil || !quarantined {
					t.Fatalf("wrong peer PN lost quarantine/raw preservation: proof=%t error=%v", quarantined, err)
				}
			} else {
				assertRouteClaimState(t, ctx, db.Pool(), root, "retry", 1)
			}
			var captured int
			if err := db.Pool().QueryRow(ctx, `select count(*)::int from public.whatsapp_messages
			 where organization_id=$1::uuid and metadata#>>'{private_collision_route,kind}'=$2`, f.organizationID, nativePrivateLegacyOutboundMarker).Scan(&captured); err != nil || captured != 0 {
				t.Fatalf("guarded echo captured=%d error=%v", captured, err)
			}
			if after := privateCollisionEffects(t, ctx, db, f); after != before {
				t.Fatalf("rejected echo changed effects: %v -> %v", before, after)
			}
		})
	}
}

func TestPrivateLegacyOutboundReaderKeepsDecisionAfterManualBinding(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	repo, f := newPrivateCollisionFixture(t, ctx, db, "outbound-manual-bind", false, 0)
	repo.privateLegacyOutboundEnabled = true
	seedLegacyOutboundPrivateHistory(t, ctx, db, f)
	root := insertFrozenLegacyOutbound(t, ctx, repo, f, "root", evolutionWebhookLaneLive)
	child := insertFrozenLegacyOutbound(t, ctx, repo, f, "child", evolutionWebhookLaneLive)
	processCaptureIsolationInbox(t, ctx, repo, root)
	var lead string
	if err := db.Pool().QueryRow(ctx, `insert into public.leads(organization_id,assigned_user_id,name,phone,source)
	 values($1::uuid,$2::uuid,'Synthetic manual outbound link','5511980000102','whatsapp') returning id::text`, f.organizationID, f.userID).Scan(&lead); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `select public.activate_whatsapp_conversation_lead_binding($1::uuid,$2::uuid,$3::uuid,null)`, f.organizationID, f.privateID, lead); err != nil {
		t.Fatal(err)
	}
	items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
	if err != nil || len(items) != 1 || items[0].ID != child {
		t.Fatalf("rebound echo claim count=%d error=%v", len(items), err)
	}
	if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
		t.Fatal(err)
	}
	assertRouteClaimState(t, ctx, db.Pool(), child, "retry", 1)
	repo.privateLegacyOutboundEnabled = false
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox set status='retry',next_attempt_at=now() where id=$1::uuid`, root); err != nil {
		t.Fatal(err)
	}
	processCaptureIsolationInbox(t, ctx, repo, root)
	var retained, childRows, leadRows int
	if err := db.Pool().QueryRow(ctx, `select
	 (select count(*)::int from public.whatsapp_messages where organization_id=$1::uuid and provider_message_id=$2 and lead_id is null and from_me and direction='outbound' and status='sent' and content='Synthetic external echo'),
	 (select count(*)::int from public.whatsapp_messages where organization_id=$1::uuid and provider_message_id=$3),
	 (select count(*)::int from public.whatsapp_messages where organization_id=$1::uuid and lead_id=$4::uuid)`, f.organizationID, f.suffix+"-outbound-root", f.suffix+"-outbound-child", lead).Scan(&retained, &childRows, &leadRows); err != nil {
		t.Fatal(err)
	}
	if retained != 1 || childRows != 0 || leadRows != 0 {
		t.Fatalf("manual bind changed observation: retained=%d child=%d lead=%d", retained, childRows, leadRows)
	}
}
