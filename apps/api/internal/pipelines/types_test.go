package pipelines

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestUpdateStageRequestPreservesQualifiedPatchPresence(t *testing.T) {
	for _, testCase := range []struct {
		name string
		body string
		want bool
	}{
		{name: "qualified", body: `{"isQualified":true}`, want: true},
		{name: "not qualified", body: `{"isQualified":false}`, want: false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			var request UpdateStageRequest
			if err := json.Unmarshal([]byte(testCase.body), &request); err != nil {
				t.Fatalf("decode update stage request: %v", err)
			}

			input, err := request.Validate()
			if err != nil {
				t.Fatalf("validate update stage request: %v", err)
			}
			if !input.IsQualified.Set || input.IsQualified.Value == nil {
				t.Fatal("isQualified patch presence was not preserved")
			}
			if got := *input.IsQualified.Value; got != testCase.want {
				t.Fatalf("isQualified = %t, want %t", got, testCase.want)
			}
		})
	}
}

func TestUpdateStageRequestRejectsQualifiedTerminalOrInactiveStage(t *testing.T) {
	for _, body := range []string{
		`{"isQualified":true,"isWon":true}`,
		`{"isQualified":true,"isLost":true}`,
		`{"isQualified":true,"isActive":false}`,
	} {
		var request UpdateStageRequest
		if err := json.Unmarshal([]byte(body), &request); err != nil {
			t.Fatalf("decode update stage request: %v", err)
		}
		if _, err := request.Validate(); err == nil {
			t.Fatalf("Validate() accepted contradictory qualified stage: %s", body)
		}
	}
}

func TestUpdateStageRequestAllowsQualifiedWhenTerminalFlagsAreCleared(t *testing.T) {
	var request UpdateStageRequest
	if err := json.Unmarshal([]byte(
		`{"isQualified":true,"isWon":false,"isLost":false,"isActive":true}`,
	), &request); err != nil {
		t.Fatalf("decode update stage request: %v", err)
	}
	if _, err := request.Validate(); err != nil {
		t.Fatalf("Validate() rejected eligible qualified stage: %v", err)
	}
}

func TestTerminalOrInactiveStageUpdateForcesQualifiedFalse(t *testing.T) {
	for _, input := range []updateStageInput{
		{IsWon: newPatchBool(true)},
		{IsLost: newPatchBool(true)},
		{IsActive: newPatchBool(false)},
	} {
		qualifiedPatch, err := qualifiedPatchForStageUpdate(input)
		if err != nil {
			t.Fatalf("normalize qualified patch: %v", err)
		}
		if !qualifiedPatch.Set || qualifiedPatch.Value == nil || *qualifiedPatch.Value {
			t.Fatalf("terminal/inactive update did not force isQualified=false: %#v", qualifiedPatch)
		}
	}
}

func TestStageMutationsRequireCanonicalHexColor(t *testing.T) {
	validCreate, err := (CreateStageRequest{
		Name:  "Entrada",
		Color: "  #A1b2C3  ",
	}).Validate()
	if err != nil {
		t.Fatalf("valid color was rejected: %v", err)
	}
	if validCreate.Color != "#A1b2C3" {
		t.Fatalf("color = %q, want trimmed compatible value", validCreate.Color)
	}

	for _, color := range []string{"#", "#fff", "#11223344", "red", "112233"} {
		t.Run(color, func(t *testing.T) {
			_, createErr := (CreateStageRequest{Name: "Entrada", Color: color}).Validate()
			assertInvalidStageColor(t, createErr)

			updateRequest := UpdateStageRequest{
				Color: patchString{Set: true, Value: &color},
			}
			_, updateErr := updateRequest.Validate()
			assertInvalidStageColor(t, updateErr)

			_, reorderErr := (ReorderStagesRequest{Stages: []StageOrderItem{{
				ID:    "11111111-1111-4111-8111-111111111111",
				Name:  "Entrada",
				Color: color,
			}}}).Validate()
			assertInvalidStageColor(t, reorderErr)
		})
	}
}

func TestUpdateStageRequestPreservesNullableColor(t *testing.T) {
	request := UpdateStageRequest{Color: patchString{Set: true, Value: nil}}
	input, err := request.Validate()
	if err != nil {
		t.Fatalf("nullable legacy color was rejected: %v", err)
	}
	if !input.Color.Set || input.Color.Value != nil {
		t.Fatalf("nullable color patch was not preserved: %#v", input.Color)
	}
}

func assertInvalidStageColor(t *testing.T, err error) {
	t.Helper()
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}
	if !strings.Contains(err.Error(), "#RRGGBB") {
		t.Fatalf("error = %q, want explicit #RRGGBB guidance", err)
	}
}
