package whatsapp

import "testing"

func TestConfiguredEvolutionWebhookURLFallsBackFromDeadBackendRoute(t *testing.T) {
	client := functionsClient{
		projectURL:          "https://project.supabase.co",
		evolutionWebhookURL: "https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go",
	}

	got := client.configuredEvolutionWebhookURL("session-1", "instance-1", "token-1")

	want := "https://project.supabase.co/functions/v1/evolution-go-webhook?instance_id=instance-1&session_id=session-1&webhook_token=token-1"
	if got != want {
		t.Fatalf("unexpected webhook URL\nwant: %s\n got: %s", want, got)
	}
}

func TestConfiguredEvolutionWebhookURLKeepsValidCustomRoute(t *testing.T) {
	client := functionsClient{
		projectURL:          "https://project.supabase.co",
		evolutionWebhookURL: "https://hooks.example.com/evolution-go-webhook",
	}

	got := client.configuredEvolutionWebhookURL("session-1", "instance-1", "token-1")

	want := "https://hooks.example.com/evolution-go-webhook?instance_id=instance-1&session_id=session-1&webhook_token=token-1"
	if got != want {
		t.Fatalf("unexpected webhook URL\nwant: %s\n got: %s", want, got)
	}
}
