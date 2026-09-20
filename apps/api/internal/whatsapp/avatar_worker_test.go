package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNormalizeWhatsAppAvatarResponseReadsEvolutionDataAndAliases(t *testing.T) {
	tests := []struct {
		name     string
		response map[string]any
		wantURL  string
		wantID   string
	}{
		{
			name: "evolution data envelope",
			response: map[string]any{
				"ok": true,
				"data": map[string]any{
					"message": "success",
					"data": map[string]any{
						"url": "https://pps.whatsapp.net/avatar.jpg?token=one",
						"id":  "picture-1",
					},
				},
			},
			wantURL: "https://pps.whatsapp.net/avatar.jpg?token=one",
			wantID:  "picture-1",
		},
		{
			name: "snake case profile alias",
			response: map[string]any{
				"data": map[string]any{
					"profile_pic_url":    "https://scontent.fbcdn.net/avatar.webp",
					"profile_picture_id": "picture-2",
				},
			},
			wantURL: "https://scontent.fbcdn.net/avatar.webp",
			wantID:  "picture-2",
		},
		{
			name: "nested avatar object",
			response: map[string]any{
				"result": map[string]any{
					"avatar": map[string]any{
						"pictureUrl": "https://lookaside.fbsbx.com/avatar.png",
						"avatarId":   "picture-3",
					},
				},
			},
			wantURL: "https://lookaside.fbsbx.com/avatar.png",
			wantID:  "picture-3",
		},
		{
			name: "legacy wpi URL alias",
			response: map[string]any{
				"data": map[string]any{
					"wpiUrl": "https://pps.whatsapp.net/legacy.jpg",
					"id":     "picture-4",
				},
			},
			wantURL: "https://pps.whatsapp.net/legacy.jpg",
			wantID:  "picture-4",
		},
		{
			name: "legacy picture string alias",
			response: map[string]any{
				"picture": "https://pps.whatsapp.net/picture.jpg",
			},
			wantURL: "https://pps.whatsapp.net/picture.jpg",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeWhatsAppAvatarResponse(tt.response)
			if got.URL != tt.wantURL || got.ProviderAvatarID != tt.wantID {
				t.Fatalf("descriptor = %#v, want URL %q and id %q", got, tt.wantURL, tt.wantID)
			}
		})
	}
}

func TestWhatsAppAvatarEvolutionPayloadPreservesQualifiedJID(t *testing.T) {
	const jid = "123456789012345@lid"
	payload := whatsappAvatarEvolutionPayload(queuedWhatsAppAvatarJob{
		SessionID: "20000000-0000-0000-0000-000000000001",
		RemoteJID: jid,
	})
	body, ok := payload["body"].(map[string]any)
	if !ok {
		t.Fatalf("body = %#v, want map", payload["body"])
	}
	if got := body["number"]; got != jid {
		t.Fatalf("number = %#v, want exact JID %q", got, jid)
	}
	if got := body["preview"]; got != true {
		t.Fatalf("preview = %#v, want true", got)
	}

	endpoint, err := evolutionEndpointFor("user.avatar", body, "instance-1")
	if err != nil {
		t.Fatalf("evolutionEndpointFor() error: %v", err)
	}
	providerBody, ok := endpoint.Body.(map[string]any)
	if !ok || providerBody["number"] != jid {
		t.Fatalf("provider body changed the qualified JID: %#v", endpoint.Body)
	}
}

