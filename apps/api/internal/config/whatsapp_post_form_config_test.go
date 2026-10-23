package config

import "testing"

func TestWhatsAppPostFormFollowUpGuardDefaultsOff(t *testing.T) {
	for _, test := range []struct {
		name  string
		value string
		want  bool
	}{
		{"unset", "", false},
		{"whitespace", "   ", false},
		{"malformed", "tru", false},
		{"explicit false", "false", false},
		{"explicit zero", "0", false},
		{"explicit true", "true", true},
		{"supported boolean alias", " enabled ", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("WHATSAPP_POST_FORM_FOLLOW_UP_GUARD_ENABLED", test.value)
			if got := loadWhatsAppPostFormFollowUpGuardEnabled(); got != test.want {
				t.Fatalf("post-form guard = %t, want %t", got, test.want)
			}
		})
	}
}
