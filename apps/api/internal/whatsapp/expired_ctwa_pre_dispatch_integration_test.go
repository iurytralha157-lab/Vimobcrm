package whatsapp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestExpiredCTWAPreDispatchFailsClosedWithRecentSuccessor(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if target.Scheme != "postgres" && target.Scheme != "postgresql" {
		t.Fatal("WHATSAPP_TEST_DATABASE_URL must be a PostgreSQL URL")
	}
	switch strings.ToLower(target.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
	default:
		t.Fatalf("WHATSAPP_TEST_DATABASE_URL must use a disposable loopback database, got %q", target.Hostname())
	}

	for _, scenario := range []struct {
		name                   string
		mode                   string
		mixed                  bool
		missingVersion         bool
		priorAttempt           bool
		staleGoClock           bool
		freshDatabase          bool
		generalPolicy          bool
		noSuccessor            bool
		twoSuccessors          bool
		successorMixed         bool
		oldReplyMixed          bool
		activate               bool
		successorCTWA          bool
		purgeAfter             bool
		downgrade              bool
		unmaterialized         string
		parserDrift            bool
		lidPN                  bool
		staleSecondPredecessor bool
		secondMedia            bool
		secondCTWA             bool
		gcSettle               bool
		concurrentClaims       bool
	}{
		{name: "edge", mode: webhookProcessorEdge},
		{name: "native", mode: webhookProcessorNative},
		{name: "edge-two-successors", mode: webhookProcessorEdge, twoSuccessors: true},
		{name: "successor-mixed-fail-closed", mode: webhookProcessorEdge, successorMixed: true},
		{name: "edge-no-successor", mode: webhookProcessorEdge, noSuccessor: true},
		{name: "native-no-successor", mode: webhookProcessorNative, noSuccessor: true},
		{name: "general-policy-delegates-to-native", mode: webhookProcessorNative, generalPolicy: true},
		{name: "database-expired-go-clock-behind", mode: webhookProcessorEdge, staleGoClock: true, noSuccessor: true},
		{name: "database-fresh-go-clock-ahead", mode: webhookProcessorEdge, freshDatabase: true, noSuccessor: true},
		{name: "fresh-mixed-keeps-normal-dispatch", mode: webhookProcessorEdge, freshDatabase: true, mixed: true},
		{name: "mixed-fail-closed", mode: webhookProcessorEdge, mixed: true, noSuccessor: true},
		{name: "old-reply-mixed-fail-closed", mode: webhookProcessorEdge, oldReplyMixed: true, noSuccessor: true},
		{name: "null-version-fail-closed", mode: webhookProcessorEdge, missingVersion: true, noSuccessor: true},
		{name: "prior-attempt-fail-closed", mode: webhookProcessorEdge, priorAttempt: true, noSuccessor: true},
		{name: "activated-native-preserves-recent", mode: webhookProcessorNative, activate: true},
		{name: "activated-edge-forces-native", mode: webhookProcessorEdge, activate: true},
		{name: "activated-two-recent-successors", mode: webhookProcessorNative, activate: true, twoSuccessors: true},
		{name: "activated-mixed-successor-fails-closed", mode: webhookProcessorNative, activate: true, successorMixed: true},
		{name: "activated-independent-new-ctwa", mode: webhookProcessorNative, activate: true, successorCTWA: true},
		{name: "activated-independent-new-ctwa-gc-settles", mode: webhookProcessorNative, activate: true, successorCTWA: true, gcSettle: true},
		{name: "activated-new-ctwa-then-organic-keeps-content", mode: webhookProcessorNative, activate: true, successorCTWA: true, twoSuccessors: true},
		{name: "activated-new-ctwa-then-stale-organic-proof-keeps-content", mode: webhookProcessorNative, activate: true, successorCTWA: true, twoSuccessors: true, staleSecondPredecessor: true},
		{name: "activated-new-ctwa-then-stale-organic-media-keeps-content", mode: webhookProcessorNative, activate: true, successorCTWA: true, twoSuccessors: true, staleSecondPredecessor: true, secondMedia: true},
		{name: "activated-organic-purges-after-seven-days", mode: webhookProcessorNative, activate: true, purgeAfter: true},
		{name: "activated-old-binary-fenced", mode: webhookProcessorNative, activate: true, downgrade: true},
		{name: "activated-unmaterialized-pending-purges", mode: webhookProcessorNative, activate: true, unmaterialized: "pending"},
		{name: "activated-unmaterialized-processing-purges", mode: webhookProcessorNative, activate: true, unmaterialized: "processing"},
		{name: "activated-unmaterialized-retry-fails-closed", mode: webhookProcessorNative, activate: true, unmaterialized: "retry"},
		{name: "activated-unmaterialized-new-generation-preserved", mode: webhookProcessorNative, activate: true, unmaterialized: "new-generation"},
		{name: "historical-ctwa-parser-drift-fails-closed", mode: webhookProcessorNative, noSuccessor: true, parserDrift: true},
		{name: "activated-lid-pn-two-successors", mode: webhookProcessorNative, activate: true, twoSuccessors: true, lidPN: true, purgeAfter: true},
		{name: "activated-lid-pn-two-replicas-claim-once", mode: webhookProcessorNative, activate: true, twoSuccessors: true, lidPN: true, concurrentClaims: true},
		{name: "activated-organic-then-ctwa-preserves-history", mode: webhookProcessorNative, activate: true, twoSuccessors: true, lidPN: true, secondCTWA: true},
		{name: "activated-organic-then-ctwa-gc-settles", mode: webhookProcessorNative, activate: true, twoSuccessors: true, lidPN: true, secondCTWA: true, gcSettle: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(postgres.Close)
			var functionExists bool
			if err := postgres.Pool().QueryRow(ctx, `
				select to_regprocedure('private.complete_expired_ctwa_webhook_route(uuid,text,text,text)') is not null
			`).Scan(&functionExists); err != nil || !functionExists {
				t.Fatalf("disposable database needs expired CTWA migration: installed=%v error=%v", functionExists, err)
			}

			suffix := fmt.Sprintf("expired-ctwa-%d", time.Now().UnixNano())
			segment := randomHex(4)
			sessionID := fmt.Sprintf("ffffffff-ffff-4fff-8fff-%s0001", segment)
			var orgID, userID string
			if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text, gen_random_uuid()::text`).Scan(&orgID, &userID); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cleanupCancel()
				if scenario.generalPolicy {
					// The production one-way trigger correctly forbids deleting an
					// active retention policy. This disposable fixture must remove
					// only its own policy before the session FK cascade runs.
					tx, err := postgres.Pool().Begin(cleanupCtx)
					if err != nil {
						t.Errorf("begin local policy cleanup: %v", err)
						return
					}
					defer tx.Rollback(cleanupCtx)
					if _, err := tx.Exec(cleanupCtx, `set local session_replication_role = replica`); err != nil {
						t.Errorf("scope local policy cleanup: %v", err)
						return
					}
					if _, err := tx.Exec(cleanupCtx, `
						delete from private.whatsapp_nonlead_retention_sessions
						where organization_id = $1::uuid and session_id = $2::uuid
					`, orgID, sessionID); err != nil {
						t.Errorf("remove local policy fixture: %v", err)
						return
					}
					if err := tx.Commit(cleanupCtx); err != nil {
						t.Errorf("commit local policy cleanup: %v", err)
						return
					}
				}
				for _, removal := range []struct {
					sql  string
					args []any
				}{
					{`delete from public.whatsapp_attendance_entries where organization_id = $1::uuid`, []any{orgID}},
					{`delete from public.whatsapp_conversations where organization_id = $1::uuid and session_id = $2::uuid`, []any{orgID, sessionID}},
					{`delete from public.whatsapp_sessions where id = $1::uuid and organization_id = $2::uuid`, []any{sessionID, orgID}},
					{`delete from public.leads where organization_id = $1::uuid`, []any{orgID}},
					{`delete from public.users where id = $1::uuid and organization_id = $2::uuid`, []any{userID, orgID}},
					{`delete from auth.users where id = $1::uuid`, []any{userID}},
					{`delete from public.organizations where id = $1::uuid`, []any{orgID}},
				} {
					if _, err := postgres.Pool().Exec(cleanupCtx, removal.sql, removal.args...); err != nil {
						t.Errorf("clean local expired CTWA fixture: %v", err)
					}
				}
			})
			for _, insertion := range []struct {
				sql  string
				args []any
			}{
				{`insert into public.organizations (id, name, slug) values ($1::uuid, $2, $2)`, []any{orgID, suffix}},
				{`insert into auth.users (
					id, aud, role, email, encrypted_password, email_confirmed_at,
					raw_app_meta_data, raw_user_meta_data, created_at, updated_at
				) values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(),
					'{}'::jsonb, '{}'::jsonb, now(), now())`, []any{userID, suffix + "@example.invalid"}},
				{`update public.users set organization_id = $2::uuid, name = $3,
					email = $4, role = 'user', is_active = true where id = $1::uuid`,
					[]any{userID, orgID, suffix, suffix + "@example.invalid"}},
				{`insert into public.whatsapp_sessions (
					id, organization_id, owner_user_id, instance_name, instance_id,
					provider, status, is_active, advanced_settings
				) values ($1::uuid, $2::uuid, $3::uuid, $4, $4,
					'evolution_go', 'connected', true, jsonb_build_object('token', 'expired-ctwa-test-token'))`,
					[]any{sessionID, orgID, userID, suffix}},
			} {
				if _, err := postgres.Pool().Exec(ctx, insertion.sql, insertion.args...); err != nil {
					t.Fatal(err)
				}
			}
			if err := postgres.Pool().QueryRow(ctx, `select private.activate_whatsapp_webhook_session_cutover($1::uuid)`, sessionID).Scan(new(time.Time)); err != nil {
				t.Fatal(err)
			}
			// Simulate a session cut over ten days ago; all writes remain local.
			if _, err := postgres.Pool().Exec(ctx, `
				update private.whatsapp_webhook_session_cutovers
				set cutoff_at = now() - interval '10 days'
				where session_id = $1::uuid
			`, sessionID); err != nil {
				t.Fatal(err)
			}

			var edgeCalls atomic.Int32
			edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				edgeCalls.Add(1)
				w.WriteHeader(http.StatusInternalServerError)
			}))
			t.Cleanup(edge.Close)
			repo := NewRepository(postgres, nil, StorageConfig{})
			repo.functions.webhookProcessorMode = scenario.mode
			repo.functions.webhookRolloutSessionIDs = []string{sessionID}
			repo.functions.inboundRecordingSessionIDs = []string{sessionID}
			repo.functions.evolutionWebhookURL = edge.URL
			repo.functions.apiKey = "local-test-only"

			phone := "5511999991111@s.whatsapp.net"
			if scenario.lidPN {
				phone = "123456789012345@lid"
			}
			oldProviderID := suffix + "-ctwa"
			buildEnvelope := func(providerID, text string, when time.Time, ctwa bool) evolutionWebhookEnvelope {
				senderPN := phone
				if scenario.lidPN {
					senderPN = "5511999991111@s.whatsapp.net"
					if strings.HasSuffix(providerID, "-recent") {
						senderPN = ""
					}
				}
				message := map[string]any{"conversation": text}
				if scenario.secondMedia && strings.HasSuffix(providerID, "-recent-2") {
					message = map[string]any{"imageMessage": map[string]any{
						"caption": text, "mimetype": "image/png",
						"directPath":    "/v/t62.7118-24/ctwa-successor-media-path",
						"mediaKey":      "bWVkaWEta2V5LWZpeHR1cmU=",
						"fileSha256":    "JfUmzNXDAYgL4c7/jmtyXqb4UJqqrtMwyampRkhTYQY=",
						"fileEncSha256": "ZW5jLXNoYTI1Ni1maXh0dXJl", "fileLength": 68,
					}}
				}
				if ctwa {
					message = map[string]any{"extendedTextMessage": map[string]any{
						"text": text,
						"contextInfo": map[string]any{"externalAdReply": map[string]any{
							"sourceType": "ad", "ctwaClid": "AfjGD28_TndSXnbFSjURxTw0AR29Ih0M0q3ZYwpb",
						}},
					}}
				}
				body, marshalErr := json.Marshal(map[string]any{
					"event": "messages.upsert", "instanceToken": "expired-ctwa-test-token",
					"instanceId": suffix,
					"data": map[string]any{"message": map[string]any{
						"Info": map[string]any{"ID": providerID, "Chat": phone,
							"SenderPN": senderPN, "IsFromMe": false, "Timestamp": when.Unix()},
						"key":     map[string]any{"id": providerID, "remoteJid": phone, "fromMe": false},
						"message": message,
					}},
				})
				if marshalErr != nil {
					t.Fatal(marshalErr)
				}
				envelope, parseErr := parseEvolutionWebhookEnvelope(
					url.Values{"session_id": {sessionID}, "instance_id": {suffix}}, http.Header{}, body,
				)
				if parseErr != nil {
					t.Fatal(parseErr)
				}
				return envelope
			}

			oldReceipt, err := repo.AcceptEvolutionWebhook(ctx,
				buildEnvelope(oldProviderID, "old CTWA", time.Now().Add(-8*24*time.Hour), true))
			if err != nil || oldReceipt.Status != "pending" {
				t.Fatalf("store old CTWA: receipt=%+v error=%v", oldReceipt, err)
			}
			oldAge := "8 days"
			oldReplyAge := "7 days 23 hours"
			if scenario.freshDatabase {
				oldAge = "6 days"
				oldReplyAge = "5 days 23 hours"
			}
			if _, err := postgres.Pool().Exec(ctx, `
				update public.whatsapp_webhook_inbox
				set created_at = now() - $2::interval
				where id = $1::uuid
			`, oldReceipt.ID, oldAge); err != nil {
				t.Fatal(err)
			}
			oldReply, err := repo.AcceptEvolutionWebhook(ctx,
				buildEnvelope(suffix+"-old-reply", "old reply", time.Now().Add(-7*24*time.Hour-23*time.Hour), false))
			if err != nil || oldReply.Status != "pending" {
				t.Fatalf("store old successor: receipt=%+v error=%v", oldReply, err)
			}
			if _, err := postgres.Pool().Exec(ctx, `
				update public.whatsapp_webhook_inbox
				set created_at = now() - $2::interval
				where id = $1::uuid
			`, oldReply.ID, oldReplyAge); err != nil {
				t.Fatal(err)
			}
			newText := "recent reply stays in inbox"
			newReceipt := evolutionWebhookReceipt{ID: "00000000-0000-0000-0000-000000000000"}
			if !scenario.noSuccessor {
				newReceipt, err = repo.AcceptEvolutionWebhook(ctx,
					buildEnvelope(suffix+"-recent", newText, time.Now(), scenario.successorCTWA))
				if err != nil || newReceipt.Status != "pending" {
					t.Fatalf("store recent successor: receipt=%+v error=%v", newReceipt, err)
				}
			}
			secondReceipt := evolutionWebhookReceipt{ID: "00000000-0000-0000-0000-000000000000"}
			if scenario.twoSuccessors {
				secondReceipt, err = repo.AcceptEvolutionWebhook(ctx,
					buildEnvelope(suffix+"-recent-2", "second recent reply", time.Now(), scenario.secondCTWA))
				if err != nil || secondReceipt.Status != "pending" {
					t.Fatalf("store second recent successor: receipt=%+v error=%v", secondReceipt, err)
				}
			}
			if scenario.staleSecondPredecessor {
				// Simulate a frozen ingress snapshot whose second organic message
				// still points at the expired CTWA, despite the independent newer
				// CTWA that will become the lead. This only changes local fixture data.
				tx, txErr := postgres.Pool().Begin(ctx)
				if txErr != nil {
					t.Fatal(txErr)
				}
				defer tx.Rollback(context.Background())
				if _, txErr = tx.Exec(ctx, `set local session_replication_role = replica`); txErr != nil {
					t.Fatal(txErr)
				}
				if _, txErr = tx.Exec(ctx, `
					update public.whatsapp_webhook_routing_snapshots as newer
					set predecessor_provider_message_id = older.provider_message_id,
					    target_mode = 'inherit_predecessor', binding_eligible = true,
					    snapshot = newer.snapshot || jsonb_build_object(
					      'state', 'predecessor_inherit',
					      'target_mode', 'inherit_predecessor',
					      'binding_eligible', true,
					      'predecessor_provider_message_id', older.provider_message_id,
					      'predecessor_inbox_event_key', older.inbox_event_key,
					      'predecessor_processing_lane', older.processing_lane
					    )
					from public.whatsapp_webhook_routing_snapshots as older
					where newer.organization_id = $1::uuid
					  and newer.session_id = $2::uuid
					  and newer.provider_message_id = $3
					  and older.organization_id = newer.organization_id
					  and older.session_id = newer.session_id
					  and older.provider_message_id = $4
				`, orgID, sessionID, suffix+"-recent-2", oldProviderID); txErr != nil {
					t.Fatal(txErr)
				}
				if _, txErr = tx.Exec(ctx, `
					update public.whatsapp_webhook_inbox as inbox
					set payload = jsonb_set(payload,
					  '{__vimob_ingress,routing_snapshot,messages,0}', snapshot.snapshot, false)
					from public.whatsapp_webhook_routing_snapshots as snapshot
					where inbox.id = $1::uuid
					  and snapshot.organization_id = inbox.organization_id
					  and snapshot.session_id = inbox.session_id
					  and snapshot.inbox_event_key = inbox.event_key
				`, secondReceipt.ID); txErr != nil {
					t.Fatal(txErr)
				}
				if txErr = tx.Commit(ctx); txErr != nil {
					t.Fatal(txErr)
				}
			}
			if scenario.mixed {
				// Recreate a legacy unsplittable row after ACK. The preflight must
				// leave both the raw row and the newer successor untouched.
				if _, err := postgres.Pool().Exec(ctx, `
					update public.whatsapp_webhook_inbox
					set payload = jsonb_set(payload, '{data,messages}',
					  jsonb_build_array(payload #> '{data,message}', payload #> '{data,message}'), true)
					where id = $1::uuid
				`, oldReceipt.ID); err != nil {
					t.Fatal(err)
				}
			}
			if scenario.successorMixed {
				// One indexed snapshot does not prove that a provider callback has
				// no second hidden message. Such a successor must remain untouched.
				if _, err := postgres.Pool().Exec(ctx, `
					update public.whatsapp_webhook_inbox
					set payload = jsonb_set(payload, '{data,messages}',
					  jsonb_build_array(payload #> '{data,message}', payload #> '{data,message}'), true)
					where id = $1::uuid
				`, newReceipt.ID); err != nil {
					t.Fatal(err)
				}
			}
			if scenario.oldReplyMixed {
				if _, err := postgres.Pool().Exec(ctx, `
					update public.whatsapp_webhook_inbox
					set payload = jsonb_set(payload, '{data,messages}',
					  jsonb_build_array(payload #> '{data,message}', payload #> '{data,message}'), true)
					where id = $1::uuid
				`, oldReply.ID); err != nil {
					t.Fatal(err)
				}
			}
			if scenario.parserDrift {
				// Keep the immutable ingress snapshot while simulating a historical
				// provider body that today's parser no longer recognizes as CTWA.
				if _, err := postgres.Pool().Exec(ctx, `
					update public.whatsapp_webhook_inbox
					set payload = jsonb_set(payload, '{data,message,message}',
					  '{"conversation":"historical provider shape"}'::jsonb, true)
					where id = $1::uuid
				`, oldReceipt.ID); err != nil {
					t.Fatal(err)
				}
			}
			if scenario.missingVersion {
				// The production immutable-snapshot trigger rightly blocks this
				// corruption. A transaction-local replica role lets the disposable
				// fixture simulate a row written by an older faulty binary, then
				// restores trigger execution automatically at commit.
				tx, err := postgres.Pool().Begin(ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer tx.Rollback(context.Background())
				if _, err := tx.Exec(ctx, `set local session_replication_role = replica`); err != nil {
					t.Fatal(err)
				}
				if _, err := tx.Exec(ctx, `
					update public.whatsapp_webhook_inbox
					set payload = payload #- '{__vimob_ingress,routing_snapshot,version}'
					where id = $1::uuid
				`, oldReceipt.ID); err != nil {
					t.Fatal(err)
				}
				if err := tx.Commit(ctx); err != nil {
					t.Fatal(err)
				}
			}
			if scenario.priorAttempt {
				if _, err := postgres.Pool().Exec(ctx, `
					update public.whatsapp_webhook_inbox
					set attempts = 1 where id = $1::uuid
				`, oldReceipt.ID); err != nil {
					t.Fatal(err)
				}
			}
			if scenario.activate {
				for _, workerID := range []string{
					"vimob-api-whatsapp-nonlead-ctwa2-local-a",
					"vimob-api-whatsapp-nonlead-ctwa2-local-b",
				} {
					if _, err := postgres.Pool().Exec(ctx, `
						select private.heartbeat_whatsapp_ctwa_cohort_worker($1)
					`, workerID); err != nil {
						t.Fatal(err)
					}
				}
				if err := postgres.Pool().QueryRow(ctx, `
					select private.activate_whatsapp_ctwa_recent_successor_session($1::uuid)
				`, sessionID).Scan(new(time.Time)); err != nil {
					t.Fatal(err)
				}
				if scenario.downgrade {
					if _, err := postgres.Pool().Exec(ctx, `
						update public.whatsapp_webhook_inbox
						set status = 'processing', attempts = attempts + 1,
						    locked_by = 'vimob-api-evolution-webhook-cutover1-old-replica', locked_at = now()
						where id = $1::uuid
					`, oldReceipt.ID); err == nil {
						t.Fatal("activated cohort accepted a claim from the old API binary")
					}
					if _, err := postgres.Pool().Exec(ctx, `
						insert into public.whatsapp_webhook_inbox (
						  organization_id, session_id, provider, provider_instance_id,
						  event_key, event_type, payload, processing_lane, status,
						  next_attempt_at, expires_at
						)
						select organization_id, session_id, provider, provider_instance_id,
						       event_key || '-old-replica', event_type, payload, processing_lane,
						       'pending', now(), now() + interval '30 days'
						from public.whatsapp_webhook_inbox where id = $1::uuid
					`, oldReceipt.ID); err == nil {
						t.Fatal("activated cohort accepted ingress from the old API binary")
					}
				}
			}
			var oldItem pendingEvolutionWebhook
			if err := postgres.Pool().QueryRow(ctx, `
				update public.whatsapp_webhook_inbox
				set status = 'processing', attempts = attempts + 1,
				    locked_by = $2, locked_at = now()
				where id = $1::uuid
				returning id::text, organization_id::text, session_id::text,
				  event_type, payload::text, processing_lane, created_at
			`, oldReceipt.ID, whatsappWebhookWorkerID).Scan(&oldItem.ID, &oldItem.OrganizationID,
				&oldItem.SessionID, &oldItem.EventType, &oldItem.Payload,
				&oldItem.ProcessingLane, &oldItem.CreatedAt); err != nil {
				t.Fatal(err)
			}
			oldItem.Attempts = 1
			oldItem.MaxAttempts = 5
			if scenario.staleGoClock {
				oldItem.CreatedAt = time.Now().Add(12 * time.Hour)
			}
			if scenario.freshDatabase {
				oldItem.CreatedAt = time.Now().Add(-8 * 24 * time.Hour)
			}
			if scenario.generalPolicy {
				if _, err := postgres.Pool().Exec(ctx, `
					insert into private.whatsapp_nonlead_retention_sessions (
					  session_id, organization_id, capture_from, purge_enabled
					) values ($1::uuid, $2::uuid, now() - interval '10 days', true)
				`, sessionID, orgID); err != nil {
					t.Fatal(err)
				}
				completed, err := repo.completeExpiredCTWABeforeDispatch(ctx, oldItem)
				if err != nil || completed {
					t.Fatalf("active general policy must delegate to native: completed=%v error=%v", completed, err)
				}
				var retained int
				if err := postgres.Pool().QueryRow(ctx, `
					select count(*) from public.whatsapp_webhook_inbox
					where id in ($1::uuid, $2::uuid, $3::uuid)
				`, oldReceipt.ID, oldReply.ID, newReceipt.ID).Scan(&retained); err != nil {
					t.Fatal(err)
				}
				if retained != 3 || edgeCalls.Load() != 0 {
					t.Fatalf("general policy delegation changed inbox or called Edge: rows=%d calls=%d", retained, edgeCalls.Load())
				}
				return
			}
			if err := repo.processClaimedEvolutionWebhook(ctx, oldItem); err != nil {
				t.Fatal(err)
			}
			wantEdgeCalls := int32(0)
			if scenario.freshDatabase {
				wantEdgeCalls = 1
			}
			if edgeCalls.Load() != wantEdgeCalls {
				t.Fatalf("expired CTWA reached Edge %d times", edgeCalls.Load())
			}
			var oldCount, newCount, outcomeCount, tombstoneCount, leadCount, messageCount int
			if err := postgres.Pool().QueryRow(ctx, `
				select
				  (select count(*) from public.whatsapp_webhook_inbox where id in ($1::uuid, $5::uuid)),
				  (select count(*) from public.whatsapp_webhook_inbox where id = $2::uuid and payload::text like '%' || $3 || '%'),
				  (select count(*) from public.whatsapp_webhook_routing_outcomes where organization_id = $4::uuid),
				  (select count(*) from private.whatsapp_nonlead_message_tombstones where organization_id = $4::uuid),
				  (select count(*) from public.leads where organization_id = $4::uuid),
				  (select count(*) from public.whatsapp_messages where organization_id = $4::uuid)
			`, oldReceipt.ID, newReceipt.ID, newText, orgID, oldReply.ID).Scan(
				&oldCount, &newCount, &outcomeCount, &tombstoneCount, &leadCount, &messageCount); err != nil {
				t.Fatal(err)
			}
			wantNewCount := 1
			if scenario.noSuccessor {
				wantNewCount = 0
			}
			if leadCount != 0 || messageCount != 0 || newCount != wantNewCount {
				t.Fatalf("side effects/recent successor: leads=%d messages=%d recent=%d", leadCount, messageCount, newCount)
			}
			completed := (scenario.noSuccessor || scenario.activate) && !scenario.mixed &&
				!scenario.successorMixed && !scenario.oldReplyMixed &&
				!scenario.missingVersion && !scenario.priorAttempt && !scenario.freshDatabase
			if completed {
				var rawSnapshotCount, rawInboxCount int
				if err := postgres.Pool().QueryRow(ctx, `
					select
					  (select count(*) from public.whatsapp_webhook_routing_snapshots
					   where organization_id = $1::uuid
					     and (provider_message_id in ($2, $3)
					       or predecessor_provider_message_id in ($2, $3)
					       or snapshot::text like '%' || $2 || '%'
					       or snapshot::text like '%' || $3 || '%')),
					  (select count(*) from public.whatsapp_webhook_inbox
					   where organization_id = $1::uuid
					     and (payload::text like '%' || $2 || '%'
					       or payload::text like '%' || $3 || '%'))
				`, orgID, oldProviderID, suffix+"-old-reply").Scan(&rawSnapshotCount, &rawInboxCount); err != nil {
					t.Fatal(err)
				}
				if oldCount != 0 || outcomeCount != 0 || tombstoneCount != 2 ||
					rawSnapshotCount != 0 || rawInboxCount != 0 {
					var oldStatus, oldError string
					_ = postgres.Pool().QueryRow(ctx, `
						select status, coalesce(last_error, '') from public.whatsapp_webhook_inbox
						where id = $1::uuid
					`, oldReceipt.ID).Scan(&oldStatus, &oldError)
					t.Fatalf("old route must leave only hashed tombstones: inbox=%d outcomes=%d tombstones=%d snapshots=%d payloads=%d status=%q error=%q",
						oldCount, outcomeCount, tombstoneCount, rawSnapshotCount, rawInboxCount, oldStatus, oldError)
				}
				if !scenario.activate {
					return
				}
				var cohortReceivedAt, cohortExpiresAt time.Time
				if err := postgres.Pool().QueryRow(ctx, `
					select cohort.first_received_at, cohort.expires_at
					from private.whatsapp_ctwa_recent_successor_cohorts as cohort
					where cohort.organization_id = $1::uuid and cohort.session_id = $2::uuid
				`, orgID, sessionID).Scan(&cohortReceivedAt, &cohortExpiresAt); err != nil {
					t.Fatal(err)
				}
				if cohortExpiresAt.Sub(cohortReceivedAt) != 168*time.Hour {
					t.Fatalf("recent successor must have its own 168-hour lifetime: %v", cohortExpiresAt.Sub(cohortReceivedAt))
				}
				if scenario.unmaterialized != "" {
					var oldRoute string
					if err := postgres.Pool().QueryRow(ctx, `
						select payload #>> '{__vimob_ingress,routing_key}'
						from public.whatsapp_webhook_inbox where id = $1::uuid
					`, newReceipt.ID).Scan(&oldRoute); err != nil {
						t.Fatal(err)
					}
					if scenario.unmaterialized == "processing" || scenario.unmaterialized == "retry" {
						status, attempts := "processing", 1
						if scenario.unmaterialized == "retry" {
							status, attempts = "retry", 2
						}
						if _, err := postgres.Pool().Exec(ctx, `
							update public.whatsapp_webhook_inbox
							set status = $2, attempts = $3, locked_by = $4,
							    locked_at = now()
							where id = $1::uuid
						`, newReceipt.ID, status, attempts, whatsappWebhookWorkerID); err != nil {
							t.Fatal(err)
						}
					}
					for _, update := range []struct {
						sql  string
						args []any
					}{
						{`update private.whatsapp_ctwa_recent_successor_cohorts
						 set first_received_at = first_received_at - interval '8 days',
						     expires_at = expires_at - interval '8 days'
						 where organization_id = $1::uuid and session_id = $2::uuid`, []any{orgID, sessionID}},
						{`update private.whatsapp_nonlead_retention_route_generations
						 set first_inbound_at = first_inbound_at - interval '8 days'
						 where organization_id = $1::uuid and session_id = $2::uuid
						   and routing_key = $3`, []any{orgID, sessionID, oldRoute}},
						{`update public.whatsapp_webhook_inbox
						 set created_at = created_at - interval '8 days'
						 where id = $1::uuid`, []any{newReceipt.ID}},
					} {
						if _, err := postgres.Pool().Exec(ctx, update.sql, update.args...); err != nil {
							t.Fatal(err)
						}
					}
					newGenerationReceipt := evolutionWebhookReceipt{ID: "00000000-0000-0000-0000-000000000000"}
					if scenario.unmaterialized == "new-generation" {
						newGenerationReceipt, err = repo.AcceptEvolutionWebhook(ctx,
							buildEnvelope(suffix+"-new-generation", "new generation", time.Now(), false))
						if err != nil || newGenerationReceipt.Status != "pending" {
							t.Fatalf("new route ingress: receipt=%+v error=%v", newGenerationReceipt, err)
						}
						var newRoute string
						if err := postgres.Pool().QueryRow(ctx, `
							select payload #>> '{__vimob_ingress,routing_key}'
							from public.whatsapp_webhook_inbox where id = $1::uuid
						`, newGenerationReceipt.ID).Scan(&newRoute); err != nil {
							t.Fatal(err)
						}
						if newRoute == oldRoute {
							t.Fatal("post-deadline ingress reused expired cohort route")
						}
					}
					var disposition string
					if scenario.unmaterialized == "processing" || scenario.unmaterialized == "retry" {
						err = postgres.Pool().QueryRow(ctx, `
							select private.try_purge_whatsapp_ctwa_unmaterialized_cohort(
							  $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text
							)
						`, orgID, sessionID, oldRoute, newReceipt.ID, whatsappWebhookWorkerID).Scan(&disposition)
					} else {
						_, purged, busy, failed, _, purgeErr := repo.purgeDueWhatsAppCTWAUnmaterializedCohortBatch(ctx, 5)
						if purgeErr != nil || failed != 0 || busy != 0 || purged != 1 {
							t.Fatalf("unmaterialized retention worker: purged=%d busy=%d failed=%d error=%v", purged, busy, failed, purgeErr)
						}
						disposition = "purged"
					}
					if err != nil {
						t.Fatal(err)
					}
					wantDisposition := "purged"
					if scenario.unmaterialized == "retry" {
						wantDisposition = "busy"
					}
					if disposition != wantDisposition {
						t.Fatalf("unmaterialized outcome=%q want=%q", disposition, wantDisposition)
					}
					if scenario.unmaterialized == "retry" {
						selected, purged, busy, failed, _, runErr :=
							repo.purgeDueWhatsAppCTWAUnmaterializedCohortBatch(ctx, 5)
						if runErr != nil || selected != 1 || purged != 0 || busy != 1 || failed != 0 {
							t.Fatalf("uncertain cohort must back off: selected=%d purged=%d busy=%d failed=%d error=%v",
								selected, purged, busy, failed, runErr)
						}
						selected, _, _, _, _, runErr = repo.purgeDueWhatsAppCTWAUnmaterializedCohortBatch(ctx, 5)
						if runErr != nil || selected != 0 {
							t.Fatalf("uncertain cohort monopolized next batch: selected=%d error=%v", selected, runErr)
						}
					}
					var oldRaw, tombstones, newGeneration int
					if err := postgres.Pool().QueryRow(ctx, `
						select
						 (select count(*) from public.whatsapp_webhook_inbox
						  where id = $2::uuid and payload::text like '%' || $3 || '%'),
						 (select count(*) from private.whatsapp_nonlead_message_tombstones
						  where organization_id = $1::uuid),
						 (select count(*) from public.whatsapp_webhook_inbox where id = $4::uuid)
					`, orgID, newReceipt.ID, suffix+"-recent", newGenerationReceipt.ID).Scan(
						&oldRaw, &tombstones, &newGeneration); err != nil {
						t.Fatal(err)
					}
					if scenario.unmaterialized == "retry" {
						if oldRaw != 1 || tombstones != 2 {
							t.Fatalf("retry state must retain raw row and old tombstones: raw=%d tombstones=%d", oldRaw, tombstones)
						}
					} else if oldRaw != 0 || tombstones != 3 {
						t.Fatalf("unmaterialized purge left raw row or tombstone missing: raw=%d tombstones=%d", oldRaw, tombstones)
					}
					if scenario.unmaterialized == "new-generation" && newGeneration != 1 {
						t.Fatal("unmaterialized purge deleted the newer generation")
					}
					return
				}
				wantMessages := 1
				if scenario.lidPN {
					// LID without PN starts in backlog; PN makes the later event live.
					// The later live event must not be claimed before the earlier
					// backlog event: a retry would consume attempts and starve it.
					items, _, claimErr := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
					if claimErr != nil || len(items) != 0 {
						t.Fatalf("later live successor was claimed before backlog: count=%d error=%v", len(items), claimErr)
					}
					var waitingStatus string
					var waitingAttempts, prematureMessages int
					if err := postgres.Pool().QueryRow(ctx, `
						select (select status from public.whatsapp_webhook_inbox where id = $1::uuid),
						       (select attempts from public.whatsapp_webhook_inbox where id = $1::uuid),
						       (select count(*) from public.whatsapp_messages where organization_id = $2::uuid)
					`, secondReceipt.ID, orgID).Scan(&waitingStatus, &waitingAttempts, &prematureMessages); err != nil {
						t.Fatal(err)
					}
					if waitingStatus != "pending" || waitingAttempts != 0 || prematureMessages != 0 {
						t.Fatalf("later live successor did not wait: status=%s attempts=%d messages=%d", waitingStatus, waitingAttempts, prematureMessages)
					}
					if scenario.concurrentClaims {
						otherDB, dbErr := dbpkg.NewPostgres(ctx, dbpkg.Config{
							URL: databaseURL, HealthTimeout: 3 * time.Second,
						})
						if dbErr != nil {
							t.Fatal(dbErr)
						}
						t.Cleanup(otherDB.Close)
						otherRepo := NewRepository(otherDB, nil, StorageConfig{})
						type claimResult struct {
							items []pendingEvolutionWebhook
							err   error
						}
						resultCh := make(chan claimResult, 2)
						for _, claimant := range []Repository{repo, otherRepo} {
							claimant := claimant
							go func() {
								claimed, _, claimErr := claimant.claimEvolutionWebhooksForLane(
									ctx, evolutionWebhookLaneBacklog, 1, "",
								)
								resultCh <- claimResult{items: claimed, err: claimErr}
							}()
						}
						items = nil
						for i := 0; i < 2; i++ {
							result := <-resultCh
							if result.err != nil {
								t.Fatal(result.err)
							}
							items = append(items, result.items...)
						}
					} else {
						items, _, claimErr = repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 1, "")
					}
					if claimErr != nil || len(items) != 1 || items[0].ID != newReceipt.ID {
						t.Fatalf("first backlog successor claim: count=%d error=%v", len(items), claimErr)
					}
					if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
						t.Fatal(err)
					}
					items, _, claimErr = repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
					if claimErr != nil || len(items) != 1 || items[0].ID != secondReceipt.ID {
						t.Fatalf("later live successor claim after backlog: count=%d error=%v", len(items), claimErr)
					}
					if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
						t.Fatal(err)
					}
					wantMessages = 2
				} else {
					items, _, claimErr := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
					if claimErr != nil || len(items) != 1 || items[0].ID != newReceipt.ID {
						gotID := ""
						if len(items) > 0 {
							gotID = items[0].ID
						}
						t.Fatalf("recent successor must be claimable: got=%s want=%s count=%d error=%v", gotID, newReceipt.ID, len(items), claimErr)
					}
					if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
						t.Fatal(err)
					}
					if scenario.twoSuccessors {
						items, _, claimErr = repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
						if claimErr != nil || len(items) != 1 || items[0].ID != secondReceipt.ID {
							t.Fatalf("second recent successor must be claimable: count=%d error=%v", len(items), claimErr)
						}
						if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
							t.Fatal(err)
						}
						wantMessages = 2
					}
				}
				var recentMessageCount, recentLeadCount, candidateCount int
				if err := postgres.Pool().QueryRow(ctx, `
					select
					  (select count(*) from public.whatsapp_messages where organization_id = $1::uuid),
					  (select count(*) from public.leads where organization_id = $1::uuid),
					  (select count(*) from private.whatsapp_nonlead_retention_candidates
					   where organization_id = $1::uuid and first_received_at = $2::timestamptz)
				`, orgID, cohortReceivedAt).Scan(&recentMessageCount, &recentLeadCount, &candidateCount); err != nil {
					t.Fatal(err)
				}
				wantLeads, wantCandidates := 0, 1
				if scenario.successorCTWA {
					wantLeads, wantCandidates = 1, 0
				} else if scenario.secondCTWA {
					wantLeads, wantCandidates = 1, 1
				}
				if recentMessageCount != wantMessages || recentLeadCount != wantLeads ||
					candidateCount != wantCandidates || edgeCalls.Load() != 0 {
					t.Fatalf("recent organic successor must process once without lead/Edge: messages=%d leads=%d candidates=%d edge=%d",
						recentMessageCount, recentLeadCount, candidateCount, edgeCalls.Load())
				}
				if scenario.lidPN {
					var conversationCount int
					if err := postgres.Pool().QueryRow(ctx, `
						select count(*) from public.whatsapp_conversations
						where organization_id = $1::uuid and session_id = $2::uuid
					`, orgID, sessionID).Scan(&conversationCount); err != nil {
						t.Fatal(err)
					}
					if conversationCount != 1 {
						t.Fatalf("LID to PN successors split into %d conversations", conversationCount)
					}
					if scenario.secondCTWA {
						var linkedMessages, convertedCandidates int
						if err := postgres.Pool().QueryRow(ctx, `
							select
							 (select count(*) from public.whatsapp_messages
							  where organization_id = $1::uuid and content is not null),
							 (select count(*) from private.whatsapp_nonlead_retention_candidates
							  where organization_id = $1::uuid and state = 'converted')
						`, orgID).Scan(&linkedMessages, &convertedCandidates); err != nil {
							t.Fatal(err)
						}
						if linkedMessages != 2 || convertedCandidates != 1 {
							var diagnostic string
							_ = postgres.Pool().QueryRow(ctx, `
								select coalesce(string_agg(provider_message_id || ':' || capture_state || ':' ||
								  case when content is null then 'empty' else 'content' end, ','), '')
								from public.whatsapp_messages where organization_id = $1::uuid
							`, orgID).Scan(&diagnostic)
							t.Fatalf("organic history was not preserved on CTWA conversion: messages=%d converted=%d states=%s",
								linkedMessages, convertedCandidates, diagnostic)
						}
					}
				}
				if scenario.successorCTWA {
					var settled bool
					if err := postgres.Pool().QueryRow(ctx, `
						select settled_at is not null
						from private.whatsapp_ctwa_recent_successor_cohorts
						where organization_id = $1::uuid and session_id = $2::uuid
					`, orgID, sessionID).Scan(&settled); err != nil {
						t.Fatal(err)
					}
					if !settled {
						t.Fatal("independent CTWA lead did not settle its exact retention cohort")
					}
					if scenario.twoSuccessors {
						var retainedContent int
						if err := postgres.Pool().QueryRow(ctx, `
							select count(*) from public.whatsapp_messages
							where organization_id = $1::uuid
							  and provider_message_id = $2
							  and content = 'second recent reply'
						`, orgID, suffix+"-recent-2").Scan(&retainedContent); err != nil {
							t.Fatal(err)
						}
						if retainedContent != 1 {
							t.Fatal("organic successor after independent CTWA lost its text")
						}
						if scenario.secondMedia {
							var mediaJobCount int
							if err := postgres.Pool().QueryRow(ctx, `
								select count(*) from public.media_jobs as job
								join public.whatsapp_messages as message on message.id = job.message_id
								where message.organization_id = $1::uuid
								  and message.provider_message_id = $2
							`, orgID, suffix+"-recent-2").Scan(&mediaJobCount); err != nil {
								t.Fatal(err)
							}
							if mediaJobCount != 1 {
								t.Fatalf("organic successor media was not queued: jobs=%d", mediaJobCount)
							}
						}
					}
				}
				if scenario.gcSettle {
					// Simulate a missed settlement in this disposable fixture. Both
					// direct CTWA and later conversion must keep their history.
					if _, err := postgres.Pool().Exec(ctx, `
						update private.whatsapp_ctwa_recent_successor_cohorts
						set settled_at = null,
						    first_received_at = first_received_at - interval '8 days',
						    expires_at = expires_at - interval '8 days'
						where organization_id = $1::uuid and session_id = $2::uuid
					`, orgID, sessionID); err != nil {
						t.Fatal(err)
					}
					if _, err := postgres.Pool().Exec(ctx, `
						update public.whatsapp_messages
						set created_at = created_at - interval '8 days'
						where organization_id = $1::uuid and session_id = $2::uuid
					`, orgID, sessionID); err != nil {
						t.Fatal(err)
					}
					if _, err := postgres.Pool().Exec(ctx, `
						update private.whatsapp_nonlead_retention_candidates
						set converted_at = converted_at - interval '8 days'
						where organization_id = $1::uuid and session_id = $2::uuid
						  and state = 'converted'
					`, orgID, sessionID); err != nil {
						t.Fatal(err)
					}
					var route, outcome string
					if err := postgres.Pool().QueryRow(ctx, `
						select routing_key from private.whatsapp_ctwa_recent_successor_cohorts
						where organization_id = $1::uuid and session_id = $2::uuid
					`, orgID, sessionID).Scan(&route); err != nil {
						t.Fatal(err)
					}
					if err := postgres.Pool().QueryRow(ctx, `
						select private.try_purge_whatsapp_ctwa_unmaterialized_cohort(
						  $1::uuid, $2::uuid, $3::text
						)
					`, orgID, sessionID, route).Scan(&outcome); err != nil {
						t.Fatal(err)
					}
					if outcome != "converted" {
						t.Fatalf("converted cohort was not settled: %s", outcome)
					}
					var retained, settled int
					if err := postgres.Pool().QueryRow(ctx, `
						select (select count(*) from public.whatsapp_messages
						        where organization_id = $1::uuid),
						       (select count(*) from private.whatsapp_ctwa_recent_successor_cohorts
						        where organization_id = $1::uuid and settled_at is not null)
					`, orgID).Scan(&retained, &settled); err != nil {
						t.Fatal(err)
					}
					if retained != wantMessages || settled != 1 {
						t.Fatalf("converted cohort lost history or remained due: messages=%d settled=%d", retained, settled)
					}
					laterReceipt, err := repo.AcceptEvolutionWebhook(ctx,
						buildEnvelope(suffix+"-after-conversion", "follow-up after conversion", time.Now(), false))
					if err != nil || laterReceipt.Status != "pending" {
						t.Fatalf("new message after converted deadline: receipt=%+v error=%v", laterReceipt, err)
					}
					laterItems, _, claimErr := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
					if claimErr != nil || len(laterItems) != 1 || laterItems[0].ID != laterReceipt.ID {
						t.Fatalf("new message after converted deadline not claimable: count=%d error=%v", len(laterItems), claimErr)
					}
					if err := repo.processClaimedEvolutionWebhook(ctx, laterItems[0]); err != nil {
						t.Fatal(err)
					}
					var laterContent int
					if err := postgres.Pool().QueryRow(ctx, `
						select count(*) from public.whatsapp_messages
						where organization_id = $1::uuid
						  and provider_message_id = $2
						  and content = 'follow-up after conversion'
					`, orgID, suffix+"-after-conversion").Scan(&laterContent); err != nil {
						t.Fatal(err)
					}
					if laterContent != 1 {
						t.Fatalf("new message after conversion lost content: %d", laterContent)
					}
				}
				if scenario.purgeAfter {
					for _, update := range []string{
						`update private.whatsapp_ctwa_recent_successor_cohorts
						 set first_received_at = first_received_at - interval '8 days',
						     expires_at = expires_at - interval '8 days'
						 where organization_id = $1::uuid and session_id = $2::uuid`,
						`update private.whatsapp_nonlead_retention_route_generations
						 set first_inbound_at = first_inbound_at - interval '8 days'
						 where organization_id = $1::uuid and session_id = $2::uuid`,
						`update private.whatsapp_nonlead_retention_candidates
						 set first_received_at = first_received_at - interval '8 days',
						     expires_at = expires_at - interval '8 days'
						 where organization_id = $1::uuid and session_id = $2::uuid`,
						`update public.whatsapp_webhook_inbox
						 set created_at = created_at - interval '8 days'
						 where organization_id = $1::uuid and session_id = $2::uuid`,
					} {
						if _, err := postgres.Pool().Exec(ctx, update, orgID, sessionID); err != nil {
							t.Fatal(err)
						}
					}
					selected, purged, busy, failed, code, err := repo.purgeDueWhatsAppNonLeadBatch(ctx, 5)
					if err != nil || selected != 1 || purged != 1 || busy != 0 || failed != 0 {
						var diagnosticErr error
						if failed != 0 {
							var diagnostic string
							diagnosticErr = postgres.Pool().QueryRow(ctx, `
								select private.try_purge_whatsapp_nonlead_conversation(conversation_id)
								from private.whatsapp_nonlead_retention_candidates
								where organization_id = $1::uuid limit 1
							`, orgID).Scan(&diagnostic)
						}
						t.Fatalf("CTWA cohort physical purge: selected=%d purged=%d busy=%d failed=%d code=%q error=%v diagnostic=%v",
							selected, purged, busy, failed, code, err, diagnosticErr)
					}
					var remainingConversations, remainingMessages, remainingInbox, remainingSnapshots int
					if err := postgres.Pool().QueryRow(ctx, `
						select
						 (select count(*) from public.whatsapp_conversations where organization_id = $1::uuid),
						 (select count(*) from public.whatsapp_messages where organization_id = $1::uuid),
						 (select count(*) from public.whatsapp_webhook_inbox where organization_id = $1::uuid),
						 (select count(*) from public.whatsapp_webhook_routing_snapshots where organization_id = $1::uuid)
					`, orgID).Scan(&remainingConversations, &remainingMessages, &remainingInbox, &remainingSnapshots); err != nil {
						t.Fatal(err)
					}
					if remainingConversations != 0 || remainingMessages != 0 ||
						remainingInbox != 0 || remainingSnapshots != 0 {
						t.Fatalf("CTWA cohort purge left CRM copies: conversations=%d messages=%d inbox=%d snapshots=%d",
							remainingConversations, remainingMessages, remainingInbox, remainingSnapshots)
					}
				}
				return
			}
			// A newer successor, ambiguous payload, prior processing or a fresh
			// database clock leaves the whole route and provider payloads intact.
			if oldCount != 2 || outcomeCount != 0 || tombstoneCount != 0 {
				t.Fatalf("recent successor must fail closed: old=%d outcomes=%d tombstones=%d", oldCount, outcomeCount, tombstoneCount)
			}
		})
	}
}
