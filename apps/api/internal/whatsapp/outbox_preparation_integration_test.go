package whatsapp

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestLocalOutboxPreparationBudget(t *testing.T) {
	for _, code := range []int{503, 403} {
		t.Run(fmt.Sprintf("storage%d", code), func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			db := openLocalOutboundDatabase(t, ctx)
			var signs, sends atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.Contains(r.URL.Path, "/storage/v1/object/whatsapp-media/") {
					if r.Method == http.MethodGet {
						_, _ = w.Write([]byte("Synthetic immutable media bytes"))
						return
					}
					if r.Method == http.MethodPost && r.Header.Get("x-upsert") == "false" {
						_, _ = w.Write([]byte(`{"Key":"synthetic"}`))
						return
					}
					t.Error("unexpected immutable Storage request")
					http.Error(w, "unexpected", 400)
					return
				}
				if strings.Contains(r.URL.Path, "/object/sign/") {
					signs.Add(1)
					w.WriteHeader(code)
					return
				}
				sends.Add(1)
				t.Error("preparation failure crossed provider boundary")
				http.Error(w, "unexpected synthetic request", 500)
			}))
			defer server.Close()
			repo := NewRepository(db, nil, StorageConfig{ProjectURL: server.URL, APIKey: "synthetic-storage", EvolutionGo: EvolutionGoConfig{APIURL: server.URL, APIKey: "synthetic-provider"}})
			fixture := outboundHardeningFixture(t, ctx, db, repo, "prep")
			clientID := fixture.suffix + "-media"
			insertOutboundMediaSource(t,ctx,db.Pool(),fixture,fixture.organizationID+"/synthetic.pdf","document","application/pdf")
			queueHardeningMessage(t, ctx, repo, fixture, sendMessageInput{ClientMessageID: clientID, MediaType: "document", Filename: "Synthetic.pdf", Mimetype: "application/pdf", MediaURL: server.URL + "/storage/v1/object/public/whatsapp-media/" + fixture.organizationID + "/synthetic.pdf"})
			// SendMessage's canonical read may sign a browser preview after commit;
			// the preparation budget applies to worker attempts, not that read.
			previewSigns := signs.Load()
			limit := whatsappOutboxPreparationLimit
			if code == 403 {
				limit = 1
			}
			for attempt := 1; attempt <= limit; attempt++ {
				if _, err := db.Pool().Exec(ctx, `update public.whatsapp_outbox set next_attempt_at=now() where organization_id=$1::uuid and client_message_id=$2`, fixture.organizationID, clientID); err != nil {
					t.Fatal(err)
				}
				items, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 1, "", whatsappOutboxLaneMedia)
				if err != nil || len(items) != 1 || items[0].ClientMessageID != clientID {
					t.Fatalf("claim preparation %d: %+v %v", attempt, items, err)
				}
				if err := repo.processClaimedWhatsAppOutbox(ctx, items[0], whatsappOutboxLaneMedia); err != nil {
					t.Fatal(err)
				}
				var status string
				var providerAttempts, preparationAttempts int
				if err := db.Pool().QueryRow(ctx, `select status,attempts,(payload->>'preparation_attempts')::integer from public.whatsapp_outbox where id=$1::uuid`, items[0].ID).Scan(&status, &providerAttempts, &preparationAttempts); err != nil {
					t.Fatal(err)
				}
				want := "retry"
				if attempt == limit {
					want = "failed"
				}
				if status != want || providerAttempts != 0 || preparationAttempts != attempt {
					t.Fatalf("preparation state=%s/provider%d/prep%d want %s/0/%d", status, providerAttempts, preparationAttempts, want, attempt)
				}
			}
			result, err := repo.GetSendStatus(ctx, fixture.tenant, fixture.conversationID, clientID, fixture.leadID)
			if err != nil || result.Status != "failed" || pointerValue(result.Message.DeliveryErrorCode) != "send_failed" || pointerValue(result.Message.MediaFilename) != "Synthetic.pdf" {
				t.Fatalf("terminal read projection: %+v %v", result, err)
			}
			if sends.Load() != 0 || int(signs.Load()-previewSigns) != limit {
				t.Fatalf("provider/worker storage calls=%d/%d", sends.Load(), signs.Load()-previewSigns)
			}
		})
	}
}

func TestLocalOutboxTerminalSessionRecovery(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := Repository{db: db}
	for _, state := range []string{"deleted", "inactive", "disconnected"} {
		t.Run(state, func(t *testing.T) {
			fixture := outboundHardeningFixture(t, ctx, db, repo, "terminal")
			clientID := fixture.suffix + "-text"
			queueHardeningMessage(t, ctx, repo, fixture, sendMessageInput{Text: "Synthetic", ClientMessageID: clientID})
			active, status := true, state
			if state == "inactive" {
				active = false
				status = "connected"
			}
			if state == "deleted" {
				active = false
			}
			if _, err := db.Pool().Exec(ctx, `update public.whatsapp_sessions set is_active=$2,status=$3 where id=$1::uuid`, fixture.sessionID, active, status); err != nil {
				t.Fatal(err)
			}
			if err := repo.RecoverStaleWhatsAppOutbox(ctx); err != nil {
				t.Fatal(err)
			}
			var outboxStatus, messageStatus string
			var attempts int
			if err := db.Pool().QueryRow(ctx, `select queued.status,message.status,queued.attempts from public.whatsapp_outbox queued join public.whatsapp_messages message on message.id=queued.message_id where queued.organization_id=$1::uuid and queued.client_message_id=$2`, fixture.organizationID, clientID).Scan(&outboxStatus, &messageStatus, &attempts); err != nil {
				t.Fatal(err)
			}
			want, wantMessage := "failed", "failed"
			if state == "disconnected" {
				want, wantMessage = "pending", "queued"
			}
			if outboxStatus != want || messageStatus != wantMessage || attempts != 0 {
				t.Fatalf("terminal session projection=%s/%s/%d want %s/%s/0", outboxStatus, messageStatus, attempts, want, wantMessage)
			}
			if err := repo.RecoverStaleWhatsAppOutbox(ctx); err != nil {
				t.Fatal(err)
			}
		})
	}
}
