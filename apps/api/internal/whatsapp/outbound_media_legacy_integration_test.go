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

type legacyMediaHTTP struct {
	mu                      sync.Mutex
	objects                 map[string][]byte
	puts, gets, media, text int
	server                  *httptest.Server
}

func newLegacyMediaHTTP(t *testing.T) *legacyMediaHTTP {
	t.Helper()
	fake := &legacyMediaHTTP{objects: map[string][]byte{}}
	fake.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/object/sign/") {
			_ = json.NewEncoder(w).Encode(map[string]string{"signedURL": fake.server.URL + "/synthetic-signed"})
			return
		}
		fake.mu.Lock()
		defer fake.mu.Unlock()
		if strings.HasPrefix(r.URL.Path, "/send/") {
			if r.URL.Path == "/send/text" {
				fake.text++
			} else {
				fake.media++
			}
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			_ = json.NewEncoder(w).Encode(map[string]string{"messageId": stringFromAny(body["id"])})
			return
		}
		path := strings.TrimPrefix(r.URL.Path, "/storage/v1/object/whatsapp-media/")
		if r.Method == http.MethodPost {
			fake.puts++
			if r.Header.Get("x-upsert") != "false" {
				t.Error("legacy compatibility overwrites object")
			}
			if _, ok := fake.objects[path]; ok {
				w.WriteHeader(400)
				_, _ = w.Write([]byte(`{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}`))
				return
			}
			fake.objects[path], _ = io.ReadAll(r.Body)
			_, _ = w.Write([]byte(`{"Key":"synthetic"}`))
			return
		}
		if r.Method == http.MethodGet {
			fake.gets++
			body, ok := fake.objects[path]
			if !ok {
				http.NotFound(w, r)
				return
			}
			_, _ = w.Write(body)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(fake.server.Close)
	return fake
}

