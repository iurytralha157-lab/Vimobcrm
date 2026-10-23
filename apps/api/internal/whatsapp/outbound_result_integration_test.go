package whatsapp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestLocalWhatsAppRejectedAndAmbiguousSendStatusNeverResends(t *testing.T) {
	for _, scenario := range []struct {
		name                          string
		status                        int
		body, errorCode, outboxStatus string
	}{
		{"unregistered500", 500, `{"error":"number 5511999999999@s.whatsapp.net is not registered on whatsapp"}`, deliveryErrorRecipientNotRegistered, "failed"},
		{"unregisteredSemantic2xx", 200, `{"error":"number 5511999999999@s.whatsapp.net is not registered on whatsapp"}`, deliveryErrorRecipientNotRegistered, "failed"},
		{"ambiguousEmpty2xx", 200, `{}`, deliveryErrorOutcomeUnknown, "dead"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			db := openLocalOutboundDatabase(t, ctx)
			var calls atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(scenario.status)
				fmt.Fprint(w, scenario.body)
			}))
			t.Cleanup(provider.Close)
			repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic-key"}})
			f := outboundHardeningFixture(t, ctx, db, repo, "send-result-"+scenario.name)
			clientID := f.suffix + "-intent"
			queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic delivery result", ClientMessageID: clientID})
			item := leaseLocalOutbound(t, ctx, db.Pool(), f.organizationID, clientID)
			if err := repo.processClaimedWhatsAppOutbox(ctx, item, whatsappOutboxLaneFast); err != nil {
				t.Fatal(err)
			}
			var outboxStatus string
			var attempts int
			if err := db.Pool().QueryRow(ctx, `select status,attempts from public.whatsapp_outbox where id=$1::uuid`, item.ID).Scan(&outboxStatus, &attempts); err != nil {
				t.Fatal(err)
			}
			status, err := repo.GetSendStatus(ctx, f.tenant, f.conversationID, clientID, f.leadID)
			if err != nil || status.Message == nil || status.Status != "failed" || pointerValue(status.Message.DeliveryErrorCode) != scenario.errorCode || outboxStatus != scenario.outboxStatus || attempts != 1 {
				t.Fatalf("incorrect terminal result projection: %+v outbox=%s attempts=%d %v", status, outboxStatus, attempts, err)
			}
			publicJSON, err := json.Marshal(status)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(publicJSON), "5511999999999") || strings.Contains(string(publicJSON), "is not registered on whatsapp") {
				t.Fatalf("provider error/phone leaked: %s", publicJSON)
			}
			if err := repo.RecoverStaleWhatsAppOutbox(ctx); err != nil {
				t.Fatal(err)
			}
			if err := repo.ProcessWhatsAppOutbox(ctx); err != nil {
				t.Fatal(err)
			}
			if calls.Load() != 1 {
				t.Fatalf("terminal or ambiguous result was resent: calls=%d", calls.Load())
			}
		})
	}
}

func TestLocalWhatsAppProviderEchoMergeKeepsSafePresentation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := outboundHardeningFixture(t, ctx, db, repo, "echo-presentation")
	target := insertHardeningTarget(t, ctx, db.Pool(), f, "-quote-target", "received", false)
	clientID := f.suffix + "-intent"
	queued := queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic canonical pending", Filename: "safe-name.pdf", QuotedMessageID: target, ClientMessageID: clientID})
	item := leaseLocalOutbound(t, ctx, db.Pool(), f.organizationID, clientID)
	if _, err := repo.startWhatsAppOutboxProviderAttempt(ctx, item); err != nil {
		t.Fatal(err)
	}
	// A legacy pending row used a local projection identity rather than the
	// deterministic provider identity. The canonical echo may then be a second
	// row; newer Native paths usually reconcile the existing row directly.
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_messages set message_id=$2 where id=$1::uuid`, queued.Message.ID, f.suffix+"-legacy-local-id"); err != nil {
		t.Fatal(err)
	}
	echoProviderID := deterministicProviderMessageID(clientID)
	var echoID string
	if err := db.Pool().QueryRow(ctx, `insert into public.whatsapp_messages
		(organization_id,session_id,conversation_id,lead_id,message_id,provider_message_id,content,from_me,direction,status,capture_state)
		values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$5,'Synthetic canonical echo',true,'outbound','sent','captured') returning id::text`, f.organizationID, f.sessionID, f.conversationID, f.leadID, echoProviderID).Scan(&echoID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.markWhatsAppOutboxProviderAccepted(ctx, item, echoProviderID); err != nil {
		t.Fatal(err)
	}
	if err := repo.completeWhatsAppOutbox(ctx, item, echoProviderID); err != nil {
		t.Fatal(err)
	}
	status, err := repo.GetSendStatus(ctx, f.tenant, f.conversationID, clientID, f.leadID)
	if err != nil || status.Message == nil || status.Message.ID != echoID || status.Message.ID == queued.Message.ID ||
		pointerValue(status.Message.MediaFilename) != "safe-name.pdf" || status.Message.QuotedMessage == nil || !status.Message.QuotedMessage.Available || pointerValue(status.Message.QuotedMessage.ID) != target {
		t.Fatalf("canonical echo lost safe pending presentation: %+v %v", status, err)
	}
}
