package config

import "testing"

func TestWhatsAppPrivateCollisionCaptureDefaultsOff(t *testing.T) {
	for _, value := range []string{"", "   ", "tru", "false", "0", "true", " enabled "} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("WHATSAPP_PRIVATE_COLLISION_CAPTURE_ENABLED", value)
			want := value == "true" || value == " enabled "
			if got := loadWhatsAppPrivateCollisionCaptureEnabled(); got != want {
				t.Fatalf("private collision emission=%t, want %t", got, want)
			}
		})
	}
}
