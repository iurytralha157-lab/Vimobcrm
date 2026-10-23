package whatsapp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// Only synthetic fixtures in webhookDependencyDatabase's explicit loopback
// database are admitted. No real provider, Storage or recovery target is used.
func TestWebhookCapturedMediaFailureDoesNotBlockSameRouteText(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "capture-media-isolation")
	var downloads atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/message/downloadmedia" {
			t.Errorf("unexpected synthetic media request: %s %s", r.Method, r.URL.Path)
		}
		downloads.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"synthetic download failure"}`))
	}))
	defer provider.Close()
	repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic-provider-key"}})
	configureCaptureIsolationFixture(t, ctx, repo, f)
	media, _ := acceptCaptureIsolationMessage(t, ctx, repo, f, "image", map[string]any{
		"imageMessage": map[string]any{"mimetype": "image/jpeg", "fileLength": 200, "directPath": "/synthetic/encrypted-image"},
	})
	text, _ := acceptCaptureIsolationMessage(t, ctx, repo, f, "next-text", map[string]any{"conversation": "synthetic following text"})
	assertCaptureIsolationPredecessor(t, ctx, repo, f, "next-text", "image")
	// The same route's successor cannot run before the real capture commits.
	processCaptureIsolationInbox(t, ctx, repo, media.ID)
	assertCaptureIsolationCounts(t, ctx, repo, f, 1, 1, 1)
	if downloads.Load() != 0 {
		t.Fatal("capture performed synchronous provider I/O")
	}
	var messageID, jobID, captureState, jobState string
	if err := db.Pool().QueryRow(ctx, `select m.id::text, j.id::text, m.capture_state, j.status
		from public.whatsapp_messages m join public.media_jobs j on j.message_id=m.id
		where m.organization_id=$1::uuid and m.session_id=$2::uuid`, f.organizationID, f.sessionID).
		Scan(&messageID, &jobID, &captureState, &jobState); err != nil {
		t.Fatal(err)
	}
	if captureState != "captured" || jobState != "pending" {
		t.Fatalf("capture/job were not committed together: %s/%s", captureState, jobState)
	}
	// Spend a bounded synthetic job budget; this does not modify the inbox or
	// the immutable message target and cannot acknowledge the following text.
	if _, err := db.Pool().Exec(ctx, `update public.media_jobs set max_attempts=1
		where organization_id=$1::uuid and id=$2::uuid`, f.organizationID, jobID); err != nil {
		t.Fatal(err)
	}
	if claimed, err := repo.drainOneWhatsAppMediaJobForSessions(ctx, time.Minute, 1, []string{f.sessionID}); err != nil || !claimed {
		t.Fatalf("synthetic failed-media drain=%v/%v", claimed, err)
	}
	if err := db.Pool().QueryRow(ctx, `select status from public.media_jobs where id=$1::uuid`, jobID).Scan(&jobState); err != nil || jobState != "failed" || downloads.Load() != 1 {
		t.Fatalf("failed media was not isolated: status=%s downloads=%d error=%v", jobState, downloads.Load(), err)
	}
	processCaptureIsolationInbox(t, ctx, repo, text.ID)
	assertCaptureIsolationCounts(t, ctx, repo, f, 2, 1, 2)
	var stableTarget bool
	if err := db.Pool().QueryRow(ctx, `select conversation_id=$3::uuid and lead_id=$4::uuid
		from public.whatsapp_messages where organization_id=$1::uuid and id=$2::uuid`, f.organizationID, messageID, f.conversationID, f.leadID).Scan(&stableTarget); err != nil || !stableTarget {
		t.Fatalf("media recovery changed captured target: %v/%v", stableTarget, err)
	}
}

func TestWebhookCaptureCancellationKeepsRoutePendingAndNeighborProgresses(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "capture-cancel-isolation")
	repo := NewRepository(db, nil, StorageConfig{})
	configureCaptureIsolationFixture(t, ctx, repo, f)
	other := addCaptureIsolationNeighbor(t, ctx, repo, f)
	root, _ := acceptCaptureIsolationMessage(t, ctx, repo, f, "blocked", map[string]any{"conversation": "synthetic blocked text"})
	items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
	if err != nil || len(items) != 1 || items[0].ID != root.ID {
		t.Fatalf("blocked-root claim=%#v/%v", items, err)
	}
	successor, _ := acceptCaptureIsolationMessage(t, ctx, repo, f, "dependent", map[string]any{"conversation": "synthetic dependent text"})
	assertCaptureIsolationPredecessor(t, ctx, repo, f, "dependent", "blocked")
	neighbor, _ := acceptCaptureIsolationMessage(t, ctx, repo, other, "neighbor", map[string]any{"conversation": "synthetic independent text"})
	blocker, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackWebhookTx(blocker)
	if _, err := blocker.Exec(ctx, `select id from public.whatsapp_conversations where id=$1::uuid for update`, f.conversationID); err != nil {
		t.Fatal(err)
	}
	jobCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	finished := make(chan error, 1)
	go func() { finished <- repo.processClaimedEvolutionWebhook(jobCtx, items[0]) }()
	assertNativeSessionLockHeld(t, ctx, repo, f.sessionID)
	processCaptureIsolationInbox(t, ctx, repo, neighbor.ID)
	select {
	case err := <-finished:
		t.Fatalf("blocked capture ended before cancellation: %v", err)
	default:
	}
	cancel()
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("canceled capture did not roll back and release its bounded lease")
	}
	var messages, outcomes, media int
	if err := db.Pool().QueryRow(ctx, `select
		(select count(*) from public.whatsapp_messages where organization_id=$1::uuid and conversation_id=$2::uuid),
		(select count(*) from public.whatsapp_webhook_routing_outcomes where organization_id=$1::uuid and provider_message_id=$3),
		(select count(*) from public.media_jobs where organization_id=$1::uuid)`, f.organizationID, f.conversationID, f.suffix+"-blocked").Scan(&messages, &outcomes, &media); err != nil || messages != 0 || outcomes != 0 || media != 0 {
		t.Fatalf("canceled capture left partial effects: messages=%d outcomes=%d media=%d error=%v", messages, outcomes, media, err)
	}
	assertRouteClaimState(t, ctx, db.Pool(), root.ID, "retry", 1)
	assertRouteClaimState(t, ctx, db.Pool(), successor.ID, "pending", 0)
	items, _, err = repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
	if err != nil || len(items) != 0 {
		t.Fatalf("canceled predecessor released its successor early: %#v/%v", items, err)
	}
	assertCaptureIsolationCounts(t, ctx, repo, other, 1, 0, 1)
}

func TestWebhookSupportedAlbumRecoveryPreservesOutcomeDedupAndFIFO(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "capture-album-recovery")
	repo := NewRepository(db, nil, StorageConfig{})
	configureCaptureIsolationFixture(t, ctx, repo, f)
	root, rootEnvelope := acceptCaptureIsolationMessage(t, ctx, repo, f, "album", map[string]any{
		"albumMessage": map[string]any{"expectedImageCount": 2}, "messageContextInfo": map[string]any{},
	})
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox set status='dead',attempts=max_attempts,dead_lettered_at=now()
		where id=$1::uuid and organization_id=$2::uuid`, root.ID, f.organizationID); err != nil {
		t.Fatal(err)
	}
	successor, _ := acceptCaptureIsolationMessage(t, ctx, repo, f, "album-successor", map[string]any{"conversation": "synthetic after album"})
	assertCaptureIsolationPredecessor(t, ctx, repo, f, "album-successor", "album")
	items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
	if err != nil || len(items) != 0 {
		t.Fatalf("dead album granted a false predecessor completion: %#v/%v", items, err)
	}
	// Local fixture recovery changes only state/budget. The original payload,
	// snapshot, provider ID, epoch, binding and event key remain immutable.
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox set status='retry',attempts=0,next_attempt_at=now()
		where id=$1::uuid and organization_id=$2::uuid and status='dead'`, root.ID, f.organizationID); err != nil {
		t.Fatal(err)
	}
	processCaptureIsolationInbox(t, ctx, repo, root.ID)
	assertCaptureIsolationCounts(t, ctx, repo, f, 1, 0, 1)
	processCaptureIsolationInbox(t, ctx, repo, successor.ID)
	replay, err := repo.AcceptEvolutionWebhook(ctx, rootEnvelope)
	if err != nil || !replay.Duplicate || replay.ID != root.ID {
		t.Fatalf("supported album replay lost exact dedup: %#v/%v", replay, err)
	}
	assertCaptureIsolationCounts(t, ctx, repo, f, 2, 0, 2)
	var content string
	if err := db.Pool().QueryRow(ctx, `select content from public.whatsapp_messages
		where organization_id=$1::uuid and session_id=$2::uuid and provider_message_id=$3`, f.organizationID, f.sessionID, f.suffix+"-album").Scan(&content); err != nil || content != "Álbum de fotos ou vídeos" {
		t.Fatalf("supported album did not create its real structured message: %q/%v", content, err)
	}
}

func configureCaptureIsolationFixture(t *testing.T, ctx context.Context, repo Repository, f sessionConversationLockFixture) {
	t.Helper()
	if _, err := repo.db.Pool().Exec(ctx, `update public.whatsapp_sessions
		set advanced_settings='{"token":"synthetic-capture-token","webhook_token":"synthetic-capture-hook"}'::jsonb where id=$1::uuid`, f.sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
		t.Fatal(err)
	}
}

func acceptCaptureIsolationMessage(t *testing.T, ctx context.Context, repo Repository, f sessionConversationLockFixture, label string, node map[string]any) (evolutionWebhookReceipt, evolutionWebhookEnvelope) {
	t.Helper()
	now := time.Now().UTC()
	payload, err := json.Marshal(map[string]any{"event": "message", "data": map[string]any{
		"Info":    map[string]any{"ID": f.suffix + "-" + label, "Chat": f.remoteJID, "SenderPN": f.remoteJID, "Timestamp": now.Format(time.RFC3339Nano)},
		"Message": node,
	}})
	if err != nil {
		t.Fatal(err)
	}
	envelope := evolutionWebhookEnvelope{SessionID: f.sessionID, InstanceToken: "synthetic-capture-token", WebhookHeaderTokens: []string{"synthetic-capture-hook"}, EventType: "message", Payload: payload, ReceivedAt: now}
	receipt, err := repo.AcceptEvolutionWebhook(ctx, envelope)
	if err != nil || receipt.Duplicate {
		t.Fatalf("accept synthetic capture=%#v/%v", receipt, err)
	}
	return receipt, envelope
}

func processCaptureIsolationInbox(t *testing.T, ctx context.Context, repo Repository, inboxID string) {
	t.Helper()
	var lane string
	if err := repo.db.Pool().QueryRow(ctx, `select processing_lane from public.whatsapp_webhook_inbox where id=$1::uuid`, inboxID).Scan(&lane); err != nil {
		t.Fatal(err)
	}
	items, _, err := repo.claimEvolutionWebhooksForLane(ctx, lane, 1, "")
	if err != nil || len(items) != 1 || items[0].ID != inboxID {
		t.Fatalf("capture FIFO claim=%#v/%v, want %s", items, err, inboxID)
	}
	if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
		t.Fatal(err)
	}
	assertRouteClaimState(t, ctx, repo.db.Pool(), inboxID, "processed", items[0].Attempts)
}

func assertCaptureIsolationCounts(t *testing.T, ctx context.Context, repo Repository, f sessionConversationLockFixture, wantMessages, wantJobs, wantOutcomes int) {
	t.Helper()
	var messages, jobs, outcomes, unread int
	if err := repo.db.Pool().QueryRow(ctx, `select
		(select count(*) from public.whatsapp_messages where organization_id=$1::uuid and conversation_id=$2::uuid and lead_id=$3::uuid),
		(select count(*) from public.media_jobs where organization_id=$1::uuid and conversation_id=$2::uuid),
		(select count(*) from public.whatsapp_webhook_routing_outcomes where organization_id=$1::uuid),
		(select unread_count from public.whatsapp_conversations where id=$2::uuid)`, f.organizationID, f.conversationID, f.leadID).
		Scan(&messages, &jobs, &outcomes, &unread); err != nil || messages != wantMessages || jobs != wantJobs || outcomes != wantOutcomes || unread != wantMessages {
		t.Fatalf("capture cardinalities messages=%d/%d jobs=%d/%d outcomes=%d/%d unread=%d error=%v", messages, wantMessages, jobs, wantJobs, outcomes, wantOutcomes, unread, err)
	}
}

func assertCaptureIsolationPredecessor(t *testing.T, ctx context.Context, repo Repository, f sessionConversationLockFixture, successor, predecessor string) {
	t.Helper()
	var exact bool
	if err := repo.db.Pool().QueryRow(ctx, `select successor.predecessor_provider_message_id=predecessor.provider_message_id
		and successor.routing_key=predecessor.routing_key and successor.processing_epoch=predecessor.processing_epoch
		and successor.ingress_sequence>predecessor.ingress_sequence
		from public.whatsapp_webhook_routing_snapshots successor
		join public.whatsapp_webhook_routing_snapshots predecessor
		on predecessor.organization_id=successor.organization_id and predecessor.session_id=successor.session_id
		where successor.organization_id=$1::uuid and successor.session_id=$2::uuid
		and successor.provider_message_id=$3 and predecessor.provider_message_id=$4`, f.organizationID, f.sessionID, f.suffix+"-"+successor, f.suffix+"-"+predecessor).Scan(&exact); err != nil || !exact {
		t.Fatalf("synthetic fixture did not establish the exact same-route predecessor: %v/%v", exact, err)
	}
}

func addCaptureIsolationNeighbor(t *testing.T, ctx context.Context, repo Repository, f sessionConversationLockFixture) sessionConversationLockFixture {
	t.Helper()
	other := f
	other.suffix += "-other"
	other.phone = "5511980000001"
	other.remoteJID = other.phone + "@s.whatsapp.net"
	if err := repo.db.Pool().QueryRow(ctx, `insert into public.leads (organization_id,assigned_user_id,name,phone,source)
		values($1::uuid,$2::uuid,'synthetic neighboring lead',$3,'whatsapp') returning id::text`, f.organizationID, f.userID, other.phone).Scan(&other.leadID); err != nil {
		t.Fatal(err)
	}
	if err := repo.db.Pool().QueryRow(ctx, `insert into public.whatsapp_conversations(organization_id,session_id,remote_jid,contact_phone,assigned_user_id)
		values($1::uuid,$2::uuid,$3,$4,$5::uuid) returning id::text`, f.organizationID, f.sessionID, other.remoteJID, other.phone, f.userID).Scan(&other.conversationID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.db.Pool().Exec(ctx, `select public.activate_whatsapp_conversation_lead_binding($1::uuid,$2::uuid,$3::uuid,null)`, f.organizationID, other.conversationID, other.leadID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.JoinConversationAttendance(ctx, f.tenant, other.conversationID, attendanceInput{ExpectedLeadID: other.leadID, SendSessionID: f.sessionID}); err != nil {
		t.Fatal(err)
	}
	return other
}