func TestUserAvatarProviderRequestPreservesQualifiedJIDAndOverridesShortClientTimeouts(t *testing.T) {
	const jid = "123456789012345@lid"
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/user/avatar" {
			t.Errorf("request = %s %s, want POST /user/avatar", request.Method, request.URL.Path)
		}
		if request.Header.Get("apikey") != "session-token" {
			t.Errorf("apikey = %q, want session-token", request.Header.Get("apikey"))
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Errorf("decode body: %v", err)
		}
		if got := body["number"]; got != jid {
			t.Errorf("number = %#v, want exact JID %q", got, jid)
		}
		if got := body["preview"]; got != true {
			t.Errorf("preview = %#v, want true", got)
		}
		// The action-specific avatar budget must replace the much shorter shared
		// client timeout; otherwise a slow provider IQ is canceled prematurely.
		time.Sleep(25 * time.Millisecond)
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"data":{"url":"https://pps.whatsapp.net/avatar.jpg"}}`))
	}))
	defer server.Close()

	shortClient := server.Client()
	shortClient.Timeout = time.Millisecond
	shortTransport, ok := shortClient.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("test client transport = %T, want *http.Transport", shortClient.Transport)
	}
	shortTransport = shortTransport.Clone()
	shortTransport.ResponseHeaderTimeout = time.Millisecond
	shortClient.Transport = shortTransport
	client := functionsClient{
		evolutionGoAPIURL: server.URL,
		evolutionGoAPIKey: "global-key",
		httpClient:        shortClient,
	}
	payload := whatsappAvatarEvolutionPayload(queuedWhatsAppAvatarJob{RemoteJID: jid})
	payload["instance_id"] = "instance-1"
	payload["token"] = "session-token"
	result, err := client.invokeEvolutionDirect(context.Background(), "user.avatar", payload)
	if err != nil {
		t.Fatalf("invokeEvolutionDirect() error: %v", err)
	}
	if !providerResultOK(result) {
		t.Fatalf("provider result = %#v, want success", result)
	}
}

func TestClassifyWhatsAppAvatarProviderResponse(t *testing.T) {
	tests := []struct {
		name        string
		response    map[string]any
		requestErr  error
		wantOutcome string
		wantError   bool
	}{
		{
			name: "completed",
			response: map[string]any{
				"ok": true,
				"data": map[string]any{"data": map[string]any{
					"url": "https://pps.whatsapp.net/avatar.jpg",
				}},
			},
			wantOutcome: whatsappAvatarOutcomeCompleted,
		},
		{
			name:        "successful response without photo",
			response:    map[string]any{"ok": true, "data": map[string]any{}},
			wantOutcome: whatsappAvatarOutcomeUnavailable,
		},
		{
			name: "privacy error nested below generic provider error",
			response: map[string]any{
				"ok":    false,
				"error": "provider returned 500",
				"data": map[string]any{
					"message": "ErrProfilePictureUnauthorized",
				},
			},
			wantOutcome: whatsappAvatarOutcomeUnavailable,
		},
		{
			name:        "generic provider failure",
			response:    map[string]any{"ok": false, "error": "upstream unavailable"},
			wantOutcome: whatsappAvatarOutcomeTransient,
			wantError:   true,
		},
		{
			name:        "transport timeout",
			requestErr:  errors.New("request timeout"),
			wantOutcome: whatsappAvatarOutcomeTransient,
			wantError:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, outcome, err := classifyWhatsAppAvatarProviderResponse(tt.response, tt.requestErr)
			if outcome != tt.wantOutcome {
				t.Fatalf("outcome = %q, want %q", outcome, tt.wantOutcome)
			}
			if (err != nil) != tt.wantError {
				t.Fatalf("error = %v, wantError %t", err, tt.wantError)
			}
		})
	}
}

func TestValidateWhatsAppAvatarURLAllowlist(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		allowed bool
	}{
		{name: "whatsapp CDN", value: "https://pps.whatsapp.net/v/t61/avatar.jpg?oh=token", allowed: true},
		{name: "Facebook CDN", value: "https://scontent-gru2-2.xx.fbcdn.net/avatar.jpg", allowed: true},
		{name: "Facebook sandbox", value: "https://lookaside.fbsbx.com/avatar.webp", allowed: true},
		{name: "explicit TLS port", value: "https://pps.whatsapp.net:443/avatar.jpg", allowed: true},
		{name: "plain HTTP", value: "http://pps.whatsapp.net/avatar.jpg"},
		{name: "suffix confusion", value: "https://pps.whatsapp.net.evil.example/avatar.jpg"},
		{name: "prefix confusion", value: "https://evilwhatsapp.net/avatar.jpg"},
		{name: "credentials", value: "https://user:password@pps.whatsapp.net/avatar.jpg"},
		{name: "forbidden port", value: "https://pps.whatsapp.net:8443/avatar.jpg"},
		{name: "direct private IP", value: "https://127.0.0.1/avatar.jpg"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := validateWhatsAppAvatarURL(tt.value)
			if (err == nil) != tt.allowed {
				t.Fatalf("validateWhatsAppAvatarURL(%q) error = %v, allowed=%t", tt.value, err, tt.allowed)
			}
		})
	}
}

func TestWhatsAppAvatarRedirectPolicyRevalidatesEveryHop(t *testing.T) {
	allowed, _ := http.NewRequest(http.MethodGet, "https://scontent.fbcdn.net/next.jpg", nil)
	if err := whatsappAvatarRedirectPolicy(allowed, []*http.Request{{}}); err != nil {
		t.Fatalf("allowed redirect rejected: %v", err)
	}

	blocked, _ := http.NewRequest(http.MethodGet, "https://example.com/private", nil)
	if err := whatsappAvatarRedirectPolicy(blocked, []*http.Request{{}}); err == nil {
		t.Fatal("redirect to a non-allowlisted origin must be rejected")
	}

	if err := whatsappAvatarRedirectPolicy(allowed, []*http.Request{{}, {}, {}}); err == nil {
		t.Fatal("fourth request must exceed the three-hop redirect budget")
	}
}

func TestReadWhatsAppAvatarBytesEnforcesLimit(t *testing.T) {
	payload, err := readWhatsAppAvatarBytes(strings.NewReader("12345"), 5)
	if err != nil || string(payload) != "12345" {
		t.Fatalf("payload = %q, error = %v", payload, err)
	}
	if _, err := readWhatsAppAvatarBytes(strings.NewReader("123456"), 5); err == nil {
		t.Fatal("payload above the limit must fail")
	}
}

func TestDetectWhatsAppAvatarImageMagicMIME(t *testing.T) {
	tests := []struct {
		name     string
		payload  []byte
		wantMIME string
		wantExt  string
		wantErr  bool
	}{
		{name: "jpeg", payload: []byte{0xff, 0xd8, 0xff, 0xdb}, wantMIME: "image/jpeg", wantExt: "jpg"},
		{name: "png", payload: []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, wantMIME: "image/png", wantExt: "png"},
		{name: "webp", payload: []byte("RIFF\x00\x00\x00\x00WEBP"), wantMIME: "image/webp", wantExt: "webp"},
		{name: "html disguised as image", payload: []byte("<html>not an image</html>"), wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mimeType, extension, err := detectWhatsAppAvatarImage(tt.payload)
			if (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %t", err, tt.wantErr)
			}
			if mimeType != tt.wantMIME || extension != tt.wantExt {
				t.Fatalf("detected (%q, %q), want (%q, %q)", mimeType, extension, tt.wantMIME, tt.wantExt)
			}
		})
	}
}

func TestUserAvatarIsReadOnlyWithDedicatedTimeout(t *testing.T) {
	if evolutionActionMayCommitMutation("user.avatar") {
		t.Fatal("user.avatar must not be classified as a mutation with an ambiguous outcome")
	}
	if got := evolutionRequestTimeout("user.avatar"); got != 90*time.Second {
		t.Fatalf("user.avatar timeout = %s, want 90s", got)
	}
	if evolutionHTTPOutcomeUnknown("user.avatar", http.StatusGatewayTimeout) {
		t.Fatal("read-only avatar request must not become provider-outcome-unknown")
	}
}

func TestWhatsAppAvatarWorkerTimeoutBudgetCoversEvolutionAvatarLookup(t *testing.T) {
	const (
		evolutionAvatarHandlerTimeout = 80 * time.Second
		providerResponseHeadroom      = 10 * time.Second
		postIOProcessingHeadroom      = 10 * time.Second
		leaseRecoveryHeadroom         = 15 * time.Second
	)
	storageRequestTimeout := newStorageClient(StorageConfig{}).httpClient.Timeout

	minimumRequestTimeout := evolutionAvatarHandlerTimeout + providerResponseHeadroom
	if whatsappAvatarRequestTimeout < minimumRequestTimeout {
		t.Fatalf(
			"avatar request timeout = %s, want Evolution Go handler %s + response headroom %s",
			whatsappAvatarRequestTimeout,
			evolutionAvatarHandlerTimeout,
			providerResponseHeadroom,
		)
	}
	worstCaseProcessing := whatsappAvatarRequestTimeout +
		whatsappAvatarDownloadTimeout +
		2*storageRequestTimeout // upload plus existence reconciliation after an ambiguous upload failure
	minimumProcessingLimit := worstCaseProcessing + postIOProcessingHeadroom
	if whatsappAvatarProcessingLimit < minimumProcessingLimit {
		t.Fatalf(
			"avatar processing limit = %s, want request %s + download %s + two Storage requests of %s + headroom %s",
			whatsappAvatarProcessingLimit,
			whatsappAvatarRequestTimeout,
			whatsappAvatarDownloadTimeout,
			storageRequestTimeout,
			postIOProcessingHeadroom,
		)
	}
	minimumLease := whatsappAvatarClaimTimeout +
		whatsappAvatarProcessingLimit +
		whatsappAvatarFinishTimeout +
		leaseRecoveryHeadroom
	if whatsappAvatarLease < minimumLease {
		t.Fatalf(
			"avatar lease = %s, want claim %s + processing %s + finish %s + recovery headroom %s",
			whatsappAvatarLease,
			whatsappAvatarClaimTimeout,
			whatsappAvatarProcessingLimit,
			whatsappAvatarFinishTimeout,
			leaseRecoveryHeadroom,
		)
	}
}

func TestEvolutionFetchDedicatedTimeoutStillHonorsCallerDeadline(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		time.Sleep(50 * time.Millisecond)
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	client := functionsClient{
		evolutionGoAPIURL: server.URL,
		evolutionGoAPIKey: "test-key",
		httpClient:        server.Client(),
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()

	_, err := client.evolutionFetch(ctx, http.MethodPost, "/user/avatar", evolutionFetchOptions{
		Body:           map[string]any{"number": "123@s.whatsapp.net"},
		RequestTimeout: 100 * time.Millisecond,
	})
	if err == nil {
		t.Fatal("dedicated Evolution timeout ignored the shorter caller deadline")
	}
	if !errors.Is(ctx.Err(), context.DeadlineExceeded) {
		t.Fatalf("caller context error = %v, want deadline exceeded", ctx.Err())
	}
}

func TestPublishWhatsAppAvatarUpdatedUsesDedicatedRealtimeType(t *testing.T) {
	publisher := &recordingLeadPublisher{}
	repo := Repository{leadPublisher: publisher}

	repo.publishWhatsAppAvatarUpdated(" org-1 ", " lead-1 ")
	if len(publisher.events) != 1 {
		t.Fatalf("published events = %d, want 1", len(publisher.events))
	}
	event := publisher.events[0]
	if event.Type != "lead.whatsapp_avatar_updated" || event.OrganizationID != "org-1" {
		t.Fatalf("event scope = %#v", event)
	}
	if got := event.Data["leadId"]; got != "lead-1" {
		t.Fatalf("leadId = %#v, want lead-1", got)
	}
	if len(event.Data) != 1 {
		t.Fatalf("event leaked additional data: %#v", event.Data)
	}
}

func TestWhatsAppAvatarErrorTextNeverPersistsProviderSecretsOrPII(t *testing.T) {
	value := whatsappAvatarErrorText(errors.New(
		"provider failed for 5511999999999@s.whatsapp.net at https://pps.whatsapp.net/avatar?token=secret\napikey=also-secret",
	))
	if value != "avatar_provider_auth_failed" {
		t.Fatalf("error code = %q, want avatar_provider_auth_failed", value)
	}
	for _, forbidden := range []string{"5511999999999", "whatsapp.net", "secret", "token", "apikey", "http"} {
		if strings.Contains(strings.ToLower(value), forbidden) {
			t.Fatalf("stable error code leaked %q: %q", forbidden, value)
		}
	}
}
