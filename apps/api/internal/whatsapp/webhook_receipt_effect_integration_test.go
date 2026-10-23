package whatsapp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestReceiptEffectsFutureDoesNotHoldKnownOrOtherMessageRoute(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "receipt-effects-future")
	repo := NewRepository(db, nil, StorageConfig{})
	if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
		t.Fatal(err)
	}
	known := createConfirmedReceiptFixture(t, ctx, repo, f, f.suffix+"-known")
	futureClient := f.suffix + "-future"
	future := deterministicProviderMessageID(futureClient)
	configureReceiptEffectFixture(t, ctx, repo, f)
	payload, _ := json.Marshal(map[string]any{"event": "receipt", "data": map[string]any{
		"MessageIDs": []string{future, known}, "status": "read", "timestamp": time.Now().UTC().Format(time.RFC3339Nano)}})
	envelope := receiptEffectFixtureEnvelope(f, payload)
	first, err := repo.AcceptEvolutionWebhook(ctx, envelope)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := repo.AcceptEvolutionWebhook(ctx, envelope)
	if err != nil || !replay.Duplicate || replay.ID != first.ID {
		t.Fatalf("effect callback replay=%+v/%v", replay, err)
	}
	var count, snapshots, outcomes int
	if err := db.Pool().QueryRow(ctx, `select count(*)::int from public.whatsapp_webhook_inbox where organization_id=$1::uuid`, f.organizationID).Scan(&count); err != nil || count != 2 {
		t.Fatalf("receipt effect cardinality=%d/%v, want exactly 2", count, err)
	}
	processOne := func(want string) {
		t.Helper()
		items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
		if err != nil || len(items) != 1 {
			t.Fatalf("effect claim=%d/%v", len(items), err)
		}
		if want != "" && items[0].ID != want {
			t.Fatalf("claimed unrelated target=%s want=%s", items[0].ID, want)
		}
		if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
			t.Fatal(err)
		}
	}
	processOne(first.ID) // Future target is retained in retry, without an ACK.
	processOne("")       // Known sibling progresses during the future backoff.
	assertReceiptFixtureState(t, ctx, repo, f, known, "read")
	other := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
		key: f.suffix + "-other-route", providerID: f.suffix + "-other-message", route: "jid:independent",
		lane: evolutionWebhookLaneLive, epoch: 1, age: time.Second,
	})
	items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
	if err != nil || len(items) != 1 || items[0].ID != other {
		t.Fatalf("future receipt blocked an unrelated message route: %d/%v", len(items), err)
	}
	// Release this synthetic selector probe; do not create a fabricated routing
	// outcome for a provider message that was never processed by the decoder.
	if _, err := db.Pool().Exec(ctx, `delete from public.whatsapp_webhook_inbox where id=$1::uuid and organization_id=$2::uuid`, other, f.organizationID); err != nil {
		t.Fatal(err)
	}
	createConfirmedReceiptFixture(t, ctx, repo, f, futureClient)
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox set next_attempt_at=now() where id=$1::uuid and status='retry'`, first.ID); err != nil {
		t.Fatal(err)
	}
	processOne(first.ID)
	assertReceiptFixtureState(t, ctx, repo, f, future, "read")
	if err := db.Pool().QueryRow(ctx, `select count(*)::int from public.whatsapp_webhook_routing_snapshots where organization_id=$1::uuid`, f.organizationID).Scan(&snapshots); err != nil {
		t.Fatal(err)
	}
	if err := db.Pool().QueryRow(ctx, `select count(*)::int from public.whatsapp_webhook_routing_outcomes where organization_id=$1::uuid`, f.organizationID).Scan(&outcomes); err != nil || snapshots != 1 || outcomes != 0 {
		// The selector probe above owns one genuine test snapshot. Receipts own
		// no snapshots and never manufacture completion outcomes for messages.
		t.Fatalf("receipt fabricated message provenance: snapshots=%d outcomes=%d/%v", snapshots, outcomes, err)
	}
}

func TestMixedReceiptSharedWorkerRetainsContentBeforeEitherExecutor(t *testing.T) {
	for _, mode := range []string{webhookProcessorNative, webhookProcessorEdge} {
		t.Run(mode, func(t *testing.T) {
			ctx, db := webhookDependencyDatabase(t)
			f := newWebhookDependencyFixture(t, ctx, db, "mixed-receipt-"+mode)
			repo := NewRepository(db, nil, StorageConfig{})
			configureReceiptEffectFixture(t, ctx, repo, f)
			if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
				t.Fatal(err)
			}
			known := createConfirmedReceiptFixture(t, ctx, repo, f, f.suffix+"-known")
			if mode == webhookProcessorEdge {
				// Epoch zero selects the legacy Edge executor; never remove a live
				// fence or alter another test's session to manufacture the proof.
				if _, err := db.Pool().Exec(ctx, `delete from private.whatsapp_webhook_session_cutovers where session_id=$1::uuid`, f.sessionID); err != nil {
					t.Fatal(err)
				}
			}
			var calls atomic.Int32
			edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"ok":true}`))
			}))
			defer edge.Close()
			repo.functions = functionsClient{db: db, apiKey: "synthetic-shared-receipt-key", evolutionWebhookURL: edge.URL,
				webhookProcessorMode: mode, webhookRolloutSessionIDs: []string{"*"}, httpClient: edge.Client()}
			fresh := f.suffix + "-retained-client-message"
			payload, _ := json.Marshal(map[string]any{"event": "receipt", "data": map[string]any{
				"MessageIDs": []string{known}, "status": "read", "timestamp": time.Now().UTC().Format(time.RFC3339Nano),
				"Info":    map[string]any{"ID": fresh, "Chat": f.remoteJID, "Timestamp": time.Now().Unix()},
				"Message": map[string]any{"conversation": "Synthetic client content retained"}}})
			accepted, err := repo.AcceptEvolutionWebhook(ctx, receiptEffectFixtureEnvelope(f, payload))
			if err != nil {
				t.Fatal(err)
			}
			var items []pendingEvolutionWebhook
			for _, lane := range []string{evolutionWebhookLaneLive, evolutionWebhookLaneBacklog} {
				items, _, err = repo.claimEvolutionWebhooksForLane(ctx, lane, 1, "")
				if err != nil {
					t.Fatal(err)
				}
				if len(items) > 0 {
					break
				}
			}
			if len(items) != 1 || items[0].ID != accepted.ID {
				t.Fatalf("mixed receipt claim=%d/%v", len(items), err)
			}
			if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
				t.Fatal(err)
			}
			assertReceiptFixtureState(t, ctx, repo, f, known, "sent")
			var status, raw string
			var messages, outcomes int
			if err := db.Pool().QueryRow(ctx, `select status,payload::text from public.whatsapp_webhook_inbox where id=$1::uuid`, accepted.ID).Scan(&status, &raw); err != nil {
				t.Fatal(err)
			}
			if err := db.Pool().QueryRow(ctx, `select (select count(*) from public.whatsapp_messages where organization_id=$1::uuid and provider_message_id=$2)::int,(select count(*) from public.whatsapp_webhook_routing_outcomes where organization_id=$1::uuid)::int`, f.organizationID, fresh).Scan(&messages, &outcomes); err != nil {
				t.Fatal(err)
			}
			if status != "retry" || calls.Load() != 0 || messages != 0 || outcomes != 0 || !json.Valid([]byte(raw)) || !strings.Contains(raw, "Synthetic client content retained") {
				t.Fatalf("mixed receipt escaped its fence: state=%s calls=%d messages=%d outcomes=%d", status, calls.Load(), messages, outcomes)
			}
		})
	}
}

