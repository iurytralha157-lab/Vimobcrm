package meta

import "testing"

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
