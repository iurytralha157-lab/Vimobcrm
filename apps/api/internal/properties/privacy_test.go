package properties

import "testing"

func TestRedactPropertyOwnerContactsRemovesTopLevelAndLegacyValues(t *testing.T) {
	property := Property{
		"owner_name":         "Proprietario",
		"owner_cellphone":    "5511999999999",
		"owner_email":        "owner@example.com",
		"owner_notify_email": true,
		"metadata": map[string]any{
			"legacy": map[string]any{
				"owner_cellphone": "5511888888888",
				"owner_email":     "legacy@example.com",
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
