package whatsapp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestLocalOutboundMediaUploadDoesNotHoldChatLocks(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	entered, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/object/whatsapp-media/") {
			if r.Header.Get("x-upsert") != "false" {
				t.Error("slow upload may overwrite")
			}
			close(entered)
			select {
			case <-release:
			case <-ctx.Done():
				return
			}
			_, _ = w.Write([]byte(`{"Key":"synthetic"}`))
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(server.Close)
	repo := NewRepository(db, nil, StorageConfig{ProjectURL: server.URL, APIKey: "synthetic"})
	f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "slow-immutable-upload")
	if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := repo.SendMessage(ctx, f.tenant, f.conversationID, sendMessageInput{Base64: base64.StdEncoding.EncodeToString([]byte("synthetic slow media")), MediaType: "image", Mimetype: "image/png", ClientMessageID: f.suffix + "-intent", ExpectedLeadID: f.leadID, SendSessionID: f.sessionID})
		done <- err
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("immutable Storage upload did not start")
	}
	probeCtx, probeCancel := context.WithTimeout(ctx, 2*time.Second)
	defer probeCancel()
	tx, err := db.Pool().Begin(probeCtx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	for _, row := range []struct{ table, id string }{{"whatsapp_sessions", f.sessionID}, {"whatsapp_conversations", f.conversationID}, {"leads", f.leadID}} {
		var id string
		if err := tx.QueryRow(probeCtx, "select id::text from public."+row.table+" where id=$1::uuid for update nowait", row.id).Scan(&id); err != nil {
			t.Fatalf("slow Storage holds %s row lock: %v", row.table, err)
		}
	}
	if _, err := tx.Exec(probeCtx, `update public.leads set assigned_user_id=$2::uuid where id=$1::uuid`, f.leadID, f.userID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(probeCtx); err != nil {
		t.Fatal(err)
	}
	releaseOnce.Do(func() { close(release) })
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("transfer during upload admitted stale sender")
		}
	case <-ctx.Done():
		t.Fatal("send did not settle after Storage release")
	}
	var messages, outbox int
	if err := db.Pool().QueryRow(ctx, `select (select count(*) from public.whatsapp_messages where organization_id=$1::uuid),
	 (select count(*) from public.whatsapp_outbox where organization_id=$1::uuid)`, f.organizationID).Scan(&messages, &outbox); err != nil || messages != 0 || outbox != 0 {
		t.Fatalf("stale media admitted durable work %d/%d: %v", messages, outbox, err)
	}
}

func TestLocalConcurrentMediaIntentsCannotReplaceWinner(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	entered, release := make(chan struct{}, 2), make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	var mu sync.Mutex
	objects := map[string][]byte{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/object/sign/") {
			_ = json.NewEncoder(w).Encode(map[string]string{"signedURL": "/storage/v1/object/sign/whatsapp-media/synthetic?token=synthetic"})
			return
		}
		if r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("x-upsert") != "false" {
			t.Error("concurrent immutable upload enables overwrite")
		}
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		objects[r.URL.Path] = body
		mu.Unlock()
		entered <- struct{}{}
		select {
		case <-release:
		case <-ctx.Done():
			return
		}
		_, _ = w.Write([]byte(`{"Key":"synthetic"}`))
	}))
	t.Cleanup(server.Close)
	repo := NewRepository(db, nil, StorageConfig{ProjectURL: server.URL, APIKey: "synthetic"})
	f := outboundHardeningFixture(t, ctx, db, repo, "concurrent-immutable-media")
	type outcome struct {
		response SendMessageResponse
		err      error
	}
	results := make(chan outcome, 2)
	for _, body := range []string{"synthetic first bytes", "synthetic other bytes"} {
		go func(body string) {
			response, err := repo.SendMessage(ctx, f.tenant, f.conversationID, sendMessageInput{Base64: base64.StdEncoding.EncodeToString([]byte(body)), MediaType: "image", Mimetype: "image/png", ClientMessageID: f.suffix + "-intent", ExpectedLeadID: f.leadID, SendSessionID: f.sessionID})
			results <- outcome{response, err}
		}(body)
	}
	for i := 0; i < 2; i++ {
		select {
		case <-entered:
		case <-ctx.Done():
			t.Fatal("both first-time uploads did not reach race boundary")
		}
	}
	releaseOnce.Do(func() { close(release) })
	accepted, rejected := 0, 0
	var winner *Message
	for i := 0; i < 2; i++ {
		select {
		case result := <-results:
			if result.err == nil {
				accepted++
				winner = result.response.Message
			} else if errors.Is(result.err, ErrInvalidInput) {
				rejected++
			} else {
				t.Errorf("unexpected race result: %v", result.err)
			}
		case <-ctx.Done():
			t.Fatal("concurrent intent did not settle")
		}
	}
	if accepted != 1 || rejected != 1 || winner == nil {
		t.Fatalf("race admits %d rejects%d winner%+v", accepted, rejected, winner)
	}
	var messages, outbox int
	var digest, path string
	if err := db.Pool().QueryRow(ctx, `select (select count(*) from public.whatsapp_messages where organization_id=$1::uuid),
	 (select count(*) from public.whatsapp_outbox where organization_id=$1::uuid),metadata->>'outbound_media_sha256',media_storage_path
	 from public.whatsapp_messages where id=$2::uuid`, f.organizationID, winner.ID).Scan(&messages, &outbox, &digest, &path); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	bytes := objects["/storage/v1/object/whatsapp-media/"+path]
	mu.Unlock()
	if messages != 1 || outbox != 1 || outboundMediaDigest(bytes) != digest {
		t.Fatalf("winner bytes/context changed: %d/%d hash=%s stored=%s", messages, outbox, outboundMediaDigest(bytes), digest)
	}
}
