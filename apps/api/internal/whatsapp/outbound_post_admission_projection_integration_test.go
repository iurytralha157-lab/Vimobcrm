package whatsapp

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// The database and the handler are real. Only Storage/provider HTTP is local
// fake traffic. Accepted delivery is recorded through the actual provider-start
// fence and ACK writer, without sending to any WhatsApp provider.
func TestLocalPostAdmissionProjectionKeepsOriginalIntent(t *testing.T) {
	for _, replay := range []bool{false, true} {
		name := "normal"
		if replay {
			name = "idempotent"
		}
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			db := openLocalOutboundDatabase(t, ctx)
			entered, release := make(chan struct{}), make(chan struct{})
			var releaseOnce sync.Once
			defer releaseOnce.Do(func() { close(release) })
			var blockSign atomic.Bool
			var uploads, signs, providerCalls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.Contains(r.URL.Path, "/object/sign/") {
					signs.Add(1)
					if blockSign.CompareAndSwap(true, false) {
						close(entered)
						select {
						case <-release:
						case <-ctx.Done():
							return
						}
					}
					_ = json.NewEncoder(w).Encode(map[string]string{"signedURL": "/object/sign/whatsapp-media/synthetic?token=synthetic"})
					return
				}
				if strings.HasPrefix(r.URL.Path, "/send/") {
					providerCalls.Add(1)
					t.Error("projection or accepted finalization issued a new provider HTTP request")
					http.Error(w, "unexpected provider send", http.StatusInternalServerError)
					return
				}
				if r.Method != http.MethodPost || !strings.HasPrefix(r.URL.Path, "/storage/v1/object/whatsapp-media/") || r.Header.Get("x-upsert") != "false" {
					t.Errorf("unexpected Storage request %s %s", r.Method, r.URL.Path)
					http.Error(w, "unexpected Storage request", http.StatusBadRequest)
					return
				}
				uploads.Add(1)
				_, _ = w.Write([]byte(`{"Key":"synthetic"}`))
			}))
			defer func() {
				releaseOnce.Do(func() { close(release) })
				server.Close()
			}()
			repo := NewRepository(db, nil, StorageConfig{ProjectURL: server.URL, APIKey: "synthetic-storage",
				EvolutionGo: EvolutionGoConfig{APIURL: server.URL, APIKey: "synthetic-provider"}})
			f := outboundHardeningFixture(t, ctx, db, repo, "post-admission-"+name)
			clientID := f.suffix + "-media"
			input := sendMessageInput{Text: "Synthetic private caption", Base64: base64.StdEncoding.EncodeToString([]byte("Synthetic immutable bytes")),
				MediaType: "image", Mimetype: "image/png", Filename: "Synthetic.png", ClientMessageID: clientID,
				ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}
			var accepted pendingWhatsAppOutbox
			accept := func() {
				t.Helper()
				accepted = leaseLocalOutbound(t, ctx, db.Pool(), f.organizationID, clientID)
				var err error
				accepted.Attempts, err = repo.startWhatsAppOutboxProviderAttempt(ctx, accepted)
				if err != nil || accepted.Attempts != 1 {
					t.Fatalf("synthetic provider-start fence: attempts=%d %v", accepted.Attempts, err)
				}
				if finalized, err := repo.markWhatsAppOutboxProviderAccepted(ctx, accepted, accepted.ProviderMessageID); err != nil || finalized {
					t.Fatalf("synthetic durable ACK: finalized=%t %v", finalized, err)
				}
				accepted.LastError = whatsappOutboxProviderAcceptedMarker
			}
			if replay {
				first, err := repo.SendMessage(ctx, f.tenant, f.conversationID, input)
				if err != nil || first.Message == nil {
					t.Fatalf("setup existing admitted intent: %+v %v", first, err)
				}
				// Exercise a real signer cache miss rather than the URL cached by
				// setup. Expire only this synthetic message's exact object key.
				whatsappMediaSignedURLCache.Delete(pointerValue(first.Message.MediaStoragePath))
				accept()
			}
			blockSign.Store(true)
			requestBody, err := json.Marshal(map[string]string{"text": input.Text, "base64": input.Base64,
				"mediaType": input.MediaType, "mimetype": input.Mimetype, "filename": input.Filename,
				"clientMessageId": clientID, "expectedLeadId": f.leadID, "sendSessionId": f.sessionID})
			if err != nil {
				t.Fatal(err)
			}
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/conversations/"+f.conversationID+"/send-message", bytes.NewReader(requestBody))
			request.SetPathValue("id", f.conversationID)
			request = request.WithContext(tenant.ContextWithTenant(ctx, f.tenant))
			done := make(chan struct{})
			go func() {
				NewHandler(repo).SendMessage(recorder, request)
				close(done)
			}()
			select {
			case <-entered:
			case <-ctx.Done():
				t.Fatal("post-commit projection signer did not start")
			}
			if !replay {
				accept()
			}
			if _, err := db.Pool().Exec(ctx, `update public.organization_members set is_active=false where organization_id=$1::uuid and user_id=$2::uuid`, f.organizationID, f.tenant.UserID); err != nil {
				t.Fatal(err)
			}
			releaseOnce.Do(func() { close(release) })
			select {
			case <-done:
			case <-ctx.Done():
				t.Fatal("post-commit response did not settle")
			}
			var response SendMessageResponse
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatalf("response JSON: %v", err)
			}
			if recorder.Code != http.StatusOK || response.ClientMessageID != clientID || response.ConversationID != f.conversationID || response.Status != "confirming" || response.Message != nil || response.ProviderData != nil {
				t.Errorf("admitted intent was misclassified or leaked a projection: HTTP%d %+v body=%s", recorder.Code, response, recorder.Body.String())
			}
			var messages, outbox, attempts int
			var state, marker string
			if err := db.Pool().QueryRow(ctx, `select
			 (select count(*)::int from public.whatsapp_messages where organization_id=$1::uuid and client_message_id=$2),
			 (select count(*)::int from public.whatsapp_outbox where organization_id=$1::uuid and client_message_id=$2),
			 attempts,status,coalesce(last_error,'') from public.whatsapp_outbox where organization_id=$1::uuid and client_message_id=$2`, f.organizationID, clientID).Scan(&messages, &outbox, &attempts, &state, &marker); err != nil {
				t.Fatal(err)
			}
			if messages != 1 || outbox != 1 || attempts != 1 || state != "processing" || marker != whatsappOutboxProviderAcceptedMarker {
				t.Fatalf("projection altered durable accepted intent: messages=%d outbox=%d attempts=%d status=%s marker=%s", messages, outbox, attempts, state, marker)
			}
			beforeSigns := signs.Load()
			if err := repo.processClaimedWhatsAppOutbox(ctx, accepted, whatsappOutboxLaneMedia); err != nil {
				t.Fatalf("accepted finalization after access loss: %v", err)
			}
			assertLocalOutboundState(t, ctx, db.Pool(), accepted, "sent", 1)
			wantSigns := int32(1)
			if replay {
				wantSigns = 2
			}
			if uploads.Load() != 1 || signs.Load() != wantSigns || signs.Load() != beforeSigns || providerCalls.Load() != 0 {
				t.Fatalf("replay/finalization performed extra HTTP: uploads=%d signs=%d provider=%d", uploads.Load(), signs.Load(), providerCalls.Load())
			}
		})
	}
}

