package whatsapp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestStoragePathFromPublicURLRequiresConfiguredOrigin(t *testing.T) {
	const projectURL = "https://project.supabase.co"
	const objectPath = "orgs/org-1/sessions/session-1/outgoing/file.pdf"

	if got := storagePathFromPublicURL(
		projectURL+"/storage/v1/object/public/whatsapp-media/"+objectPath,
		projectURL,
	); got != objectPath {
		t.Fatalf("public object path = %q, want %q", got, objectPath)
	}
	if got := storagePathFromPublicURL(
		projectURL+"/storage/v1/object/sign/whatsapp-media/"+objectPath+"?token=temporary",
		projectURL,
	); got != objectPath {
		t.Fatalf("signed object path = %q, want %q", got, objectPath)
	}
	if got := storagePathFromPublicURL(
		"https://attacker.invalid/storage/v1/object/public/whatsapp-media/"+objectPath,
		projectURL,
	); got != "" {
		t.Fatalf("external spoofed object path = %q, want empty", got)
	}
}

func TestWhatsAppMediaPathMustBelongToOrganization(t *testing.T) {
	const organizationID = "20000000-0000-0000-0000-000000000001"
	tests := []struct {
		path string
		want bool
	}{
		{"orgs/" + organizationID + "/sessions/session-1/outgoing/file.pdf", true},
		{organizationID + "/sessions/session-1/incoming/legacy.pdf", true},
		{"orgs/20000000-0000-0000-0000-000000000002/sessions/session-1/outgoing/file.pdf", false},
		{"20000000-0000-0000-0000-000000000002/sessions/session-1/incoming/legacy.pdf", false},
		{"orgs/" + organizationID + "/../20000000-0000-0000-0000-000000000002/file.pdf", false},
		{organizationID + "/../20000000-0000-0000-0000-000000000002/file.pdf", false},
		{"orgs/" + organizationID + "/%2e%2e/20000000-0000-0000-0000-000000000002/file.pdf", false},
		{"orgs/" + organizationID + `\sessions\session-1\file.pdf`, false},
	}
	for _, test := range tests {
		if got := whatsappMediaPathBelongsToOrganization(test.path, organizationID); got != test.want {
			t.Fatalf("whatsappMediaPathBelongsToOrganization(%q) = %t, want %t", test.path, got, test.want)
		}
	}
}

func TestAllowedWhatsAppMediaURLRejectsSSRFAndScopesCredentials(t *testing.T) {
	tests := []struct {
		raw          string
		allowed      bool
		providerHost bool
	}{
		{"https://evogo.example.com:8443/media/1", true, true},
		{"https://evogo.example.com/media/1", false, false},
		{"http://evogo.example.com:8443/media/1", false, false},
		{"https://evogo.example.com:9443/media/1", false, false},
		{"https://project.supabase.co/storage/v1/object/sign/whatsapp-media/file", true, false},
		{"https://project.supabase.co:444/storage/v1/object/sign/whatsapp-media/file", false, false},
		{"https://mmg.whatsapp.net/media/1", true, false},
		{"https://mmg.whatsapp.net:443/media/1", true, false},
		{"https://mmg.whatsapp.net:444/media/1", false, false},
		{"http://mmg.whatsapp.net/media/1", false, false},
		{"https://lookaside.fbsbx.com/media/1", true, false},
		{"https://evilwhatsapp.net/media/1", false, false},
		{"http://127.0.0.1/admin", false, false},
		{"https://169.254.169.254/latest/meta-data", false, false},
		{"https://attacker.invalid/media/1", false, false},
		{"https://user:password@evogo.example.com/media/1", false, false},
	}
	for _, test := range tests {
		candidate, err := url.Parse(test.raw)
		if err != nil {
			t.Fatal(err)
		}
		allowed, providerHost := allowedWhatsAppMediaURL(
			candidate,
			"https://evogo.example.com:8443",
			"https://project.supabase.co",
		)
		if allowed != test.allowed || providerHost != test.providerHost {
			t.Fatalf("allowedWhatsAppMediaURL(%q) = (%t,%t), want (%t,%t)", test.raw, allowed, providerHost, test.allowed, test.providerHost)
		}
	}
}

func TestAllowedWhatsAppMediaURLAllowsExactConfiguredHTTPProviderOrigin(t *testing.T) {
	candidate, err := url.Parse("http://evolution-go.internal:8080/media/1")
	if err != nil {
		t.Fatal(err)
	}
	allowed, providerHost := allowedWhatsAppMediaURL(candidate, "http://evolution-go.internal:8080/api", "https://project.supabase.co")
	if !allowed || !providerHost {
		t.Fatalf("exact configured provider origin = (%t,%t), want (true,true)", allowed, providerHost)
	}
}

