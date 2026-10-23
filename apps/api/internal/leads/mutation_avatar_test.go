package leads

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestMutationAvatarDoesNotContactStorageAndReadsStillSign(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		_, _ = w.Write([]byte(`{"signedURL":"/object/sign/whatsapp-media/safe?token=avatar"}`))
	}))
	defer server.Close()
	repo := newAvatarSigningTestRepository(server)
	objectPath := avatarTestStoragePath(avatarTestOrganizationID, avatarTestLeadID)
	legacyURL := "https://provider.invalid/legacy.jpg"
	lead := Lead{ID: avatarTestLeadID, OrganizationID: avatarTestOrganizationID,
		WhatsAppAvatarStoragePath: &objectPath, WhatsAppAvatarURL: &legacyURL}
	repo.hydrateMutationLeadAvatar(avatarTestOrganizationID, &lead)
	if requests.Load() != 0 || lead.WhatsAppAvatarURL != nil {
		t.Fatal("cache miss must not contact Storage or expose the legacy URL")
	}
	repo.hydrateLeadAvatar(context.Background(), avatarTestOrganizationID, &lead)
	if requests.Load() != 1 || lead.WhatsAppAvatarURL == nil {
		t.Fatal("the authorized read must still sign the avatar")
	}
	want := *lead.WhatsAppAvatarURL
	lead.WhatsAppAvatarURL = nil
	repo.hydrateMutationLeadAvatar(avatarTestOrganizationID, &lead)
	if requests.Load() != 1 || lead.WhatsAppAvatarURL == nil || *lead.WhatsAppAvatarURL != want {
		t.Fatal("mutation must reuse only the authorized signature")
	}
	repo.whatsAppAvatarURLs.store(objectPath, cachedWhatsAppAvatarSignedURL{url: want, expiresAt: time.Now().Add(-time.Second)})
	repo.hydrateMutationLeadAvatar(avatarTestOrganizationID, &lead)
	if lead.WhatsAppAvatarURL != nil || requests.Load() != 1 {
		t.Fatal("expired mutation signatures must be omitted without signing")
	}
}

func TestMutationAvatarRejectsForeignOrganizationEvenWithCachedPath(t *testing.T) {
	repo := Repository{whatsAppAvatarURLs: newBoundedWhatsAppAvatarSignedURLCache(2)}
	objectPath := avatarTestStoragePath(avatarTestOrganizationID, avatarTestLeadID)
	url := "https://storage.invalid/signed"
	repo.whatsAppAvatarURLs.store(objectPath, cachedWhatsAppAvatarSignedURL{url: url, expiresAt: time.Now().Add(time.Hour)})
	lead := Lead{ID: avatarTestLeadID, OrganizationID: avatarTestOrganizationID,
		WhatsAppAvatarStoragePath: &objectPath, WhatsAppAvatarURL: &url}
	repo.hydrateMutationLeadAvatar("33333333-3333-4333-8333-333333333333", &lead)
	if lead.WhatsAppAvatarURL != nil {
		t.Fatal("foreign organization cannot reuse the cached signature")
	}
}
