package config

import (
	"bufio"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Config struct {
	Environment string
	LogLevel    slog.Level
	HTTP        HTTPConfig
	Auth        authpkg.Config
	Database    dbpkg.Config
	Storage     StorageConfig
	Email       EmailConfig
	Push        PushConfig
	AI          AIConfig
	EvolutionGo EvolutionGoConfig
	Meta        MetaConfig
}

type HTTPConfig struct {
	Host              string
	Port              string
	CORSOrigins       []string
	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
}

type StorageConfig struct {
	ProjectURL string
	APIKey     string
}

type EvolutionGoConfig struct {
	APIURL                   string
	APIKey                   string
	WebhookURL               string
	BackendWebhookURL        string
	WebhookProcessorMode     string
	WebhookRolloutSessionIDs []string
}

type MetaConfig struct {
	AppSecret          string
	WebhookVerifyToken string
	GraphVersion       string
	GraphBaseURL       string
}

type EmailConfig struct {
	ResendAPIKey string
	FromEmail    string
	ReplyTo      string
	SupportEmail string
	AppURL       string
}

type PushConfig struct {
	VAPIDPublicKey  string
	VAPIDPrivateKey string
	VAPIDSubject    string
	FCMServerKey    string
}

type AIConfig struct {
	OpenAIAPIKey   string
	OpenAIBaseURL  string
	DefaultModel   string
	RealtimeModel  string
	RealtimeVoice  string
	AutoReplyToken string
}

func (cfg HTTPConfig) Addr() string {
	return cfg.Host + ":" + cfg.Port
}

func Load() (Config, error) {
	loadDevelopmentEnvFiles()

	env := getEnv("API_ENV", "development")

	cfg := Config{
		Environment: env,
		LogLevel:    parseLogLevel(getEnv("API_LOG_LEVEL", "info")),
		HTTP: HTTPConfig{
			Host:              getEnv("API_HOST", "0.0.0.0"),
			Port:              getEnv("API_PORT", "8081"),
			CORSOrigins:       parseCSV(getEnv("API_CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")),
			ReadHeaderTimeout: parseDuration("API_READ_HEADER_TIMEOUT", 5*time.Second),
			ReadTimeout:       parseDuration("API_READ_TIMEOUT", 15*time.Second),
			WriteTimeout:      parseDuration("API_WRITE_TIMEOUT", 30*time.Second),
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
			MaxConns:             parseInt("DATABASE_MAX_CONNS", 20),
			MinConns:             parseInt("DATABASE_MIN_CONNS", 2),
			MaxConnLifetime:      parseDuration("DATABASE_MAX_CONN_LIFETIME", 30*time.Minute),
			MaxConnIdleTime:      parseDuration("DATABASE_MAX_CONN_IDLE_TIME", 5*time.Minute),
			HealthTimeout:        parseDuration("DATABASE_HEALTH_TIMEOUT", 10*time.Second),
			StartupRetryTimeout:  parseDuration("DATABASE_STARTUP_RETRY_TIMEOUT", 5*time.Minute),
			StartupRetryInterval: parseDuration("DATABASE_STARTUP_RETRY_INTERVAL", 5*time.Second),
		},
		Storage: StorageConfig{
			ProjectURL: getEnv("SUPABASE_PROJECT_URL", getEnv("NEXT_PUBLIC_SUPABASE_URL", getEnv("SUPABASE_URL", ""))),
			APIKey:     getEnv("SUPABASE_SERVICE_ROLE_KEY", os.Getenv("SUPABASE_SECRET_KEY")),
		},
		Email: EmailConfig{
			ResendAPIKey: os.Getenv("RESEND_API_KEY"),
			FromEmail:    getEnv("RESEND_FROM_EMAIL", "Vimob CRM <naoresponde@vimobcrm.com.br>"),
			ReplyTo:      getEnv("RESEND_REPLY_TO", "contato@vimobcrm.com.br"),
			SupportEmail: getEnv("SUPPORT_EMAIL", getEnv("RESEND_REPLY_TO", "contato@vimobcrm.com.br")),
			AppURL:       getEnv("APP_PUBLIC_URL", getEnv("NEXT_PUBLIC_SITE_URL", "https://vimobcrm.com.br")),
		},
		Push: PushConfig{
			VAPIDPublicKey: getEnv("WEB_PUSH_VAPID_PUBLIC_KEY", getEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "")),
			VAPIDPrivateKey: getEnv(
				"WEB_PUSH_VAPID_PRIVATE_KEY",
				getEnv("VAPID_PRIVATE_KEY", getEnv("WEB_PUSH_PRIVATE_KEY", "")),
			),
			VAPIDSubject: getEnv("WEB_PUSH_VAPID_SUBJECT", getEnv("RESEND_REPLY_TO", "mailto:contato@vimobcrm.com.br")),
			FCMServerKey: getEnv("FCM_SERVER_KEY", getEnv("FIREBASE_SERVER_KEY", "")),
		},
		AI: AIConfig{
			OpenAIAPIKey:   os.Getenv("OPENAI_API_KEY"),
			OpenAIBaseURL:  getEnv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
			DefaultModel:   getEnv("OPENAI_TEXT_MODEL", getEnv("OPENAI_MODEL", "gpt-4.1-mini")),
			RealtimeModel:  getEnv("OPENAI_REALTIME_MODEL", "gpt-realtime-2"),
			RealtimeVoice:  getEnv("OPENAI_REALTIME_VOICE", "cedar"),
			AutoReplyToken: getEnv("AI_AUTOREPLY_TOKEN", os.Getenv("INTERNAL_WEBHOOK_TOKEN")),
		},
		EvolutionGo: EvolutionGoConfig{
			APIURL:                   strings.TrimRight(getEnv("EVOLUTION_GO_API_URL", ""), "/"),
			APIKey:                   os.Getenv("EVOLUTION_GO_API_KEY"),
			WebhookURL:               strings.TrimRight(getEnv("EVOLUTION_GO_WEBHOOK_URL", ""), "/"),
			BackendWebhookURL:        strings.TrimRight(getEnv("EVOLUTION_GO_BACKEND_WEBHOOK_URL", ""), "/"),
			WebhookProcessorMode:     strings.ToLower(getEnv("WHATSAPP_WEBHOOK_PROCESSOR_MODE", "edge")),
			WebhookRolloutSessionIDs: parseCSV(getEnv("WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS", "")),
		},
		Meta: MetaConfig{
			AppSecret:          os.Getenv("META_APP_SECRET"),
			WebhookVerifyToken: os.Getenv("META_WEBHOOK_VERIFY_TOKEN"),
			GraphVersion:       getEnv("META_GRAPH_VERSION", "v25.0"),
			GraphBaseURL:       strings.TrimRight(getEnv("META_GRAPH_BASE_URL", "https://graph.facebook.com"), "/"),
		},
	}

	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}

	return cfg, nil
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
		return value
	}

	quote := value[0]
	if quote != '"' && quote != '\'' {
		return value
	}
	if value[len(value)-1] != quote {
		return value
	}

	return value[1 : len(value)-1]
}

