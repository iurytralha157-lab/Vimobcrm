package whatsapp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestLocalAutomationReplyCaptureRequiresAcceptedSendAndExactScope(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	pool := db.Pool()
	f := createLocalSharedOutboundFixture(t, ctx, pool, "automation-reply")
	foreign := createLocalSharedOutboundFixture(t, ctx, pool, "automation-reply-foreign")
	for _, fixture := range []sessionConversationLockFixture{f, foreign} {
		configureAutomationReplyFixture(t, ctx, pool, fixture)
	}
	neighbor := addAutomationReplyNeighbor(t, ctx, pool, f)

	var reject atomic.Bool
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var request struct{ ID, Number string }
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || r.URL.Path != "/send/text" || request.Number != f.phone {
			t.Errorf("unexpected synthetic provider request: %s, %v", r.URL.Path, err)
			http.Error(w, "unexpected synthetic provider request", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if reject.Load() {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "number " + f.remoteJID + " is not registered on whatsapp"})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"messageId": request.ID})
	}))
	defer provider.Close()
	repo := NewRepository(db, nil, StorageConfig{
		EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic"},
	})

	acceptReply := func(fixture sessionConversationLockFixture, label string, at time.Time) (evolutionWebhookReceipt, evolutionWebhookEnvelope) {
		t.Helper()
		return acceptAutomationReply(t, ctx, repo, fixture, label, at)
	}
	assertReply := func(fixture sessionConversationLockFixture, label string, captured bool) {
		t.Helper()
		assertAutomationReply(t, ctx, pool, fixture, label, captured)
	}

	// An outbound admission provides no proof of contact, and a provider
	// rejection cannot authorize capture after the attempt becomes terminal.
	reject.Store(true)
	failed, _ := queueAutomationOutboxFixture(t, ctx, pool, f)
	reply, _ := acceptReply(f, "queued-only", time.Now().UTC())
	processCaptureIsolationInbox(t, ctx, repo, reply.ID)
	assertReply(f, "queued-only", false)
	oldInboxID := reply.ID
	if err := repo.processClaimedWhatsAppOutbox(ctx, failed, whatsappOutboxLaneFast); err != nil {
		t.Fatal(err)
	}
	assertLocalOutboundState(t, ctx, pool, failed, "failed", 1)
	reply, _ = acceptReply(f, "failed-send", time.Now().UTC())
	processCaptureIsolationInbox(t, ctx, repo, reply.ID)
	assertReply(f, "failed-send", false)

	// A message admitted before provider start remains old even if the worker
	// only processes it after the next outbound has been accepted.
	beforeStart := time.Now().UTC()
	oldReply, _ := acceptReply(f, "before-start", beforeStart)
	reject.Store(false)
	sent, _ := queueAutomationOutboxFixture(t, ctx, pool, f)
	if err := repo.processClaimedWhatsAppOutbox(ctx, sent, whatsappOutboxLaneFast); err != nil {
		t.Fatal(err)
	}
	assertLocalOutboundState(t, ctx, pool, sent, "sent", 1)
	if calls.Load() != 2 {
		t.Fatalf("provider received %d calls, want 2", calls.Load())
	}
	processCaptureIsolationInbox(t, ctx, repo, oldReply.ID)
	assertReply(f, "before-start", false)

	// Late acceptance of an older provider event cannot make it a reply to the
	// automation. An existing callback keeps its original capture decision.
	reply, _ = acceptReply(f, "late-old-event", beforeStart.Add(-2*time.Second))
	processCaptureIsolationInbox(t, ctx, repo, reply.ID)
	assertReply(f, "late-old-event", false)
	// Model a redacted row written by a legacy processor before it was upgraded.
	// The modern test cluster always admits v1 routing snapshots.
	if _, err := pool.Exec(ctx, `update public.whatsapp_messages set capture_state='suppressed', content=null
		where organization_id=$1::uuid and session_id=$2::uuid and provider_message_id=$3`,
		f.organizationID, f.sessionID, f.suffix+"-queued-only"); err != nil {
		t.Fatal(err)
	}
	// Run the original durable inbox row again without changing its admitted
	// envelope. This exercises the processor even though ingress normally
	// handles duplicate provider callbacks before they can reach the worker.
	result, err := pool.Exec(ctx, `update public.whatsapp_webhook_inbox
		set status='retry', next_attempt_at=now()
		where organization_id=$1::uuid and id=$2::uuid and status='processed'`, f.organizationID, oldInboxID)
	if err != nil || result.RowsAffected() != 1 {
		t.Fatalf("could not requeue exact synthetic inbox row: %v", err)
	}
	processCaptureIsolationInbox(t, ctx, repo, oldInboxID)
	if state := assertAutomationReply(t, ctx, pool, f, "queued-only", false); state != "suppressed" {
		t.Fatalf("replay changed the original suppressed decision to %s", state)
	}

	for _, scenario := range []struct {
		name     string
		fixture  sessionConversationLockFixture
		captured bool
	}{
		{"exact-automation-reply", f, true},
		{"other-binding-same-connection", neighbor, false},
		{"other-organization", foreign, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			reply, _ := acceptReply(scenario.fixture, scenario.name, time.Now().UTC())
			processCaptureIsolationInbox(t, ctx, repo, reply.ID)
			assertReply(scenario.fixture, scenario.name, scenario.captured)
		})
	}

	// Only the contact's own lead history becomes readable to the current
	// assignee. Automation did not create permissions to operate the owner's inbox.
	history, err := repo.GetHistoryAccess(ctx, f.tenant, HistoryAccessFilter{LeadID: f.leadID, MessageFilter: MessageFilter{Limit: 25}})
	if err != nil {
		t.Fatal(err)
	}
	var received int
	for _, message := range history.Messages {
		if message.MessageID == f.suffix+"-exact-automation-reply" {
			received++
		}
	}
	if received != 1 {
		t.Fatalf("eligible lead assignee sees %d copies of accepted reply, want 1", received)
	}
	var attendance, shared int
	if err := pool.QueryRow(ctx, `select
		(select count(*) from public.whatsapp_attendance_entries where organization_id=$1::uuid and conversation_id=$2::uuid),
		(select count(*) from public.whatsapp_session_access where organization_id=$1::uuid and session_id=$3::uuid)`,
		f.organizationID, f.conversationID, f.sessionID).Scan(&attendance, &shared); err != nil || attendance != 0 || shared != 0 {
		t.Fatalf("reply capture changed human attendance (%d) or connection sharing (%d): %v", attendance, shared, err)
	}
}

