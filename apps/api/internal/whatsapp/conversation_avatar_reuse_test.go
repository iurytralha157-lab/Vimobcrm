package whatsapp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestConversationAvatarPrivateObjectWorksWithoutLegacyURL(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost || !strings.Contains(r.URL.Path, "/object/sign/whatsapp-media/orgs/"+conversationAvatarTestOrg+"/profile-pictures/"+conversationAvatarTestLead+"/") {
			t.Error("unexpected private-avatar signing target")
		}
		_, _ = w.Write([]byte(`{"signedURL":"/object/sign/whatsapp-media/synthetic-private?token=fixture"}`))
	}))
	defer server.Close()
	repo := conversationAvatarTestRepository(server)
	current := conversationAvatarTestRecord(conversationAvatarTestOrg, conversationAvatarTestLead, false)
	history := conversationAvatarTestRecord(conversationAvatarTestOrg, conversationAvatarTestLead, true)
	foreign := conversationAvatarTestRecord(conversationAvatarOtherOrg, conversationAvatarTestLead, false)
	for _, conversation := range []*Conversation{&current, &history, &foreign} {
		conversation.Lead.WhatsAppAvatarURL = nil
		conversation.ContactPicture = nil
	}
	repo.hydrateConversationAvatars(context.Background(), conversationAvatarTestOrg, []*Conversation{&current, &history, &foreign})
	want := server.URL + "/storage/v1/object/sign/whatsapp-media/synthetic-private?token=fixture"
	if calls.Load() != 1 || current.Lead.WhatsAppAvatarURL == nil || *current.Lead.WhatsAppAvatarURL != want ||
		history.Lead.WhatsAppAvatarURL == nil || *history.Lead.WhatsAppAvatarURL != want ||
		history.ContactPicture == nil || *history.ContactPicture != want {
		t.Fatal("private-only current/history photo did not reuse the canonical signed URL")
	}
	if current.ContactPicture != nil || foreign.Lead.WhatsAppAvatarURL != nil || foreign.ContactPicture != nil {
		t.Fatal("projection invented a contact photo or exposed a foreign tenant photo")
	}
}
