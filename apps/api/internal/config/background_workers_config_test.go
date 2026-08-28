package config

import "testing"

func TestBackgroundWorkersDefaultEnabledAndExplicitlyDisable(t *testing.T) {
	for _, test := range []struct {
		name  string
		value string
		want  bool
	}{
		{name: "unset equivalent keeps compatibility", value: "", want: true},
		{name: "whitespace keeps compatibility", value: "   ", want: true},
		{name: "malformed keeps compatibility", value: "flase", want: true},
		{name: "explicit false disables", value: "false", want: false},
		{name: "explicit zero disables", value: "0", want: false},
		{name: "explicit true enables", value: "true", want: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("API_BACKGROUND_WORKERS_ENABLED", test.value)

			if got := loadBackgroundWorkersEnabled(); got != test.want {
				t.Fatalf("background workers enabled = %v, want %v", got, test.want)
			}
		})
	}
}
