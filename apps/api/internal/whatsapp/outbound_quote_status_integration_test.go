package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func insertHardeningTarget(t *testing.T, ctx context.Context, pool *pgxpool.Pool, fixture sessionConversationLockFixture, suffix, status string, fromMe bool) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `insert into public.whatsapp_messages
		(organization_id,session_id,conversation_id,lead_id,message_id,provider_message_id,
		 content,sender_name,sender_jid,remote_jid,from_me,direction,message_type,status,capture_state)
		values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$5,'synthetic quoted body',
		'Synthetic sender',$6,$6,$7,case when $7 then 'outbound' else 'inbound' end,'text',$8,'captured')
		returning id::text`, fixture.organizationID, fixture.sessionID, fixture.conversationID,
		fixture.leadID, fixture.suffix+suffix, fixture.remoteJID, fromMe, status).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestLocalWhatsAppQuoteAndSendStatusIsolation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	var sends atomic.Int32
	var expectedProviderID, expectedParticipant string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/send/text" || request.Method != http.MethodPost {
			t.Errorf("unexpected fake quote endpoint: %s", request.URL.Path)
			http.NotFound(w, request)
			return
		}
		sends.Add(1)
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		quoted := mapFromAny(body["quoted"])
		if len(quoted) != 2 || quoted["messageId"] != expectedProviderID || quoted["participant"] != expectedParticipant {
			t.Errorf("quote did not use the primary upstream minimal contract: %#v", quoted)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"messageId": stringFromAny(body["id"])})
	}))
	t.Cleanup(provider.Close)
	repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic-provider-key"}})
	a := outboundHardeningFixture(t, ctx, db, repo, "quote-status-a")
	b := outboundHardeningFixture(t, ctx, db, repo, "quote-status-b")
	target := insertHardeningTarget(t, ctx, db.Pool(), a, "-quote-target", "received", false)
	foreignTarget := insertHardeningTarget(t, ctx, db.Pool(), b, "-quote-target", "received", false)
	expectedProviderID, expectedParticipant = a.suffix+"-quote-target", a.remoteJID
	clientID := a.suffix + "-quoted-intent"
	queued := queueHardeningMessage(t, ctx, repo, a, sendMessageInput{Text: "synthetic reply", ClientMessageID: clientID, QuotedMessageID: target})
	assertQuoted := func(message *Message) {
		t.Helper()
		if message == nil || message.QuotedMessage == nil || !message.QuotedMessage.Available ||
			pointerValue(message.QuotedMessage.ID) != target || pointerValue(message.QuotedMessage.Content) != "synthetic quoted body" {
			t.Fatalf("canonical authorized quote missing: %+v", message)
		}
		encoded, err := json.Marshal(message)
		if err != nil {
			t.Fatal(err)
		}
		for _, private := range []string{"quoted_message_id", "ingress_sequence", "send_attendance", "provider_started", "participant"} {
			if strings.Contains(string(encoded), private) {
				t.Fatalf("private field %s leaked: %s", private, encoded)
			}
		}
		if len(message.Metadata) != 0 {
			t.Fatalf("raw metadata leaked: %#v", message.Metadata)
		}
	}
	assertQuoted(queued.Message)
	status, err := repo.GetSendStatus(ctx, a.tenant, a.conversationID, clientID, a.leadID)
	if err != nil || status.Status != "queued" {
		t.Fatalf("durable status lookup: %+v %v", status, err)
	}
	assertQuoted(status.Message)
	for _, check := range []struct {
		conversation, client, lead string
		owner                      sessionConversationLockFixture
	}{
		{a.conversationID, a.suffix + "-absent", a.leadID, a},
		{a.conversationID, clientID, b.leadID, a},
		{a.conversationID, clientID, a.leadID, b},
		{b.conversationID, clientID, b.leadID, b},
	} {
		if result, err := repo.GetSendStatus(ctx, check.owner.tenant, check.conversation, check.client, check.lead); err == nil || result.Message != nil {
			t.Fatalf("missing/foreign intent became visible: %+v %v", result, err)
		}
	}
	if _, err := repo.GetSendStatus(ctx, a.tenant, a.conversationID, a.suffix+"-absent", a.leadID); !errors.Is(err, ErrMessageNotFound) {
		t.Fatalf("absence must remain not-found, not a failed/send-again result: %v", err)
	}
	for _, rejected := range []string{foreignTarget, "00000000-0000-4000-8000-000000000099"} {
		if _, err := repo.SendMessage(ctx, a.tenant, a.conversationID, sendMessageInput{
			Text: "synthetic disallowed quote", ClientMessageID: a.suffix + rejected,
			ExpectedLeadID: a.leadID, QuotedMessageID: rejected,
		}); !errors.Is(err, ErrQuoteTargetUnavailable) {
			t.Fatalf("foreign/missing quote accepted: %v", err)
		}
	}
	if duplicate, err := repo.SendMessage(ctx, a.tenant, a.conversationID, sendMessageInput{
		Text: "synthetic reply", ClientMessageID: clientID, ExpectedLeadID: a.leadID, QuotedMessageID: target,
	}); err != nil || duplicate.Message == nil || duplicate.Message.ID != queued.Message.ID {
		t.Fatalf("quote intent lost dedupe: %+v %v", duplicate, err)
	}
	item := leaseLocalOutbound(t, ctx, db.Pool(), a.organizationID, clientID)
	if err := repo.processClaimedWhatsAppOutbox(ctx, item, whatsappOutboxLaneFast); err != nil {
		t.Fatal(err)
	}
	assertLocalOutboundState(t, ctx, db.Pool(), item, "sent", 1)
	if sends.Load() != 1 {
		t.Fatalf("provider sends=%d, want one", sends.Load())
	}
	status, err = repo.GetSendStatus(ctx, a.tenant, a.conversationID, clientID, a.leadID)
	if err != nil || status.Status != "sent" {
		t.Fatalf("final status lookup: %+v %v", status, err)
	}
	assertQuoted(status.Message)
}

