package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func insertOutboundMediaSource(t *testing.T, ctx context.Context, pool *pgxpool.Pool, f sessionConversationLockFixture, path, mediaType, mimeType string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `insert into public.whatsapp_messages
	 (organization_id,session_id,conversation_id,lead_id,message_id,provider_message_id,content,message_type,media_storage_path,
	 media_status,media_mime_type,remote_jid,from_me,direction,status,capture_state)
	 values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$5,'Synthetic source', $6,$7,'ready',$8,$9,false,'inbound','received','captured') returning id::text`,
		f.organizationID, f.sessionID, f.conversationID, f.leadID, f.suffix+"-source-"+path, mediaType, path, mimeType, f.remoteJID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestLocalMediaURLForwardRequiresCurrentSourceAuthority(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	var mu sync.Mutex
	objects := map[string][]byte{}
	gets, puts, providerCalls := 0, 0, 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/object/sign/") {
			_ = json.NewEncoder(w).Encode(map[string]string{"signedURL": server.URL + "/synthetic-signed"})
			return
		}
		if strings.HasPrefix(r.URL.Path, "/send/") {
			mu.Lock()
			providerCalls++
			mu.Unlock()
			http.Error(w, "must not reach provider", 500)
			return
		}
		path := strings.TrimPrefix(r.URL.Path, "/storage/v1/object/whatsapp-media/")
		mu.Lock()
		defer mu.Unlock()
		if r.Method == http.MethodGet {
			gets++
			data, ok := objects[path]
			if !ok {
				http.NotFound(w, r)
				return
			}
			_, _ = w.Write(data)
			return
		}
		if r.Method == http.MethodPost {
			puts++
			if r.Header.Get("x-upsert") != "false" {
				t.Error("forward enabled overwrite")
			}
			if _, ok := objects[path]; ok {
				w.WriteHeader(400)
				_, _ = w.Write([]byte(`{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}`))
				return
			}
			data, _ := io.ReadAll(r.Body)
			objects[path] = data
			_, _ = w.Write([]byte(`{"Key":"synthetic"}`))
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(server.Close)
	repo := NewRepository(db, nil, StorageConfig{ProjectURL: server.URL, APIKey: "synthetic", EvolutionGo: EvolutionGoConfig{APIURL: server.URL, APIKey: "synthetic"}})
	f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "source-authority")
	copyFixture := f
	copyFixture.userID = f.tenant.UserID
	destination := secondHardeningConversation(t, ctx, db, repo, copyFixture)
	path := "orgs/" + f.organizationID + "/sessions/" + f.sessionID + "/incoming/synthetic.png"
	insertOutboundMediaSource(t, ctx, db.Pool(), f, path, "image", "image/png")
	mu.Lock()
	objects[path] = []byte("synthetic authorized source bytes")
	mu.Unlock()
	input := sendMessageInput{MediaURL: server.URL + "/storage/v1/object/public/whatsapp-media/" + path, MediaType: "image", Mimetype: "image/png", ClientMessageID: f.suffix + "-copy", ExpectedLeadID: destination.leadID, SendSessionID: f.sessionID}
	queued, err := repo.SendMessage(ctx, f.tenant, destination.conversationID, input)
	if err != nil || queued.Message == nil {
		t.Fatalf("authorized copy: %+v %v", queued, err)
	}
	copyPath := pointerValue(queued.Message.MediaStoragePath)
	mu.Lock()
	objects[path] = []byte("source was later repaired")
	if string(objects[copyPath]) != "synthetic authorized source bytes" {
		t.Error("copy still aliases mutable source")
	}
	beforeGets, beforePuts := gets, puts
	mu.Unlock()
	if _, err := db.Pool().Exec(ctx, `update public.leads set assigned_user_id=$2::uuid where id=$1::uuid`, f.leadID, f.userID); err != nil {
		t.Fatal(err)
	}
	input.ClientMessageID = f.suffix + "-denied-new-intent"
	if _, err := repo.SendMessage(ctx, f.tenant, destination.conversationID, input); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("old source URL copied after transfer: %v", err)
	}
	mu.Lock()
	if gets != beforeGets || puts != beforePuts || providerCalls != 0 {
		t.Errorf("denied source reached I/O: get%d/%d put%d/%d provider%d", gets, beforeGets, puts, beforePuts, providerCalls)
	}
	mu.Unlock()
	item := leaseLocalOutbound(t, ctx, db.Pool(), f.organizationID, f.suffix+"-copy")
	if err := repo.processClaimedWhatsAppOutbox(ctx, item, whatsappOutboxLaneMedia); err != nil {
		t.Fatal(err)
	}
	assertLocalOutboundState(t, ctx, db.Pool(), item, "failed", 0)
	mu.Lock()
	defer mu.Unlock()
	if providerCalls != 0 {
		t.Fatal("queued forward crossed provider after source permission loss")
	}
}

func TestLocalMediaURLRejectsCorruptImmutableSource(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	fake := newLegacyMediaHTTP(t)
	repo := NewRepository(db, nil, StorageConfig{ProjectURL: fake.server.URL, APIKey: "synthetic"})
	f := outboundHardeningFixture(t, ctx, db, repo, "corrupt-immutable-source")
	path := outboundMediaImmutablePath(f.organizationID, f.sessionID, deterministicProviderMessageID(f.suffix+"-source"), "image/png", outboundMediaDigest([]byte("original bytes")))
	insertOutboundMediaSource(t, ctx, db.Pool(), f, path, "image", "image/png")
	fake.mu.Lock()
	fake.objects[path] = []byte("corrupted bytes")
	fake.mu.Unlock()
	_, err := repo.SendMessage(ctx, f.tenant, f.conversationID, sendMessageInput{
		MediaURL:  fake.server.URL + "/storage/v1/object/public/whatsapp-media/" + path,
		MediaType: "image", Mimetype: "image/png", ClientMessageID: f.suffix + "-copy",
		ExpectedLeadID: f.leadID, SendSessionID: f.sessionID,
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("corrupt digest object admitted: %v", err)
	}
	var messages, outbox int
	if err := db.Pool().QueryRow(ctx, `select
	 (select count(*) from public.whatsapp_messages where organization_id=$1::uuid and from_me),
	 (select count(*) from public.whatsapp_outbox where organization_id=$1::uuid)`, f.organizationID).Scan(&messages, &outbox); err != nil || messages != 0 || outbox != 0 {
		t.Fatalf("corrupt source created delivery rows: %d/%d %v", messages, outbox, err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if fake.gets != 1 || fake.puts != 0 || fake.media != 0 {
		t.Fatalf("corrupt source crossed copy/provider: GET%d PUT%d provider%d", fake.gets, fake.puts, fake.media)
	}
}
