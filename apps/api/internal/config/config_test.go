package config

import (
	"crypto/ecdh"
	"encoding/base64"
	"strings"
	"testing"

	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func testVAPIDKeyPair(t *testing.T, scalar byte) (string, string) {
	t.Helper()
	privateBytes := make([]byte, 32)
	privateBytes[31] = scalar
	private, err := ecdh.P256().NewPrivateKey(privateBytes)
	if err != nil {
		t.Fatalf("create VAPID key: %v", err)
	}
	return base64.RawURLEncoding.EncodeToString(private.PublicKey().Bytes()), base64.RawURLEncoding.EncodeToString(private.Bytes())
}

func TestConfigValidateAcceptsMatchingVAPIDPair(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.Push.VAPIDPublicKey, cfg.Push.VAPIDPrivateKey = testVAPIDKeyPair(t, 1)

	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected valid VAPID pair, got %v", err)
	}
}

func TestConfigValidateRejectsMismatchedVAPIDPair(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.Push.VAPIDPublicKey, _ = testVAPIDKeyPair(t, 1)
	_, cfg.Push.VAPIDPrivateKey = testVAPIDKeyPair(t, 2)

	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "do not form a pair") {
		t.Fatalf("expected mismatched VAPID pair error, got %v", err)
	}
}

func TestConfigValidateRequiresVAPIDInProduction(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.Environment = "production"
	cfg.HTTP.CORSOrigins = []string{"https://app.vimobcrm.com.br"}

	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "WEB_PUSH_VAPID_PUBLIC_KEY is required") || !strings.Contains(err.Error(), "WEB_PUSH_VAPID_PRIVATE_KEY is required") {
		t.Fatalf("expected production VAPID requirements, got %v", err)
	}
}

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

func TestConfigValidateRejectsInvalidWhatsAppRecoverySessionID(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.WhatsApp.SessionSupervisorRecoveryIDs = []string{"not-a-session"}

	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "WHATSAPP_SESSION_SUPERVISOR_RECOVERY_SESSION_IDS") {
		t.Fatalf("expected recovery allowlist validation error, got %v", err)
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

func TestConfigValidateRequiresBackendURLWheneverEvolutionGoIsEnabled(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.EvolutionGo.APIURL = "https://evolution.example.com"
	cfg.EvolutionGo.APIKey = "provider-key"
	cfg.EvolutionGo.BackendWebhookURL = ""

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

func TestConfigValidateRejectsWebhookCredentialsInURL(t *testing.T) {
	for _, field := range []string{"backend", "edge"} {
		t.Run(field, func(t *testing.T) {
			cfg := validConfigForWebhookRolloutTest()
			if field == "backend" {
				cfg.EvolutionGo.BackendWebhookURL += "?Webhook_Token=secret"
			} else {
				cfg.EvolutionGo.WebhookURL = "https://project.supabase.co/functions/v1/evolution-go-webhook?APIKEY=secret"
			}

			err := cfg.Validate()
			if err == nil || !strings.Contains(err.Error(), "must not contain credentials in the query string") {
				t.Fatalf("expected URL credential validation error, got %v", err)
			}
		})
	}
}

func TestConfigValidateRequiresHTTPSForProductionWebhookURLs(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.Environment = "production"
	cfg.EvolutionGo.BackendWebhookURL = "http://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go"

	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "must use https in production") {
		t.Fatalf("expected production HTTPS validation error, got %v", err)
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
