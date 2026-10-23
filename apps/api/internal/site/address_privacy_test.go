package site

import "testing"

func TestDeliveredSnapshotMinimumAndUnknownPrivacyRedactsLocation(t *testing.T) {
	for _, visibility := range []any{" Mínimo ", "minimal", "unknown", "", nil, "minimo"} {
		property := map[string]any{"public_address_visibility": visibility, "bairro": "PRIVATE", "cidade": "Curitiba",
			"pais": "PRIVATE", "endereco": "PRIVATE", "numero": "PRIVATE", "complemento": "PRIVATE", "cep": "PRIVATE",
			"latitude": -25.5, "longitude": -49.2, "condominio_nome": "PRIVATE"}
		redactPublicPropertyInternalValues(property)
		for _, key := range []string{"bairro", "pais", "endereco", "numero", "complemento", "cep", "latitude", "longitude", "condominio_nome"} {
			if _, exists := property[key]; exists {
				t.Fatalf("snapshot privacy %#v exposed %s", visibility, key)
			}
		}
		if property["cidade"] != "Curitiba" || property["public_address_visibility"] != "minimo" {
			t.Fatalf("safe city/marker changed for privacy %#v: %#v", visibility, property)
		}
	}
	property := map[string]any{"public_address_visibility": "parcial", "bairro": "Public neighborhood", "endereco": "PRIVATE"}
	redactPublicPropertyInternalValues(property)
	if property["bairro"] != "Public neighborhood" {
		t.Fatal("canonical partial address lost its chosen neighborhood")
	}
	if _, exists := property["endereco"]; exists {
		t.Fatal("partial snapshot exposed street")
	}
}
