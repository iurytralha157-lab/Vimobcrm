package whatsapp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEvolutionSendAcknowledgementRequiresProof(t *testing.T) {
	for _, scenario := range []struct {
		name, body string
		unknown    bool
	}{
		{"canonical provider ID", `{"messageId":"fixture-provider-id"}`, false},
		{"nested provider ID", `{"data":{"key":{"id":"fixture-provider-id"}}}`, false},
		{"explicit success", `{"success":true}`, false},
		{"nested explicit success", `{"data":{"ok":true}}`, false},
		{"empty body", ``, true},
		{"empty object", `{}`, true},
		{"invalid JSON", `<html>gateway fallback</html>`, true},
		{"error without false flag", `{"error":"upstream could not confirm"}`, true},
		{"contradictory success", `{"ok":true,"error":"upstream could not confirm"}`, true},
		{"contradictory provider ID", `{"messageId":"fixture-provider-id","success":false}`, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/send/text" {
					t.Errorf("unexpected fake provider path %q", r.URL.Path)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(scenario.body))
			}))
			defer server.Close()
			client := functionsClient{evolutionGoAPIURL: server.URL, evolutionGoAPIKey: "synthetic-key", httpClient: server.Client()}
			_, err := client.invokeEvolutionDirect(context.Background(), "send.text", map[string]any{
				"instance_id": "synthetic-instance", "token": "synthetic-token",
				"body": map[string]any{"id": "fixture-provider-id", "number": "5511999999999", "text": "synthetic"},
			})
			if scenario.unknown {
				if !errors.Is(err, ErrProviderOutcomeUnknown) {
					t.Fatalf("unproven 2xx acknowledgement = %v, want outcome-unknown", err)
				}
			} else if err != nil {
				t.Fatalf("valid provider acknowledgement rejected: %v", err)
			}
		})
	}
}