func TestLocalWhatsAppQuoteAndReactionTargetRevalidation(t *testing.T) {
	for _, action := range []string{"quote", "reaction"} {
		t.Run(action, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			db := openLocalOutboundDatabase(t, ctx)
			var sends atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				sends.Add(1)
				http.Error(w, "should never send", 500)
			}))
			t.Cleanup(provider.Close)
			repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic-provider-key"}})
			fixture := outboundHardeningFixture(t, ctx, db, repo, action+"-recheck")
			pendingTarget := insertHardeningTarget(t, ctx, db.Pool(), fixture, "-pending-target", "queued", true)
			clientID := fixture.suffix + "-action"
			queue := func(target string) error {
				if action == "reaction" {
					_, err := repo.ReactToMessage(ctx, fixture.tenant, fixture.conversationID, target,
						reactToMessageInput{Emoji: "👍", ClientReactionID: clientID, ExpectedLeadID: fixture.leadID})
					return err
				}
				_, err := repo.SendMessage(ctx, fixture.tenant, fixture.conversationID, sendMessageInput{
					Text: "synthetic reply", ClientMessageID: clientID, ExpectedLeadID: fixture.leadID, QuotedMessageID: target})
				return err
			}
			wantErr := ErrQuoteTargetUnavailable
			if action == "reaction" {
				wantErr = ErrReactionTargetUnconfirmed
			}
			if err := queue(pendingTarget); !errors.Is(err, wantErr) {
				t.Fatalf("unconfirmed outbound target was accepted: %v", err)
			}
			target := insertHardeningTarget(t, ctx, db.Pool(), fixture, "-confirmed-target", "received", false)
			if err := queue(target); err != nil {
				t.Fatal(err)
			}
			item := leaseLocalOutbound(t, ctx, db.Pool(), fixture.organizationID, clientID)
			if _, err := db.Pool().Exec(ctx, `update public.whatsapp_messages set message_type='deleted',content=null where id=$1::uuid`, target); err != nil {
				t.Fatal(err)
			}
			// Exercise the atomic provider-start fence independently of the cheap
			// worker check: deleting the target must not consume an attempt.
			if _, err := repo.startWhatsAppOutboxProviderAttempt(ctx, item); !errors.Is(err, wantErr) {
				t.Fatalf("atomic target fence: %v", err)
			}
			if err := repo.processClaimedWhatsAppOutbox(ctx, item, whatsappOutboxLaneFast); err != nil {
				t.Fatal(err)
			}
			assertLocalOutboundState(t, ctx, db.Pool(), item, "failed", 0)
			if sends.Load() != 0 {
				t.Fatal("invalid target reached fake provider")
			}
		})
	}
}