func (cfg Config) Validate() error {
	var validationErrors []error

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

	if cfg.EvolutionGo.APIURL != "" {
		if _, err := url.ParseRequestURI(cfg.EvolutionGo.APIURL); err != nil {
			validationErrors = append(validationErrors, fmt.Errorf("EVOLUTION_GO_API_URL is invalid: %w", err))
		}
	}
	if cfg.EvolutionGo.WebhookURL != "" {
		if _, err := url.ParseRequestURI(cfg.EvolutionGo.WebhookURL); err != nil {
			validationErrors = append(validationErrors, fmt.Errorf("EVOLUTION_GO_WEBHOOK_URL is invalid: %w", err))
		}
	}
	if cfg.EvolutionGo.BackendWebhookURL != "" {
		if _, err := url.ParseRequestURI(cfg.EvolutionGo.BackendWebhookURL); err != nil {
			validationErrors = append(validationErrors, fmt.Errorf("EVOLUTION_GO_BACKEND_WEBHOOK_URL is invalid: %w", err))
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
	if len(cfg.EvolutionGo.WebhookRolloutSessionIDs) > 0 && strings.TrimSpace(cfg.EvolutionGo.BackendWebhookURL) == "" {
		validationErrors = append(validationErrors, errors.New("EVOLUTION_GO_BACKEND_WEBHOOK_URL is required when WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS is enabled"))
	}
	if cfg.Meta.GraphBaseURL != "" {
		if _, err := url.ParseRequestURI(cfg.Meta.GraphBaseURL); err != nil {
			validationErrors = append(validationErrors, fmt.Errorf("META_GRAPH_BASE_URL is invalid: %w", err))
		}
	}

	if cfg.Environment == "production" {
		for _, origin := range cfg.HTTP.CORSOrigins {
			if origin == "*" {
				validationErrors = append(validationErrors, errors.New("API_CORS_ALLOWED_ORIGINS cannot contain * in production"))
			}
		}
	}

	return errors.Join(validationErrors...)
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
