package automations

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestProcessRuntimeOnceUsesOperationalBounds(t *testing.T) {
	var payload map[string]any
	var requestPath string
	var decodeErr error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPath = r.URL.Path
		decodeErr = json.NewDecoder(r.Body).Decode(&payload)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)

	repo := Repository{functions: newFunctionsClient(FunctionsConfig{
		ProjectURL: server.URL,
		APIKey:     "test-service-key",
	})}

	if err := repo.ProcessRuntimeOnce(context.Background()); err != nil {
		t.Fatalf("process runtime once: %v", err)
	}
	if requestPath != "/functions/v1/automation-runner" {
		t.Fatalf("unexpected function path: %s", requestPath)
	}
	if decodeErr != nil {
		t.Fatalf("decode request body: %v", decodeErr)
	}
	if payload["event_batch_size"] != float64(5) {
		t.Fatalf("unexpected event batch size: %v", payload["event_batch_size"])
	}
	if repo.functions.httpClient.Timeout != 60*time.Second {
		t.Fatalf("unexpected functions timeout: %s", repo.functions.httpClient.Timeout)
	}
}
