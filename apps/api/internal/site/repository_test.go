package site

import (
	"net/url"
	"strings"
	"testing"
)

func TestPublicPropertyJSONDoesNotExposeExactLocation(t *testing.T) {
	query := publicPropertyJSONSQL()

	for _, field := range []string{
		"'endereco'",
		"'numero'",
		"'complemento'",
		"'cep'",
		"'quadra'",
		"'lote'",
		"'condominio_nome'",
		"'metadata'",
		"'public_address_visibility'",
	} {
		if strings.Contains(query, field) {
			t.Fatalf("public property payload exposes exact location field %s", field)
		}
	}

	for _, field := range []string{"'bairro'", "'cidade'", "'estado'"} {
		if !strings.Contains(query, field) {
			t.Fatalf("public property payload should preserve approximate location field %s", field)
		}
	}
}

func TestPublicPropertySearchCannotProbeExactLocation(t *testing.T) {
	args := []any{"organization-id"}
	clauses := strings.Join(publicPropertyWhereClauses(url.Values{
		"search":     []string{"local secreto"},
		"condominio": []string{"condominio secreto"},
	}, "", &args), " ")

	for _, fragment := range []string{"p.endereco", "p.condominium_id", "property_condominiums"} {
		if strings.Contains(clauses, fragment) {
			t.Fatalf("public property search can probe exact location through %s", fragment)
		}
	}
}
