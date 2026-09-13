package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
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

func TestStorageObjectExistsUsesBoundedAuthenticatedRead(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %s, want GET", r.Method)
		}
		if r.Header.Get("Range") != "bytes=0-0" {
			t.Errorf("Range = %q, want bytes=0-0", r.Header.Get("Range"))
		}
		if r.Header.Get("apikey") != "service-role-test-key" || r.Header.Get("Authorization") != "" {
			t.Error("Storage reconciliation omitted service authentication")
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/exists.png"):
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write([]byte("x"))
		case strings.HasSuffix(r.URL.Path, "/missing.png"):
			http.NotFound(w, r)
		case strings.HasSuffix(r.URL.Path, "/legacy-missing.png"):
			http.Error(w, `{"message":"Object not found"}`, http.StatusBadRequest)
		case strings.HasSuffix(r.URL.Path, "/invalid.png"):
			http.Error(w, `{"message":"Invalid object path"}`, http.StatusBadRequest)
		default:
			http.Error(w, "storage unavailable", http.StatusServiceUnavailable)
		}
	}))
	defer server.Close()

	client := storageClient{projectURL: server.URL, apiKey: "service-role-test-key", httpClient: server.Client()}
	exists, err := client.objectExists(context.Background(), whatsappMediaBucket, "orgs/org/assets/v2/exists.png")
	if err != nil || !exists {
		t.Fatalf("existing object = (%v, %v), want (true, nil)", exists, err)
	}
	exists, err = client.objectExists(context.Background(), whatsappMediaBucket, "orgs/org/assets/v2/missing.png")
	if err != nil || exists {
		t.Fatalf("missing object = (%v, %v), want (false, nil)", exists, err)
	}
	exists, err = client.objectExists(context.Background(), whatsappMediaBucket, "orgs/org/assets/v2/legacy-missing.png")
	if err != nil || exists {
		t.Fatalf("legacy missing object = (%v, %v), want (false, nil)", exists, err)
	}
	if _, err := client.objectExists(context.Background(), whatsappMediaBucket, "orgs/org/assets/v2/invalid.png"); err == nil {
		t.Fatal("generic Storage 400 was treated as a missing object")
	}
	if _, err := client.objectExists(context.Background(), whatsappMediaBucket, "orgs/org/assets/v2/error.png"); err == nil {
		t.Fatal("unexpected Storage response was treated as a missing object")
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

func TestDownloadWhatsAppMediaNeverSendsProviderCredentialsToWebhookURL(t *testing.T) {
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

	var providerCredentialLeaks atomic.Int32
	var blockedRedirectTarget string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/blocked" {
			http.Redirect(w, r, blockedRedirectTarget, http.StatusFound)
			return
		}
		if r.Header.Get("apikey") != "" || r.Header.Get("Authorization") != "" {
			providerCredentialLeaks.Add(1)
		}
		if r.URL.Path == "/private" {
			http.Error(w, "credentials required", http.StatusUnauthorized)
			return
		}
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

	if _, err := repo.downloadWhatsAppMediaURL(ctx, provider.URL+"/private"); err == nil {
		t.Fatal("webhook-controlled provider URL unexpectedly received privileged access")
	}
	if providerCredentialLeaks.Load() != 0 {
		t.Fatalf("provider API key leaked on %d webhook-controlled request(s)", providerCredentialLeaks.Load())
	}

	media, err := repo.downloadWhatsAppMediaURL(ctx, provider.URL+"/public")
	if err != nil {
		t.Fatalf("public download through provider redirect: %v", err)
	}
	if string(media.bytes) != "safe-media" {
		t.Fatalf("download = %q, want safe-media", media.bytes)
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

func TestSignedWhatsAppMessageMediaURLUsesTenantScopedCache(t *testing.T) {
	const organizationID = "20000000-0000-0000-0000-000000000011"
	objectPath := "orgs/" + organizationID + "/sessions/session-1/incoming/lazy.png"
	whatsappMediaSignedURLCache.Delete(objectPath)
	t.Cleanup(func() { whatsappMediaSignedURLCache.Delete(objectPath) })

	var signingRequests atomic.Int32
	storage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		signingRequests.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"signedURL":"/object/sign/whatsapp-media/safe?token=lazy"}`))
	}))
	defer storage.Close()

	repo := Repository{storage: storageClient{
		projectURL: storage.URL,
		apiKey:     "service-role-test-key",
		httpClient: storage.Client(),
	}}
	first, firstTTL, err := repo.signedWhatsAppMessageMediaURLWithTTL(context.Background(), organizationID, objectPath)
	if err != nil || first == "" {
		t.Fatalf("first lazy media signing = %q, %v", first, err)
	}
	if firstTTL != whatsappMediaSignedURLTTLSeconds-int(whatsappMediaSignedURLCacheSkew/time.Second) {
		t.Fatalf("first lazy media safe TTL = %d, want %d", firstTTL, whatsappMediaSignedURLTTLSeconds-int(whatsappMediaSignedURLCacheSkew/time.Second))
	}
	if whatsappMediaSignedURLTTLSeconds > 15*60 {
		t.Fatalf("lazy media bearer URL TTL = %ds, exceeds 15 minute security bound", whatsappMediaSignedURLTTLSeconds)
	}
	second, secondTTL, err := repo.signedWhatsAppMessageMediaURLWithTTL(context.Background(), organizationID, objectPath)
	if err != nil || second != first {
		t.Fatalf("cached lazy media signing = %q, %v; want %q", second, err, first)
	}
	if secondTTL < 1 || secondTTL > firstTTL {
		t.Fatalf("cached lazy media safe TTL = %d, want 1..%d", secondTTL, firstTTL)
	}
	if signingRequests.Load() != 1 {
		t.Fatalf("Storage signing requests = %d, want one cached request", signingRequests.Load())
	}

	foreignOrganization := "20000000-0000-0000-0000-000000000012"
	if _, _, err := repo.signedWhatsAppMessageMediaURLWithTTL(context.Background(), foreignOrganization, objectPath); !errors.Is(err, ErrMessageNotFound) {
		t.Fatalf("foreign tenant signing error = %v, want ErrMessageNotFound", err)
	}
}

func TestWhatsAppMediaSignedURLCacheIsBoundedAndSweepsExpiredEntries(t *testing.T) {
	cache := newBoundedWhatsAppMediaSignedURLCache(2)
	now := time.Now()
	cache.Store("expired", cachedWhatsAppMediaSignedURL{url: "expired", expiresAt: now.Add(-time.Minute)})
	cache.Store("first", cachedWhatsAppMediaSignedURL{url: "first", expiresAt: now.Add(time.Minute)})
	cache.Store("second", cachedWhatsAppMediaSignedURL{url: "second", expiresAt: now.Add(2 * time.Minute)})
	if cache.Len() != 2 {
		t.Fatalf("cache entries after expired sweep = %d, want 2", cache.Len())
	}
	if _, ok := cache.Load("expired"); ok {
		t.Fatal("expired signed URL survived opportunistic sweep")
	}

	cache.Store("third", cachedWhatsAppMediaSignedURL{url: "third", expiresAt: now.Add(3 * time.Minute)})
	if cache.Len() != 2 {
		t.Fatalf("cache entries after capacity eviction = %d, want 2", cache.Len())
	}
	if _, ok := cache.Load("first"); ok {
		t.Fatal("earliest-expiring signed URL was not evicted at capacity")
	}
	if _, ok := cache.Load("second"); !ok {
		t.Fatal("newer signed URL was evicted instead of the earliest expiry")
	}
	if _, ok := cache.Load("third"); !ok {
		t.Fatal("newly stored signed URL is missing")
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
