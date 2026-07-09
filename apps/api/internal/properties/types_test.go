package properties

import "testing"

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
