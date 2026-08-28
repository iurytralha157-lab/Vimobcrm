package config

import (
	"bufio"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/pushconfig"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Config struct {
	Environment              string
	BackgroundWorkersEnabled bool
	LogLevel                 slog.Level
	HTTP                     HTTPConfig
	Auth                     authpkg.Config
	Database                 dbpkg.Config
	Automations              AutomationConfig
	Developments             DevelopmentConfig
	Publications             PublicationConfig
	Portals                  PortalConfig
	Storage                  StorageConfig
	Email                    EmailConfig
	Notifications            NotificationConfig
	Push                     PushConfig
	AI                       AIConfig
	WhatsApp                 WhatsAppConfig
	EvolutionGo              EvolutionGoConfig
	Meta                     MetaConfig
	Asaas                    AsaasConfig
}

type HTTPConfig struct {
	Host              string
	Port              string
	CORSOrigins       []string
	TrustedProxyCIDRs []string
	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
}

type StorageConfig struct {
	ProjectURL                string
	APIKey                    string
	EdgeClientIPSigningSecret string
}

type EvolutionGoConfig struct {
	APIURL                   string
	APIKey                   string
	WebhookURL               string
	BackendWebhookURL        string
	WebhookProcessorMode     string
	WebhookRolloutSessionIDs []string
}

type AutomationConfig struct {
	RuntimeWorkerEnabled     bool
	RuntimeWorkerInterval    time.Duration
	InactivityWorkerInterval time.Duration
	WorkerRunTimeout         time.Duration
	WorkerLockTimeout        time.Duration
}

type DevelopmentConfig struct {
	ReservationExpirationWorkerEnabled  bool
	ReservationExpirationWorkerInterval time.Duration
	ReservationExpirationWorkerBatch    int
}

type PublicationConfig struct {
	WorkerEnabled  bool
	WorkerInterval time.Duration
	WorkerBatch    int
	WorkerLease    time.Duration
	MaxAttempts    int
	PublicBaseURL  string
}

type PortalConfig struct {
	// GrupoOLXWebhookSecret is the CRM-wide SECRET_KEY provisioned by Grupo
	// OLX. It is server-only and must never be persisted per organization.
	GrupoOLXWebhookSecret      string
	ImportReportWorkerEnabled  bool
	ImportReportWorkerInterval time.Duration
	ImportReportWorkerBatch    int
}

type MetaConfig struct {
	AppID                                   string
	AppSecret                               string
	LoginConfigID                           string
	WebhookVerifyToken                      string
	WebhookWorkerEnabled                    bool
	GraphVersion                            string
	GraphBaseURL                            string
	OAuthCallbackURL                        string
	OAuthAllowedOrigins                     []string
	ConversionFeedbackWorkerEnabled         bool
	ConversionFeedbackWorkerInterval        time.Duration
	ConversionFeedbackWorkerBatch           int
	ConversionFeedbackWorkerLease           time.Duration
	ConversionFeedbackRequestTimeout        time.Duration
	ConversionFeedbackPartnerAgent          string
	ConversionFeedbackAppSecretProofEnabled bool
}

type AsaasConfig struct {
	APIURL                 string
	APIKey                 string
	ReconciliationEnabled  bool
	ReconciliationInterval time.Duration
	ReconciliationBatch    int
	RequestTimeout         time.Duration
}

type EmailConfig struct {
	ResendAPIKey         string
	FromEmail            string
	ReplyTo              string
	SupportEmail         string
	AppURL               string
	SignupRecoverySecret string
}

type NotificationConfig struct {
	DispatchWorkerEnabled bool
}

type PushConfig struct {
	VAPIDPublicKey        string
	VAPIDPrivateKey       string
	VAPIDSubject          string
	FCMServerKey          string
	FCMProjectID          string
	FCMServiceAccountJSON string
	FCMServiceAccountFile string
}

type AIConfig struct {
	OpenAIAPIKey   string
	OpenAIBaseURL  string
	DefaultModel   string
	RealtimeModel  string
	RealtimeVoice  string
	AutoReplyToken string
}

type WhatsAppConfig struct {
	AIWorkerEnabled               bool
	AIWorkerInterval              time.Duration
	AIFollowUpWorkerEnabled       bool
	AIFollowUpWorkerInterval      time.Duration
	OutboxWorkerEnabled           bool
	OutboxWorkerInterval          time.Duration
	OutboxWorkerBatch             int
	WebhookWorkerEnabled          bool
	WebhookWorkerInterval         time.Duration
	WebhookWorkerBatch            int
	WebhookWorkerConcurrency      int
	SessionSupervisorEnabled      bool
	SessionSupervisorInitialDelay time.Duration
	SessionSupervisorInterval     time.Duration
	SessionSupervisorBatch        int
}

func (cfg HTTPConfig) Addr() string {
	return cfg.Host + ":" + cfg.Port
}

