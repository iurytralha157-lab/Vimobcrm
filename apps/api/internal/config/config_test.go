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

func TestNormalizeDotEnvValuePreservesEscapedLiteralDollar(t *testing.T) {
	for _, input := range []string{`\$token`, `'\$token'`, `"\$token"`} {
		if got := normalizeDotEnvValue(input); got != "$token" {
			t.Fatalf("normalizeDotEnvValue(%q) = %q, want literal dollar value", input, got)
		}
	}
}

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

func TestConfigValidateRequiresTrustedProxyCIDRsInProduction(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.Environment = " Production "
	cfg.HTTP.TrustedProxyCIDRs = nil

	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "API_TRUSTED_PROXY_CIDRS is required in production") {
		t.Fatalf("expected production trusted proxy requirement, got %v", err)
	}
}

func TestConfigValidateRejectsInvalidOrOverlyBroadTrustedProxyCIDRs(t *testing.T) {
	for _, test := range []struct {
		name        string
		environment string
		cidr        string
	}{
		{name: "malformed", environment: "development", cidr: "not-a-cidr"},
		{name: "trust every peer", environment: "production", cidr: "0.0.0.0/0"},
		{name: "overly broad IPv6", environment: "production", cidr: "2000::/3"},
	} {
		t.Run(test.name, func(t *testing.T) {
			cfg := validConfigForWebhookRolloutTest()
			cfg.Environment = test.environment
			cfg.HTTP.TrustedProxyCIDRs = []string{test.cidr}

			err := cfg.Validate()
			if err == nil || !strings.Contains(err.Error(), "API_TRUSTED_PROXY_CIDRS") {
				t.Fatalf("expected unsafe trusted proxy CIDR to fail, got %v", err)
			}
		})
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

func TestConfigValidateRejectsUnsafeWebhookWorkerConcurrency(t *testing.T) {
	for _, concurrency := range []int{0, 17} {
		cfg := validConfigForWebhookRolloutTest()
		cfg.WhatsApp.WebhookWorkerEnabled = true
		cfg.WhatsApp.WebhookWorkerConcurrency = concurrency
		err := cfg.Validate()
		if err == nil || !strings.Contains(err.Error(), "WHATSAPP_WEBHOOK_WORKER_CONCURRENCY must be between 1 and 16") {
			t.Fatalf("concurrency %d validation error = %v", concurrency, err)
		}
	}

	cfg := validConfigForWebhookRolloutTest()
	cfg.WhatsApp.WebhookWorkerEnabled = true
	cfg.WhatsApp.WebhookWorkerConcurrency = 4
	if err := cfg.Validate(); err != nil {
		t.Fatalf("safe webhook worker concurrency rejected: %v", err)
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

func TestConfigValidateRequiresAsaasKeyForProductionReconciliation(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.Environment = "production"
	cfg.HTTP.CORSOrigins = []string{"https://app.vimobcrm.com.br"}
	cfg.Push.VAPIDPublicKey, cfg.Push.VAPIDPrivateKey = testVAPIDKeyPair(t, 1)
	cfg.Asaas = AsaasConfig{
		APIURL:                 "https://api.asaas.com/v3",
		ReconciliationEnabled:  true,
		ReconciliationInterval: 5 * time.Minute,
		ReconciliationBatch:    50,
		RequestTimeout:         10 * time.Second,
	}

	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "ASAAS_API_KEY is required") {
		t.Fatalf("expected Asaas reconciliation key requirement, got %v", err)
	}
}

func TestConfigValidateRequiresTransactionalDeliveryConfigurationInProduction(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.Environment = "production"
	cfg.HTTP.CORSOrigins = []string{"https://app.vimobcrm.com.br"}
	cfg.Push.VAPIDPublicKey, cfg.Push.VAPIDPrivateKey = testVAPIDKeyPair(t, 1)
	cfg.Email = EmailConfig{
		FromEmail: "Vimob CRM <naoresponde@vimobcrm.com.br>",
		AppURL:    "https://app.vimobcrm.com.br",
	}

	err := cfg.Validate()
	if err == nil ||
		!strings.Contains(err.Error(), "RESEND_API_KEY") ||
		!strings.Contains(err.Error(), "PUBLIC_SIGNUP_RECOVERY_SECRET") ||
		!strings.Contains(err.Error(), "EVOLUTION_GO_API_URL") ||
		!strings.Contains(err.Error(), "EVOLUTION_GO_API_KEY") {
		t.Fatalf("expected mandatory transactional delivery configuration, got %v", err)
	}

	cfg.Email.ResendAPIKey = "resend-test-key"
	cfg.Email.SignupRecoverySecret = "signup-recovery-secret-for-production-tests"
	cfg.EvolutionGo.APIURL = "https://evolution.vimobcrm.com.br"
	cfg.EvolutionGo.APIKey = "evolution-test-key"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected complete transactional delivery configuration, got %v", err)
	}
}

func TestConfigValidateRequiresBillingEdgeClientIPSecretInProduction(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.Environment = "production"
	cfg.Storage.EdgeClientIPSigningSecret = ""
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "BILLING_EDGE_CLIENT_IP_SIGNING_SECRET") {
		t.Fatalf("expected billing Edge client-IP signing secret requirement, got %v", err)
	}
}

func TestConfigValidateRejectsUnsafeProductionAppPublicURL(t *testing.T) {
	for _, value := range []string{
		"http://app.vimobcrm.com.br",
		"https://app.vimobcrm.com.br/checkout/token",
		"https://user:secret@app.vimobcrm.com.br",
	} {
		if err := validateProductionPublicOrigin("APP_PUBLIC_URL", value); err == nil {
			t.Fatalf("unsafe APP_PUBLIC_URL accepted: %s", value)
		}
	}
	if err := validateProductionPublicOrigin("APP_PUBLIC_URL", "https://app.vimobcrm.com.br"); err != nil {
		t.Fatalf("safe APP_PUBLIC_URL rejected: %v", err)
	}
}

func TestConfigValidateRejectsUnsafeAsaasWorkerBounds(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.Asaas = AsaasConfig{
		APIURL:                 "https://api.asaas.com/v3",
		APIKey:                 "test-key",
		ReconciliationEnabled:  true,
		ReconciliationInterval: 0,
		ReconciliationBatch:    101,
		RequestTimeout:         2 * time.Minute,
	}

	err := cfg.Validate()
	if err == nil ||
		!strings.Contains(err.Error(), "ASAAS_RECONCILIATION_INTERVAL") ||
		!strings.Contains(err.Error(), "ASAAS_RECONCILIATION_BATCH") ||
		!strings.Contains(err.Error(), "ASAAS_REQUEST_TIMEOUT") {
		t.Fatalf("expected bounded Asaas worker configuration errors, got %v", err)
	}
}

func TestConfigValidateReservationExpirationWorkerBounds(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.Developments = DevelopmentConfig{
		ReservationExpirationWorkerEnabled:  true,
		ReservationExpirationWorkerInterval: 0,
		ReservationExpirationWorkerBatch:    501,
	}

	err := cfg.Validate()
	if err == nil ||
		!strings.Contains(err.Error(), "PROPERTY_DEVELOPMENT_RESERVATION_WORKER_INTERVAL") ||
		!strings.Contains(err.Error(), "PROPERTY_DEVELOPMENT_RESERVATION_WORKER_BATCH") {
		t.Fatalf("expected bounded reservation worker errors, got %v", err)
	}

	cfg.Developments = DevelopmentConfig{
		ReservationExpirationWorkerEnabled:  true,
		ReservationExpirationWorkerInterval: time.Minute,
		ReservationExpirationWorkerBatch:    100,
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected safe reservation worker defaults, got %v", err)
	}
}

func TestConfigValidatePublicationWorkerBoundsAndPublicOrigin(t *testing.T) {
	cfg := Config{
		Environment: "development",
		Publications: PublicationConfig{
			WorkerEnabled:  true,
			WorkerInterval: 2 * time.Second,
			WorkerBatch:    25,
			WorkerLease:    2 * time.Minute,
			MaxAttempts:    12,
			PublicBaseURL:  "http://localhost:8081",
		},
	}
	// Isolate this feature's validation because the full application config has
	// independent required services covered by the existing tests.
	if err := validatePublicationPublicBaseURL(cfg.Publications.PublicBaseURL, false); err != nil {
		t.Fatalf("local publication origin rejected: %v", err)
	}
	if err := validatePublicationPublicBaseURL("http://api.example.com", true); err == nil {
		t.Fatal("production publication origin accepted insecure HTTP")
	}
	if err := validatePublicationPublicBaseURL("https://api.example.com/path", true); err == nil {
		t.Fatal("publication origin accepted a path")
	}
}

func TestConfigValidateAcceptsCompleteMetaOAuthBackendConfiguration(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.Email.AppURL = "https://app.vimobcrm.com.br"
	cfg.Meta = MetaConfig{
		AppID:               "123456789012345",
		AppSecret:           "server-only-secret",
		LoginConfigID:       "987654321098765",
		GraphVersion:        "v25.0",
		GraphBaseURL:        "https://graph.facebook.com",
		OAuthCallbackURL:    "https://api.vimobcrm.com.br/v1/public/integrations/meta/oauth/callback",
		OAuthAllowedOrigins: []string{"http://127.0.0.1:3000"},
	}

	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected valid Meta OAuth configuration, got %v", err)
	}
}

