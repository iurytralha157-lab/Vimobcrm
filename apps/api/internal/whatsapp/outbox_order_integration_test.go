package whatsapp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func secondHardeningConversation(t *testing.T, ctx context.Context, db *dbpkg.Postgres, repo Repository, first sessionConversationLockFixture) sessionConversationLockFixture {
	t.Helper()
	second := first
	second.phone = first.phone[:len(first.phone)-1] + "0"
	if second.phone == first.phone {
		second.phone = first.phone[:len(first.phone)-1] + "1"
	}
	second.remoteJID = second.phone + "@s.whatsapp.net"
	if err := db.Pool().QueryRow(ctx, `insert into public.leads(organization_id,assigned_user_id,name,phone,source) values($1::uuid,$2::uuid,'Synthetic second conversation',$3,'manual') returning id::text`, first.organizationID, first.userID, second.phone).Scan(&second.leadID); err != nil {
		t.Fatal(err)
	}
	if err := db.Pool().QueryRow(ctx, `insert into public.whatsapp_conversations(organization_id,session_id,remote_jid,contact_phone,assigned_user_id) values($1::uuid,$2::uuid,$3,$4,$5::uuid) returning id::text`, first.organizationID, first.sessionID, second.remoteJID, second.phone, first.userID).Scan(&second.conversationID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `select public.activate_whatsapp_conversation_lead_binding($1::uuid,$2::uuid,$3::uuid,null)`, first.organizationID, second.conversationID, second.leadID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.JoinConversationAttendance(ctx, first.tenant, second.conversationID, attendanceInput{ExpectedLeadID: second.leadID, SendSessionID: second.sessionID}); err != nil {
		t.Fatal(err)
	}
	return second
}

func TestLocalOutboxSerialStartsAcrossLanes(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	mediaStarted, releaseMedia := make(chan struct{}), make(chan struct{})
	var released atomic.Bool
	var mu sync.Mutex
	var starts []string
	var providerCalls atomic.Int32
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
			json.NewEncoder(w).Encode(map[string]string{"signedURL": server.URL + "/synthetic-signed"})
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			http.Error(w, "invalid fixture", 400)
			return
		}
		id := stringFromAny(body["id"])
		providerCalls.Add(1)
		mu.Lock()
		starts = append(starts, id)
		mu.Unlock()
		if r.URL.Path == "/send/media" {
			close(mediaStarted)
			select {
			case <-releaseMedia:
			case <-ctx.Done():
				return
			}
		}
		json.NewEncoder(w).Encode(map[string]string{"messageId": id})
	}))
	defer server.Close()
	defer func() {
		if released.CompareAndSwap(false, true) {
			close(releaseMedia)
		}
	}()
	repo := NewRepository(db, nil, StorageConfig{ProjectURL: server.URL, APIKey: "synthetic-storage", EvolutionGo: EvolutionGoConfig{APIURL: server.URL, APIKey: "synthetic-provider"}})
	first := outboundHardeningFixture(t, ctx, db, repo, "serial")
	second := secondHardeningConversation(t, ctx, db, repo, first)
	mediaID, textID, otherID := first.suffix+"-media", first.suffix+"-text", first.suffix+"-other"
	insertOutboundMediaSource(t,ctx,db.Pool(),first,first.organizationID+"/synthetic.png","image","image/png")
	queueHardeningMessage(t, ctx, repo, first, sendMessageInput{ClientMessageID: mediaID, MediaType: "image", Mimetype: "image/png", MediaURL: server.URL + "/storage/v1/object/public/whatsapp-media/" + first.organizationID + "/synthetic.png"})
	queueHardeningMessage(t, ctx, repo, first, sendMessageInput{Text: "Synthetic later text", ClientMessageID: textID})
	queueHardeningMessage(t, ctx, repo, second, sendMessageInput{Text: "Synthetic independent text", ClientMessageID: otherID})
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_outbox set status='retry',next_attempt_at=now()+interval '1 minute' where organization_id=$1::uuid and client_message_id=$2`, first.organizationID, mediaID); err != nil {
		t.Fatal(err)
	}
	fast, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 10, "", whatsappOutboxLaneFast)
	if err != nil || len(fast) != 1 || fast[0].ClientMessageID != otherID {
		t.Fatalf("deferred media must hold only its conversation: %+v %v", fast, err)
	}
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_outbox set next_attempt_at=now() where organization_id=$1::uuid and client_message_id=$2`, first.organizationID, mediaID); err != nil {
		t.Fatal(err)
	}
	media, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 1, "", whatsappOutboxLaneMedia)
	if err != nil || len(media) != 1 || media[0].ClientMessageID != mediaID {
		t.Fatalf("media head claim: %+v %v", media, err)
	}
	done := make(chan error, 1)
	go func() { done <- repo.processClaimedWhatsAppOutbox(ctx, media[0], whatsappOutboxLaneMedia) }()
	select {
	case <-mediaStarted:
	case <-ctx.Done():
		t.Fatal("synthetic media provider did not start")
	}
	blocked, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 10, "", whatsappOutboxLaneFast)
	if err != nil || len(blocked) != 0 {
		t.Fatalf("processing media must hold later text: %+v %v", blocked, err)
	}
	if err := repo.processClaimedWhatsAppOutbox(ctx, fast[0], whatsappOutboxLaneFast); err != nil {
		t.Fatal(err)
	}
	if providerCalls.Load() != 2 {
		t.Fatalf("independent conversation did not progress while media waits: %d", providerCalls.Load())
	}
	if released.CompareAndSwap(false, true) {
		close(releaseMedia)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("media completion timed out")
	}
	later, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 1, "", whatsappOutboxLaneFast)
	if err != nil || len(later) != 1 || later[0].ClientMessageID != textID {
		t.Fatalf("next text did not release after media completion: %+v %v", later, err)
	}
	if err := repo.processClaimedWhatsAppOutbox(ctx, later[0], whatsappOutboxLaneFast); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	want := []string{deterministicProviderMessageID(mediaID), deterministicProviderMessageID(otherID), deterministicProviderMessageID(textID)}
	if fmt.Sprint(starts) != fmt.Sprint(want) {
		t.Fatalf("actual provider starts=%v want %v", starts, want)
	}
}