func Load() (Config, error) {
	loadDevelopmentEnvFiles()

	env := strings.ToLower(strings.TrimSpace(getEnv("API_ENV", "development")))

	cfg := Config{
		Environment:              env,
		BackgroundWorkersEnabled: loadBackgroundWorkersEnabled(),
		LogLevel:                 parseLogLevel(getEnv("API_LOG_LEVEL", "info")),
		HTTP: HTTPConfig{
			Host:              getEnv("API_HOST", "0.0.0.0"),
			Port:              getEnv("API_PORT", "8081"),
			CORSOrigins:       parseCSV(getEnv("API_CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")),
			TrustedProxyCIDRs: parseCSV(getEnv("API_TRUSTED_PROXY_CIDRS", "")),
			ReadHeaderTimeout: parseDuration("API_READ_HEADER_TIMEOUT", 5*time.Second),
			ReadTimeout:       parseDuration("API_READ_TIMEOUT", 15*time.Second),
			WriteTimeout:      parseDuration("API_WRITE_TIMEOUT", 100*time.Second),
			IdleTimeout:       parseDuration("API_IDLE_TIMEOUT", 60*time.Second),
		},
		Auth: authpkg.Config{
			ProjectURL: getEnv("SUPABASE_PROJECT_URL", getEnv("NEXT_PUBLIC_SUPABASE_URL", "")),
			JWKSURL:    os.Getenv("SUPABASE_JWKS_URL"),
			Issuer:     os.Getenv("SUPABASE_JWT_ISSUER"),
			Audience:   getEnv("SUPABASE_JWT_AUDIENCE", "authenticated"),
			JWTSecret:  os.Getenv("SUPABASE_JWT_SECRET"),
		},
		Database: dbpkg.Config{
			URL:                  os.Getenv("DATABASE_URL"),
			MaxConns:             parseInt("DATABASE_MAX_CONNS", 16),
			MinConns:             parseInt("DATABASE_MIN_CONNS", 0),
			MaxConnLifetime:      parseDuration("DATABASE_MAX_CONN_LIFETIME", 30*time.Minute),
			MaxConnIdleTime:      parseDuration("DATABASE_MAX_CONN_IDLE_TIME", 2*time.Minute),
			HealthTimeout:        parseDuration("DATABASE_HEALTH_TIMEOUT", 10*time.Second),
			StartupRetryTimeout:  parseDuration("DATABASE_STARTUP_RETRY_TIMEOUT", 5*time.Minute),
			StartupRetryInterval: parseDuration("DATABASE_STARTUP_RETRY_INTERVAL", 5*time.Second),
		},
		Automations: AutomationConfig{
			RuntimeWorkerEnabled:     parseBool("AUTOMATION_RUNTIME_WORKER_ENABLED", true),
			RuntimeWorkerInterval:    parseDuration("AUTOMATION_RUNTIME_WORKER_INTERVAL", 30*time.Second),
			InactivityWorkerInterval: parseDuration("AUTOMATION_INACTIVITY_WORKER_INTERVAL", 5*time.Minute),
			WorkerRunTimeout:         parseDuration("AUTOMATION_WORKER_RUN_TIMEOUT", 25*time.Second),
			WorkerLockTimeout:        parseDuration("AUTOMATION_WORKER_LOCK_TIMEOUT", 2*time.Second),
		},
		Developments: DevelopmentConfig{
			ReservationExpirationWorkerEnabled:  parseBool("PROPERTY_DEVELOPMENT_RESERVATION_WORKER_ENABLED", true),
			ReservationExpirationWorkerInterval: parseDuration("PROPERTY_DEVELOPMENT_RESERVATION_WORKER_INTERVAL", time.Minute),
			ReservationExpirationWorkerBatch:    int(parseInt("PROPERTY_DEVELOPMENT_RESERVATION_WORKER_BATCH", 100)),
		},
		Publications: PublicationConfig{
			WorkerEnabled:  parseBool("PROPERTY_PUBLICATION_WORKER_ENABLED", true),
			WorkerInterval: parseDuration("PROPERTY_PUBLICATION_WORKER_INTERVAL", 2*time.Second),
			WorkerBatch:    int(parseInt("PROPERTY_PUBLICATION_WORKER_BATCH", 25)),
			WorkerLease:    parseDuration("PROPERTY_PUBLICATION_WORKER_LEASE", 2*time.Minute),
			MaxAttempts:    int(parseInt("PROPERTY_PUBLICATION_MAX_ATTEMPTS", 12)),
			PublicBaseURL: strings.TrimRight(getEnv(
				"VIMOB_API_URL",
				getEnv("NEXT_PUBLIC_VIMOB_API_URL", "http://localhost:8081"),
			), "/"),
		},
		Portals: PortalConfig{
			GrupoOLXWebhookSecret:      strings.TrimSpace(os.Getenv("GRUPO_OLX_WEBHOOK_SECRET")),
			ImportReportWorkerEnabled:  parseBool("GRUPO_OLX_IMPORT_REPORT_WORKER_ENABLED", true),
			ImportReportWorkerInterval: parseDuration("GRUPO_OLX_IMPORT_REPORT_WORKER_INTERVAL", 2*time.Second),
			ImportReportWorkerBatch:    int(parseInt("GRUPO_OLX_IMPORT_REPORT_WORKER_BATCH", 25)),
		},
		Storage: StorageConfig{
			ProjectURL:                getEnv("SUPABASE_PROJECT_URL", getEnv("NEXT_PUBLIC_SUPABASE_URL", getEnv("SUPABASE_URL", ""))),
			APIKey:                    getEnv("SUPABASE_SERVICE_ROLE_KEY", os.Getenv("SUPABASE_SECRET_KEY")),
			EdgeClientIPSigningSecret: strings.TrimSpace(os.Getenv("BILLING_EDGE_CLIENT_IP_SIGNING_SECRET")),
		},
		Email: EmailConfig{
			ResendAPIKey:         os.Getenv("RESEND_API_KEY"),
			FromEmail:            getEnv("RESEND_FROM_EMAIL", "Vimob CRM <naoresponde@vimobcrm.com.br>"),
			ReplyTo:              getEnv("RESEND_REPLY_TO", "contato@vimobcrm.com.br"),
			SupportEmail:         getEnv("SUPPORT_EMAIL", getEnv("RESEND_REPLY_TO", "contato@vimobcrm.com.br")),
			AppURL:               getEnv("APP_PUBLIC_URL", getEnv("NEXT_PUBLIC_SITE_URL", "https://vimobcrm.com.br")),
			SignupRecoverySecret: strings.TrimSpace(os.Getenv("PUBLIC_SIGNUP_RECOVERY_SECRET")),
		},
		Notifications: loadNotificationConfig(),
		Push: PushConfig{
			VAPIDPublicKey: getEnv("WEB_PUSH_VAPID_PUBLIC_KEY", ""),
			VAPIDPrivateKey: getEnv(
				"WEB_PUSH_VAPID_PRIVATE_KEY",
				getEnv("VAPID_PRIVATE_KEY", getEnv("WEB_PUSH_PRIVATE_KEY", "")),
			),
			VAPIDSubject:          getEnv("WEB_PUSH_VAPID_SUBJECT", getEnv("RESEND_REPLY_TO", "mailto:contato@vimobcrm.com.br")),
			FCMServerKey:          getEnv("FCM_SERVER_KEY", getEnv("FIREBASE_SERVER_KEY", "")),
			FCMProjectID:          getEnv("FCM_PROJECT_ID", getEnv("FIREBASE_PROJECT_ID", getEnv("GOOGLE_CLOUD_PROJECT", ""))),
			FCMServiceAccountJSON: getEnv("FCM_SERVICE_ACCOUNT_JSON", getEnv("FIREBASE_SERVICE_ACCOUNT_JSON", "")),
			FCMServiceAccountFile: getEnv("FCM_SERVICE_ACCOUNT_FILE", os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")),
		},
		AI: AIConfig{
			OpenAIAPIKey:   os.Getenv("OPENAI_API_KEY"),
			OpenAIBaseURL:  getEnv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
			DefaultModel:   getEnv("OPENAI_TEXT_MODEL", getEnv("OPENAI_MODEL", "gpt-4.1-mini")),
			RealtimeModel:  getEnv("OPENAI_REALTIME_MODEL", "gpt-realtime-2"),
			RealtimeVoice:  getEnv("OPENAI_REALTIME_VOICE", "cedar"),
			AutoReplyToken: getEnv("AI_AUTOREPLY_TOKEN", os.Getenv("INTERNAL_WEBHOOK_TOKEN")),
		},
		WhatsApp: WhatsAppConfig{
			AIWorkerEnabled:               parseBool("WHATSAPP_AI_WORKER_ENABLED", true),
			AIWorkerInterval:              parseDuration("WHATSAPP_AI_WORKER_INTERVAL", time.Minute),
			AIFollowUpWorkerEnabled:       parseBool("WHATSAPP_AI_FOLLOW_UP_WORKER_ENABLED", true),
			AIFollowUpWorkerInterval:      parseDuration("WHATSAPP_AI_FOLLOW_UP_WORKER_INTERVAL", 10*time.Minute),
			OutboxWorkerEnabled:           parseBool("WHATSAPP_OUTBOX_WORKER_ENABLED", true),
			OutboxWorkerInterval:          parseDuration("WHATSAPP_OUTBOX_WORKER_INTERVAL", time.Second),
			OutboxWorkerBatch:             int(parseInt("WHATSAPP_OUTBOX_WORKER_BATCH", 5)),
			WebhookWorkerEnabled:          parseBool("WHATSAPP_WEBHOOK_WORKER_ENABLED", true),
			WebhookWorkerInterval:         parseDuration("WHATSAPP_WEBHOOK_WORKER_INTERVAL", time.Second),
			WebhookWorkerBatch:            int(parseInt("WHATSAPP_WEBHOOK_WORKER_BATCH", 5)),
			WebhookWorkerConcurrency:      int(parseInt("WHATSAPP_WEBHOOK_WORKER_CONCURRENCY", 4)),
			SessionSupervisorEnabled:      parseBool("WHATSAPP_SESSION_SUPERVISOR_ENABLED", true),
			SessionSupervisorInitialDelay: parseDuration("WHATSAPP_SESSION_SUPERVISOR_INITIAL_DELAY", 30*time.Second),
			SessionSupervisorInterval:     parseDuration("WHATSAPP_SESSION_SUPERVISOR_INTERVAL", time.Minute),
			SessionSupervisorBatch:        int(parseInt("WHATSAPP_SESSION_SUPERVISOR_BATCH", 5)),
		},
		EvolutionGo: EvolutionGoConfig{
			APIURL:                   strings.TrimRight(getEnv("EVOLUTION_GO_API_URL", ""), "/"),
			APIKey:                   os.Getenv("EVOLUTION_GO_API_KEY"),
			WebhookURL:               strings.TrimRight(getEnv("EVOLUTION_GO_WEBHOOK_URL", ""), "/"),
			BackendWebhookURL:        strings.TrimRight(getEnv("EVOLUTION_GO_BACKEND_WEBHOOK_URL", ""), "/"),
			WebhookProcessorMode:     strings.ToLower(getEnv("WHATSAPP_WEBHOOK_PROCESSOR_MODE", "edge")),
			WebhookRolloutSessionIDs: parseCSV(getEnv("WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS", "")),
		},
		Asaas: AsaasConfig{
			APIURL:                 strings.TrimRight(getEnv("ASAAS_BASE_URL", "https://api.asaas.com/v3"), "/"),
			APIKey:                 os.Getenv("ASAAS_API_KEY"),
			ReconciliationEnabled:  parseBool("ASAAS_RECONCILIATION_ENABLED", true),
			ReconciliationInterval: parseDuration("ASAAS_RECONCILIATION_INTERVAL", 5*time.Minute),
			ReconciliationBatch:    int(parseInt("ASAAS_RECONCILIATION_BATCH", 50)),
			RequestTimeout:         parseDuration("ASAAS_REQUEST_TIMEOUT", 10*time.Second),
		},
		Meta: MetaConfig{
			AppID:                                   os.Getenv("META_APP_ID"),
			AppSecret:                               os.Getenv("META_APP_SECRET"),
			LoginConfigID:                           strings.TrimSpace(os.Getenv("META_LOGIN_CONFIG_ID")),
			WebhookVerifyToken:                      os.Getenv("META_WEBHOOK_VERIFY_TOKEN"),
			WebhookWorkerEnabled:                    parseBool("META_WEBHOOK_WORKER_ENABLED", true),
			GraphVersion:                            getEnv("META_GRAPH_VERSION", "v25.0"),
			GraphBaseURL:                            strings.TrimRight(getEnv("META_GRAPH_BASE_URL", "https://graph.facebook.com"), "/"),
			OAuthCallbackURL:                        os.Getenv("META_OAUTH_CALLBACK_URL"),
			OAuthAllowedOrigins:                     parseCSV(getEnv("META_OAUTH_ALLOWED_ORIGINS", "")),
			ConversionFeedbackWorkerEnabled:         parseBool("META_CONVERSION_FEEDBACK_WORKER_ENABLED", true),
			ConversionFeedbackWorkerInterval:        parseDuration("META_CONVERSION_FEEDBACK_WORKER_INTERVAL", 5*time.Second),
			ConversionFeedbackWorkerBatch:           int(parseInt("META_CONVERSION_FEEDBACK_WORKER_BATCH", 25)),
			ConversionFeedbackWorkerLease:           parseDuration("META_CONVERSION_FEEDBACK_WORKER_LEASE", 2*time.Minute),
			ConversionFeedbackRequestTimeout:        parseDuration("META_CONVERSION_FEEDBACK_REQUEST_TIMEOUT", 15*time.Second),
			ConversionFeedbackPartnerAgent:          strings.TrimSpace(getEnv("META_CONVERSION_FEEDBACK_PARTNER_AGENT", "")),
			ConversionFeedbackAppSecretProofEnabled: parseBool("META_CONVERSION_FEEDBACK_APPSECRET_PROOF_ENABLED", false),
		},
	}

	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}

	return cfg, nil
}