func TestLocalLegacyMediaReplayPreservesMissingFilenameAndDigest(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	fake := newLegacyMediaHTTP(t)
	repo := NewRepository(db, nil, StorageConfig{ProjectURL: fake.server.URL, APIKey: "synthetic"})
	f := outboundHardeningFixture(t, ctx, db, repo, "legacy-media-replay")
	input := sendMessageInput{Base64: base64.StdEncoding.EncodeToString([]byte("synthetic legacy bytes")), MediaType: "image", Mimetype: "image/png", Filename: "Original.png", ClientMessageID: f.suffix + "-intent", ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}
	queued, err := repo.SendMessage(ctx, f.tenant, f.conversationID, input)
	if err != nil || queued.Message == nil {
		t.Fatalf("setup legacy intent: %+v %v", queued, err)
	}
	path := pointerValue(queued.Message.MediaStoragePath)
	// Simulate the deployed older format: filename is still in the immutable
	// outbox intent, while neither filename nor digest exists on message metadata.
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_messages set metadata=metadata-'media_filename'-'outbound_media_sha256' where id=$1::uuid;
	 update public.whatsapp_outbox set payload=jsonb_set(payload,'{body}',(payload->'body')-'mediaSHA256') where message_id=$1::uuid`, queued.Message.ID); err != nil {
		t.Fatal(err)
	}
	var before string
	if err := db.Pool().QueryRow(ctx, `select metadata::text from public.whatsapp_messages where id=$1::uuid`, queued.Message.ID).Scan(&before); err != nil {
		t.Fatal(err)
	}
	for _, attempt := range []struct {
		name, filename, body string
		wantSuccess          bool
	}{
		{"identical", "Original.png", "synthetic legacy bytes", true},
		{"filename changes intent", "Other.png", "synthetic legacy bytes", false},
		{"bytes changes intent", "Original.png", "different bytes", false},
	} {
		t.Run(attempt.name, func(t *testing.T) {
			copy := input
			copy.Filename = attempt.filename
			copy.Base64 = base64.StdEncoding.EncodeToString([]byte(attempt.body))
			got, err := repo.SendMessage(ctx, f.tenant, f.conversationID, copy)
			if attempt.wantSuccess {
				if err != nil || got.Message == nil || got.Message.ID != queued.Message.ID {
					t.Fatalf("compatible replay: %+v %v", got, err)
				}
			} else if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("changed legacy intent accepted: %v", err)
			}
		})
	}
	var after string
	if err := db.Pool().QueryRow(ctx, `select metadata::text from public.whatsapp_messages where id=$1::uuid`, queued.Message.ID).Scan(&after); err != nil || after != before {
		t.Fatalf("legacy replay retrofitted metadata: equal=%t %v", after == before, err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if fake.puts != 1 || string(fake.objects[path]) != "synthetic legacy bytes" {
		t.Fatalf("legacy file overwritten: puts%d body%q", fake.puts, fake.objects[path])
	}
}

func TestLocalLegacyMediaIntegrityGatePreservesProviderBoundaries(t *testing.T) {
	for _, scenario := range []struct {
		name, marker, wantState, wantCode string
		attempts                          int
	}{
		{"untouched", "", "failed", deliveryErrorSendFailed, 0},
		{"accepted", whatsappOutboxProviderAcceptedMarker, "sent", "", 1},
		{"started", whatsappOutboxProviderStartedMarker, "dead", deliveryErrorOutcomeUnknown, 1},
		{"unknown", whatsappOutboxProviderUnknownMarker, "dead", deliveryErrorOutcomeUnknown, 1},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			db := openLocalOutboundDatabase(t, ctx)
			fake := newLegacyMediaHTTP(t)
			repo := NewRepository(db, nil, StorageConfig{ProjectURL: fake.server.URL, APIKey: "synthetic", EvolutionGo: EvolutionGoConfig{APIURL: fake.server.URL, APIKey: "synthetic"}})
			f := outboundHardeningFixture(t, ctx, db, repo, "legacy-media-"+scenario.name)
			queued := queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Base64: base64.StdEncoding.EncodeToString([]byte("synthetic legacy bytes")), MediaType: "image", Mimetype: "image/png", Filename: "Original.png", ClientMessageID: f.suffix + "-media"})
			if _, err := db.Pool().Exec(ctx, `update public.whatsapp_messages set metadata=metadata-'outbound_media_sha256' where id=$1::uuid;
		 update public.whatsapp_outbox set payload=jsonb_set(payload,'{body}',(payload->'body')-'mediaSHA256'),last_error=nullif($2,''),attempts=$3 where message_id=$1::uuid`, queued.Message.ID, scenario.marker, scenario.attempts); err != nil {
				t.Fatal(err)
			}
			item := leaseLocalOutbound(t, ctx, db.Pool(), f.organizationID, f.suffix+"-media")
			if err := repo.processClaimedWhatsAppOutbox(ctx, item, whatsappOutboxLaneMedia); err != nil {
				t.Fatal(err)
			}
			if scenario.wantState == "dead" {
				var outbox, message string
				var attempts int
				if err := db.Pool().QueryRow(ctx, `select queued.status,wm.status,queued.attempts from public.whatsapp_outbox queued join public.whatsapp_messages wm on wm.id=queued.message_id where queued.id=$1::uuid`, item.ID).Scan(&outbox, &message, &attempts); err != nil || outbox != "dead" || message != "failed" || attempts != scenario.attempts {
					t.Fatalf("uncertain delivery must retain dead/failed/attempts: %s/%s/%d %v", outbox, message, attempts, err)
				}
			} else {
				assertLocalOutboundState(t, ctx, db.Pool(), item, scenario.wantState, scenario.attempts)
			}
			status, err := repo.GetSendStatus(ctx, f.tenant, f.conversationID, item.ClientMessageID, f.leadID)
			if err != nil || status.Message == nil || pointerValue(status.Message.DeliveryErrorCode) != scenario.wantCode {
				t.Fatalf("legacy boundary classification: %+v %v", status, err)
			}
			if scenario.name == "untouched" {
				if pointerValue(status.Message.DeliveryErrorReason) != "media_integrity_unverified" {
					t.Fatal("stable compatible recovery reason missing")
				}
				var bodyStillPresent, noHash bool
				if err := db.Pool().QueryRow(ctx, `select media_storage_path is not null and metadata->>'media_filename'='Original.png',metadata->>'outbound_media_sha256' is null from public.whatsapp_messages where id=$1::uuid`, item.MessageRowID).Scan(&bodyStillPresent, &noHash); err != nil || !bodyStillPresent || !noHash {
					t.Fatalf("legacy gate changed media proof/body %t/%t: %v", bodyStillPresent, noHash, err)
				}
				queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic following text", ClientMessageID: f.suffix + "-following"})
				next, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 1, "", whatsappOutboxLaneFast)
				if err != nil || len(next) != 1 || next[0].ClientMessageID != f.suffix+"-following" {
					t.Fatalf("terminal legacy head blocks following text: %+v %v", next, err)
				}
				if err := repo.processClaimedWhatsAppOutbox(ctx, next[0], whatsappOutboxLaneFast); err != nil {
					t.Fatal(err)
				}
				assertLocalOutboundState(t, ctx, db.Pool(), next[0], "sent", 1)
			} else if status.Message.DeliveryErrorReason != nil {
				t.Fatal("accepted/unknown delivery incorrectly says file was never sent")
			}
			fake.mu.Lock()
			defer fake.mu.Unlock()
			if fake.media != 0 {
				t.Fatalf("legacy media provider repeated %d times", fake.media)
			}
		})
	}
}