func configureReceiptEffectFixture(t *testing.T, ctx context.Context, repo Repository, f sessionConversationLockFixture) {
	t.Helper()
	if _, err := repo.db.Pool().Exec(ctx, `update public.whatsapp_sessions set advanced_settings='{"token":"synthetic-effect-token","webhook_token":"synthetic-effect-hook"}'::jsonb where id=$1::uuid`, f.sessionID); err != nil {
		t.Fatal(err)
	}
}

func receiptEffectFixtureEnvelope(f sessionConversationLockFixture, payload []byte) evolutionWebhookEnvelope {
	return evolutionWebhookEnvelope{SessionID: f.sessionID, InstanceToken: "synthetic-effect-token", WebhookHeaderTokens: []string{"synthetic-effect-hook"}, EventType: "receipt", Payload: payload, ReceivedAt: time.Now().UTC()}
}

func TestReceiptEffectRollingReplicaCollisionNeverAddsPartialSiblings(t *testing.T) {
	for _, direction := range []string{"legacy_then_isolated", "isolated_then_legacy", "derived_collision"} {
		t.Run(direction, func(t *testing.T) {
			ctx, db := webhookDependencyDatabase(t)
			f := newWebhookDependencyFixture(t, ctx, db, direction)
			repo := NewRepository(db, nil, StorageConfig{})
			configureReceiptEffectFixture(t, ctx, repo, f)
			raw := []byte(`{"event":"receipt","data":{"MessageIDs":["FUTURE-A","FUTURE-B"],"status":"read"}}`)
			envelope := receiptEffectFixtureEnvelope(f, raw)
			envelope.EventKey = evolutionWebhookEventKey(f.sessionID, raw)
			insert := func(key string, payload []byte) {
				t.Helper()
				annotated, err := annotateEvolutionWebhookRouting(payload)
				if err != nil {
					t.Fatal(err)
				}
				parts, err := attachEvolutionWebhookRoutingSnapshots(ctx, nil, evolutionWebhookSession{OrganizationID: f.organizationID, ID: f.sessionID}, []evolutionWebhookDurablePart{{EventKey: key, Payload: annotated}}, 1, false)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := db.Pool().Exec(ctx, `insert into public.whatsapp_webhook_inbox(organization_id,session_id,provider,event_key,event_type,payload,processing_epoch,processing_lane) values($1::uuid,$2::uuid,'evolution_go',$3,'receipt',$4::jsonb,1,'backlog')`, f.organizationID, f.sessionID, key, string(parts[0].Payload)); err != nil {
					t.Fatal(err)
				}
			}
			switch direction {
			case "legacy_then_isolated":
				insert(envelope.EventKey, raw)
				if _, err := repo.AcceptEvolutionWebhook(ctx, envelope); err == nil {
					t.Fatal("changed decomposition must fail the provenance fence")
				}
			case "isolated_then_legacy":
				if _, err := repo.AcceptEvolutionWebhook(ctx, envelope); err != nil {
					t.Fatal(err)
				}
				// This is the older replica's first INSERT ON CONFLICT fence.
				result, err := db.Pool().Exec(ctx, `insert into public.whatsapp_webhook_inbox(organization_id,session_id,provider,event_key,event_type,payload,processing_epoch,processing_lane) select $1::uuid,$2::uuid,'evolution_go',$3,'receipt',payload,1,'backlog' from public.whatsapp_webhook_inbox where event_key=$3 on conflict(event_key) do nothing`, f.organizationID, f.sessionID, envelope.EventKey)
				if err != nil || result.RowsAffected() != 0 {
					t.Fatalf("old replica inserted a duplicate first part: %v", err)
				}
			case "derived_collision":
				parts, err := prepareEvolutionWebhookDurableParts(envelope)
				if err != nil || len(parts) != 2 {
					t.Fatal(err)
				}
				insert(parts[1].EventKey, raw)
				if _, err := repo.AcceptEvolutionWebhook(ctx, envelope); err == nil {
					t.Fatal("a colliding sibling must roll back the original INSERT")
				}
			}
			var count int
			if err := db.Pool().QueryRow(ctx, `select count(*)::int from public.whatsapp_webhook_inbox where organization_id=$1::uuid`, f.organizationID).Scan(&count); err != nil {
				t.Fatal(err)
			}
			want := 1
			if direction == "isolated_then_legacy" {
				want = 2
			}
			if count != want {
				t.Fatalf("mixed replicas left partial/duplicate parts: count=%d want=%d", count, want)
			}
		})
	}
}