func loadNotificationConfig() NotificationConfig {
	return NotificationConfig{
		// Delivery is deliberately opt-in. An absent, malformed or misspelled
		// value must not drain the durable notification backlog during rollout.
		DispatchWorkerEnabled: parseBool("NOTIFICATION_DISPATCH_WORKER_ENABLED", false),
	}
}

func loadBackgroundWorkersEnabled() bool {
	// Keep normal deployments backwards-compatible. Local sessions that point
	// at shared data must opt out explicitly before the API starts.
	return parseBool("API_BACKGROUND_WORKERS_ENABLED", true)
}

func loadDevelopmentEnvFiles() {
	locked := currentEnvKeys()
	loadDotEnvFile(".env", locked)
	loadDotEnvFile(".env.local", locked)
}

func currentEnvKeys() map[string]struct{} {
	keys := map[string]struct{}{}
	for _, item := range os.Environ() {
		key, _, ok := strings.Cut(item, "=")
		if ok {
			keys[key] = struct{}{}
		}
	}

	return keys
}

func loadDotEnvFile(path string, locked map[string]struct{}) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}

		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if _, isLocked := locked[key]; isLocked {
			continue
		}

		os.Setenv(key, normalizeDotEnvValue(value))
	}
}

func normalizeDotEnvValue(value string) string {
	value = strings.TrimSpace(value)
	if len(value) < 2 {
		return strings.ReplaceAll(value, `\$`, "$")
	}

	quote := value[0]
	if quote != '"' && quote != '\'' {
		return strings.ReplaceAll(value, `\$`, "$")
	}
	if value[len(value)-1] != quote {
		return strings.ReplaceAll(value, `\$`, "$")
	}

	return strings.ReplaceAll(value[1:len(value)-1], `\$`, "$")
}

