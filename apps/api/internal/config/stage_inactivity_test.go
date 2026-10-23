package config

import "testing"

func TestStageInactivityConfigurationIsExplicitOptIn(t *testing.T) {
	// Prevent Load from looking for development env files in the checkout.
	t.Chdir(t.TempDir())
	t.Setenv("API_ENV", "development")
	t.Setenv("SUPABASE_PROJECT_URL", "https://supabase.example.test")
	t.Setenv("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
	t.Setenv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key")
	for _, tc := range []struct {
		value string
		want  bool
	}{{"", false}, {"false", false}, {"malformed", false}, {"true", true}} {
		t.Run(tc.value, func(t *testing.T) {
			t.Setenv("STAGE_INACTIVITY_WORKER_ENABLED", tc.value)
			cfg, err := Load()
			if err != nil {
				t.Fatal(err)
			}
			if cfg.StageInactivityEnabled != tc.want {
				t.Fatalf("stage inactivity enabled = %v, want %v", cfg.StageInactivityEnabled, tc.want)
			}
		})
	}
}
