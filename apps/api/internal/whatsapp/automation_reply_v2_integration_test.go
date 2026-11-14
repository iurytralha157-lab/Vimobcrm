package whatsapp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestLocalAutomationReplyV2OrderingAndAccountGeneration(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	pool := db.Pool()
	f := createLocalSharedOutboundFixture(t, ctx, pool, "automation-reply-v2")
	configureAutomationReplyFixture(t, ctx, pool, f)
	const instance = "synthetic-instance-generation-one"
	if _, err := pool.Exec(ctx, `
		update public.whatsapp_sessions set instance_id=$3 where organization_id=$1::uuid and id=$2::uuid;
		insert into private.whatsapp_automation_reply_sessions (organization_id, session_id, enabled, activated_at)
		values ($1::uuid,$2::uuid,true,clock_timestamp())
	`, f.organizationID, f.sessionID, instance); err != nil {
		t.Fatal(err)
	}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct{ ID string }
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ID == "" {
			http.Error(w, "invalid synthetic request", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"messageId": body.ID})
	}))
	defer provider.Close()
	repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic"}})
	item, _ := queueAutomationOutboxFixture(t, ctx, pool, f)
	if err := repo.processClaimedWhatsAppOutbox(ctx, item, whatsappOutboxLaneFast); err != nil {
		t.Fatal(err)
	}
	var startedAt, acceptedAt time.Time
	var generation string
	if err := pool.QueryRow(ctx, `select started_at, accepted_at, account_generation::text
		from private.whatsapp_automation_reply_starts where outbox_id=$1::uuid and account_confirmation`,
		item.ID).Scan(&startedAt, &acceptedAt, &generation); err != nil {
		t.Fatal(err)
	}
	accept := func(label, instanceID string, at time.Time) evolutionWebhookReceipt {
		t.Helper()
		payload, err := json.Marshal(map[string]any{"event": "message", "data": map[string]any{
			"Info": map[string]any{"ID": f.suffix + "-" + label, "Chat": f.remoteJID, "SenderPN": f.remoteJID,
				"Timestamp": at.Format(time.RFC3339Nano)},
			"Message": map[string]any{"conversation": "Synthetic reply " + label},
		}})
		if err != nil {
			t.Fatal(err)
		}
		receipt, err := repo.AcceptEvolutionWebhook(ctx, evolutionWebhookEnvelope{SessionID: f.sessionID,
			RouteInstanceID: instanceID, InstanceToken: "synthetic-capture-token", WebhookHeaderTokens: []string{"synthetic-capture-hook"},
			EventType: "message", Payload: payload, ReceivedAt: time.Now().UTC()})
		if err != nil || receipt.Duplicate {
			t.Fatalf("admit %s: %v (duplicate=%v)", label, err, receipt.Duplicate)
		}
		return receipt
	}
	setStatus := func(status string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `update public.whatsapp_sessions set status=$3 where organization_id=$1::uuid and id=$2::uuid`, f.organizationID, f.sessionID, status); err != nil {
			t.Fatal(err)
		}
	}
	previous := accept("pre-send-precise", instance, startedAt.Add(-time.Microsecond))
	processCaptureIsolationInbox(t, ctx, repo, previous.ID)
	assertAutomationReply(t, ctx, pool, f, "pre-send-precise", false)

	setStatus("disconnected")
	replyAt := time.Now().UTC().Truncate(time.Millisecond)
	if replyAt.Before(acceptedAt) {
		replyAt = time.Now().UTC()
	}
	reply := accept("transient-disconnect", instance, replyAt)
	var pendingGeneration string
	if err := pool.QueryRow(ctx, `select account_generation::text from private.whatsapp_automation_pending_replies
		where inbox_id=$1::uuid`, reply.ID).Scan(&pendingGeneration); err != nil || pendingGeneration != generation {
		t.Fatalf("durable candidate lost same-account generation: %v", err)
	}
	processCaptureIsolationInbox(t, ctx, repo, reply.ID)
	assertAutomationReply(t, ctx, pool, f, "transient-disconnect", true)
	var timestampMatches, pending bool
	if err := pool.QueryRow(ctx, `select
		exists(select 1 from public.automation_event_outbox where organization_id=$1::uuid
		  and payload->>'automation_reply_inbox_accepted_at' is not null and (payload->>'occurred_at')::timestamptz=$2::timestamptz),
		exists(select 1 from private.whatsapp_automation_pending_replies where inbox_id=$3::uuid)`,
		f.organizationID, replyAt, reply.ID).Scan(&timestampMatches, &pending); err != nil || !timestampMatches || pending {
		t.Fatalf("reply event lost its original clock or left a candidate: %v (%v/%v)", err, timestampMatches, pending)
	}

	queued := accept("queued-previous-account", instance, time.Now().UTC())
	const replacement = "synthetic-instance-generation-two"
	if _, err := pool.Exec(ctx, `update public.whatsapp_sessions set instance_id=$3, status='connected'
		where organization_id=$1::uuid and id=$2::uuid`, f.organizationID, f.sessionID, replacement); err != nil {
		t.Fatal(err)
	}
	processCaptureIsolationInbox(t, ctx, repo, queued.ID)
	assertAutomationReply(t, ctx, pool, f, "queued-previous-account", false)
	newAccount := accept("replacement-account", replacement, time.Now().UTC())
	processCaptureIsolationInbox(t, ctx, repo, newAccount.ID)
	assertAutomationReply(t, ctx, pool, f, "replacement-account", false)
}