func (cfg Config) Validate() error {
	var validationErrors []error
	production := strings.EqualFold(strings.TrimSpace(cfg.Environment), "production")

	if production && len(cfg.HTTP.TrustedProxyCIDRs) == 0 {
		validationErrors = append(validationErrors, errors.New("API_TRUSTED_PROXY_CIDRS is required in production"))
	}
	for _, value := range cfg.HTTP.TrustedProxyCIDRs {
		prefix, err := netip.ParsePrefix(strings.TrimSpace(value))
		if err != nil || prefix.Addr().Is4In6() {
			if err == nil {
				err = errors.New("IPv4-mapped IPv6 prefixes are not supported")
			}
			validationErrors = append(validationErrors, fmt.Errorf("API_TRUSTED_PROXY_CIDRS contains invalid CIDR %q: %w", value, err))
			continue
		}
		if production {
			minimumBits := 32
			if prefix.Addr().Is4() {
				minimumBits = 8
			}
			if prefix.Bits() < minimumBits {
				validationErrors = append(validationErrors, fmt.Errorf(
					"API_TRUSTED_PROXY_CIDRS contains an overly broad proxy network %q",
					value,
				))
			}
		}
	}

	if cfg.Auth.ProjectURL == "" {
		validationErrors = append(validationErrors, errors.New("SUPABASE_PROJECT_URL is required"))
	} else if _, err := url.ParseRequestURI(cfg.Auth.ProjectURL); err != nil {
		validationErrors = append(validationErrors, fmt.Errorf("SUPABASE_PROJECT_URL is invalid: %w", err))
	}

	if cfg.Database.URL == "" {
		validationErrors = append(validationErrors, errors.New("DATABASE_URL is required"))
	}

	if cfg.Storage.ProjectURL == "" {
		validationErrors = append(validationErrors, errors.New("SUPABASE_PROJECT_URL is required for storage uploads"))
	} else if _, err := url.ParseRequestURI(cfg.Storage.ProjectURL); err != nil {
		validationErrors = append(validationErrors, fmt.Errorf("SUPABASE_PROJECT_URL is invalid for storage uploads: %w", err))
	}
	if cfg.Storage.APIKey == "" {
		validationErrors = append(validationErrors, errors.New("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required for storage uploads"))
	}
	edgeClientIPSecret := strings.TrimSpace(cfg.Storage.EdgeClientIPSigningSecret)
	if production && edgeClientIPSecret == "" {
		validationErrors = append(validationErrors, errors.New("BILLING_EDGE_CLIENT_IP_SIGNING_SECRET is required in production"))
	} else if edgeClientIPSecret != "" && (len(edgeClientIPSecret) < 32 || len(edgeClientIPSecret) > 512 || strings.IndexFunc(edgeClientIPSecret, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsControl(r)
	}) >= 0) {
		validationErrors = append(validationErrors, errors.New("BILLING_EDGE_CLIENT_IP_SIGNING_SECRET must contain 32 to 512 non-whitespace bytes"))
	}
	if secret := strings.TrimSpace(cfg.Portals.GrupoOLXWebhookSecret); secret != "" {
		if len(secret) < 16 || len(secret) > 512 || strings.IndexFunc(secret, func(r rune) bool {
			return unicode.IsSpace(r) || unicode.IsControl(r)
		}) >= 0 {
			validationErrors = append(validationErrors, errors.New("GRUPO_OLX_WEBHOOK_SECRET must contain 16 to 512 non-whitespace bytes"))
		}
	}
	if cfg.Portals.ImportReportWorkerEnabled {
		if cfg.Portals.ImportReportWorkerInterval < 250*time.Millisecond || cfg.Portals.ImportReportWorkerInterval > time.Hour {
			validationErrors = append(validationErrors, errors.New("GRUPO_OLX_IMPORT_REPORT_WORKER_INTERVAL must be between 250ms and 1h"))
		}
		if cfg.Portals.ImportReportWorkerBatch < 1 || cfg.Portals.ImportReportWorkerBatch > 500 {
			validationErrors = append(validationErrors, errors.New("GRUPO_OLX_IMPORT_REPORT_WORKER_BATCH must be between 1 and 500"))
		}
	}

	if cfg.EvolutionGo.APIURL != "" {
		if _, err := url.ParseRequestURI(cfg.EvolutionGo.APIURL); err != nil {
			validationErrors = append(validationErrors, fmt.Errorf("EVOLUTION_GO_API_URL is invalid: %w", err))
		}
	}
	if cfg.EvolutionGo.WebhookURL != "" {
		if err := validateEvolutionWebhookURL("EVOLUTION_GO_WEBHOOK_URL", cfg.EvolutionGo.WebhookURL, cfg.Environment == "production"); err != nil {
			validationErrors = append(validationErrors, err)
		}
	}
	if cfg.EvolutionGo.BackendWebhookURL != "" {
		if err := validateEvolutionWebhookURL("EVOLUTION_GO_BACKEND_WEBHOOK_URL", cfg.EvolutionGo.BackendWebhookURL, cfg.Environment == "production"); err != nil {
			validationErrors = append(validationErrors, err)
		}
	}
	switch cfg.EvolutionGo.WebhookProcessorMode {
	case "edge", "native", "native_fallback":
	default:
		validationErrors = append(validationErrors, errors.New("WHATSAPP_WEBHOOK_PROCESSOR_MODE must be edge, native_fallback, or native"))
	}
	if err := validateWebhookRolloutSessionIDs(cfg.EvolutionGo.WebhookRolloutSessionIDs); err != nil {
		validationErrors = append(validationErrors, err)
	}
	if cfg.WhatsApp.WebhookWorkerEnabled && (cfg.WhatsApp.WebhookWorkerConcurrency < 1 || cfg.WhatsApp.WebhookWorkerConcurrency > 16) {
		validationErrors = append(validationErrors, errors.New("WHATSAPP_WEBHOOK_WORKER_CONCURRENCY must be between 1 and 16"))
	}
	if (strings.TrimSpace(cfg.EvolutionGo.APIURL) != "" || strings.TrimSpace(cfg.EvolutionGo.APIKey) != "" || len(cfg.EvolutionGo.WebhookRolloutSessionIDs) > 0) &&
		strings.TrimSpace(cfg.EvolutionGo.BackendWebhookURL) == "" {
		validationErrors = append(validationErrors, errors.New("EVOLUTION_GO_BACKEND_WEBHOOK_URL is required when Evolution Go is enabled"))
	}
	if cfg.Meta.GraphBaseURL != "" {
		if err := validateMetaGraphBaseURL(cfg.Meta.GraphBaseURL, cfg.Environment == "production"); err != nil {
			validationErrors = append(validationErrors, err)
		}
	}
	if strings.TrimSpace(cfg.Meta.AppID) != "" {
		if !isDecimalIdentifier(cfg.Meta.AppID, 32) {
			validationErrors = append(validationErrors, errors.New("META_APP_ID must contain only digits"))
		}
		if strings.TrimSpace(cfg.Meta.AppSecret) == "" {
			validationErrors = append(validationErrors, errors.New("META_APP_SECRET is required when Meta OAuth is enabled"))
		} else if length := len(strings.TrimSpace(cfg.Meta.AppSecret)); length < 8 || length > 512 {
			validationErrors = append(validationErrors, errors.New("META_APP_SECRET must contain between 8 and 512 bytes"))
		}
		if !isMetaGraphVersion(cfg.Meta.GraphVersion) {
			validationErrors = append(validationErrors, errors.New("META_GRAPH_VERSION must use the vN.N format"))
		}
		if err := validateMetaOAuthCallbackURL(cfg.Meta.OAuthCallbackURL, cfg.Environment == "production"); err != nil {
			validationErrors = append(validationErrors, err)
		}
		if err := validateMetaOAuthOrigins(append([]string{cfg.Email.AppURL}, cfg.Meta.OAuthAllowedOrigins...)); err != nil {
			validationErrors = append(validationErrors, err)
		}
	}
	if loginConfigID := strings.TrimSpace(cfg.Meta.LoginConfigID); loginConfigID != "" {
		if strings.TrimSpace(cfg.Meta.AppID) == "" {
			validationErrors = append(validationErrors, errors.New("META_APP_ID is required when META_LOGIN_CONFIG_ID is set"))
		}
		if !isDecimalIdentifier(loginConfigID, 32) {
			validationErrors = append(validationErrors, errors.New("META_LOGIN_CONFIG_ID must contain only digits"))
		}
	}
	if cfg.Asaas.ReconciliationEnabled {
		if parsed, err := url.ParseRequestURI(cfg.Asaas.APIURL); err != nil || parsed.Scheme == "" || parsed.Host == "" {
			if err == nil {
				err = errors.New("absolute URL with host is required")
			}
			validationErrors = append(validationErrors, fmt.Errorf("ASAAS_BASE_URL is invalid: %w", err))
		}
		if cfg.Environment == "production" && strings.TrimSpace(cfg.Asaas.APIKey) == "" {
			validationErrors = append(validationErrors, errors.New("ASAAS_API_KEY is required when billing reconciliation is enabled in production"))
		}
		if cfg.Asaas.ReconciliationInterval <= 0 {
			validationErrors = append(validationErrors, errors.New("ASAAS_RECONCILIATION_INTERVAL must be positive"))
		}
		if cfg.Asaas.ReconciliationBatch < 1 || cfg.Asaas.ReconciliationBatch > 100 {
			validationErrors = append(validationErrors, errors.New("ASAAS_RECONCILIATION_BATCH must be between 1 and 100"))
		}
		if cfg.Asaas.RequestTimeout <= 0 || cfg.Asaas.RequestTimeout > time.Minute {
			validationErrors = append(validationErrors, errors.New("ASAAS_REQUEST_TIMEOUT must be between 1ns and 1m"))
		}
	}
	if cfg.Developments.ReservationExpirationWorkerEnabled {
		if cfg.Developments.ReservationExpirationWorkerInterval < time.Second || cfg.Developments.ReservationExpirationWorkerInterval > 24*time.Hour {
			validationErrors = append(validationErrors, errors.New("PROPERTY_DEVELOPMENT_RESERVATION_WORKER_INTERVAL must be between 1s and 24h"))
		}
		if cfg.Developments.ReservationExpirationWorkerBatch < 1 || cfg.Developments.ReservationExpirationWorkerBatch > 500 {
			validationErrors = append(validationErrors, errors.New("PROPERTY_DEVELOPMENT_RESERVATION_WORKER_BATCH must be between 1 and 500"))
		}
	}
	if cfg.Publications.WorkerEnabled {
		if cfg.Publications.WorkerInterval < 100*time.Millisecond || cfg.Publications.WorkerInterval > time.Hour {
			validationErrors = append(validationErrors, errors.New("PROPERTY_PUBLICATION_WORKER_INTERVAL must be between 100ms and 1h"))
		}
		if cfg.Publications.WorkerBatch < 1 || cfg.Publications.WorkerBatch > 500 {
			validationErrors = append(validationErrors, errors.New("PROPERTY_PUBLICATION_WORKER_BATCH must be between 1 and 500"))
		}
		if cfg.Publications.WorkerLease < 10*time.Second || cfg.Publications.WorkerLease > time.Hour {
			validationErrors = append(validationErrors, errors.New("PROPERTY_PUBLICATION_WORKER_LEASE must be between 10s and 1h"))
		}
		if cfg.Publications.MaxAttempts < 1 || cfg.Publications.MaxAttempts > 50 {
			validationErrors = append(validationErrors, errors.New("PROPERTY_PUBLICATION_MAX_ATTEMPTS must be between 1 and 50"))
		}
	}
	if strings.TrimSpace(cfg.Publications.PublicBaseURL) != "" {
		if err := validatePublicationPublicBaseURL(cfg.Publications.PublicBaseURL, cfg.Environment == "production"); err != nil {
			validationErrors = append(validationErrors, err)
		}
	} else if cfg.Publications.WorkerEnabled {
		validationErrors = append(validationErrors, errors.New("VIMOB_API_URL is required when the property publication worker is enabled"))
	}

	if cfg.Environment == "production" {
		for _, origin := range cfg.HTTP.CORSOrigins {
			if origin == "*" {
				validationErrors = append(validationErrors, errors.New("API_CORS_ALLOWED_ORIGINS cannot contain * in production"))
			}
		}

		if strings.TrimSpace(cfg.Email.ResendAPIKey) == "" {
			validationErrors = append(validationErrors, errors.New("RESEND_API_KEY is required for transactional email in production"))
		}
		if secretLength := len(strings.TrimSpace(cfg.Email.SignupRecoverySecret)); secretLength < 32 || secretLength > 512 {
			validationErrors = append(validationErrors, errors.New("PUBLIC_SIGNUP_RECOVERY_SECRET must contain between 32 and 512 bytes in production"))
		}
		if _, err := mail.ParseAddress(strings.TrimSpace(cfg.Email.FromEmail)); err != nil {
			validationErrors = append(validationErrors, fmt.Errorf("RESEND_FROM_EMAIL is invalid: %w", err))
		}
		if err := validateProductionPublicOrigin("APP_PUBLIC_URL", cfg.Email.AppURL); err != nil {
			validationErrors = append(validationErrors, err)
		}
		if strings.TrimSpace(cfg.EvolutionGo.APIURL) == "" {
			validationErrors = append(validationErrors, errors.New("EVOLUTION_GO_API_URL is required for transactional WhatsApp in production"))
		}
		if strings.TrimSpace(cfg.EvolutionGo.APIKey) == "" {
			validationErrors = append(validationErrors, errors.New("EVOLUTION_GO_API_KEY is required for transactional WhatsApp in production"))
		}
	}

	vapidPublicKey := strings.TrimSpace(cfg.Push.VAPIDPublicKey)
	vapidPrivateKey := strings.TrimSpace(cfg.Push.VAPIDPrivateKey)
	if cfg.Environment == "production" || vapidPublicKey != "" || vapidPrivateKey != "" {
		if vapidPublicKey == "" {
			validationErrors = append(validationErrors, errors.New("WEB_PUSH_VAPID_PUBLIC_KEY is required"))
		}
		if vapidPrivateKey == "" {
			validationErrors = append(validationErrors, errors.New("WEB_PUSH_VAPID_PRIVATE_KEY is required"))
		}
		if vapidPublicKey != "" && vapidPrivateKey != "" {
			if err := pushconfig.ValidateVAPIDKeyPair(vapidPublicKey, vapidPrivateKey); err != nil {
				validationErrors = append(validationErrors, fmt.Errorf("WEB_PUSH_VAPID key pair is invalid: %w", err))
			}
		}
	}

	return errors.Join(validationErrors...)
}

