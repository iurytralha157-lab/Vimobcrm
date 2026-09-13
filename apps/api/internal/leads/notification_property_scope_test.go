package leads

import (
	"strings"
	"testing"
)

func TestHiddenPropertyNotificationRemovesDirectAndNestedPropertyDetails(t *testing.T) {
	metadata := map[string]any{
		"event_key":      "interest_property_reserved",
		"property_id":    "10000000-0000-4000-8000-000000000001",
		"property_title": "Cobertura privada",
		"property_code":  "PRIV-1",
		"property_price": "999999",
		"variables": map[string]any{
			"interestPropertyId": "10000000-0000-4000-8000-000000000001",
			"propertyName":       "Cobertura privada",
			"propertyImage":      "https://private.example/image.jpg",
		},
	}
	title, content, redacted := hiddenPropertyNotificationCopy(
		"Imovel de interesse reservado",
		"A cobertura PRIV-1 foi reservada",
		metadata,
	)
	serialized := string(jsonb(redacted))
	for _, forbidden := range []string{"10000000-0000-4000-8000-000000000001", "Cobertura privada", "PRIV-1", "999999", "private.example"} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("redacted notification metadata exposes %q: %s", forbidden, serialized)
		}
	}
	if title != "Imovel de interesse reservado" || content != "O imovel de interesse foi reservado. Revise este atendimento." {
		t.Fatalf("hidden property notification = %q / %q", title, content)
	}
}

func TestNotificationPropertyReferenceSupportsLegacyAliases(t *testing.T) {
	for _, key := range []string{"property_id", "propertyId", "interest_property_id", "interestPropertyId"} {
		metadata := map[string]any{"variables": map[string]any{key: "10000000-0000-4000-8000-000000000001"}}
		if got := notificationPropertyReference(metadata); got != "10000000-0000-4000-8000-000000000001" {
			t.Fatalf("reference for %s = %q", key, got)
		}
	}
}

func TestPropertyNotificationWithoutCanonicalIDFailsClosed(t *testing.T) {
	content := "Codigo PRIV-404"
	notification := Notification{
		Title:   "Imovel reservado: Cobertura privada",
		Content: &content,
		Metadata: map[string]any{
			"event_key":      "interest_property_reserved",
			"property_title": "Cobertura privada",
			"property_media": []any{"https://private.example/image.jpg"},
		},
	}

	scoped := scopeNotificationPropertyForAPI(notification, nil)
	if scoped.Title == notification.Title || scoped.Content == nil || *scoped.Content == *notification.Content {
		t.Fatalf("property notification without a canonical id retained private copy: %#v", scoped)
	}
	if _, exists := scoped.Metadata["property_title"]; exists {
		t.Fatalf("property notification without a canonical id retained title metadata: %#v", scoped.Metadata)
	}
	if _, exists := scoped.Metadata["property_media"]; exists {
		t.Fatalf("property notification without a canonical id retained media metadata: %#v", scoped.Metadata)
	}
}
