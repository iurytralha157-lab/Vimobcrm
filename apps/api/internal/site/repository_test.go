package site

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestEnrichTrackingLocationFromInfrastructureHeaders(t *testing.T) {
	request := PublicTrackingRequest{}
	header := http.Header{
		"X-Vercel-Ip-Latitude":       []string{"-23.5505"},
		"X-Vercel-Ip-Longitude":      []string{"-46.6333"},
		"X-Vercel-Ip-City":           []string{"S%C3%A3o+Paulo"},
		"X-Vercel-Ip-Country-Region": []string{"SP"},
		"X-Vercel-Ip-Country":        []string{"BR"},
	}

	enrichTrackingLocation(&request, header)

	if request.Metadata["city"] != "São Paulo" || request.Metadata["region"] != "SP" || request.Metadata["country"] != "BR" {
		t.Fatalf("unexpected location metadata: %#v", request.Metadata)
	}
	if request.Metadata["lat"] != -23.5505 || request.Metadata["lng"] != -46.6333 {
		t.Fatalf("unexpected coordinates: %#v", request.Metadata)
	}
}

func TestEnrichTrackingLocationRejectsInvalidCoordinates(t *testing.T) {
	request := PublicTrackingRequest{Metadata: map[string]any{"timezone": "America/Sao_Paulo"}}
	header := http.Header{
		"X-Vercel-Ip-Latitude":  []string{"999"},
		"X-Vercel-Ip-Longitude": []string{"-46.6333"},
	}

	enrichTrackingLocation(&request, header)
	if _, exists := request.Metadata["lat"]; exists {
		t.Fatalf("invalid coordinate should not be stored: %#v", request.Metadata)
	}
}

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