func validateProductionPublicOrigin(name string, value string) error {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		if err == nil {
			err = errors.New("an absolute https URL is required")
		}
		return fmt.Errorf("%s is invalid: %w", name, err)
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return fmt.Errorf("%s must be an origin without credentials, path, query parameters, or a fragment", name)
	}
	return nil
}

func validatePublicationPublicBaseURL(value string, production bool) error {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(value))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		if err == nil {
			err = errors.New("absolute URL with host is required")
		}
		return fmt.Errorf("VIMOB_API_URL is invalid for publication media: %w", err)
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return errors.New("VIMOB_API_URL must be an origin without credentials, query parameters, or a fragment")
	}
	loopback := parsed.Hostname() == "localhost" || parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "::1"
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && loopback && !production) {
		return errors.New("VIMOB_API_URL must use https (http is allowed only for local development)")
	}
	return nil
}

func validateMetaGraphBaseURL(value string, production bool) error {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(value))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		if err == nil {
			err = errors.New("absolute URL with host is required")
		}
		return fmt.Errorf("META_GRAPH_BASE_URL is invalid: %w", err)
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return errors.New("META_GRAPH_BASE_URL must be an origin without credentials, query parameters, or a fragment")
	}
	loopback := parsed.Hostname() == "localhost" || parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "::1"
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && loopback && !production) {
		return errors.New("META_GRAPH_BASE_URL must use https (http is allowed only for local tests)")
	}
	if production && !strings.EqualFold(parsed.Hostname(), "graph.facebook.com") {
		return errors.New("META_GRAPH_BASE_URL must use graph.facebook.com in production")
	}
	return nil
}

