package leads

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestWhatsAppAvatarPrivateOnlyLeadBoardAndContactUseOneSignature(t *testing.T) {
	var calls atomic.Int32
	path := avatarTestStoragePath(avatarTestOrganizationID, avatarTestLeadID)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost || !strings.HasSuffix(r.URL.Path, "/whatsapp-media/"+path) {
			t.Error("unexpected private-avatar signing target")
		}
		_, _ = w.Write([]byte(`{"signedURL":"/object/sign/whatsapp-media/private-only?token=fixture"}`))
	}))
	defer server.Close()
	repo := newAvatarSigningTestRepository(server)
	lead := Lead{ID: avatarTestLeadID, OrganizationID: avatarTestOrganizationID, WhatsAppAvatarStoragePath: &path}
	board := PipelineBoardLead{ID: avatarTestLeadID, OrganizationID: avatarTestOrganizationID, WhatsAppAvatarStoragePath: &path}
	contacts := []Contact{{ID: avatarTestLeadID, WhatsAppAvatarStoragePath: &path}}
	repo.hydrateLeadAvatar(context.Background(), avatarTestOrganizationID, &lead)
	repo.hydratePipelineBoardLeadAvatars(context.Background(), avatarTestOrganizationID, []*PipelineBoardLead{&board})
	repo.hydrateContactAvatars(context.Background(), avatarTestOrganizationID, contacts)
	want := server.URL + "/storage/v1/object/sign/whatsapp-media/private-only?token=fixture"
	for name, url := range map[string]*string{"lead": lead.WhatsAppAvatarURL, "board": board.WhatsAppAvatarURL, "contact": contacts[0].WhatsAppAvatarURL} {
		if url == nil || *url != want {
			t.Errorf("%s did not expose its authorized private-only avatar", name)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("signatures=%d, want one cached signature", calls.Load())
	}
}