func TestLocalAutomationReplyWaitsForInFlightProviderAcknowledgement(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	pool := db.Pool()
	f := createLocalSharedOutboundFixture(t, ctx, pool, "automation-reply-race")
	configureAutomationReplyFixture(t, ctx, pool, f)

	started := make(chan struct{})
	ack := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(ack) }) }
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct{ ID, Number string }
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || r.URL.Path != "/send/text" || request.Number != f.phone {
			t.Errorf("unexpected synthetic provider request: %s, %v", r.URL.Path, err)
			http.Error(w, "unexpected synthetic provider request", http.StatusBadRequest)
			return
		}
		close(started)
		select {
		case <-r.Context().Done():
			return
		case <-ack:
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"messageId": request.ID})
	}))
	defer provider.Close()
	defer release()
	repo := NewRepository(db, nil, StorageConfig{
		EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic"},
	})
	item, _ := queueAutomationOutboxFixture(t, ctx, pool, f)
	completed := make(chan error, 1)
	go func() { completed <- repo.processClaimedWhatsAppOutbox(ctx, item, whatsappOutboxLaneFast) }()
	select {
	case <-started:
	case err := <-completed:
		t.Fatalf("outbox worker completed before provider call: %v", err)
	case <-ctx.Done():
		t.Fatal("outbox worker did not reach the synthetic provider")
	}

	receipt, _ := acceptAutomationReply(t, ctx, repo, f, "rapid-reply", time.Now().UTC())
	items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
	if err != nil || len(items) != 1 || items[0].ID != receipt.ID {
		t.Fatalf("expected the rapid reply in the live lane, got %#v: %v", items, err)
	}
	if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
		t.Fatal(err)
	}
	assertRouteClaimState(t, ctx, pool, receipt.ID, "retry", items[0].Attempts)
	var messages int
	if err := pool.QueryRow(ctx, `select count(*) from public.whatsapp_messages
		where organization_id=$1::uuid and session_id=$2::uuid and provider_message_id=$3`,
		f.organizationID, f.sessionID, f.suffix+"-rapid-reply").Scan(&messages); err != nil || messages != 0 {
		t.Fatalf("undecided reply was persisted before provider acceptance (%d rows): %v", messages, err)
	}

	release()
	select {
	case err := <-completed:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("outbox worker did not complete after the synthetic acknowledgement")
	}
	assertLocalOutboundState(t, ctx, pool, item, "sent", 1)
	if _, err := pool.Exec(ctx, `update public.whatsapp_webhook_inbox set next_attempt_at=now()
		where organization_id=$1::uuid and id=$2::uuid and status='retry'`, f.organizationID, receipt.ID); err != nil {
		t.Fatal(err)
	}
	processCaptureIsolationInbox(t, ctx, repo, receipt.ID)
	assertAutomationReply(t, ctx, pool, f, "rapid-reply", true)
}

