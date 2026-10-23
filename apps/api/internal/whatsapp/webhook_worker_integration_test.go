package whatsapp

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestClaimEvolutionWebhooksSkipsLockedSessionAndRefillsBatch(t *testing.T) {
	databaseURL := os.Getenv("WHATSAPP_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	suffix := fmt.Sprintf("wa-fair-claim-%d", time.Now().UnixNano())
	orderedTail := randomHex(4)
	sessionA := fmt.Sprintf("ffffffff-ffff-4fff-8fff-%s0001", orderedTail)
	sessionB := fmt.Sprintf("ffffffff-ffff-4fff-8fff-%s0002", orderedTail)
	sessionC := fmt.Sprintf("ffffffff-ffff-4fff-8fff-%s0003", orderedTail)
	cursorBefore := fmt.Sprintf("ffffffff-ffff-4fff-8fff-%s0000", orderedTail)
	var organizationID, userID string
	if err := postgres.Pool().QueryRow(ctx, `
		select gen_random_uuid()::text, gen_random_uuid()::text
	`).Scan(&organizationID, &userID); err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() {
		cleanupSessionConversationLockFixture(t, postgres.Pool(), sessionConversationLockFixture{
			organizationID: organizationID, userID: userID,
		})
	})

	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.organizations (id, name, slug)
		values ($1::uuid, $2, $2)
	`, organizationID, suffix); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values (
			$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now()
		)
	`, userID, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, $3, $4, 'user', true)
		on conflict (id) do update
		set organization_id=excluded.organization_id, name=excluded.name,
		    email=excluded.email, role=excluded.role, is_active=excluded.is_active
	`, userID, organizationID, suffix, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'user', true)
		on conflict (user_id, organization_id) do update
		set role=excluded.role, is_active=excluded.is_active, deleted_at=null
	`, organizationID, userID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.whatsapp_sessions (
			id, organization_id, owner_user_id, instance_name, instance_id,
			provider, status, is_active, advanced_settings
		) values
			($1::uuid, $4::uuid, $5::uuid, $6 || '-a', $6 || '-a', 'evolution_go', 'connected', true, '{"token":"synthetic-fair-instance","webhook_token":"synthetic-fair-webhook"}'::jsonb),
			($2::uuid, $4::uuid, $5::uuid, $6 || '-b', $6 || '-b', 'evolution_go', 'connected', true, '{"token":"synthetic-fair-instance","webhook_token":"synthetic-fair-webhook"}'::jsonb),
			($3::uuid, $4::uuid, $5::uuid, $6 || '-c', $6 || '-c', 'evolution_go', 'connected', true, '{"token":"synthetic-fair-instance","webhook_token":"synthetic-fair-webhook"}'::jsonb)
	`, sessionA, sessionB, sessionC, organizationID, userID, suffix); err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(postgres, nil, StorageConfig{})
	repo.functions.webhookProcessorMode = webhookProcessorNative
	repo.functions.webhookRolloutSessionIDs = []string{sessionA, sessionB, sessionC}
	instances := map[string]string{sessionA: suffix + "-a", sessionB: suffix + "-b", sessionC: suffix + "-c"}
	for sessionID := range instances {
		if _, err := postgres.Pool().Exec(ctx, `select private.activate_whatsapp_webhook_session_cutover($1::uuid,$2::uuid)`, organizationID, sessionID); err != nil {
			t.Fatal(err)
		}
	}
	// Authenticate and freeze every row through the production admission path.
	// Only claim scheduling fields below are altered to model the worker cases.
	admit := func(sessionID, eventID, phone, lane, status string, attempts int, due, age time.Duration) string {
		t.Helper()
		payload, err := json.Marshal(map[string]any{"event": "messages.upsert", "data": map[string]any{"messages": []any{map[string]any{
			"Info":    map[string]any{"ID": eventID, "Chat": phone + "@s.whatsapp.net", "SenderPN": phone + "@s.whatsapp.net", "IsFromMe": false, "Timestamp": time.Now().UTC().Add(-time.Second).Format(time.RFC3339Nano)},
			"Message": map[string]any{"conversation": "synthetic FIFO claim"},
		}}}})
		if err != nil {
			t.Fatal(err)
		}
		receipt, err := repo.AcceptEvolutionWebhook(ctx, evolutionWebhookEnvelope{
			SessionID: sessionID, InstanceID: instances[sessionID], InstanceToken: "synthetic-fair-instance",
			WebhookHeaderTokens: []string{"synthetic-fair-webhook"}, EventType: "messages.upsert", Payload: payload, ReceivedAt: time.Now().UTC(),
		})
		if err != nil || receipt.Duplicate || receipt.ID == "" {
			t.Fatalf("canonical worker fixture admission = %+v: %v", receipt, err)
		}
		if _, err := postgres.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox
			set processing_lane=$2,status=$3,attempts=$4,next_attempt_at=$5,created_at=$6
			where id=$1::uuid and organization_id=$7::uuid`, receipt.ID, lane, status, attempts, time.Now().Add(due), time.Now().Add(-age), organizationID); err != nil {
			t.Fatal(err)
		}
		return receipt.ID
	}
	firstAID := admit(sessionA, suffix+"-a-1", "5511999990001", "backlog", "pending", 0, -2*time.Minute, 2*time.Minute)
	for _, fixture := range []struct {
		sessionID string
		eventKey  string
		delay     time.Duration
	}{
		{sessionID: sessionA, eventKey: suffix + "-a-2", delay: time.Minute},
		{sessionID: sessionB, eventKey: suffix + "-b-1", delay: time.Minute},
		{sessionID: sessionC, eventKey: suffix + "-c-1", delay: time.Minute},
	} {
		admit(fixture.sessionID, fixture.eventKey, "5511999990001", "backlog", "pending", 0, -fixture.delay, fixture.delay)
	}

	lockedHeadTx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer lockedHeadTx.Rollback(ctx)
	if _, err := lockedHeadTx.Exec(ctx, `
		select id
		from public.whatsapp_webhook_inbox
		where id = $1::uuid
		for update
	`, firstAID); err != nil {
		t.Fatal(err)
	}

	claimed, err := repo.claimEvolutionWebhooksWithBatchAfterSession(ctx, 3, cursorBefore)
	if err != nil {
		t.Fatalf("claim with locked exact head: %v", err)
	}
	claimedSessions := map[string]bool{}
	for _, item := range claimed {
		claimedSessions[item.SessionID] = true
	}
	if len(claimed) != 2 || !claimedSessions[sessionB] || !claimedSessions[sessionC] || claimedSessions[sessionA] {
		t.Fatalf("claimed sessions with A head locked = %#v, want B and C only", claimedSessions)
	}
	var pendingAWithHeadLocked int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)
		from public.whatsapp_webhook_inbox
		where session_id = $1::uuid
		  and status = 'pending'
	`, sessionA).Scan(&pendingAWithHeadLocked); err != nil {
		t.Fatal(err)
	}
	if pendingAWithHeadLocked != 2 {
		t.Fatalf("pending rows for A with its head locked = %d, want 2", pendingAWithHeadLocked)
	}
	if err := lockedHeadTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set status = 'pending', attempts = 0, locked_at = null, locked_by = null
		where session_id in ($1::uuid, $2::uuid)
	`, sessionB, sessionC); err != nil {
		t.Fatal(err)
	}

	blockedSessionTx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer blockedSessionTx.Rollback(ctx)
	if _, err := blockedSessionTx.Exec(ctx, `
		select id
		from public.whatsapp_sessions
		where id = $1::uuid
		for no key update
	`, sessionA); err != nil {
		t.Fatal(err)
	}

	claimed, err = repo.claimEvolutionWebhooksWithBatchAfterSession(ctx, 2, cursorBefore)
	if err != nil {
		t.Fatalf("claim with locked first session: %v", err)
	}
	if len(claimed) != 2 {
		t.Fatalf("claim with locked first session returned %d rows, want 2", len(claimed))
	}
	claimedSessions = map[string]bool{}
	for _, item := range claimed {
		claimedSessions[item.SessionID] = true
	}
	if !claimedSessions[sessionB] || !claimedSessions[sessionC] || claimedSessions[sessionA] {
		t.Fatalf("claimed sessions with A locked = %#v, want B and C", claimedSessions)
	}

	if err := blockedSessionTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	claimed, err = repo.claimEvolutionWebhooksWithBatchAfterSession(ctx, 2, cursorBefore)
	if err != nil {
		t.Fatalf("claim after releasing first session: %v", err)
	}
	if len(claimed) != 1 || claimed[0].SessionID != sessionA || claimed[0].ID != firstAID {
		t.Fatalf("claim after releasing A = %#v, want A's oldest due head %s", claimed, firstAID)
	}

	var remainingPendingA int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)
		from public.whatsapp_webhook_inbox
		where session_id = $1::uuid
		  and status = 'pending'
	`, sessionA).Scan(&remainingPendingA); err != nil {
		t.Fatal(err)
	}
	if remainingPendingA != 1 {
		t.Fatalf("remaining pending rows for A = %d, want 1", remainingPendingA)
	}

	// Reset the fixtures and verify the worker-level lane reservation. Session A
	// and B both have fresh live work. Even though B also has an older backlog
	// row, the reserved backlog slot must skip B rather than putting that old row
	// ahead of B's live message.
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set status = 'pending', attempts = 0, locked_at = null, locked_by = null,
		    processing_lane = 'backlog'
		where organization_id = $1::uuid
	`, organizationID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		with ranked as (
			select id, row_number() over (partition by session_id order by created_at desc, id desc) as position
			from public.whatsapp_webhook_inbox
			where organization_id = $1::uuid
			  and session_id in ($2::uuid, $3::uuid)
		)
		update public.whatsapp_webhook_inbox inbox
		set processing_lane = 'live', provider_occurred_at = now()
		from ranked
		where inbox.id = ranked.id and ranked.position = 1
	`, organizationID, sessionA, sessionB); err != nil {
		t.Fatal(err)
	}
	secondBID := admit(sessionB, suffix+"-b-backlog", "5511999990001", "backlog", "pending", 0, -3*time.Minute, 3*time.Minute)

	laneItems, _, err := repo.claimEvolutionWebhooksForWorker(ctx, 2, evolutionWebhookLaneCursors{
		LiveSessionID:    cursorBefore,
		BacklogSessionID: cursorBefore,
	})
	if err != nil {
		t.Fatalf("worker lane claim: %v", err)
	}
	if len(laneItems) != 2 || laneItems[0].SessionID != sessionA || laneItems[0].ProcessingLane != evolutionWebhookLaneLive ||
		laneItems[1].SessionID != sessionC || laneItems[1].ProcessingLane != evolutionWebhookLaneBacklog {
		t.Fatalf("lane claim = %#v, want live A then backlog C", laneItems)
	}
	var bBacklogStatus string
	if err := postgres.Pool().QueryRow(ctx, `
		select status from public.whatsapp_webhook_inbox where id = $1::uuid
	`, secondBID).Scan(&bBacklogStatus); err != nil {
		t.Fatal(err)
	}
	if bBacklogStatus != "pending" {
		t.Fatalf("session B backlog status = %q, want pending while B has live work", bBacklogStatus)
	}

	// A deferred live retry is a FIFO barrier only for its own conversation.
	// Independent conversations on the same session remain eligible, while a
	// newer message for the failed conversation cannot overtake it.
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set status = 'processed', locked_at = null, locked_by = null
		where organization_id = $1::uuid
	`, organizationID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set status = 'processing', attempts = 1, locked_at = now(), locked_by = 'vimob-api-evolution-webhook-epoch1-integration-backlog'
		where id = $1::uuid
	`, secondBID); err != nil {
		t.Fatal(err)
	}
	retryHeadID := admit(sessionA, suffix+"-live-retry-head", "5511999991111", "live", "retry", 1, 5*time.Minute, 2*time.Minute)
	newerSameConversationID := admit(sessionA, suffix+"-live-newer-same", "5511999991111", "live", "pending", 0, -time.Minute, time.Minute)
	newerOtherConversationID := admit(sessionA, suffix+"-live-newer-other", "5511999992222", "live", "pending", 0, -30*time.Second, 30*time.Second)
	// Starting after the largest fixture UUID also exercises the single explicit
	// cursor wrap back to the beginning of the session index.
	bypassedRetry, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, sessionC)
	if err != nil {
		t.Fatalf("claim past deferred retry head: %v", err)
	}
	if len(bypassedRetry) != 1 || bypassedRetry[0].ID != newerOtherConversationID {
		t.Fatalf("conversation-safe bypass = %#v, want independent conversation %s", bypassedRetry, newerOtherConversationID)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set status = 'processed', locked_at = null, locked_by = null
		where id in ($1::uuid, $2::uuid)
	`, newerOtherConversationID, secondBID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set next_attempt_at = now() - interval '1 second'
		where id = $1::uuid
	`, retryHeadID); err != nil {
		t.Fatal(err)
	}
	claimedFIFO, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, sessionC)
	if err != nil {
		t.Fatalf("claim due retry head: %v", err)
	}
	if len(claimedFIFO) != 1 || claimedFIFO[0].ID != retryHeadID {
		t.Fatalf("FIFO claim = %#v, want older retry head %s", claimedFIFO, retryHeadID)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set status = 'processed', locked_at = null, locked_by = null
		where id = $1::uuid
	`, retryHeadID); err != nil {
		t.Fatal(err)
	}
	claimedAfterRetry, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, sessionC)
	if err != nil {
		t.Fatalf("claim newer same-conversation message after retry: %v", err)
	}
	if len(claimedAfterRetry) != 1 || claimedAfterRetry[0].ID != newerSameConversationID {
		t.Fatalf("post-retry claim = %#v, want newer same-conversation message %s", claimedAfterRetry, newerSameConversationID)
	}
}
