package whatsapp

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestNativeWebhookLockTimeoutAndCanceledJobReleaseFIFO(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	repo := NewRepository(db, nil, StorageConfig{})
	repo.functions.webhookProcessorMode = webhookProcessorNative
	for _, cancelJob := range []bool{false, true} {
		label := "lock-timeout"
		if cancelJob {
			label = "canceled-job"
		}
		t.Run(label, func(t *testing.T) {
			f := newWebhookDependencyFixture(t, ctx, db, label)
			if _, err := db.Pool().Exec(ctx, `update public.whatsapp_sessions set advanced_settings='{"token":"synthetic-runtime","webhook_token":"synthetic-runtime-hook"}'::jsonb where id=$1::uuid`, f.sessionID); err != nil {
				t.Fatal(err)
			}
			payload, _ := json.Marshal(map[string]any{"event": "message", "data": map[string]any{
				"Info":    map[string]any{"ID": f.suffix + "-target", "Chat": f.remoteJID, "SenderPN": f.remoteJID, "Timestamp": time.Now().UTC().Format(time.RFC3339Nano)},
				"Message": map[string]any{"conversation": "bounded Native fixture"}}})
			receipt, err := repo.AcceptEvolutionWebhook(ctx, evolutionWebhookEnvelope{SessionID: f.sessionID, InstanceToken: "synthetic-runtime", WebhookHeaderTokens: []string{"synthetic-runtime-hook"}, EventType: "message", Payload: payload, ReceivedAt: time.Now().UTC()})
			if err != nil {
				t.Fatal(err)
			}
			items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
			if err != nil || len(items) != 1 {
				t.Fatalf("claim before lock=%d/%v", len(items), err)
			}
			var independent sessionConversationLockFixture
			if !cancelJob {
				independent = newWebhookDependencyFixture(t, ctx, db, "independent-native-route")
				if _, err := db.Pool().Exec(ctx, `update public.whatsapp_sessions set advanced_settings='{"token":"synthetic-runtime","webhook_token":"synthetic-runtime-hook"}'::jsonb where id=$1::uuid`, independent.sessionID); err != nil {
					t.Fatal(err)
				}
				otherPayload, _ := json.Marshal(map[string]any{"event": "message", "data": map[string]any{
					"Info":    map[string]any{"ID": independent.suffix + "-target", "Chat": independent.remoteJID, "SenderPN": independent.remoteJID, "Timestamp": time.Now().UTC().Format(time.RFC3339Nano)},
					"Message": map[string]any{"conversation": "independent route progresses"}}})
				if _, err := repo.AcceptEvolutionWebhook(ctx, evolutionWebhookEnvelope{SessionID: independent.sessionID, InstanceToken: "synthetic-runtime", WebhookHeaderTokens: []string{"synthetic-runtime-hook"}, EventType: "message", Payload: otherPayload, ReceivedAt: time.Now().UTC()}); err != nil {
					t.Fatal(err)
				}
			}
			blocker, err := db.Pool().Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer rollbackWebhookTx(blocker)
			if _, err := blocker.Exec(ctx, `select id from public.whatsapp_conversations where id=$1::uuid for update`, f.conversationID); err != nil {
				t.Fatal(err)
			}
			jobCtx := ctx
			cancel := func() {}
			if cancelJob {
				jobCtx, cancel = context.WithTimeout(ctx, 100*time.Millisecond)
			}
			started := time.Now()
			if cancelJob {
				err = repo.processClaimedEvolutionWebhook(jobCtx, items[0])
			} else {
				finished := make(chan error, 1)
				go func() { finished <- repo.processClaimedEvolutionWebhook(jobCtx, items[0]) }()
				assertNativeSessionLockHeld(t, ctx, repo, f.sessionID)
				otherItems, _, claimErr := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
				if claimErr != nil || len(otherItems) != 1 || otherItems[0].SessionID != independent.sessionID {
					t.Fatalf("blocked route held independent claim: %d/%v", len(otherItems), claimErr)
				}
				if err := repo.processClaimedEvolutionWebhook(ctx, otherItems[0]); err != nil {
					t.Fatal(err)
				}
				select {
				case err = <-finished:
					t.Fatalf("blocked Native route finished before independent route: %v", err)
				default:
				}
				err = <-finished
			}
			cancel()
			if err != nil {
				t.Fatalf("failed to release bounded job into retry: %v", err)
			}
			if time.Since(started) > 8*time.Second {
				t.Fatal("Native row lock exhausted the worker slot budget")
			}
			var status string
			var messages, outcomes int
			if err := db.Pool().QueryRow(ctx, `select status,
				(select count(*) from public.whatsapp_messages where organization_id=$2::uuid),
				(select count(*) from public.whatsapp_webhook_routing_outcomes where organization_id=$2::uuid)
				from public.whatsapp_webhook_inbox where id=$1::uuid`, receipt.ID, f.organizationID).Scan(&status, &messages, &outcomes); err != nil {
				t.Fatal(err)
			}
			if status != "retry" || messages != 0 || outcomes != 0 {
				t.Fatalf("rollback/retry=%s messages=%d outcomes=%d", status, messages, outcomes)
			}
			assertNativeSessionLockReleased(t, ctx, repo, f.sessionID)
			rollbackWebhookTx(blocker)
			if _, err := db.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox set next_attempt_at=now() where id=$1::uuid`, receipt.ID); err != nil {
				t.Fatal(err)
			}
			items, _, err = repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
			if err != nil || len(items) != 1 {
				t.Fatalf("retry claim=%d/%v", len(items), err)
			}
			if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
				t.Fatal(err)
			}
			if err := db.Pool().QueryRow(ctx, `select count(*) from public.whatsapp_messages where organization_id=$1::uuid`, f.organizationID).Scan(&messages); err != nil {
				t.Fatal(err)
			}
			if messages != 1 {
				t.Fatalf("retry created %d canonical messages; want1", messages)
			}
		})
	}
}

func assertNativeSessionLockHeld(t *testing.T, ctx context.Context, repo Repository, session string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		probe, err := repo.db.Pool().Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		_, err = probe.Exec(ctx, `select id from public.whatsapp_sessions where id=$1::uuid for update nowait`, session)
		rollbackWebhookTx(probe)
		if err != nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("Native job did not acquire its session before independent-route proof")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestWebhookRecoveryLockWaitIsBoundedAndRollsBack(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "bounded-recovery")
	repo := NewRepository(db, nil, StorageConfig{})
	id := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
		key: f.suffix + "-stale", providerID: f.suffix + "-stale", route: "jid:" + f.remoteJID,
		lane: evolutionWebhookLaneLive, status: "pending", epoch: 1, attempts: 1, maxAttempts: 12, age: 10 * time.Minute})
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox set status='processing',locked_at=now()-interval '10 minutes',locked_by=$2 where id=$1::uuid`, id, whatsappWebhookWorkerID); err != nil {
		t.Fatal(err)
	}
	blocker, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackWebhookTx(blocker)
	if _, err := blocker.Exec(ctx, `select id from public.whatsapp_webhook_inbox where id=$1::uuid for update`, id); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	err = repo.RecoverStaleWebhookInbox(ctx)
	if err == nil || time.Since(started) > 5*time.Second {
		t.Fatalf("recovery lock timeout=%v duration=%s", err, time.Since(started))
	}
	rollbackWebhookTx(blocker)
	if err := repo.RecoverStaleWebhookInbox(ctx); err != nil {
		t.Fatal(err)
	}
	var status string
	if err := db.Pool().QueryRow(ctx, `select status from public.whatsapp_webhook_inbox where id=$1::uuid`, id).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "retry" {
		t.Fatalf("bounded recovery lost stale work: %s", status)
	}
}

func assertNativeSessionLockReleased(t *testing.T, ctx context.Context, repo Repository, session string) {
	t.Helper()
	deadline := time.Now().Add(webhookRollbackTimeout)
	for {
		probe, err := repo.db.Pool().Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		_, err = probe.Exec(ctx, `select id from public.whatsapp_sessions where id=$1::uuid for update nowait`, session)
		rollbackWebhookTx(probe)
		if err == nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("Native cancellation retained its session lock beyond cleanup budget: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
