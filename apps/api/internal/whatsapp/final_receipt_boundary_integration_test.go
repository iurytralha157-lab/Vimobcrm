package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestLocalFinalReceiptOwnerOnlyAndReleasesDatabaseLocks(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "final-receipt-start")
	insertHardeningTarget(t, ctx, db.Pool(), f, "-receipt-target", "received", false)
	var calls atomic.Int32
	var locksReleased atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body struct {
			JID        string   `json:"jid"`
			MessageIDs []string `json:"messageIds"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.JID != f.remoteJID || len(body.MessageIDs) != 1 || body.MessageIDs[0] != f.suffix+"-receipt-target" {
			t.Errorf("receipt lost immutable conversation/lead message scope: %+v %v", body, err)
		}
		check, err := db.Pool().Begin(r.Context())
		if err != nil {
			t.Error(err)
			return
		}
		defer check.Rollback(context.Background())
		_, err = check.Exec(r.Context(), `set local lock_timeout='200ms';select id from public.whatsapp_sessions where id=$1::uuid for update;select id from public.whatsapp_conversations where id=$2::uuid for update`, f.sessionID, f.conversationID)
		if err != nil {
			t.Errorf("provider HTTP still holds resource locks: %v", err)
		} else {
			locksReleased.Store(true)
		}
		_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
	}))
	defer server.Close()
	repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: server.URL, APIKey: "synthetic"}})
	if err := repo.MarkAsSeenOnWhatsApp(ctx, f.tenant, f.conversationID, f.leadID); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("recipient emitted owner's receipt: %v", err)
	}
	if calls.Load() != 0 {
		t.Fatal("shared recipient reached provider")
	}
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_sessions set owner_user_id=$2::uuid where id=$1::uuid`, f.sessionID, f.tenant.UserID); err != nil {
		t.Fatal(err)
	}
	if err := repo.MarkAsSeenOnWhatsApp(ctx, f.tenant, f.conversationID, f.leadID); err != nil {
		t.Fatalf("owner receipt denied: %v", err)
	}
	if calls.Load() != 1 || !locksReleased.Load() {
		t.Fatalf("owner receipt calls%d resource-lock release%t", calls.Load(), locksReleased.Load())
	}
}
