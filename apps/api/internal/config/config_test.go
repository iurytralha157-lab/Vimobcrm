package config

import (
	"strings"
	"testing"

	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestValidateWebhookRolloutSessionIDs(t *testing.T) {
	tests := []struct {
		name    string
		values  []string
		wantErr bool
	}{
		{name: "empty is safe default", values: nil},
		{name: "explicit wildcard", values: []string{"*"}},
		{name: "single canary", values: []string{"13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"}},
		{name: "multiple UUIDs", values: []string{"13eea7e8-a74f-4bfb-bb36-024e3d26ccc9", "c15fe784-741b-4764-a60c-c60ffc50d606"}},
		{name: "invalid UUID", values: []string{"not-a-session"}, wantErr: true},
		{name: "wildcard mixed with UUID", values: []string{"*", "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"}, wantErr: true},
		{name: "duplicate UUID", values: []string{"13eea7e8-a74f-4bfb-bb36-024e3d26ccc9", "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"}, wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateWebhookRolloutSessionIDs(test.values)
			if (err != nil) != test.wantErr {
				t.Fatalf("validateWebhookRolloutSessionIDs(%#v) error = %v, wantErr %v", test.values, err, test.wantErr)
			}
		})
	}
}

func TestConfigValidateRejectsInvalidWebhookRolloutSessionID(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.EvolutionGo.WebhookRolloutSessionIDs = []string{"not-a-session"}

	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS") {
		t.Fatalf("expected rollout allowlist validation error, got %v", err)
	}
}

func TestConfigValidateRequiresBackendURLForWebhookRollout(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.EvolutionGo.BackendWebhookURL = ""
	cfg.EvolutionGo.WebhookRolloutSessionIDs = []string{"13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"}

	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "EVOLUTION_GO_BACKEND_WEBHOOK_URL is required") {
		t.Fatalf("expected backend webhook URL validation error, got %v", err)
	}
}

func TestConfigValidateAcceptsCanaryWebhookRolloutSessionID(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.EvolutionGo.WebhookRolloutSessionIDs = []string{"13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"}

	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected valid rollout allowlist, got %v", err)
	}
}

func validConfigForWebhookRolloutTest() Config {
	return Config{
		Auth:     authpkg.Config{ProjectURL: "https://project.supabase.co"},
		Database: dbpkg.Config{URL: "postgresql://postgres:postgres@localhost:5432/postgres"},
		Storage: StorageConfig{
			ProjectURL: "https://project.supabase.co",
			APIKey:     "service-role-test-key",
		},
		EvolutionGo: EvolutionGoConfig{
			BackendWebhookURL:    "https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go",
			WebhookProcessorMode: "edge",
		},
	}
}
