package whatsapp

import (
	"bytes"
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

// This fake implements Storage's create-only/last-write-wins contract. Every
// database write still goes to the exact disposable PostgreSQL fixture.
func TestLocalWhatsAppOutboundMediaIsImmutable(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	var mu sync.Mutex
	objects := map[string][]byte{}
	uploads := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/object/sign/") {
			_ = json.NewEncoder(w).Encode(map[string]string{"signedURL": "/storage/v1/object/sign/whatsapp-media/synthetic?token=synthetic"})
			return
		}
		path := strings.TrimPrefix(r.URL.Path, "/storage/v1/object/whatsapp-media/")
		mu.Lock()
		defer mu.Unlock()
		switch r.Method {
		case http.MethodPost:
			uploads++
			body, _ := io.ReadAll(r.Body)
			if _, exists := objects[path]; exists && r.Header.Get("x-upsert") != "true" {
				w.WriteHeader(400)
				_, _ = w.Write([]byte(`{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}`))
				return
			}
			objects[path] = append([]byte(nil), body...)
			_, _ = w.Write([]byte(`{"Key":"synthetic"}`))
		case http.MethodGet:
			body, exists := objects[path]
			if !exists {
				http.NotFound(w, r)
				return
			}
			_, _ = w.Write(body)
		default:
			t.Errorf("unexpected synthetic Storage method %s", r.Method)
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	repo := NewRepository(db, nil, StorageConfig{ProjectURL: server.URL, APIKey: "synthetic-storage-key"})
	f := outboundHardeningFixture(t, ctx, db, repo, "immutable-media")
	input := sendMessageInput{Text: "synthetic caption", MediaType: "image", Mimetype: "image/png", Filename: "synthetic.png",
		Base64: base64.StdEncoding.EncodeToString([]byte("synthetic original bytes")), ClientMessageID: f.suffix + "-media",
		ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}
	first, err := repo.SendMessage(ctx, f.tenant, f.conversationID, input)
	if err != nil || first.Message == nil {
		t.Fatalf("first enqueue: %+v %v", first, err)
	}
	path := pointerValue(first.Message.MediaStoragePath)
	assertUnchanged := func(t *testing.T, wantUploads int) {
		t.Helper()
		mu.Lock()
		defer mu.Unlock()
		if !bytes.Equal(objects[path], []byte("synthetic original bytes")) || uploads != wantUploads {
			t.Fatalf("immutable bytes changed or replay wrote Storage: bytes=%q uploads=%d want=%d", objects[path], uploads, wantUploads)
		}
	}
	t.Run("same intent reuses without upload", func(t *testing.T) {
		again, err := repo.SendMessage(ctx, f.tenant, f.conversationID, input)
		if err != nil || again.Message == nil || again.Message.ID != first.Message.ID {
			t.Fatalf("replay: %+v %v", again, err)
		}
		assertUnchanged(t, 1)
	})
	t.Run("different bytes are denied before Storage", func(t *testing.T) {
		other := input
		other.Base64 = base64.StdEncoding.EncodeToString([]byte("synthetic replacement bytes"))
		if _, err := repo.SendMessage(ctx, f.tenant, f.conversationID, other); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("different-byte replay accepted: %v", err)
		}
		assertUnchanged(t, 1)
	})
	t.Run("another lead cannot overwrite known client ID", func(t *testing.T) {
		var leadID, conversationID string
		if err := db.Pool().QueryRow(ctx, `insert into public.leads(organization_id,assigned_user_id,name,phone,source)
		 values($1::uuid,$2::uuid,'Synthetic other lead','5511888812345','whatsapp') returning id::text`, f.organizationID, f.userID).Scan(&leadID); err != nil {
			t.Fatal(err)
		}
		if err := db.Pool().QueryRow(ctx, `insert into public.whatsapp_conversations(organization_id,session_id,remote_jid,contact_phone)
		 values($1::uuid,$2::uuid,'5511888812345@s.whatsapp.net','5511888812345') returning id::text`, f.organizationID, f.sessionID).Scan(&conversationID); err != nil {
			t.Fatal(err)
		}
		var ignored json.RawMessage
		if err := db.Pool().QueryRow(ctx, `select public.activate_whatsapp_conversation_lead_binding($1::uuid,$2::uuid,$3::uuid,null,'unlinked')`, f.organizationID, conversationID, leadID).Scan(&ignored); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.JoinConversationAttendance(ctx, f.tenant, conversationID, attendanceInput{ExpectedLeadID: leadID, SendSessionID: f.sessionID}); err != nil {
			t.Fatal(err)
		}
		other := input
		other.ExpectedLeadID = leadID
		other.Base64 = base64.StdEncoding.EncodeToString([]byte("synthetic other lead bytes"))
		if _, err := repo.SendMessage(ctx, f.tenant, conversationID, other); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("cross-lead client ID accepted: %v", err)
		}
		assertUnchanged(t, 1)
	})
}
