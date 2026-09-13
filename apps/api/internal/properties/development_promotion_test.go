package properties

import (
	"encoding/json"
	"testing"
)

func TestDevelopmentUnitPropertyRequestUsesCanonicalSafeFields(t *testing.T) {
	description := "Planta com varanda"
	price := 780000.0
	bedrooms := 2
	mainImage := "https://cdn.example.com/main.jpg"
	request, err := developmentUnitPropertyRequest(DevelopmentUnitPropertyInput{
		Title:                   "Residencial Horizonte - Unidade 101",
		PropertyType:            "Apartamento",
		DealType:                "lancamento",
		Purpose:                 "Residencial",
		Status:                  "active",
		Description:             &description,
		Price:                   &price,
		Bedrooms:                &bedrooms,
		MainImageURL:            &mainImage,
		ImageURLs:               []string{mainImage},
		PublicAddressVisibility: "parcial",
		Metadata: map[string]any{
			"source":              "property_development_unit_promotion",
			"development_unit_id": "11111111-1111-4111-8111-111111111111",
		},
	})
	if err != nil {
		t.Fatalf("developmentUnitPropertyRequest returned %v", err)
	}

	if request["tipo"] != "Apartamento" || request["finalidade"] != "lancamento" || request["finalidade_uso"] != "Residencial" {
		t.Fatalf("canonical property classification was not preserved: %#v", request)
	}
	if request["published_on_site"] != false || request["is_demo"] != false {
		t.Fatalf("promoted property did not start private and non-demo: %#v", request)
	}
	if _, exists := request["tipo_de_negocio"]; exists {
		t.Fatalf("legacy deal-type column leaked into canonical request: %#v", request)
	}
	if _, exists := request["responsible_user_id"]; exists {
		t.Fatalf("nil responsible user should not be written: %#v", request)
	}

	metadataText, ok := request["metadata"].(string)
	if !ok {
		t.Fatalf("metadata was not normalized to JSON text: %#v", request["metadata"])
	}
	var metadata map[string]any
	if err := json.Unmarshal([]byte(metadataText), &metadata); err != nil {
		t.Fatalf("decode normalized metadata: %v", err)
	}
	if metadata["source"] != "property_development_unit_promotion" {
		t.Fatalf("promotion source missing from metadata: %#v", metadata)
	}
}

func TestDevelopmentUnitPropertyRequestRejectsIncompleteSource(t *testing.T) {
	_, err := developmentUnitPropertyRequest(DevelopmentUnitPropertyInput{
		Title:    "Unidade sem planta",
		DealType: "lancamento",
		Purpose:  "Residencial",
		Status:   "active",
	})
	if err == nil {
		t.Fatal("promotion without property type was accepted")
	}
}