func TestNativeNotificationReceiptRejectsAnotherSenderSession(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "notification-receipt-session")
	repo := NewRepository(db, nil, StorageConfig{})
	var otherSession, notificationID string
	if err := db.Pool().QueryRow(ctx, `insert into public.whatsapp_sessions(organization_id,instance_name,owner_user_id,provider,status) values($1::uuid,$2,$3::uuid,'evolution_go','connected') returning id::text`, f.organizationID, f.suffix+"-second", f.userID).Scan(&otherSession); err != nil {
		t.Fatal(err)
	}
	identity := f.suffix + "-notification-target"
	if err := db.Pool().QueryRow(ctx, `insert into public.notifications(organization_id,user_id,title,metadata) values($1::uuid,$2::uuid,'Synthetic receipt',jsonb_build_object('dispatch',jsonb_build_object('whatsapp',jsonb_build_object('status','sent','expected_message_id',$3::text,'session_id',$4::text)))) returning id::text`, f.organizationID, f.userID, identity, otherSession).Scan(&notificationID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := db.Pool().Exec(cleanup, `delete from public.notifications where id=$1::uuid`, notificationID); err != nil {
			t.Errorf("cleanup synthetic notification: %v", err)
		}
	})
	item := pendingEvolutionWebhook{OrganizationID: f.organizationID, SessionID: f.sessionID, EventType: "receipt"}
	statuses := []nativeEvolutionStatus{{MessageIDs: []string{identity}, Status: "read", OccurredAt: time.Now().UTC()}}
	if err := repo.processNativeEvolutionStatuses(ctx, item, statuses); err == nil {
		t.Fatal("a different sender session acknowledged the notification receipt")
	}
	var status string
	if err := db.Pool().QueryRow(ctx, `select metadata #>> '{dispatch,whatsapp,status}' from public.notifications where id=$1::uuid`, notificationID).Scan(&status); err != nil || status != "sent" {
		t.Fatalf("foreign-session notification changed: %s/%v", status, err)
	}
	item.SessionID = otherSession
	if err := repo.processNativeEvolutionStatuses(ctx, item, statuses); err != nil {
		t.Fatalf("the exact sender session failed reconciliation: %v", err)
	}
	if err := db.Pool().QueryRow(ctx, `select metadata #>> '{dispatch,whatsapp,status}' from public.notifications where id=$1::uuid`, notificationID).Scan(&status); err != nil || status != "delivered" {
		t.Fatalf("exact-session notification did not advance: %s/%v", status, err)
	}
}
