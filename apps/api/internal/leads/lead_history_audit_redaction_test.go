package leads

import (
	"strings"
	"testing"
)

func TestLeadHistoryAuditPayloadRedactsPersonalAndUnknownFields(t *testing.T) {
	logs := []map[string]any{{
		"old_data": map[string]any{
			"name": "Pessoa Antiga", "cpf": "12345678900", "deal_status": "open",
			"integration_secret": "secret-old",
		},
		"new_data": map[string]any{
			"name": "Pessoa Nova", "cpf": "98765432100", "deal_status": "won",
			"integration_secret": "secret-new", "metadata": map[string]any{"token": "secret-nested"},
			"property_code":    map[string]any{"token": "secret-under-allowed-key"},
			"source":           strings.Repeat("x", 161),
			"assigned_user_id": "not-a-uuid",
			"valor_interesse":  map[string]any{"token": "secret-under-number-key"},
		},
	}}
	redactLeadHistoryAuditLogs(logs)
	oldData := logs[0]["old_data"].(map[string]any)
	newData := logs[0]["new_data"].(map[string]any)
	if oldData["name"] != "[valor protegido]" || newData["cpf"] != "[valor protegido]" {
		t.Fatalf("personal values were not redacted: old=%v new=%v", oldData, newData)
	}
	if oldData["deal_status"] != "open" || newData["deal_status"] != "won" {
		t.Fatalf("operational status was removed: old=%v new=%v", oldData, newData)
	}
	if _, exists := newData["integration_secret"]; exists {
		t.Fatal("unknown secret escaped the allowlist")
	}
	if _, exists := newData["metadata"]; exists {
		t.Fatal("nested metadata escaped the allowlist")
	}
	if _, exists := newData["property_code"]; exists {
		t.Fatal("nested value escaped through an allowed field")
	}
	for _, field := range []string{"source", "assigned_user_id", "valor_interesse"} {
		if _, exists := newData[field]; exists {
			t.Fatalf("invalid or oversized %s escaped through an allowed field", field)
		}
	}
}