func isDecimalIdentifier(value string, maximum int) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > maximum {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func isMetaGraphVersion(value string) bool {
	value = strings.TrimSpace(value)
	majorMinor := strings.TrimPrefix(value, "v")
	major, minor, ok := strings.Cut(majorMinor, ".")
	return ok && isDecimalIdentifier(major, 3) && isDecimalIdentifier(minor, 3)
}

func validateMetaOAuthCallbackURL(value string, requireHTTPS bool) error {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(value))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		if err == nil {
			err = errors.New("absolute URL with host is required")
		}
		return fmt.Errorf("META_OAUTH_CALLBACK_URL is invalid: %w", err)
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("META_OAUTH_CALLBACK_URL must not contain credentials, query parameters, or a fragment")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("META_OAUTH_CALLBACK_URL must use http or https")
	}
	if requireHTTPS && parsed.Scheme != "https" {
		return errors.New("META_OAUTH_CALLBACK_URL must use https in production")
	}
	return nil
}

func validateMetaOAuthOrigins(values []string) error {
	valid := 0
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		parsed, err := url.ParseRequestURI(value)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
			return fmt.Errorf("META_OAUTH_ALLOWED_ORIGINS contains invalid origin %q", value)
		}
		if parsed.Scheme != "https" && !(parsed.Scheme == "http" && (parsed.Hostname() == "localhost" || parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "::1")) {
			return fmt.Errorf("META_OAUTH_ALLOWED_ORIGINS contains insecure origin %q", value)
		}
		valid++
	}
	if valid == 0 {
		return errors.New("APP_PUBLIC_URL or META_OAUTH_ALLOWED_ORIGINS is required when Meta OAuth is enabled")
	}
	return nil
}