func TestConfigValidateRejectsInvalidMetaLoginConfigurationID(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.Email.AppURL = "https://app.vimobcrm.com.br"
	cfg.Meta = MetaConfig{
		AppID:            "123456789012345",
		AppSecret:        "server-only-secret",
		LoginConfigID:    "not-a-meta-config-id",
		GraphVersion:     "v25.0",
		GraphBaseURL:     "https://graph.facebook.com",
		OAuthCallbackURL: "https://api.vimobcrm.com.br/v1/public/integrations/meta/oauth/callback",
	}

	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "META_LOGIN_CONFIG_ID must contain only digits") {
		t.Fatalf("expected invalid Meta login configuration id error, got %v", err)
	}
}

func TestConfigValidateRequiresMetaAppIDForLoginConfiguration(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.Meta.LoginConfigID = "987654321098765"

	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "META_APP_ID is required when META_LOGIN_CONFIG_ID is set") {
		t.Fatalf("expected Meta app id dependency error, got %v", err)
	}
}

func TestConfigValidateRejectsIncompleteMetaOAuthBackendConfiguration(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.Meta = MetaConfig{
		AppID:            "123456789012345",
		GraphVersion:     "v25.0",
		GraphBaseURL:     "https://graph.facebook.com",
		OAuthCallbackURL: "",
	}

	err := cfg.Validate()
	if err == nil ||
		!strings.Contains(err.Error(), "META_APP_SECRET") ||
		!strings.Contains(err.Error(), "META_OAUTH_CALLBACK_URL") {
		t.Fatalf("expected incomplete Meta OAuth configuration errors, got %v", err)
	}
}

