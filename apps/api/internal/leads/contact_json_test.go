package leads

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestContactJSONPreservesNumbersAndRedactsNestedDocuments(t *testing.T) {
	raw := pgtype.Text{Valid: true, String: `{"big":9007199254740993,"decimal":1234567890.1234567890123456789,"exponent":1e1000,"nested":{"profile":{"CPF":"cpf-secret","rg":"rg-secret","safe":"allowed"}},"field_data":[{"name":"Qual seu CPF?","values":["cpf-answer"]},{"name":"numero_do_rg","value":"rg-answer"},{"name":"Cidade","values":["São Paulo"]}]}`}
	result := sanitizedLeadMetadataJSON(raw)
	if result == nil {
		t.Fatal("valid JSON lost its output")
	}
	for _, expected := range []string{"9007199254740993", "1234567890.1234567890123456789", "1e1000", `"hasCPF":true`, `"hasRG":true`, "allowed", "São Paulo"} {
		if !strings.Contains(*result, expected) {
			t.Fatalf("sanitized export omitted %q: %s", expected, *result)
		}
	}
	for _, secret := range []string{"cpf-secret", "rg-secret", "cpf-answer", "rg-answer"} {
		if strings.Contains(*result, secret) {
			t.Fatalf("sanitized export retained document %s", secret)
		}
	}
	var decoded any
	decoder := json.NewDecoder(strings.NewReader(*result))
	decoder.UseNumber()
	if err := decoder.Decode(&decoded); err != nil {
		t.Fatalf("sanitized JSON is invalid: %v", err)
	}
}

func TestContactJSONRootArraysNilAndInvalidFailClosed(t *testing.T) {
	if result := sanitizedLeadMetadataJSON(pgtype.Text{}); result != nil {
		t.Fatal("absent JSON became invented data")
	}
	invalid := sanitizedLeadMetadataJSON(pgtype.Text{Valid: true, String: `{bad`})
	if invalid == nil || *invalid != "{}" {
		t.Fatal("invalid JSON must fail closed")
	}
	result := sanitizedLeadMetadataJSON(pgtype.Text{Valid: true, String: `[{"name":"CPF","values":[]},{"RG":null},{"id":9007199254740993}]`})
	if result == nil || !strings.Contains(*result, "9007199254740993") || !strings.Contains(*result, `"hasCPF":false`) || !strings.Contains(*result, `"hasRG":false`) {
		t.Fatalf("array/null export projection changed: %v", result)
	}
}
