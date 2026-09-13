package properties

import (
	"os"
	"strings"
	"testing"
)

func TestRedactPropertyOwnerContactsRemovesTopLevelAndLegacyValues(t *testing.T) {
	property := Property{
		"owner_name":         "Proprietario",
		"owner_cellphone":    "5511999999999",
		"owner_email":        "owner@example.com",
		"owner_notify_email": true,
		"origin_media":       "indicacao-confidencial",
		"metadata": map[string]any{
			"owner_email":  "metadata@example.com",
			"origin_media": "metadata-confidencial",
			"legacy": map[string]any{
				"owner_cellphone": "5511888888888",
				"owner_email":     "legacy@example.com",
				"origin_media":    "portal-confidencial",
			},
		},
	}

	redactPropertyOwnerContacts(property)

	if property["owner_name"] != "Proprietario" {
		t.Fatal("redaction must retain the owner identity")
	}
	for _, field := range propertyOwnerContactFields {
		if _, exists := property[field]; exists {
			t.Fatalf("top-level field %s was not redacted", field)
		}
	}
	legacy := property["metadata"].(map[string]any)["legacy"].(map[string]any)
	for _, field := range propertyOwnerContactFields {
		if _, exists := legacy[field]; exists {
			t.Fatalf("legacy field %s was not redacted", field)
		}
	}
	metadata := property["metadata"].(map[string]any)
	for _, field := range propertyOwnerContactFields {
		if _, exists := metadata[field]; exists {
			t.Fatalf("metadata field %s was not redacted", field)
		}
	}
}

func TestRedactPropertyOwnerContactValuesProtectsHistoryPayloads(t *testing.T) {
	payload := map[string]any{
		"changes": map[string]any{
			"owner": map[string]any{
				"email": "nested-owner@example.com",
				"name":  "Identidade preservada",
			},
			"metadata": map[string]any{
				"owner_cellphone": "5511999999999",
				"items": []any{
					map[string]any{"owner_email": "history@example.com", "label": "preservado"},
				},
			},
		},
	}

	redactPropertyOwnerContactValues(payload)

	metadata := payload["changes"].(map[string]any)["metadata"].(map[string]any)
	if _, exists := metadata["owner_cellphone"]; exists {
		t.Fatal("nested history owner cellphone was not redacted")
	}
	item := metadata["items"].([]any)[0].(map[string]any)
	if _, exists := item["owner_email"]; exists {
		t.Fatal("array-nested history owner email was not redacted")
	}
	if item["label"] != "preservado" {
		t.Fatal("unrelated history metadata changed during redaction")
	}
	owner := payload["changes"].(map[string]any)["owner"].(map[string]any)
	if _, exists := owner["email"]; exists {
		t.Fatal("generic contact field inside an owner history object was not redacted")
	}
	if owner["name"] != "Identidade preservada" {
		t.Fatal("owner identity changed during contact redaction")
	}
}

func TestRedactPropertyHistoryInternalValuesUsesWorkspaceClassification(t *testing.T) {
	event := HistoryEvent{
		Title: "Comissao atualizada para 8%",
		Metadata: map[string]any{
			"message": "Comissao atualizada para 8%",
			"changes": map[string]any{
				"title":                 "Titulo publico",
				"commission_percentage": 8,
				"metadata": map[string]any{
					"hidden_site_image_urls": []any{"https://private.example.test/photo.jpg"},
				},
			},
			"updated_fields": []any{
				propertyHistoryFieldLabel("title"),
				propertyHistoryFieldLabel("commission_percentage"),
				propertyHistoryFieldLabel("metadata"),
			},
		},
	}

	redactPropertyHistoryInternalValues(&event)

	changes := event.Metadata["changes"].(map[string]any)
	for _, field := range []string{"commission_percentage", "metadata"} {
		if _, exists := changes[field]; exists {
			t.Fatalf("history retained internal field %s", field)
		}
	}
	if changes["title"] != "Titulo publico" {
		t.Fatal("history removed a safe property change")
	}
	fields := event.Metadata["updated_fields"].([]string)
	if len(fields) != 1 || fields[0] != propertyHistoryFieldLabel("title") {
		t.Fatalf("history field labels were not redacted: %#v", fields)
	}
	if event.Title != "Imovel atualizado" || event.Metadata["message"] != "Imovel atualizado" {
		t.Fatalf("history retained a message derived from internal values: %#v", event)
	}
}

func TestRedactOwnerContactsRetainsOperationalSummary(t *testing.T) {
	owner := Owner{
		"id":             "owner-1",
		"name":           "Proprietario",
		"cellphone":      "5511999999999",
		"email":          "owner@example.com",
		"notes":          "Sensitive note",
		"property_count": float64(2),
	}

	redactOwnerContacts(owner)

	if owner["name"] != "Proprietario" || owner["property_count"] != float64(2) {
		t.Fatal("redaction must keep non-sensitive operational fields")
	}
	for _, field := range ownerContactFields {
		if _, exists := owner[field]; exists {
			t.Fatalf("owner field %s was not redacted", field)
		}
	}
}

func TestPropertyHistoryHandlerAppliesInternalAndOwnerPrivacyIndependently(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("handler.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (handler Handler) History(")
	end := strings.Index(source, "func (handler Handler) Create(")
	if start < 0 || end <= start {
		t.Fatal("property History handler was not found")
	}
	method := source[start:end]
	for _, required := range []string{
		"if !canManageProperties(tenantContext)",
		"redactPropertyHistoryInternalValues(&events[index])",
		"if !canViewContacts",
		"redactPropertyOwnerContactValues(events[index].Metadata)",
	} {
		if !strings.Contains(method, required) {
			t.Fatalf("property History privacy contract is missing %q", required)
		}
	}
}
