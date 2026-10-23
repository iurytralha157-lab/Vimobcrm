package meta

import (
	"strings"
	"testing"
)

func TestMapLeadDataCanonicalizesProviderPhones(t *testing.T) {
	tests := map[string]struct {
		providerValue string
		want          string
	}{
		"North American E.164":    {providerValue: "+1 (415) 555-2671", want: "+14155552671"},
		"international 00 prefix": {providerValue: "00 351 912 345 678", want: "+351912345678"},
		"Brazilian local default": {providerValue: "(11) 99999-9999", want: "+5511999999999"},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			details := map[string]any{
				"field_data": []any{
					map[string]any{"name": "full_name", "values": []any{"Ada Lovelace"}},
					map[string]any{"name": "phone_number", "values": []any{test.providerValue}},
				},
			}

			lead := mapLeadData(details, leadgenChange{}, metaIntegration{}, metaFormConfig{})
			if lead.Phone == nil || *lead.Phone != test.want {
				t.Fatalf("mapLeadData() phone = %#v, want %q", lead.Phone, test.want)
			}
		})
	}
}

func TestMapLeadDataKeepsInvalidPhoneOnlyInRawFields(t *testing.T) {
	details := map[string]any{
		"field_data": []any{
			map[string]any{"name": "phone_number", "values": []any{"+1 415 CALL-NOW"}},
		},
	}

	lead := mapLeadData(details, leadgenChange{}, metaIntegration{}, metaFormConfig{})
	if lead.Phone != nil {
		t.Fatalf("mapLeadData() accepted invalid phone: %q", *lead.Phone)
	}
	if _, exists := lead.RawFields["phone_number"]; !exists {
		t.Fatal("mapLeadData() must retain the provider field for diagnostics")
	}
}

func TestMapLeadDataMapsIdentityAndPreservesEveryProviderAnswer(t *testing.T) {
	details := map[string]any{
		"field_data": []any{
			map[string]any{"name": "full_name", "values": []any{"  Maria Silva  "}},
			map[string]any{"name": "phone_number", "values": []any{"(11) 99999-9999"}},
			map[string]any{"name": "email", "values": []any{"maria@example.com"}},
			map[string]any{"name": "qual_e_a_renda_familiar", "values": []any{"R$ 8.000 a R$ 10.000"}},
		},
	}

	lead := mapLeadData(details, leadgenChange{}, metaIntegration{}, metaFormConfig{})
	if lead.Name != "Maria Silva" {
		t.Fatalf("mapLeadData() name = %q", lead.Name)
	}
	if !lead.NameFromProvider {
		t.Fatal("mapLeadData() did not mark the mapped provider name")
	}
	if lead.Phone == nil || *lead.Phone != "+5511999999999" {
		t.Fatalf("mapLeadData() phone = %#v", lead.Phone)
	}
	if lead.Email == nil || *lead.Email != "maria@example.com" {
		t.Fatalf("mapLeadData() email = %#v", lead.Email)
	}
	if got := lead.Custom["qual_e_a_renda_familiar"]; got != "R$ 8.000 a R$ 10.000" {
		t.Fatalf("mapLeadData() custom answer = %#v", got)
	}
	if len(lead.RawFields) != 4 {
		t.Fatalf("mapLeadData() retained %d provider fields, want 4", len(lead.RawFields))
	}
}

func TestMapLeadDataHonorsArbitraryMappingsAndExplicitIgnore(t *testing.T) {
	details := map[string]any{
		"field_data": []any{
			map[string]any{"name": "campo_a", "values": []any{"Maria Configurada"}},
			map[string]any{"name": "campo_b", "values": []any{"(11) 98888-7777"}},
			map[string]any{"name": "campo_c", "values": []any{"Resposta preservada"}},
			map[string]any{"name": "full_name", "values": []any{"Nome ignorado"}},
		},
	}
	config := metaFormConfig{FieldMapping: map[string]string{
		"campo_a":   "name",
		"campo_b":   "phone",
		"campo_c":   "custom",
		"full_name": "",
	}}

	lead := mapLeadData(details, leadgenChange{}, metaIntegration{}, config)
	if lead.Name != "Maria Configurada" || !lead.NameFromProvider {
		t.Fatalf("mapped provider name = %q, provider=%t", lead.Name, lead.NameFromProvider)
	}
	if lead.Phone == nil || *lead.Phone != "+5511988887777" {
		t.Fatalf("mapped provider phone = %#v", lead.Phone)
	}
	if got := lead.Custom["campo_c"]; got != "Resposta preservada" {
		t.Fatalf("mapped custom answer = %#v", got)
	}
	if _, exists := lead.Custom["full_name"]; exists {
		t.Fatal("explicitly ignored provider field was mapped as custom")
	}
	if len(lead.RawFields) != 4 {
		t.Fatalf("raw provider answers = %d, want 4", len(lead.RawFields))
	}
}

