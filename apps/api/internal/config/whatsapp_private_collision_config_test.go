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

func TestWhatsAppPrivateLegacyOutboundCaptureIsIndependentAndDefaultsOff(t *testing.T) {
	t.Setenv("WHATSAPP_PRIVATE_COLLISION_CAPTURE_ENABLED", "true")
	for _, value := range []string{"", "false", "0", "tru", "true", " enabled "} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("WHATSAPP_PRIVATE_LEGACY_OUTBOUND_CAPTURE_ENABLED", value)
			want := value == "true" || value == " enabled "
			if got := loadWhatsAppPrivateLegacyOutboundEnabled(); got != want || !loadWhatsAppPrivateCollisionCaptureEnabled() {
				t.Fatalf("outbound emission=%t, want %t with PN emission enabled", got, want)
			}
		})
	}
}
