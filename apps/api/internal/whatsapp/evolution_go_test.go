package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"
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

func TestEvolutionStatusPreservesPlainTextDisconnectError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "client disconnected", http.StatusBadRequest)
	}))
	defer server.Close()

	client := functionsClient{
		evolutionGoAPIURL: server.URL,
		evolutionGoAPIKey: "global-key",
		httpClient:        server.Client(),
	}
	result, err := client.invokeEvolutionDirect(context.Background(), "instance.status", map[string]any{
		"instance_id": "instance-1",
		"token":       "session-token",
	})
	if err != nil {
		t.Fatalf("invokeEvolutionDirect() error: %v", err)
	}
	if got := providerErrorMessage(result, ""); got != "client disconnected" {
		t.Fatalf("provider error = %q, want client disconnected", got)
	}
	status, authoritative, missing := evolutionConnectionObservation(result)
	if status != "disconnected" || !authoritative || missing {
		t.Fatalf("observation = (%q, %v, %v), want (disconnected, true, false)", status, authoritative, missing)
	}
}

func TestEvolutionStatusDoesNotTreatUnrelatedErrorsAsDisconnected(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
		message    string
	}{
		{name: "ambiguous disconnect text", statusCode: http.StatusBadRequest, message: "client is not disconnected"},
		{name: "proxy route not found", statusCode: http.StatusInternalServerError, message: "upstream route not found"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, tt.message, tt.statusCode)
			}))
			defer server.Close()

			client := functionsClient{
				evolutionGoAPIURL: server.URL,
				evolutionGoAPIKey: "global-key",
				httpClient:        server.Client(),
			}
			result, err := client.invokeEvolutionDirect(context.Background(), "instance.status", map[string]any{
				"instance_id": "instance-1",
				"token":       "session-token",
			})
			if err != nil {
				t.Fatalf("invokeEvolutionDirect() error: %v", err)
			}
			status, authoritative, missing := evolutionConnectionObservation(result)
			if status != "" || authoritative || missing {
				t.Fatalf("observation = (%q, %v, %v), want unknown", status, authoritative, missing)
			}
		})
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

func TestEvolutionQRCodeRequestIsInstanceScoped(t *testing.T) {
	const (
		instanceKey = "instance-1"
		token       = "session-token"
		qrCode      = "data:image/png;base64,cXItY29kZQ=="
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %q, want GET", r.Method)
		}
		if r.URL.Path != "/instance/qr" {
			t.Errorf("path = %q, want /instance/qr", r.URL.Path)
		}
		if r.URL.Query().Get("instanceId") != instanceKey {
			t.Errorf("instanceId query = %q, want %q", r.URL.Query().Get("instanceId"), instanceKey)
		}
		if r.Header.Get("instanceId") != instanceKey {
			t.Errorf("instanceId header = %q, want %q", r.Header.Get("instanceId"), instanceKey)
		}
		if r.Header.Get("apikey") != token {
			t.Errorf("apikey = %q, want session token", r.Header.Get("apikey"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"qrcode":"` + qrCode + `"}}`))
	}))
	defer server.Close()

	client := functionsClient{
		evolutionGoAPIURL: server.URL,
		evolutionGoAPIKey: "global-key",
		httpClient:        server.Client(),
	}
	result, err := client.invokeEvolutionDirect(context.Background(), "instance.qr", map[string]any{
		"instance_id": instanceKey,
		"token":       token,
	})
	if err != nil {
		t.Fatalf("invokeEvolutionDirect() error: %v", err)
	}
	if !providerResultOK(result) {
		t.Fatalf("expected provider success, got %#v", result)
	}
	if got := firstString(result, "data.qrcode"); got != qrCode {
		t.Fatalf("qrcode = %q, want %q", got, qrCode)
	}
	if got := firstString(result, "data.sourceEndpoint"); got != "/instance/qr" {
		t.Fatalf("sourceEndpoint = %q, want /instance/qr", got)
	}
}

func TestEvolutionQRCodeRecoversStaleDisconnectedClient(t *testing.T) {
	const (
		instanceKey = "10baa7ac-6b37-4531-a3c2-ec9f36965bbb"
		token       = "session-token"
		qrCode      = "data:image/png;base64,cXItY29kZQ=="
	)
	qrRequests := 0
	statusRequests := 0
	restartRequests := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/instance/qr":
			qrRequests++
			if r.URL.Query().Get("instanceId") != instanceKey || r.Header.Get("instanceId") != instanceKey {
				t.Errorf("QR request was not scoped to %q", instanceKey)
			}
			if r.Header.Get("apikey") != token {
				t.Errorf("QR apikey = %q, want session token", r.Header.Get("apikey"))
			}
			if qrRequests < 3 {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"no QR code available. Please wait a moment and try again"}`))
				return
			}
			_, _ = w.Write([]byte(`{"qrcode":"` + qrCode + `"}`))
		case "/instance/status":
			statusRequests++
			if r.Header.Get("apikey") != token {
				t.Errorf("status apikey = %q, want session token", r.Header.Get("apikey"))
			}
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"client disconnected"}`))
		case "/instance/forcereconnect/" + instanceKey:
			restartRequests++
			if r.Method != http.MethodPost {
				t.Errorf("restart method = %q, want POST", r.Method)
			}
			if r.Header.Get("apikey") != "global-key" {
				t.Errorf("restart apikey = %q, want global provider key", r.Header.Get("apikey"))
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode force reconnect body: %v", err)
			}
			if body["number"] != instanceKey {
				t.Errorf("restart number = %#v, want %q", body["number"], instanceKey)
			}
			// Evolution Go can report this after it has already started an
			// unpaired client. The following QR read is authoritative.
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"error":"failed to login"}`))
		default:
			t.Errorf("unexpected provider request to %s", r.URL.String())
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := functionsClient{
		evolutionGoAPIURL: server.URL,
		evolutionGoAPIKey: "global-key",
		httpClient:        server.Client(),
	}
	result, err := client.invokeEvolutionDirect(context.Background(), "instance.qr", map[string]any{
		"instance_id": instanceKey,
		"token":       token,
	})
	if err != nil {
		t.Fatalf("invokeEvolutionDirect() error: %v", err)
	}
	if qrRequests != 3 || statusRequests != 2 || restartRequests != 1 {
		t.Fatalf(
			"requests = qr:%d status:%d restart:%d, want qr:3 status:2 restart:1",
			qrRequests,
			statusRequests,
			restartRequests,
		)
	}
	if !providerResultOK(result) {
		t.Fatalf("expected QR after stale-client restart, got %#v", result)
	}
	if got := firstString(result, "data.qrcode"); got != qrCode {
		t.Fatalf("qrcode = %q, want %q", got, qrCode)
	}
}

