package config

import (
	"strings"
	"testing"
)

func TestOperationsChecksConfigIsOptIn(t *testing.T) {
	t.Chdir(t.TempDir())
	t.Setenv("API_ENV", "development")
	t.Setenv("SUPABASE_PROJECT_URL", "https://supabase.example.test")
	t.Setenv("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
	t.Setenv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key")
	t.Setenv("OPERATIONS_CHECKS_COMMAND_TOKEN", "")
	t.Setenv("WHATSAPP_SESSION_HEALTH_NOTIFICATIONS_ENABLED", "")
	t.Setenv("WHATSAPP_SESSION_SUPERVISOR_ENABLED", "true")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.OperationsChecksToken != "" || cfg.WhatsApp.SessionHealthNotifications {
		t.Fatal("operations checks must default to disabled")
	}

	token := strings.Repeat("a", 32)
	t.Setenv("OPERATIONS_CHECKS_COMMAND_TOKEN", token)
	t.Setenv("WHATSAPP_SESSION_HEALTH_NOTIFICATIONS_ENABLED", "true")
	cfg, err = Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.OperationsChecksToken != token || !cfg.WhatsApp.SessionHealthNotifications {
		t.Fatal("expected dedicated operations settings to be loaded")
	}

	t.Setenv("OPERATIONS_CHECKS_COMMAND_TOKEN", strings.Repeat("a", 31)+" b")
	t.Setenv("WHATSAPP_SESSION_SUPERVISOR_ENABLED", "false")
	_, err = Load()
	if err == nil || !strings.Contains(err.Error(), "OPERATIONS_CHECKS_COMMAND_TOKEN") ||
		!strings.Contains(err.Error(), "WHATSAPP_SESSION_HEALTH_NOTIFICATIONS_ENABLED") {
		t.Fatalf("invalid operations settings were accepted: %v", err)
	}
}
