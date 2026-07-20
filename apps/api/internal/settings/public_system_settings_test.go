package settings

import "testing"

func TestSanitizePublicSystemSettingsValueAllowsBrandingAndPublicControls(t *testing.T) {
	input := map[string]any{
		"logo_url_light":      "https://cdn.example/logo-light.png",
		"contact_whatsapp":    "5511999999999",
		"maintenance_mode":    true,
		"maintenance_message": "Atualizacao programada",
		"feature_flags":       map[string]any{"dashboard_v2": true},
	}

	got := sanitizePublicSystemSettingsValue(input)
	for _, key := range []string{"logo_url_light", "contact_whatsapp", "maintenance_mode", "maintenance_message", "feature_flags"} {
		if _, ok := got[key]; !ok {
			t.Fatalf("expected public key %q to be preserved", key)
		}
	}
}

func TestSanitizePublicSystemSettingsValueRemovesCredentialsAndInternalFields(t *testing.T) {
	input := map[string]any{
		"notification_instance_token": "must-not-leak",
		"notification_instance_name":  "internal-instance",
		"notification_dispatch":       map[string]any{"token": "must-not-leak"},
		"whatsapp":                    map[string]any{"api_key": "must-not-leak"},
		"sms":                         map[string]any{"api_key": "must-not-leak"},
		"maintenance": map[string]any{
			"enabled":     true,
			"message":     "Atualizacao programada",
			"allowed_ips": []any{"10.0.0.1"},
		},
	}

	got := sanitizePublicSystemSettingsValue(input)
	for _, key := range []string{"notification_instance_token", "notification_instance_name", "notification_dispatch", "whatsapp", "sms"} {
		if _, ok := got[key]; ok {
			t.Fatalf("internal key %q must not be public", key)
		}
	}

	maintenance, ok := got["maintenance"].(map[string]any)
	if !ok {
		t.Fatal("expected sanitized maintenance object")
	}
	if _, ok := maintenance["allowed_ips"]; ok {
		t.Fatal("maintenance allowed_ips must not be public")
	}
	if maintenance["enabled"] != true || maintenance["message"] != "Atualizacao programada" {
		t.Fatal("public maintenance state was not preserved")
	}
}
