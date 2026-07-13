package whatsapp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestConfiguredEvolutionWebhookURLDefaultsToSupabaseEdge(t *testing.T) {
	const sessionID = "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"
	client := functionsClient{
		projectURL:                 "https://project.supabase.co",
		evolutionBackendWebhookURL: "https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go",
	}

	got := client.configuredEvolutionWebhookURL(sessionID, "instance-1", "token-1")
	want := "https://project.supabase.co/functions/v1/evolution-go-webhook?instance_id=instance-1&session_id=" + sessionID + "&webhook_token=token-1"
	if got != want {
		t.Fatalf("unexpected default webhook URL\nwant: %s\n got: %s", want, got)
	}
}

func TestConfiguredEvolutionWebhookURLKeepsNonCanaryOnLegacyEdge(t *testing.T) {
	const sessionID = "c15fe784-741b-4764-a60c-c60ffc50d606"
	client := functionsClient{
		projectURL:                 "https://project.supabase.co",
		evolutionWebhookURL:        "https://project.supabase.co/functions/v1/evolution-go-webhook",
		evolutionBackendWebhookURL: "https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go",
		webhookRolloutSessionIDs:   []string{"13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"},
	}

	got := client.configuredEvolutionWebhookURL(sessionID, "instance-1", "token-1")
	want := "https://project.supabase.co/functions/v1/evolution-go-webhook?instance_id=instance-1&session_id=" + sessionID + "&webhook_token=token-1"
	if got != want {
		t.Fatalf("unexpected webhook URL\nwant: %s\n got: %s", want, got)
	}
}

func TestConfiguredEvolutionWebhookURLRoutesCanaryToBackend(t *testing.T) {
	const sessionID = "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"
	client := functionsClient{
		projectURL:                 "https://project.supabase.co",
		evolutionWebhookURL:        "https://project.supabase.co/functions/v1/evolution-go-webhook",
		evolutionBackendWebhookURL: "https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go",
		webhookRolloutSessionIDs:   []string{sessionID},
	}

	got := client.configuredEvolutionWebhookURL(sessionID, "instance-1", "token-1")
	want := "https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go?instance_id=instance-1&session_id=" + sessionID
	if got != want {
		t.Fatalf("unexpected webhook URL\nwant: %s\n got: %s", want, got)
	}
	if strings.Contains(got, "token-1") || strings.Contains(got, "webhook_token") {
		t.Fatalf("backend webhook URL leaked its secret: %q", got)
	}
}

func TestConfiguredEvolutionWebhookURLWildcardRoutesEverySessionToBackend(t *testing.T) {
	const sessionID = "c15fe784-741b-4764-a60c-c60ffc50d606"
	client := functionsClient{
		evolutionWebhookURL:        "https://project.supabase.co/functions/v1/evolution-go-webhook",
		evolutionBackendWebhookURL: "https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go",
		webhookRolloutSessionIDs:   []string{"*"},
	}

	got := client.configuredEvolutionWebhookURL(sessionID, "instance-1", "token-1")
	want := "https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go?instance_id=instance-1&session_id=" + sessionID
	if got != want {
		t.Fatalf("unexpected webhook URL\nwant: %s\n got: %s", want, got)
	}
}

func TestConfiguredEvolutionWebhookURLRemovesSecretAlreadyPresentInBackendBaseURL(t *testing.T) {
	const sessionID = "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"
	client := functionsClient{
		evolutionBackendWebhookURL: "https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go?webhook_token=stale-secret&fixed=1",
		webhookRolloutSessionIDs:   []string{sessionID},
	}

	got := client.configuredEvolutionWebhookURL(sessionID, "instance-1", "new-secret")
	want := "https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go?fixed=1&instance_id=instance-1&session_id=" + sessionID
	if got != want {
		t.Fatalf("unexpected backend webhook URL\nwant: %s\n got: %s", want, got)
	}
}

func TestConfiguredEvolutionWebhookURLCanaryFailsClosedWithoutBackendURL(t *testing.T) {
	const sessionID = "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"
	client := functionsClient{
		projectURL:               "https://project.supabase.co",
		evolutionWebhookURL:      "https://project.supabase.co/functions/v1/evolution-go-webhook",
		webhookRolloutSessionIDs: []string{sessionID},
	}

	if got := client.configuredEvolutionWebhookURL(sessionID, "instance-1", "token-1"); got != "" {
		t.Fatalf("expected missing backend URL to fail closed, got %q", got)
	}
}

func TestInvokeEvolutionNeverFallsBackToEdgeProxy(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		http.Error(w, "unexpected Edge proxy call", http.StatusInternalServerError)
	}))
	defer server.Close()

	client := functionsClient{
		projectURL: server.URL,
		apiKey:     "service-key",
		httpClient: server.Client(),
	}
	_, err := client.invokeEvolution(context.Background(), "send.text", map[string]any{
		"session_id": "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9",
	})
	if !errors.Is(err, ErrProviderFailed) {
		t.Fatalf("invokeEvolution() error = %v, want ErrProviderFailed", err)
	}
	if called {
		t.Fatal("invokeEvolution() called the legacy evolution-go-proxy")
	}
}