func TestLocalSendRejectsAccessLostBeforeAdmission(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Error(w, "pre-admission rejection must not call Storage/provider", http.StatusInternalServerError)
	}))
	defer server.Close()
	repo := NewRepository(db, nil, StorageConfig{ProjectURL: server.URL, APIKey: "synthetic"})
	f := outboundHardeningFixture(t, ctx, db, repo, "pre-admission-loss")
	if _, err := db.Pool().Exec(ctx, `update public.organization_members set is_active=false where organization_id=$1::uuid and user_id=$2::uuid`, f.organizationID, f.tenant.UserID); err != nil {
		t.Fatal(err)
	}
	clientID := f.suffix + "-media"
	body, err := json.Marshal(map[string]string{"text": "Synthetic private caption", "base64": base64.StdEncoding.EncodeToString([]byte("Synthetic bytes")),
		"mediaType": "image", "mimetype": "image/png", "clientMessageId": clientID, "expectedLeadId": f.leadID, "sendSessionId": f.sessionID})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/conversations/"+f.conversationID+"/send-message", bytes.NewReader(body))
	request.SetPathValue("id", f.conversationID)
	NewHandler(repo).SendMessage(recorder, request.WithContext(tenant.ContextWithTenant(ctx, f.tenant)))
	var rows int
	if err := db.Pool().QueryRow(ctx, `select (select count(*)::int from public.whatsapp_messages where organization_id=$1::uuid and client_message_id=$2)
	 +(select count(*)::int from public.whatsapp_outbox where organization_id=$1::uuid and client_message_id=$2)`, f.organizationID, clientID).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if recorder.Code != http.StatusForbidden || !strings.Contains(recorder.Body.String(), `"code":"permission_denied"`) || rows != 0 || calls.Load() != 0 {
		t.Fatalf("pre-admission denial was masked or had effects: HTTP%d rows=%d HTTPcalls=%d body=%s", recorder.Code, rows, calls.Load(), recorder.Body.String())
	}
}
