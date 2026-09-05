package config

import (
	"crypto/ecdh"
	"encoding/base64"
	"strings"
	"testing"
	"time"

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

func TestConfigValidateRejectsUnsafeMediaWorkerTiming(t *testing.T) {
	for _, test := range []struct {
		name     string
		interval time.Duration
		lease    time.Duration
		want     string
	}{
		{name: "too short interval", interval: 100 * time.Millisecond, lease: 5 * time.Minute, want: "WHATSAPP_MEDIA_WORKER_INTERVAL"},
		{name: "too long interval", interval: 2 * time.Minute, lease: 5 * time.Minute, want: "WHATSAPP_MEDIA_WORKER_INTERVAL"},
		{name: "too short lease", interval: 2 * time.Second, lease: 10 * time.Second, want: "WHATSAPP_MEDIA_WORKER_LEASE"},
		{name: "too long lease", interval: 2 * time.Second, lease: time.Hour, want: "WHATSAPP_MEDIA_WORKER_LEASE"},
	} {
		t.Run(test.name, func(t *testing.T) {
			cfg := validConfigForWebhookRolloutTest()
			cfg.WhatsApp.MediaWorkerEnabled = true
			cfg.WhatsApp.MediaWorkerInterval = test.interval
			cfg.WhatsApp.MediaWorkerLease = test.lease

			err := cfg.Validate()
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %s validation error, got %v", test.want, err)
			}
		})
	}

	cfg := validConfigForWebhookRolloutTest()
	cfg.WhatsApp.MediaWorkerEnabled = true
	cfg.WhatsApp.MediaWorkerInterval = 2 * time.Second
	cfg.WhatsApp.MediaWorkerLease = 5 * time.Minute
	cfg.WhatsApp.MediaWorkerSessionIDs = []string{"*"}
	cfg.EvolutionGo.WebhookProcessorMode = "native"
	cfg.EvolutionGo.WebhookRolloutSessionIDs = []string{"*"}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("safe media worker timing rejected: %v", err)
	}
}

func TestConfigValidateRequiresGlobalNativeMediaWorkerOwnership(t *testing.T) {
	for _, test := range []struct {
		name      string
		mode      string
		allowlist []string
		wantErr   bool
	}{
		{name: "edge global", mode: "edge", allowlist: []string{"*"}, wantErr: true},
		{name: "native empty", mode: "native", wantErr: true},
		{name: "native canary", mode: "native", allowlist: []string{"13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"}, wantErr: true},
		{name: "fallback canary", mode: "native_fallback", allowlist: []string{"13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"}, wantErr: true},
		{name: "native global", mode: "native", allowlist: []string{"*"}},
		{name: "fallback global", mode: "native_fallback", allowlist: []string{"*"}, wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			cfg := validConfigForWebhookRolloutTest()
			cfg.WhatsApp.MediaWorkerEnabled = true
			cfg.WhatsApp.MediaWorkerInterval = 2 * time.Second
			cfg.WhatsApp.MediaWorkerLease = 5 * time.Minute
			cfg.WhatsApp.MediaWorkerSessionIDs = []string{"*"}
			cfg.EvolutionGo.WebhookProcessorMode = test.mode
			cfg.EvolutionGo.WebhookRolloutSessionIDs = test.allowlist

			err := cfg.Validate()
			if test.wantErr && (err == nil || !strings.Contains(err.Error(), "WHATSAPP_MEDIA_WORKER_ENABLED requires")) {
				t.Fatalf("expected ownership validation error, got %v", err)
			}
			if !test.wantErr && err != nil {
				t.Fatalf("global native ownership rejected: %v", err)
			}
		})
	}
}

func TestConfigValidateRequiresExplicitMediaWorkerSessionAllowlist(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.WhatsApp.MediaWorkerEnabled = true
	cfg.WhatsApp.MediaWorkerInterval = 2 * time.Second
	cfg.WhatsApp.MediaWorkerLease = 5 * time.Minute
	cfg.EvolutionGo.WebhookProcessorMode = "native"
	cfg.EvolutionGo.WebhookRolloutSessionIDs = []string{"*"}

	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "WHATSAPP_MEDIA_WORKER_SESSION_IDS") {
		t.Fatalf("expected empty media worker allowlist rejection, got %v", err)
	}

	cfg.WhatsApp.MediaWorkerSessionIDs = []string{"not-a-session"}
	err = cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "WHATSAPP_MEDIA_WORKER_SESSION_IDS") {
		t.Fatalf("expected invalid media worker session rejection, got %v", err)
	}

	cfg.WhatsApp.MediaWorkerSessionIDs = []string{"13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("explicit media worker canary rejected: %v", err)
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