func TestLocalAutomationReplyUsesExactProviderReceipt(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	pool := db.Pool()
	f := createLocalSharedOutboundFixture(t, ctx, pool, "automation-reply-receipt")
	foreign := createLocalSharedOutboundFixture(t, ctx, pool, "automation-reply-receipt-foreign")
	configureAutomationReplyFixture(t, ctx, pool, f)
	configureAutomationReplyFixture(t, ctx, pool, foreign)
	repo := NewRepository(db, nil, StorageConfig{})
	item, _ := queueAutomationOutboxFixture(t, ctx, pool, f)
	if item.ProviderMessageID == "" {
		t.Fatal("queued automation has no deterministic provider identity")
	}
	if _, err := repo.startWhatsAppOutboxProviderAttempt(ctx, item); err != nil {
		t.Fatal(err)
	}
	assertReceiptProof := func(wantAccepted bool) {
		t.Helper()
		var accepted bool
		if err := pool.QueryRow(ctx, `select accepted_at is not null from private.whatsapp_automation_reply_starts
			where organization_id=$1::uuid and outbox_id=$2::uuid`, f.organizationID, item.ID).Scan(&accepted); err != nil || accepted != wantAccepted {
			t.Fatalf("persisted reply proof accepted=%v, want %v: %v", accepted, wantAccepted, err)
		}
	}
	acceptReceipt := func(fixture sessionConversationLockFixture) {
		t.Helper()
		now := time.Now().UTC()
		payload, err := json.Marshal(map[string]any{"event": "receipt", "data": map[string]any{
			"MessageIDs": []string{item.ProviderMessageID}, "Chat": fixture.remoteJID,
			"status": "delivered", "timestamp": now.Format(time.RFC3339Nano),
		}})
		if err != nil {
			t.Fatal(err)
		}
		receipt, err := repo.AcceptEvolutionWebhook(ctx, evolutionWebhookEnvelope{
			SessionID: fixture.sessionID, InstanceToken: "synthetic-capture-token", WebhookHeaderTokens: []string{"synthetic-capture-hook"},
			EventType: "receipt", Payload: payload, ReceivedAt: now,
		})
		if err != nil || receipt.Duplicate {
			t.Fatalf("accept synthetic provider receipt: %#v, %v", receipt, err)
		}
		processCaptureIsolationInbox(t, ctx, repo, receipt.ID)
	}
	assertReceiptProof(false)
	acceptReceipt(foreign)
	assertReceiptProof(false)
	acceptReceipt(f)
	assertReceiptProof(true)
	assertReceiptFixtureState(t, ctx, repo, f, item.ProviderMessageID, "delivered")
	reply, _ := acceptAutomationReply(t, ctx, repo, f, "after-provider-receipt", time.Now().UTC())
	processCaptureIsolationInbox(t, ctx, repo, reply.ID)
	assertAutomationReply(t, ctx, pool, f, "after-provider-receipt", true)
}

func configureAutomationReplyFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, f sessionConversationLockFixture) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		delete from public.whatsapp_session_access where organization_id=$1::uuid and session_id=$2::uuid;
		update public.whatsapp_sessions
		set advanced_settings='{"token":"synthetic-capture-token","webhook_token":"synthetic-capture-hook"}'::jsonb
		where organization_id=$1::uuid and id=$2::uuid;
		insert into private.whatsapp_webhook_session_cutovers(session_id,active_epoch,cutover_at)
		values($2::uuid,1,now() - interval '10 minutes');
		insert into public.organization_modules(organization_id,module_name,is_enabled) values($1::uuid,'automations',true)
	`, f.organizationID, f.sessionID); err != nil {
		t.Fatal(err)
	}
}

func addAutomationReplyNeighbor(t *testing.T, ctx context.Context, pool *pgxpool.Pool, f sessionConversationLockFixture) sessionConversationLockFixture {
	t.Helper()
	other := f
	other.suffix += "-neighbor"
	other.phone = "5511980000001"
	other.remoteJID = other.phone + "@s.whatsapp.net"
	if err := pool.QueryRow(ctx, `insert into public.leads(organization_id,assigned_user_id,name,phone,source)
		values($1::uuid,$2::uuid,'Synthetic unrelated lead',$3,'whatsapp') returning id::text`,
		f.organizationID, f.tenant.UserID, other.phone).Scan(&other.leadID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `insert into public.whatsapp_conversations(organization_id,session_id,remote_jid,contact_phone,assigned_user_id)
		values($1::uuid,$2::uuid,$3,$4,$5::uuid) returning id::text`,
		f.organizationID, f.sessionID, other.remoteJID, other.phone, f.tenant.UserID).Scan(&other.conversationID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `select public.activate_whatsapp_conversation_lead_binding($1::uuid,$2::uuid,$3::uuid,null)`,
		f.organizationID, other.conversationID, other.leadID); err != nil {
		t.Fatal(err)
	}
	return other
}

func acceptAutomationReply(t *testing.T, ctx context.Context, repo Repository, f sessionConversationLockFixture, label string, occurredAt time.Time) (evolutionWebhookReceipt, evolutionWebhookEnvelope) {
	t.Helper()
	payload, err := json.Marshal(map[string]any{"event": "message", "data": map[string]any{
		"Info": map[string]any{"ID": f.suffix + "-" + label, "Chat": f.remoteJID, "SenderPN": f.remoteJID,
			"Timestamp": occurredAt.Format(time.RFC3339Nano)},
		"Message": map[string]any{"conversation": "Synthetic reply " + label},
	}})
	if err != nil {
		t.Fatal(err)
	}
	envelope := evolutionWebhookEnvelope{SessionID: f.sessionID, InstanceToken: "synthetic-capture-token",
		WebhookHeaderTokens: []string{"synthetic-capture-hook"}, EventType: "message", Payload: payload, ReceivedAt: time.Now().UTC()}
	receipt, err := repo.AcceptEvolutionWebhook(ctx, envelope)
	if err != nil || receipt.Duplicate {
		t.Fatalf("accept synthetic reply: %#v, %v", receipt, err)
	}
	return receipt, envelope
}

func assertAutomationReply(t *testing.T, ctx context.Context, pool *pgxpool.Pool, f sessionConversationLockFixture, label string, captured bool) string {
	t.Helper()
	var state, content string
	var events int
	if err := pool.QueryRow(ctx, `select message.capture_state, coalesce(message.content,''), (
		select count(*) from public.automation_event_outbox event
		where event.organization_id=message.organization_id and event.lead_id=message.lead_id
		  and event.conversation_id=message.conversation_id and event.aggregate_id=message.id
		  and event.event_type='message_received')
		from public.whatsapp_messages message
		where message.organization_id=$1::uuid and message.session_id=$2::uuid
		and message.conversation_id=$3::uuid and message.lead_id=$4::uuid and message.provider_message_id=$5`,
		f.organizationID, f.sessionID, f.conversationID, f.leadID, f.suffix+"-"+label).Scan(&state, &content, &events); err != nil {
		t.Fatal(err)
	}
	visibleContent := "Synthetic reply " + label
	if captured {
		if state != "captured" || content != visibleContent || events != 1 {
			t.Fatalf("%s: want one captured reply event, got state=%s content=%q automation events=%d", label, state, content, events)
		}
		return state
	}
	if events != 0 || !((state == "suppressed" && content == "") || (state == "observed_unattended" && content == visibleContent)) {
		t.Fatalf("%s: unproven reply escaped the existing capture policy: state=%s content=%q automation events=%d", label, state, content, events)
	}
	return state
}