func TestStringMapPreservesLegacyEmptyIgnoreOverride(t *testing.T) {
	mapping := stringMap(map[string]any{
		"full_name": "",
		"campo_a":   "name",
	})
	if value, exists := mapping["full_name"]; !exists || value != "" {
		t.Fatalf("legacy ignore override = %q, exists=%t", value, exists)
	}
}

func TestMapLeadDataAcceptsKnownLabelsOnConfiguredPhoneAndPreservesRawAnswers(t *testing.T) {
	values := []string{
		"Cel. +55 (11) 99999-9999",
		"Tel. +55 (11) 99999-9999",
		"Telefone: +55 (11) 99999-9999",
		"Celular: +55 (11) 99999-9999",
		"WhatsApp: +55 (11) 99999-9999",
		"  cEL. +55 (11) 99999-9999  ",
	}
	for _, value := range values {
		t.Run(value, func(t *testing.T) {
			lead := mapLeadData(metaConfiguredContactDetails(value), leadgenChange{}, metaIntegration{}, metaConfiguredContactMapping())
			if lead.Phone == nil || *lead.Phone != "+5511999999999" {
				t.Fatalf("configured phone = %#v, want canonical labeled contact", lead.Phone)
			}
			if lead.Name != "Maria Silva" || lead.Email == nil || *lead.Email != "maria@example.com" {
				t.Fatal("contact labeling changed the configured name or email")
			}
			if got := lead.Custom["phone_number"]; got != "+5511988887777" {
				t.Fatalf("provider phone configured as custom = %#v", got)
			}
			raw, ok := lead.RawFields["whatsapp_number"].([]string)
			if !ok || len(raw) != 1 || raw[0] != strings.TrimSpace(value) {
				t.Fatalf("original labeled answer was changed: %#v", lead.RawFields["whatsapp_number"])
			}
		})
	}
}

func TestMapLeadDataRejectsAmbiguousLabeledPhoneWithoutUsingCustomProviderPhone(t *testing.T) {
	values := []string{
		"Cel. +55 (11) 99999-9999 ramal 2",
		"Telefone: +55 (11) 99999-9999 / +55 (11) 98888-7777",
		"WhatsApp: +55 (11) 99999-9999 ou +55 (11) 98888-7777",
		"Cel. +55 (11) 99999-9999 para recado",
		"Recado: +55 (11) 99999-9999",
		"Cel +55 (11) 99999-9999",
		"Cel. Tel. +55 (11) 99999-9999",
		"Cel. +55 (11 99999-9999",
		"Cel.",
	}
	for _, value := range values {
		t.Run(value, func(t *testing.T) {
			lead := mapLeadData(metaConfiguredContactDetails(value), leadgenChange{}, metaIntegration{}, metaConfiguredContactMapping())
			if lead.Phone != nil {
				t.Fatalf("accepted ambiguous contact or promoted custom provider phone: %q", *lead.Phone)
			}
			if got := lead.Custom["phone_number"]; got != "+5511988887777" {
				t.Fatalf("provider phone configured as custom = %#v", got)
			}
			raw, ok := lead.RawFields["whatsapp_number"].([]string)
			if !ok || len(raw) != 1 || raw[0] != value {
				t.Fatalf("rejected answer was not preserved: %#v", lead.RawFields["whatsapp_number"])
			}
		})
	}
}

func metaConfiguredContactDetails(value string) map[string]any {
	return map[string]any{"field_data": []any{
		map[string]any{"name": "phone_number", "values": []any{"+5511988887777"}},
		map[string]any{"name": "whatsapp_number", "values": []any{value}},
		map[string]any{"name": "email", "values": []any{"maria@example.com"}},
		map[string]any{"name": "nome_completo", "values": []any{"Maria Silva"}},
	}}
}

func metaConfiguredContactMapping() metaFormConfig {
	return metaFormConfig{FieldMapping: map[string]string{
		"phone_number":    "custom",
		"whatsapp_number": "phone",
		"email":           "email",
		"nome_completo":   "name",
	}}
}
