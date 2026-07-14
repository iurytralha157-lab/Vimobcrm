package properties

import (
	"strings"
	"testing"
)

func TestSanitizePayloadWritesCanonicalPropertyColumns(t *testing.T) {
	input := propertyRequest{
		"title":                     "Apartamento teste",
		"fotos":                     []any{"https://example.com/foto-1.jpg", "https://example.com/foto-2.jpg"},
		"anunciar":                  true,
		"cadastrado_por":            "11111111-1111-1111-1111-111111111111",
		"tipo_de_imovel":            "Apartamento",
		"tipo_de_negocio":           "Venda",
		"finalidade":                "Residencial",
		"owner_media_source":        "Instagram",
		"public_address_visibility": "parcial",
	}

	out, err := sanitizePayload(input)
	if err != nil {
		t.Fatalf("sanitizePayload returned error: %v", err)
	}

	if _, exists := out["fotos"]; exists {
		t.Fatalf("legacy fotos key should not be written: %#v", out)
	}
	if _, exists := out["anunciar"]; exists {
		t.Fatalf("legacy anunciar key should not be written: %#v", out)
	}
	if _, exists := out["cadastrado_por"]; exists {
		t.Fatalf("legacy cadastrado_por key should not be written: %#v", out)
	}
	if _, exists := out["tipo_de_imovel"]; exists {
		t.Fatalf("legacy tipo_de_imovel key should not be written: %#v", out)
	}
	if _, exists := out["tipo_de_negocio"]; exists {
		t.Fatalf("legacy tipo_de_negocio key should not be written: %#v", out)
	}
	if got := out["finalidade"]; got != "venda" {
		t.Fatalf("deal type should be written to finalidade, got %#v", got)
	}
	if got := out["finalidade_uso"]; got != "Residencial" {
		t.Fatalf("usage purpose should be written to finalidade_uso, got %#v", got)
	}
	if got := out["image_urls"]; len(got.([]string)) != 2 {
		t.Fatalf("photos should be normalized to image_urls, got %#v", got)
	}
	if got := out["published_on_site"]; got != true {
		t.Fatalf("anunciar should be normalized to published_on_site, got %#v", got)
	}
	if got := out["responsible_user_id"]; got != "11111111-1111-1111-1111-111111111111" {
		t.Fatalf("cadastrado_por should be normalized to responsible_user_id, got %#v", got)
	}
	if got := out["origin_media"]; got != "Instagram" {
		t.Fatalf("owner_media_source should be normalized to origin_media, got %#v", got)
	}
	if got := out["address_visibility"]; got != "parcial" {
		t.Fatalf("public_address_visibility should normalize to address_visibility, got %#v", got)
	}
}

func TestSanitizePayloadReservedStatusUnpublishesCanonicalColumn(t *testing.T) {
	out, err := sanitizePayload(propertyRequest{
		"title":    "Apartamento teste",
		"status":   "reservado",
		"anunciar": true,
	})
	if err != nil {
		t.Fatalf("sanitizePayload returned error: %v", err)
	}
	if got := out["published_on_site"]; got != false {
		t.Fatalf("reserved property should be unpublished, got %#v", got)
	}
	if _, exists := out["anunciar"]; exists {
		t.Fatalf("legacy anunciar key should not be written: %#v", out)
	}
}

func TestAddPropertyTypeFilterKeepsRegularTypesLiteral(t *testing.T) {
	args, where := addPropertyTypeFilter([]any{"org-1"}, []string{"p.organization_id = $1::uuid"}, "Apartamento")

	if len(args) != 2 {
		t.Fatalf("args length = %d, want 2: %#v", len(args), args)
	}
	if args[1] != "Apartamento" {
		t.Fatalf("property type arg = %#v, want Apartamento", args[1])
	}
	if got := where[len(where)-1]; got != "(p.tipo = $2 or p.tipo_de_imovel = $2)" {
		t.Fatalf("regular property type filter = %s", got)
	}
}

func TestAddPropertyTypeFilterExpandsHouse(t *testing.T) {
	args, where := addPropertyTypeFilter([]any{"org-1"}, []string{"p.organization_id = $1::uuid"}, "Casa")

	if len(args) != 3 {
		t.Fatalf("args length = %d, want 3: %#v", len(args), args)
	}
	if args[1] != "Casa" {
		t.Fatalf("exact property type arg = %#v", args[1])
	}
	aliases, ok := args[2].([]string)
	if !ok {
		t.Fatalf("alias arg type = %T, want []string", args[2])
	}
	if !containsString(aliases, "casa") || !containsString(aliases, "casa de condom\u00ednio") {
		t.Fatalf("house aliases = %#v", aliases)
	}

	clause := where[len(where)-1]
	for _, expected := range []string{
		"p.tipo = $2",
		"p.tipo_de_imovel = $2",
		"= any($3::text[])",
	} {
		if !strings.Contains(clause, expected) {
			t.Fatalf("house filter %q missing %q", clause, expected)
		}
	}
	if strings.Contains(clause, "p.condominium_id is not null") {
		t.Fatalf("house filter should not require condominium link: %s", clause)
	}
}

func TestAddPropertyTypeFilterExpandsCondominiumHouse(t *testing.T) {
	args, where := addPropertyTypeFilter([]any{"org-1"}, []string{"p.organization_id = $1::uuid"}, "Casa de condom\u00ednio")

	if len(args) != 4 {
		t.Fatalf("args length = %d, want 4: %#v", len(args), args)
	}
	if args[1] != "Casa de condom\u00ednio" {
		t.Fatalf("exact property type arg = %#v", args[1])
	}
	explicitAliases, ok := args[2].([]string)
	if !ok {
		t.Fatalf("explicit alias arg type = %T, want []string", args[2])
	}
	if !containsString(explicitAliases, "casa de condom\u00ednio") || containsString(explicitAliases, "casa") {
		t.Fatalf("explicit condominium house aliases = %#v", explicitAliases)
	}
	linkedAliases, ok := args[3].([]string)
	if !ok {
		t.Fatalf("linked alias arg type = %T, want []string", args[3])
	}
	if !containsString(linkedAliases, "casa") || !containsString(linkedAliases, "sobrado") || containsString(linkedAliases, "casa de condom\u00ednio") {
		t.Fatalf("linked condominium house aliases = %#v", linkedAliases)
	}

	clause := where[len(where)-1]
	for _, expected := range []string{
		"p.tipo = $2",
		"p.tipo_de_imovel = $2",
		"= any($3::text[])",
		"p.condominium_id is not null",
		"= any($4::text[])",
	} {
		if !strings.Contains(clause, expected) {
			t.Fatalf("condominium house filter %q missing %q", clause, expected)
		}
	}
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
