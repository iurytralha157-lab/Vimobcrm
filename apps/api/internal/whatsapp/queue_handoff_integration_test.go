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
)

func TestLocalQueueOutboxDrainsInFlightSendWithoutClaimingSuccessor(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	started := make(chan struct{})
	acknowledge := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(acknowledge) }) }
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct{ ID string }
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.ID == "" {
			t.Errorf("invalid synthetic provider request: %v", err)
			http.Error(w, "invalid synthetic provider request", http.StatusBadRequest)
			return
		}
		if calls.Add(1) == 1 {
			close(started)
			select {
			case <-acknowledge:
			case <-r.Context().Done():
				t.Error("sender shutdown canceled an in-flight provider request")
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"messageId": request.ID})
	}))
	defer provider.Close()
	defer release()
	repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{
		APIURL: provider.URL, APIKey: "synthetic-provider",
	}})
	f := outboundHardeningFixture(t, ctx, db, repo, "queue-handoff")
	firstID, secondID := f.suffix+"-first", f.suffix+"-second"
	for _, id := range []string{firstID, secondID} {
		queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic handoff", ClientMessageID: id})
	}
	assertStatus := func(id, wantStatus string, wantAttempts int) {
		t.Helper()
		var status string
		var attempts int
		err := db.Pool().QueryRow(ctx, `select status, attempts from public.whatsapp_outbox
			where organization_id=$1::uuid and conversation_id=$2::uuid and client_message_id=$3`,
			f.organizationID, f.conversationID, id).Scan(&status, &attempts)
		if err != nil || status != wantStatus || attempts != wantAttempts {
			t.Fatalf("outbox %s = %s/%d, want %s/%d: %v", id, status, attempts, wantStatus, wantAttempts, err)
		}
	}

	workerCtx, stopWorker := context.WithCancel(ctx)
	defer stopWorker()
	config := DefaultWorkerConfig()
	config.OutboxWorkerConcurrency = 1
	done := NewHandler(repo).WithWorkerConfig(config).StartOutboxWorker(workerCtx, nil)
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("outbox worker did not reach the provider")
	}

	stopWorker()
	assertStatus(firstID, "processing", 1)
	assertStatus(secondID, "pending", 0)
	select {
	case <-done:
		t.Fatal("worker exited before the provider request finished")
	default:
	}
	release()
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("worker did not finish after provider acknowledgement")
	}
	assertStatus(firstID, "sent", 1)
	assertStatus(secondID, "pending", 0)

	if err := repo.ProcessWhatsAppOutbox(ctx); err != nil {
		t.Fatal(err)
	}
	assertStatus(secondID, "sent", 1)
	if got := calls.Load(); got != 2 {
		t.Fatalf("provider received %d requests, want exactly one per message", got)
	}
}
