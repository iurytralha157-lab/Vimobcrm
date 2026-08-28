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
