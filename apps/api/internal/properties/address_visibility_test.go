package properties

import (
	"strings"
	"testing"
)

func TestAddressPrivacyWritesCanonicalAliasesAndRejectsUnknown(t *testing.T) {
	for input, expected := range map[string]string{
		"completo": "completo", " Full ": "completo", "complete": "completo",
		"parcial": "parcial", " PARTIAL ": "parcial", "minimo": "minimo",
		" Mínimo ": "minimo", "mínimo": "minimo", "minimum": "minimo", "minimal": "minimo", "cidade": "minimo", "city": "minimo",
	} {
		request := propertyRequest{"public_address_visibility": input, "expected_updated_at": "2026-10-13T00:00:00Z"}
		out, err := request.ValidateUpdate()
		if err != nil || out["address_visibility"] != expected {
			t.Fatalf("privacy %q = %#v, %v", input, out, err)
		}
		created, err := (propertyRequest{"title": "Synthetic property", "tipo_de_imovel": "Apartamento", "tipo_de_negocio": "Venda", "public_address_visibility": input}).ValidateCreate()
		if err != nil || created["address_visibility"] != expected {
			t.Fatalf("create privacy %q = %#v, %v", input, created, err)
		}
	}
	for _, input := range []any{nil, 1, true, "", " ", "unknown", "all", "exact"} {
		if _, err := (propertyRequest{"public_address_visibility": input}).ValidateUpdate(); err == nil {
			t.Fatalf("unknown privacy %#v was accepted", input)
		}
	}
}

func TestAddressPrivacyUnknownReadsNeverExposeNeighborhoodOrExactAddress(t *testing.T) {
	for _, input := range []string{"", "unknown", " Mínimo ", "minimal", "minimum", "city", "cidade"} {
		if got := NormalizePublicAddressVisibility(input); got != "minimo" {
			t.Fatalf("privacy %q expanded to %q", input, got)
		}
	}
	for _, input := range []string{"", "unknown", "mínimo", "minimal"} {
		if got := NormalizePublicSnapshotAddressVisibility(input); got != "minimo" {
			t.Fatalf("historical privacy %q expanded to %q", input, got)
		}
	}
	for _, input := range []string{" Full ", "complete"} {
		if NormalizePublicSnapshotAddressVisibility(input) != "completo" {
			t.Fatalf("known complete snapshot alias %q lost its chosen granularity", input)
		}
	}
	for _, value := range []string{"completo", "parcial", "minimo"} {
		if NormalizePublicAddressVisibility(value) != value || NormalizePublicSnapshotAddressVisibility(value) != value {
			t.Fatalf("canonical privacy %q changed", value)
		}
	}
	query := PropertyPublicAddressVisibilitySQL("p")
	if !strings.Contains(query, "translate(lower(") || !strings.Contains(query, "else 'minimo'") {
		t.Fatal("SQL privacy must normalize accents and fail closed")
	}
}

func TestPropertyDTOCanonicalizesPrivacyWithoutChangingStoredRawMarker(t *testing.T) {
	for raw, expected := range map[string]string{" Mínimo ": "minimo", "minimal": "minimo", "unknown": "minimo", "full": "completo", "partial": "parcial"} {
		property := Property{"address_visibility": raw, "public_address_visibility": "parcial"}
		out := normalizePropertyOutput(property)
		if out["public_address_visibility"] != expected || out["address_visibility"] != raw {
			t.Fatalf("privacy DTO changed raw or failed canonical alias: %#v", out)
		}
	}
	property := normalizePropertyOutput(Property{"address_visibility": "", "public_address_visibility": "parcial"})
	if property["public_address_visibility"] != "parcial" {
		t.Fatal("valid legacy partial marker lost its existing granularity")
	}
}
