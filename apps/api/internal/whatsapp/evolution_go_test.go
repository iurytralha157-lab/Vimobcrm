package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestEvolutionSendTextBodyPreservesIdempotencyID(t *testing.T) {
	body := evolutionSendTextBody(map[string]any{
		"id":     "client-message-123",
		"number": "5511999999999",
		"text":   "Teste",
	})
	if body["id"] != "client-message-123" {
		t.Fatalf("expected deterministic provider message id, got %#v", body["id"])
	}
}

func TestEvolutionSendMediaBodyKeepsURLAndBase64Separate(t *testing.T) {
	body := evolutionSendMediaBody(map[string]any{
		"number":       "5511999999999",
		"type":         "image",
		"url":          "https://example.com/image.png?token=abc",
		"mimetype":     "image/png",
		"filename":     "image.png",
		"caption":      "Teste",
		"mentionedJid": []string{},
	}, "")

	if body["url"] != "https://example.com/image.png?token=abc" {
		t.Fatalf("expected URL media to stay in url field, got %#v", body["url"])
	}
	if _, exists := body["base64"]; exists {
		t.Fatalf("expected URL media to not populate base64 field, got %#v", body["base64"])
	}
}

func TestEvolutionSendMediaBodyDoesNotTreatBase64AsURL(t *testing.T) {
	body := evolutionSendMediaBody(map[string]any{
		"number":   "5511999999999",
		"type":     "audio",
		"base64":   "UklGRiQAAABXQVZFZm10IBAAAAABAAEA",
		"mimetype": "audio/webm",
		"filename": "audio.webm",
	}, "")

	if body["base64"] != "UklGRiQAAABXQVZFZm10IBAAAAABAAEA" {
		t.Fatalf("expected base64 media to stay in base64 field, got %#v", body["base64"])
	}
	if _, exists := body["url"]; exists {
		t.Fatalf("expected base64 media to not populate url field, got %#v", body["url"])
	}
}

func TestEvolutionCreateDefaultsPreserveMobileNotifications(t *testing.T) {
	endpoint, err := evolutionEndpointFor("instance.create", map[string]any{
		"name": "test-instance",
	}, "test-instance")
	if err != nil {
		t.Fatalf("evolutionEndpointFor() returned error: %v", err)
	}
	body, ok := endpoint.Body.(map[string]any)
	if !ok {
		t.Fatalf("expected create body map, got %#v", endpoint.Body)
	}
	advanced, ok := body["advancedSettings"].(map[string]any)
	if !ok {
		t.Fatalf("expected advancedSettings map, got %#v", body["advancedSettings"])
	}
	if advanced["alwaysOnline"] != false || advanced["readMessages"] != false || advanced["ignoreStatus"] != false || advanced["ignoreGroups"] != false {
		t.Fatalf("unsafe notification defaults: %#v", advanced)
	}
}

func TestEvolutionAdvancedSettingsEndpointIsInstanceScopedAndNotificationSafe(t *testing.T) {
	const instanceKey = "instance/with spaces"
	endpoint, err := evolutionEndpointFor("instance.advancedSettings", map[string]any{
		"alwaysOnline": true,
		"readMessages": true,
		"unexpected":   true,
	}, instanceKey)
	if err != nil {
		t.Fatalf("evolutionEndpointFor() returned error: %v", err)
	}
	if endpoint.Method != http.MethodPut {
		t.Fatalf("method = %q, want PUT", endpoint.Method)
	}
	wantPath := "/instance/" + url.PathEscape(instanceKey) + "/advanced-settings"
	if endpoint.Path != wantPath {
		t.Fatalf("path = %q, want %q", endpoint.Path, wantPath)
	}
	body, ok := endpoint.Body.(map[string]any)
	if !ok {
		t.Fatalf("expected body map, got %#v", endpoint.Body)
	}
	want := evolutionNotificationSafeSettingsBody()
	if len(body) != len(want) {
		t.Fatalf("unexpected advanced-settings body %#v", body)
	}
	for key, value := range want {
		if body[key] != value {
			t.Fatalf("advanced setting %q = %#v, want %#v", key, body[key], value)
		}
	}
	if _, exists := body["unexpected"]; exists {
		t.Fatalf("unexpected caller-controlled field escaped normalization: %#v", body)
	}
}

func TestEvolutionAdvancedSettingsDirectCallUsesSessionTokenAndInstance(t *testing.T) {
	const (
		instanceKey = "instance/with spaces"
		token       = "session-token"
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("method = %q, want PUT", r.Method)
		}
		wantPath := "/instance/" + url.PathEscape(instanceKey) + "/advanced-settings"
		if r.URL.EscapedPath() != wantPath {
			t.Errorf("path = %q, want %q", r.URL.EscapedPath(), wantPath)
		}
		if r.Header.Get("apikey") != token {
			t.Errorf("apikey = %q, want session token", r.Header.Get("apikey"))
		}
		if r.Header.Get("instanceId") != instanceKey {
			t.Errorf("instanceId = %q, want %q", r.Header.Get("instanceId"), instanceKey)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode body: %v", err)
		}
		for key, value := range evolutionNotificationSafeSettingsBody() {
			if body[key] != value {
				t.Errorf("body[%q] = %#v, want %#v", key, body[key], value)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"updated":true}`))
	}))
	defer server.Close()

	client := functionsClient{
		evolutionGoAPIURL: server.URL,
		evolutionGoAPIKey: "global-key",
		httpClient:        server.Client(),
	}
	result, err := client.invokeEvolutionDirect(context.Background(), "instance.advancedSettings", map[string]any{
		"instance_id": instanceKey,
		"token":       token,
	})
	if err != nil {
		t.Fatalf("invokeEvolutionDirect() error: %v", err)
	}
	if !providerResultOK(result) {
		t.Fatalf("expected provider success, got %#v", result)
	}
}

func TestEvolutionAdvancedSettingsProviderFailureIsReturned(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"settings rejected"}`, http.StatusBadGateway)
	}))
	defer server.Close()

	client := functionsClient{
		evolutionGoAPIURL: server.URL,
		evolutionGoAPIKey: "global-key",
		httpClient:        server.Client(),
	}
	_, err := client.invokeEvolution(context.Background(), "instance.advancedSettings", map[string]any{
		"instance_id": "instance-1",
		"token":       "session-token",
	})
	if !errors.Is(err, ErrProviderFailed) {
		t.Fatalf("invokeEvolution() error = %v, want ErrProviderFailed", err)
	}
}

func TestEvolutionMediaDownloadActionsAreFixedAndSizeLimited(t *testing.T) {
	tests := map[string]string{
		"message.downloadMedia": "/message/downloadmedia",
		"message.downloadImage": "/message/downloadimage",
	}
	for action, wantPath := range tests {
		endpoint, err := evolutionEndpointFor(action, map[string]any{"message": map[string]any{}}, "instance")
		if err != nil {
			t.Fatalf("%s: %v", action, err)
		}
		if endpoint.Path != wantPath || endpoint.Method != "POST" {
			t.Fatalf("%s endpoint = %s %s", action, endpoint.Method, endpoint.Path)
		}
		if evolutionResponseMaxBytes(action) <= int64(whatsappMediaMaxBytes) {
			t.Fatalf("%s response limit does not account for base64 expansion", action)
		}
	}
}