func TestConfigValidateRequiresHTTPSForProductionMetaOAuthCallback(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.Environment = "production"
	cfg.HTTP.CORSOrigins = []string{"https://app.vimobcrm.com.br"}
	cfg.Push.VAPIDPublicKey, cfg.Push.VAPIDPrivateKey = testVAPIDKeyPair(t, 1)
	cfg.Email.AppURL = "https://app.vimobcrm.com.br"
	cfg.Meta = MetaConfig{
		AppID:            "123456789012345",
		AppSecret:        "server-only-secret",
		GraphVersion:     "v25.0",
		GraphBaseURL:     "https://graph.facebook.com",
		OAuthCallbackURL: "http://api.vimobcrm.com.br/v1/public/integrations/meta/oauth/callback",
	}

	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "META_OAUTH_CALLBACK_URL must use https in production") {
		t.Fatalf("expected production Meta OAuth HTTPS error, got %v", err)
	}
}

func TestConfigValidateRejectsUnsafeProductionMetaGraphOrigin(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.Environment = "production"
	cfg.HTTP.CORSOrigins = []string{"https://app.vimobcrm.com.br"}
	cfg.Push.VAPIDPublicKey, cfg.Push.VAPIDPrivateKey = testVAPIDKeyPair(t, 1)
	cfg.Meta.GraphBaseURL = "https://attacker.invalid"

	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "graph.facebook.com in production") {
		t.Fatalf("expected production Meta Graph origin error, got %v", err)
	}
}

func TestConfigValidateAllowsLoopbackMetaGraphOnlyOutsideProduction(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.Meta.GraphBaseURL = "http://127.0.0.1:9090"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected development loopback Meta Graph URL, got %v", err)
	}

	cfg.Environment = "production"
	cfg.HTTP.CORSOrigins = []string{"https://app.vimobcrm.com.br"}
	cfg.Push.VAPIDPublicKey, cfg.Push.VAPIDPrivateKey = testVAPIDKeyPair(t, 1)
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "META_GRAPH_BASE_URL must use https") {
		t.Fatalf("expected production Meta Graph HTTPS error, got %v", err)
	}
}

func validConfigForWebhookRolloutTest() Config {
	return Config{
		HTTP:     HTTPConfig{TrustedProxyCIDRs: []string{"10.23.0.0/24"}},
		Auth:     authpkg.Config{ProjectURL: "https://project.supabase.co"},
		Database: dbpkg.Config{URL: "postgresql://postgres:postgres@localhost:5432/postgres"},
		Storage: StorageConfig{
			ProjectURL:                "https://project.supabase.co",
			APIKey:                    "service-role-test-key",
			EdgeClientIPSigningSecret: "vimob-edge-client-ip-signing-secret-for-tests",
		},
		Portals: PortalConfig{GrupoOLXWebhookSecret: "crm-wide-grupo-olx-secret"},
		EvolutionGo: EvolutionGoConfig{
			BackendWebhookURL:    "https://api.vimobcrm.com.br/v1/whatsapp/webhook/evolution-go",
			WebhookProcessorMode: "edge",
		},
	}
}

func TestConfigValidateAllowsUnprovisionedGrupoOLXSecretButRejectsUnsafeFormat(t *testing.T) {
	cfg := validConfigForWebhookRolloutTest()
	cfg.Portals.GrupoOLXWebhookSecret = ""
	if err := cfg.Validate(); err != nil {
		t.Fatalf("an unprovisioned optional integration secret must not stop the API: %v", err)
	}
	cfg.Portals.GrupoOLXWebhookSecret = "short secret"
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "GRUPO_OLX_WEBHOOK_SECRET must contain") {
		t.Fatalf("expected unsafe global Grupo OLX webhook secret format error, got %v", err)
	}
}
