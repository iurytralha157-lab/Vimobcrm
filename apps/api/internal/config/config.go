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
			URL:             os.Getenv("DATABASE_URL"),
			MaxConns:        parseInt("DATABASE_MAX_CONNS", 20),
			MinConns:        parseInt("DATABASE_MIN_CONNS", 2),
			MaxConnLifetime: parseDuration("DATABASE_MAX_CONN_LIFETIME", 30*time.Minute),
			MaxConnIdleTime: parseDuration("DATABASE_MAX_CONN_IDLE_TIME", 5*time.Minute),
			HealthTimeout:   parseDuration("DATABASE_HEALTH_TIMEOUT", 3*time.Second),
		},
		Storage: StorageConfig{
			ProjectURL: getEnv("SUPABASE_PROJECT_URL", getEnv("NEXT_PUBLIC_SUPABASE_URL", getEnv("SUPABASE_URL", ""))),
			APIKey:     getEnv("SUPABASE_SERVICE_ROLE_KEY", os.Getenv("SUPABASE_SECRET_KEY")),
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

	if cfg.Environment == "production" {
		for _, origin := range cfg.HTTP.CORSOrigins {
			if origin == "*" {
				validationErrors = append(validationErrors, errors.New("API_CORS_ALLOWED_ORIGINS cannot contain * in production"))
			}
		}
	}

	return errors.Join(validationErrors...)
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
