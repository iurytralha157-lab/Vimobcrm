package leads

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
)

func TestLeadFinancialSharedContractVectors(t *testing.T) {
	var fixture struct {
		Version int `json:"version"`
		Cases   []struct {
			Name       string  `json:"name"`
			Mode       string  `json:"mode"`
			Field      string  `json:"field"`
			Input      *string `json:"input"`
			Valid      bool    `json:"valid"`
			Normalized *string `json:"normalized"`
		} `json:"cases"`
	}
	raw, err := os.ReadFile("testdata/lead_financial_cases.json")
	if err != nil || json.Unmarshal(raw, &fixture) != nil || fixture.Version != 1 || len(fixture.Cases) == 0 {
		t.Fatal("invalid shared financial corpus", err)
	}
	for _, vector := range fixture.Cases {
		t.Run(vector.Name, func(t *testing.T) {
			payload := map[string]any{vector.Field: vector.Input}
			if vector.Mode == "create" {
				payload["name"] = "Synthetic financial lead"
			}
			body, _ := json.Marshal(payload)
			request := httptest.NewRequest("POST", "/v1/leads", strings.NewReader(string(body)))
			response := httptest.NewRecorder()
			var actual *string
			var validationError error
			if vector.Mode == "create" {
				decoded, valid := httpserver.DecodeJSONValue[CreateRequest](response, request, 1<<20)
				if !valid {
					t.Fatal("financial string/null did not bind")
				}
				input, err := decoded.Validate()
				actual, validationError = input.InterestValue, err
			} else {
				decoded, valid := httpserver.DecodeJSONValue[UpdateRequest](response, request, 1<<20)
				if !valid {
					t.Fatal("financial string/null did not bind")
				}
				input, err := decoded.Validate()
				actual, validationError = input.InterestValue.Value, err
				if vector.Field == "commissionPercentage" {
					actual = input.CommissionPercentage.Value
				}
			}
			if vector.Valid {
				if validationError != nil || !reflect.DeepEqual(actual, vector.Normalized) {
					t.Fatalf("normalized=%v expected=%v error=%v", actual, vector.Normalized, validationError)
				}
			} else if !errors.Is(validationError, ErrLeadFinancialValuesInvalid) || !errors.Is(validationError, ErrInvalidInput) {
				t.Fatalf("invalid financial value was accepted or lost its safe error: %v", validationError)
			}
		})
	}
}

func TestLeadFinancialOmissionNullZeroAndPointerIsolation(t *testing.T) {
	input, err := (CreateRequest{Name: "Synthetic financial lead"}).Validate()
	if err != nil || input.InterestValue != nil {
		t.Fatal("create omission changed", err)
	}
	name := "Synthetic renamed lead"
	update, err := (UpdateRequest{Name: patchString{Set: true, Value: &name}}).Validate()
	if err != nil || update.InterestValue.Set || update.CommissionPercentage.Set {
		t.Fatal("unrelated patch invented financial changes", err)
	}
	for _, field := range []string{"interestValue", "commissionPercentage"} {
		for _, raw := range []string{"null", "0", `"-0e99999999999999999999"`, `"+000.00"`} {
			var request UpdateRequest
			if err := json.Unmarshal([]byte(`{"`+field+`":`+raw+`}`), &request); err != nil {
				t.Fatal(err)
			}
			next, err := request.Validate()
			value := next.InterestValue
			if field == "commissionPercentage" {
				value = next.CommissionPercentage
			}
			if err != nil || !value.Set || raw == "null" && value.Value != nil || raw != "null" && (value.Value == nil || *value.Value != "0") {
				t.Fatal("presence/null/zero contract changed", raw, err)
			}
		}
	}
	interest, percentage := " 650000.125 ", " 7.500000000000000000001 "
	request := UpdateRequest{InterestValue: patchString{Set: true, Value: &interest}, CommissionPercentage: patchString{Set: true, Value: &percentage}}
	next, err := request.Validate()
	if err != nil || interest != " 650000.125 " || percentage != " 7.500000000000000000001 " {
		t.Fatal("validation mutated caller financial pointers", err)
	}
	interest, percentage = "NaN", "150"
	if *next.InterestValue.Value != "650000.125" || *next.CommissionPercentage.Value != "7.500000000000000000001" {
		t.Fatal("validated financial snapshot aliases mutable input")
	}
}

func TestLeadFinancialCanonicalSourcesHaveNoWirePrecisionTruncation(t *testing.T) {
	for _, scenario := range []struct {
		value      string
		percentage bool
	}{
		{"650000." + strings.Repeat("1", 90), false},
		{"7." + strings.Repeat("5", 90), true},
		{"100." + strings.Repeat("0", 90), true},
	} {
		if _, err := normalizeLeadFinancialNumber(scenario.value, scenario.percentage, 40); !errors.Is(err, ErrLeadFinancialValuesInvalid) {
			t.Fatal("oversized wire number was not rejected before truncation")
		}
		value, err := normalizeLeadFinancialNumber(scenario.value, scenario.percentage, 0)
		if err != nil || value != scenario.value {
			t.Fatal("canonical numeric source lost precision", err)
		}
	}
	if _, err := normalizeLeadFinancialNumber("100."+strings.Repeat("0", 90)+"1", true, 0); !errors.Is(err, ErrLeadFinancialValuesInvalid) {
		t.Fatal("canonical percentage bound used rounded float comparison")
	}
}
