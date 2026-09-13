package publicapi

import "testing"

func TestLeadRequestPayloadValidatesPublicContract(t *testing.T) {
	valid := "valid"
	tests := []struct {
		name    string
		request LeadRequest
		valid   bool
	}{
		{name: "valid", request: LeadRequest{Name: "Joao", Phone: "+55 11 99999-9999"}, valid: true},
		{name: "short name", request: LeadRequest{Name: "J", Phone: "11999999999"}},
		{name: "short phone", request: LeadRequest{Name: "Joao", Phone: "123"}},
		{name: "invalid email", request: LeadRequest{Name: "Joao", Phone: "11999999999", Email: &valid}},
		{name: "invalid property", request: LeadRequest{Name: "Joao", Phone: "11999999999", PropertyID: &valid}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := test.request.Payload()
			if (err == nil) != test.valid {
				t.Fatalf("error = %v, want valid = %v", err, test.valid)
			}
		})
	}
}

func TestRawAPIKeyFormatIsNarrow(t *testing.T) {
	if !validRawAPIKey(testAPIKey) {
		t.Fatal("generated key shape should be accepted")
	}
	for _, value := range []string{
		"",
		"vimob_short",
		"other_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"vimob_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
	} {
		if validRawAPIKey(value) {
			t.Fatalf("unexpected accepted API key %q", value)
		}
	}
}