func TestDownloadWhatsAppMediaStripsProviderCredentialsOnRedirect(t *testing.T) {
	const apiKey = "provider-secret"
	var projectCredentialLeaks atomic.Int32
	project := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("apikey") != "" || r.Header.Get("Authorization") != "" {
			projectCredentialLeaks.Add(1)
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("safe-media"))
	}))
	defer project.Close()

	var providerAuthorizedRequests atomic.Int32
	var blockedRedirectTarget string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/blocked" {
			http.Redirect(w, r, blockedRedirectTarget, http.StatusFound)
			return
		}
		if r.Header.Get("apikey") != apiKey || r.Header.Get("Authorization") != "Bearer "+apiKey {
			http.Error(w, "credentials required", http.StatusUnauthorized)
			return
		}
		providerAuthorizedRequests.Add(1)
		http.Redirect(w, r, project.URL+"/media", http.StatusFound)
	}))
	defer provider.Close()

	var blockedTargetRequests atomic.Int32
	blocked := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		blockedTargetRequests.Add(1)
		_, _ = w.Write([]byte("must-not-be-reached"))
	}))
	defer blocked.Close()
	blockedRedirectTarget = blocked.URL + "/private"

	repo := Repository{
		storage: storageClient{projectURL: project.URL},
		functions: functionsClient{
			evolutionGoAPIURL: provider.URL,
			evolutionGoAPIKey: apiKey,
			httpClient:        &http.Client{Timeout: 2 * time.Second},
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	media, err := repo.downloadWhatsAppMediaURL(ctx, provider.URL+"/media")
	if err != nil {
		t.Fatalf("download through provider redirect: %v", err)
	}
	if string(media.bytes) != "safe-media" || providerAuthorizedRequests.Load() != 1 {
		t.Fatalf("download = %q, authorized provider requests = %d", media.bytes, providerAuthorizedRequests.Load())
	}
	if projectCredentialLeaks.Load() != 0 {
		t.Fatalf("provider credentials leaked on %d redirected request(s)", projectCredentialLeaks.Load())
	}

	if _, err := repo.downloadWhatsAppMediaURL(ctx, provider.URL+"/blocked"); err == nil {
		t.Fatal("download accepted a redirect to a non-allowlisted origin")
	}
	if blockedTargetRequests.Load() != 0 {
		t.Fatalf("blocked redirect target received %d request(s)", blockedTargetRequests.Load())
	}
}

func TestHydrateMessageMediaURLsSignsOnlySameOrganizationPaths(t *testing.T) {
	const organizationID = "20000000-0000-0000-0000-000000000001"
	modernPath := "orgs/" + organizationID + "/sessions/session-1/incoming/modern.png"
	legacyPath := organizationID + "/sessions/session-1/incoming/legacy.png"
	foreignPath := "orgs/20000000-0000-0000-0000-000000000002/sessions/session-1/incoming/foreign.png"
	for _, objectPath := range []string{modernPath, legacyPath, foreignPath} {
		whatsappMediaSignedURLCache.Delete(objectPath)
		defer whatsappMediaSignedURLCache.Delete(objectPath)
	}

	var signingRequests atomic.Int32
	storage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		signingRequests.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"signedURL":"/object/sign/whatsapp-media/safe?token=test"}`))
	}))
	defer storage.Close()

	repo := Repository{storage: storageClient{
		projectURL: storage.URL,
		apiKey:     "service-role-test-key",
		httpClient: storage.Client(),
	}}
	foreignURL := "https://attacker.invalid/already-present"
	messages := []Message{
		{MessageType: "image", MediaStoragePath: &modernPath},
		{MessageType: "image", MediaStoragePath: &legacyPath},
		{MessageType: "image", MediaStoragePath: &foreignPath, MediaURL: &foreignURL},
	}
	if err := repo.hydrateMessageMediaURLs(context.Background(), organizationID, messages); err != nil {
		t.Fatal(err)
	}
	if signingRequests.Load() != 2 {
		t.Fatalf("storage signing requests = %d, want 2 same-organization objects", signingRequests.Load())
	}
	if messages[0].MediaURL == nil || messages[1].MediaURL == nil {
		t.Fatalf("same-organization media was not signed: %#v", messages)
	}
	if messages[2].MediaURL != nil {
		t.Fatalf("foreign organization media retained/signed URL: %#v", messages[2])
	}
}

func TestSessionJSONRedactsProviderCredentials(t *testing.T) {
	session := Session{
		ID: "session-1",
		AdvancedSettings: map[string]any{
			"token":                 "provider-secret",
			"webhook_token":         "webhook-secret",
			"webhook_url":           "https://example.invalid/hook?webhook_token=secret",
			"ai_auto_reply_enabled": true,
			"nested": map[string]any{
				"access_token": "nested-secret",
				"mode":         "safe",
			},
		},
	}

	raw, err := json.Marshal(session)
	if err != nil {
		t.Fatal(err)
	}
	encoded := string(raw)
	for _, secret := range []string{"provider-secret", "webhook-secret", "nested-secret", "webhook_url"} {
		if strings.Contains(encoded, secret) {
			t.Fatalf("session JSON leaked %q: %s", secret, encoded)
		}
	}
	if !strings.Contains(encoded, `"ai_auto_reply_enabled":true`) || !strings.Contains(encoded, `"mode":"safe"`) {
		t.Fatalf("session JSON removed non-secret settings: %s", encoded)
	}
}

func TestSendMessageRequestRejectsOversizedClientIDAndMedia(t *testing.T) {
	oversizedClientID := strings.Repeat("x", 201)
	if _, err := (SendMessageRequest{Text: "hello", ClientMessageID: &oversizedClientID}).Validate(); err == nil {
		t.Fatal("expected oversized client message id to be rejected")
	}

	oversizedBase64 := strings.Repeat("A", 7*1024*1024+1)
	if _, err := (SendMessageRequest{Base64: &oversizedBase64}).Validate(); err == nil {
		t.Fatal("expected oversized media to be rejected")
	}
}
