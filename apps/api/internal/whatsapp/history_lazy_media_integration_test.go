package whatsapp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
	"time"
)

func TestHistoryMediaPreferencePreservesDefaults(t *testing.T) {
	for _, setting := range []string{"", "false", "true"} {
		t.Run("includeMediaUrls="+setting, func(t *testing.T) {
			values := url.Values{"leadId": {"11111111-1111-4111-8111-111111111111"}}
			if setting != "" {
				values.Set("includeMediaUrls", setting)
			}
			filter, err := ParseHistoryAccessFilter(values)
			if err != nil || filter.IncludeMediaURLs != (setting != "false") {
				t.Fatalf("history media option=%t, err=%v", filter.IncludeMediaURLs, err)
			}
		})
	}
	if _, err := ParseHistoryAccessFilter(url.Values{"leadId": {"11111111-1111-4111-8111-111111111111"}, "includeMediaUrls": {"unknown"}}); err == nil {
		t.Fatal("history accepted an invalid media preference")
	}
}

// Uses the existing guarded, disposable local fixture. Storage and provider are
// an in-process HTTP fixture; lazy history must not contact them, even on failure.
func TestLocalLeadHistoryLazyMediaContract(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	var calls atomic.Int32
	var unavailable atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if unavailable.Load() {
			http.Error(w, "synthetic storage unavailable", http.StatusServiceUnavailable)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"signedURL": "/object/sign/whatsapp-media/synthetic?token=fixture"})
	}))
	t.Cleanup(server.Close)
	repo := NewRepository(db, nil, StorageConfig{ProjectURL: server.URL, APIKey: "synthetic-only"})
	f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "lazy-lead-history")
	foreign := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "lazy-lead-history-foreign")
	path := "orgs/" + f.organizationID + "/sessions/" + f.sessionID + "/incoming/synthetic.png"
	id := insertOutboundMediaSource(t, ctx, db.Pool(), f, path, "image", "image/png")
	if _, err := db.Pool().Exec(ctx, `insert into public.whatsapp_messages
	 (organization_id,session_id,conversation_id,lead_id,message_id,provider_message_id,content,message_type,
	 remote_jid,from_me,direction,status,capture_state)
	 values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$5,'Synthetic text remains available','text',$6,false,'inbound','received','captured')`,
		f.organizationID, f.sessionID, f.conversationID, f.leadID, f.suffix+"-text", f.remoteJID); err != nil {
		t.Fatal(err)
	}
	values := url.Values{"leadId": {f.leadID}, "conversationId": {f.conversationID}, "includeMediaUrls": {"false"}, "orderingVersion": {"2"}}
	lazy, err := ParseHistoryAccessFilter(values)
	if err != nil {
		t.Fatal(err)
	}
	for _, fails := range []bool{false, true} {
		unavailable.Store(fails)
		history, err := repo.GetHistoryAccess(ctx, f.tenant, lazy)
		if err != nil || len(history.Messages) != 2 || calls.Load() != 0 {
			t.Fatalf("lazy history waited for Storage: messages=%d calls=%d err=%v", len(history.Messages), calls.Load(), err)
		}
		var textFound, mediaFound bool
		for _, message := range history.Messages {
			if message.MessageType == "text" && pointerValue(message.Content) == "Synthetic text remains available" {
				textFound = true
			}
			if message.ID == id && pointerValue(message.MediaStoragePath) == path && message.MediaURL == nil {
				mediaFound = true
			}
		}
		if !textFound || !mediaFound {
			t.Fatal("lazy history lost the text or canonical media reference")
		}
	}
	unavailable.Store(false)
	if _, err := repo.GetHistoryAccess(ctx, foreign.tenant, lazy); err == nil || calls.Load() != 0 {
		t.Fatal("foreign history access was accepted or contacted Storage")
	}
	if _, err := repo.GetMessageMediaURL(ctx, foreign.tenant, id); err == nil || calls.Load() != 0 {
		t.Fatal("foreign lazy media reference minted a capability")
	}
	if media, err := repo.GetMessageMediaURL(ctx, f.tenant, id); err != nil || media.URL == "" || calls.Load() != 1 {
		t.Fatalf("authorized lazy media cannot renew: calls=%d err=%v", calls.Load(), err)
	}
	whatsappMediaSignedURLCache.Delete(path)
	values.Del("includeMediaUrls")
	eager, err := ParseHistoryAccessFilter(values)
	if err != nil {
		t.Fatal(err)
	}
	history, err := repo.GetHistoryAccess(ctx, f.tenant, eager)
	if err != nil || calls.Load() != 2 {
		t.Fatalf("legacy eager history lost signing: calls=%d err=%v", calls.Load(), err)
	}
	for _, message := range history.Messages {
		if message.ID == id && pointerValue(message.MediaURL) != "" {
			return
		}
	}
	t.Fatal("legacy eager history lost its authorized signed URL")
}