func TestEvolutionQRCodeDoesNotRestartActivePairing(t *testing.T) {
	const (
		instanceKey = "5b50538e-a693-48d5-b72f-f956b8c88187"
		token       = "session-token"
	)
	qrRequests := 0
	statusRequests := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/instance/qr":
			qrRequests++
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"no QR code available. Please wait a moment and try again"}`))
		case "/instance/status":
			statusRequests++
			_, _ = w.Write([]byte(`{"Connected":true,"LoggedIn":false}`))
		case "/instance/forcereconnect/" + instanceKey:
			t.Error("active pairing client must not be restarted")
		default:
			t.Errorf("unexpected provider request to %s", r.URL.String())
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := functionsClient{
		evolutionGoAPIURL: server.URL,
		evolutionGoAPIKey: "global-key",
		httpClient:        server.Client(),
	}
	result, err := client.invokeEvolutionDirect(context.Background(), "instance.qr", map[string]any{
		"instance_id": instanceKey,
		"token":       token,
	})
	if err != nil {
		t.Fatalf("invokeEvolutionDirect() error: %v", err)
	}
	if qrRequests != 1 || statusRequests != 1 {
		t.Fatalf("requests = qr:%d status:%d, want qr:1 status:1", qrRequests, statusRequests)
	}
	if providerResultOK(result) {
		t.Fatalf("QR unexpectedly ready: %#v", result)
	}
}

func TestEvolutionQRCodeDoesNotRestartMissingClient(t *testing.T) {
	const (
		instanceKey = "80c3e834-aec2-4830-b018-043ba2624320"
		token       = "session-token"
	)
	restartRequests := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/instance/qr":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"no QR code available. Please wait a moment and try again"}`))
		case "/instance/status":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"no active session found"}`))
		case "/instance/forcereconnect/" + instanceKey:
			restartRequests++
			t.Error("missing provider client must not be force restarted")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := functionsClient{
		evolutionGoAPIURL: server.URL,
		evolutionGoAPIKey: "global-key",
		httpClient:        server.Client(),
	}
	result, err := client.invokeEvolutionDirect(context.Background(), "instance.qr", map[string]any{
		"instance_id": instanceKey,
		"token":       token,
	})
	if err != nil {
		t.Fatalf("invokeEvolutionDirect() error: %v", err)
	}
	if restartRequests != 0 {
		t.Fatalf("restart requests = %d, want 0", restartRequests)
	}
	if providerResultOK(result) {
		t.Fatalf("QR unexpectedly ready: %#v", result)
	}
}

func TestEvolutionQRCodeRejectsFailedRecovery(t *testing.T) {
	const (
		instanceKey = "8513bf79-f466-4ba4-a945-f794516d4e87"
		token       = "session-token"
	)
	qrRequests := 0
	restartRequests := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/instance/qr":
			qrRequests++
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"no QR code available. Please wait a moment and try again"}`))
		case "/instance/status":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"client disconnected"}`))
		case "/instance/forcereconnect/" + instanceKey:
			restartRequests++
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"unauthorized"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := functionsClient{
		evolutionGoAPIURL: server.URL,
		evolutionGoAPIKey: "invalid-global-key",
		httpClient:        server.Client(),
	}
	_, err := client.invokeEvolutionDirect(context.Background(), "instance.qr", map[string]any{
		"instance_id": instanceKey,
		"token":       token,
	})
	if !errors.Is(err, ErrProviderFailed) {
		t.Fatalf("invokeEvolutionDirect() error = %v, want ErrProviderFailed", err)
	}
	if restartRequests != 1 {
		t.Fatalf("restart requests = %d, want 1", restartRequests)
	}
	if qrRequests != 2 {
		t.Fatalf("QR requests = %d, want 2 (no read after rejected recovery)", qrRequests)
	}
}

func TestEvolutionQRCodeSerializesConcurrentRecovery(t *testing.T) {
	const (
		instanceKey = "5df7654d-444a-42ff-b60d-05eaf18b9542"
		token       = "session-token"
		qrCode      = "data:image/png;base64,cXItY29kZQ=="
	)
	var stateMu sync.Mutex
	qrReady := false
	restartRequests := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/instance/qr":
			stateMu.Lock()
			ready := qrReady
			stateMu.Unlock()
			if ready {
				_, _ = w.Write([]byte(`{"qrcode":"` + qrCode + `"}`))
				return
			}
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"no QR code available. Please wait a moment and try again"}`))
		case "/instance/status":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"client disconnected"}`))
		case "/instance/forcereconnect/" + instanceKey:
			stateMu.Lock()
			restartRequests++
			stateMu.Unlock()
			time.Sleep(100 * time.Millisecond)
			stateMu.Lock()
			qrReady = true
			stateMu.Unlock()
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"error":"failed to login"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := functionsClient{
		evolutionGoAPIURL: server.URL,
		evolutionGoAPIKey: "global-key",
		httpClient:        server.Client(),
	}
	results := make(chan map[string]any, 2)
	errs := make(chan error, 2)
	var callers sync.WaitGroup
	callers.Add(2)
	for range 2 {
		go func() {
			defer callers.Done()
			result, err := client.invokeEvolutionDirect(context.Background(), "instance.qr", map[string]any{
				"instance_id": instanceKey,
				"token":       token,
			})
			results <- result
			errs <- err
		}()
	}
	callers.Wait()
	close(results)
	close(errs)

	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent QR request failed: %v", err)
		}
	}
	for result := range results {
		if got := firstString(result, "data.qrcode"); got != qrCode {
			t.Fatalf("concurrent QR = %q, want %q", got, qrCode)
		}
	}
	stateMu.Lock()
	gotRestarts := restartRequests
	stateMu.Unlock()
	if gotRestarts != 1 {
		t.Fatalf("restart requests = %d, want 1", gotRestarts)
	}
}

func TestEvolutionQRCodeRecoveryHonorsCallerDeadline(t *testing.T) {
	const (
		instanceKey = "14ea5e48-f47b-4f83-8eca-3bf847131049"
		token       = "session-token"
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/instance/qr":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"no QR code available. Please wait a moment and try again"}`))
		case "/instance/status":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"client disconnected"}`))
		case "/instance/forcereconnect/" + instanceKey:
			select {
			case <-r.Context().Done():
			case <-time.After(250 * time.Millisecond):
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := functionsClient{
		evolutionGoAPIURL: server.URL,
		evolutionGoAPIKey: "global-key",
		httpClient:        server.Client(),
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	startedAt := time.Now()
	_, err := client.invokeEvolutionDirect(ctx, "instance.qr", map[string]any{
		"instance_id": instanceKey,
		"token":       token,
	})
	if !errors.Is(err, ErrProviderFailed) {
		t.Fatalf("invokeEvolutionDirect() error = %v, want ErrProviderFailed", err)
	}
	if elapsed := time.Since(startedAt); elapsed > time.Second {
		t.Fatalf("QR recovery ignored caller deadline: %s", elapsed)
	}
}

func TestNormalizeEvolutionQRSupportsNestedPayloads(t *testing.T) {
	const qrCode = "data:image/png;base64,cXItY29kZQ=="

	tests := map[string]any{
		"qrcode base64": map[string]any{
			"qrcode": map[string]any{"base64": qrCode},
		},
		"data qrcode base64": map[string]any{
			"data": map[string]any{
				"qrcode": map[string]any{"base64": qrCode},
			},
		},
		"response qrcode base64": map[string]any{
			"response": map[string]any{
				"qrcode": map[string]any{"base64": qrCode},
			},
		},
	}

	for name, payload := range tests {
		t.Run(name, func(t *testing.T) {
			if got := normalizeEvolutionQR(payload); got != qrCode {
				t.Fatalf("normalizeEvolutionQR() = %q, want %q", got, qrCode)
			}
		})
	}
}

func TestNormalizeEvolutionQRIgnoresRawPairingCode(t *testing.T) {
	payload := map[string]any{
		"qrcode": map[string]any{
			"code": "2@raw-whatsapp-pairing-payload",
		},
	}

	if got := normalizeEvolutionQR(payload); got != "" {
		t.Fatalf("normalizeEvolutionQR() = %q, want an empty image value", got)
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

func TestNormalizeEvolutionStatusUsesTransportAndLoginState(t *testing.T) {
	tests := []struct {
		name string
		data map[string]any
		want string
	}{
		{name: "socket and login active", data: map[string]any{"Connected": true, "LoggedIn": true}, want: "connected"},
		{name: "socket awaiting qr", data: map[string]any{"Connected": true, "LoggedIn": false}, want: "qr_ready"},
		{name: "paired session temporarily offline", data: map[string]any{"Connected": false, "LoggedIn": true}, want: "disconnected"},
		{name: "logged out", data: map[string]any{"Connected": false, "LoggedIn": false}, want: "disconnected"},
		{name: "webhook open state", data: map[string]any{"status": "open"}, want: "connected"},
		{name: "unknown payload", data: map[string]any{"message": "success"}, want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeEvolutionStatus(tt.data); got != tt.want {
				t.Fatalf("normalizeEvolutionStatus(%#v) = %q, want %q", tt.data, got, tt.want)
			}
		})
	}
}

func TestEvolutionRecoveryEndpointsUseCorrectAuthenticationScope(t *testing.T) {
	info, err := evolutionEndpointFor("instance.info", nil, "instance/id")
	if err != nil {
		t.Fatalf("info endpoint: %v", err)
	}
	if info.Method != http.MethodGet || info.Path != "/instance/info/"+url.PathEscape("instance/id") {
		t.Fatalf("unexpected info endpoint %#v", info)
	}
	if !evolutionUsesGlobalAPIKey("instance.info") {
		t.Fatal("instance info must use the backend-only global API key")
	}

	reconnect, err := evolutionEndpointFor("instance.reconnect", nil, "instance-id")
	if err != nil {
		t.Fatalf("reconnect endpoint: %v", err)
	}
	if reconnect.Method != http.MethodPost || reconnect.Path != "/instance/reconnect" {
		t.Fatalf("unexpected reconnect endpoint %#v", reconnect)
	}
	if evolutionUsesGlobalAPIKey("instance.reconnect") {
		t.Fatal("regular reconnect must use the session token")
	}

	force, err := evolutionEndpointFor("instance.forceReconnect", map[string]any{"number": "5511999999999"}, "instance/id")
	if err != nil {
		t.Fatalf("force reconnect endpoint: %v", err)
	}
	if force.Method != http.MethodPost || force.Path != "/instance/forcereconnect/"+url.PathEscape("instance/id") {
		t.Fatalf("unexpected force reconnect endpoint %#v", force)
	}
	if !evolutionUsesGlobalAPIKey("instance.forceReconnect") {
		t.Fatal("force reconnect must use the backend-only global API key")
	}
	body, ok := force.Body.(map[string]any)
	if !ok || body["number"] != "5511999999999" {
		t.Fatalf("unexpected force reconnect body %#v", force.Body)
	}
}