func TestLocalOutboxTerminalHeadsReleaseNextIntent(t *testing.T) {
	for _, terminal := range []string{"unknown", "exhausted"} {
		t.Run(terminal, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			db := openLocalOutboundDatabase(t, ctx)
			var providerCalls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				providerCalls.Add(1)
				http.Error(w, "synthetic uncertain response", 500)
			}))
			defer server.Close()
			repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: server.URL, APIKey: "synthetic-provider"}})
			fixture := outboundHardeningFixture(t, ctx, db, repo, "release")
			firstID, secondID := fixture.suffix+"-first", fixture.suffix+"-second"
			queueHardeningMessage(t, ctx, repo, fixture, sendMessageInput{Text: "Synthetic first", ClientMessageID: firstID})
			queueHardeningMessage(t, ctx, repo, fixture, sendMessageInput{Text: "Synthetic second", ClientMessageID: secondID})
			if terminal == "unknown" {
				items, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 1, "", whatsappOutboxLaneFast)
				if err != nil || len(items) != 1 || items[0].ClientMessageID != firstID {
					t.Fatalf("first claim: %+v %v", items, err)
				}
				if err := repo.processClaimedWhatsAppOutbox(ctx, items[0], whatsappOutboxLaneFast); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := db.Pool().Exec(ctx, `update public.whatsapp_outbox set attempts=max_attempts where organization_id=$1::uuid and client_message_id=$2`, fixture.organizationID, firstID); err != nil {
					t.Fatal(err)
				}
				if err := repo.RecoverStaleWhatsAppOutbox(ctx); err != nil {
					t.Fatal(err)
				}
			}
			var status string
			if err := db.Pool().QueryRow(ctx, `select status from public.whatsapp_outbox where organization_id=$1::uuid and client_message_id=$2`, fixture.organizationID, firstID).Scan(&status); err != nil || status != "dead" {
				t.Fatalf("terminal head=%s %v", status, err)
			}
			items, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 1, "", whatsappOutboxLaneFast)
			if err != nil || len(items) != 1 || items[0].ClientMessageID != secondID {
				t.Fatalf("terminal head did not release successor: %+v %v", items, err)
			}
			if got := providerCalls.Load(); (terminal == "unknown" && got != 1) || (terminal == "exhausted" && got != 0) {
				t.Fatalf("terminal head was resent: %d", got)
			}
		})
	}
}