func validateEvolutionWebhookURL(name string, value string, requireHTTPS bool) error {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(value))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		if err == nil {
			err = errors.New("absolute URL with host is required")
		}
		return fmt.Errorf("%s is invalid: %w", name, err)
	}
	if parsed.User != nil {
		return fmt.Errorf("%s must not contain URL credentials", name)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("%s must use http or https", name)
	}
	if requireHTTPS && parsed.Scheme != "https" {
		return fmt.Errorf("%s must use https in production", name)
	}
	for queryName := range parsed.Query() {
		switch strings.ToLower(strings.TrimSpace(queryName)) {
		case "webhook_token", "apikey", "token":
			return fmt.Errorf("%s must not contain credentials in the query string", name)
		}
	}
	return nil
}

func validateWebhookRolloutSessionIDs(values []string) error {
	if len(values) == 0 {
		return nil
	}
	if len(values) == 1 && values[0] == "*" {
		return nil
	}

	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "*" {
			return errors.New("WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS must be either * or a comma-separated UUID allowlist")
		}

		var uuid pgtype.UUID
		if err := uuid.Scan(value); err != nil || !uuid.Valid {
			return fmt.Errorf("WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS contains invalid UUID %q", value)
		}

		normalized := uuid.String()
		if _, exists := seen[normalized]; exists {
			return fmt.Errorf("WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS contains duplicate UUID %q", normalized)
		}
		seen[normalized] = struct{}{}
	}

	return nil
}

func getEnv(key string, fallback string) string {
	if value, ok := os.LookupEnv(key); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}

	return fallback
}

func parseCSV(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))

	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}

	return out
}

func parseDuration(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}

	value, err := time.ParseDuration(raw)
	if err != nil {
		return fallback
	}

	return value
}

func parseInt(key string, fallback int32) int32 {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}

	value, err := strconv.ParseInt(raw, 10, 32)
	if err != nil {
		return fallback
	}

	return int32(value)
}

func parseBool(key string, fallback bool) bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if raw == "" {
		return fallback
	}
	switch raw {
	case "1", "true", "t", "yes", "y", "on", "enabled":
		return true
	case "0", "false", "f", "no", "n", "off", "disabled":
		return false
	default:
		return fallback
	}
}

func parseLogLevel(value string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
