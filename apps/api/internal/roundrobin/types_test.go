package roundrobin

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestConditionConflictErrorUsesFriendlyPortugueseMessage(t *testing.T) {
	err := ConditionConflictError{QueueName: "EQUIPE LINCE"}
	if !errors.Is(err, ErrConditionConflict) {
		t.Fatal("expected condition conflict error to preserve its error category")
	}
	want := `Esta condição de entrada já está sendo usada na fila "EQUIPE LINCE". Altere a regra ou edite a fila existente.`
	if err.Error() != want {
		t.Fatalf("unexpected message: %q", err.Error())
	}
}

func TestCreateRequestValidateNormalizesConditionContracts(t *testing.T) {
	request := CreateRequest{
		Name: "Fila residencial",
		Conditions: []ConditionInput{
			{Type: "source", Values: []string{"meta_ads", "whatsapp"}},
			{Type: "whatsapp_session", Values: []string{"0f7e8b58-8ff0-4374-b52d-c21f2f15c498"}},
			{Type: "meta_form", Values: []string{"1748389402409199"}},
			{Type: "website_category", Values: []string{"venda"}},
			{Type: "campaign_contains", Values: []string{"Reserva dos Lagos"}},
			{Type: "tag", Values: []string{"lote"}},
			{Type: "city", Values: []string{"Jundiai"}},
			{Type: "interest_property", Values: []string{"CA0035"}},
		},
	}

	input, err := request.Validate()
	if err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	if len(input.Rules) != len(request.Conditions) {
		t.Fatalf("expected %d rules, got %d", len(request.Conditions), len(input.Rules))
	}

	assertMatchList(t, input.Rules[0].Match, "source", []string{"meta_ads", "whatsapp"})
	assertMatchList(t, input.Rules[1].Match, "whatsapp_id", nil)
	assertMatchList(t, input.Rules[1].Match, "whatsapp_session_id", []string{"0f7e8b58-8ff0-4374-b52d-c21f2f15c498"})
	assertMatchList(t, input.Rules[2].Match, "meta_form_id", []string{"1748389402409199"})
	assertMatchList(t, input.Rules[3].Match, "website_category", []string{"venda"})
	if input.Rules[4].Match["campaign_name_contains"] != "Reserva dos Lagos" {
		t.Fatalf("campaign_contains mismatch: %#v", input.Rules[4].Match)
	}
	assertMatchList(t, input.Rules[5].Match, "tag_in", []string{"lote"})
	assertMatchList(t, input.Rules[6].Match, "city_in", []string{"Jundiai"})
	if input.Rules[7].Match["interest_property_id"] != "CA0035" {
		t.Fatalf("interest_property mismatch: %#v", input.Rules[7].Match)
	}
}

func TestUpdateRequestDetectsConditionsSet(t *testing.T) {
	var request UpdateRequest
	payload := []byte(`{"conditions":[{"type":"source","values":["website"]}]}`)
	if err := json.Unmarshal(payload, &request); err != nil {
		t.Fatalf("UnmarshalJSON() error = %v", err)
	}

	input, err := request.Validate()
	if err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	if !input.RulesSet {
		t.Fatal("expected rules set when conditions are provided")
	}
	if len(input.Rules) != 1 || input.Rules[0].MatchType != "source" {
		t.Fatalf("unexpected rules: %#v", input.Rules)
	}
}

func TestCreateRequestValidatePreservesTeamMember(t *testing.T) {
	teamID := "11111111-1111-1111-1111-111111111111"
	request := CreateRequest{
		Name: "Fila com equipe",
		Members: []MemberInput{
			{Type: "team", EntityID: teamID},
		},
	}

	input, err := request.Validate()
	if err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	if len(input.Members) != 1 {
		t.Fatalf("expected 1 member, got %d", len(input.Members))
	}
	if input.Members[0].TeamID == nil || *input.Members[0].TeamID != teamID {
		t.Fatalf("expected team id %q, got %#v", teamID, input.Members[0].TeamID)
	}
	if input.Members[0].UserID != nil {
		t.Fatalf("expected no expanded user id, got %#v", input.Members[0].UserID)
	}
}

func assertMatchList(t *testing.T, match map[string]any, key string, expected []string) {
	t.Helper()
	if expected == nil {
		if _, ok := match[key]; ok {
			t.Fatalf("did not expect key %q in %#v", key, match)
		}
		return
	}

	raw, ok := match[key]
	if !ok {
		t.Fatalf("expected key %q in %#v", key, match)
	}
	values, ok := raw.([]string)
	if !ok {
		t.Fatalf("expected %q to be []string, got %T", key, raw)
	}
	if len(values) != len(expected) {
		t.Fatalf("expected %q length %d, got %d", key, len(expected), len(values))
	}
	for index := range expected {
		if values[index] != expected[index] {
			t.Fatalf("expected %q[%d] = %q, got %q", key, index, expected[index], values[index])
		}
	}
}
