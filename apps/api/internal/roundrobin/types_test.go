package roundrobin

import (
	"encoding/json"
	"errors"
	"strings"
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
			{
				Type:      "whatsapp_message_contains",
				Values:    []string{"Quero conhecer"},
				SessionID: "0f7e8b58-8ff0-4374-b52d-c21f2f15c498",
			},
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
	if input.Rules[5].Match["message_contains"] != "Quero conhecer" {
		t.Fatalf("whatsapp_message_contains mismatch: %#v", input.Rules[5].Match)
	}
	if input.Rules[5].Match[whatsappSessionMatchKey] != "0f7e8b58-8ff0-4374-b52d-c21f2f15c498" {
		t.Fatalf("whatsapp session mismatch: %#v", input.Rules[5].Match)
	}
	assertMatchList(t, input.Rules[6].Match, "tag_in", []string{"lote"})
	assertMatchList(t, input.Rules[7].Match, "city_in", []string{"Jundiai"})
	if input.Rules[8].Match["interest_property_id"] != "CA0035" {
		t.Fatalf("interest_property mismatch: %#v", input.Rules[8].Match)
	}
}

func TestWhatsAppMessageConditionRejectsMultipleValues(t *testing.T) {
	_, err := (ConditionInput{
		Type:   whatsappMessageContainsConditionType,
		Values: []string{"casa", "apartamento"},
	}).toRuleInput(0)
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid input, got %v", err)
	}
}

func TestWhatsAppMessageRulePreservesCommaInMatch(t *testing.T) {
	input, err := (RuleRequest{
		MatchType:  whatsappMessageContainsConditionType,
		MatchValue: "Quero casa, agora",
		Match: map[string]any{
			whatsappSessionMatchKey: "0f7e8b58-8ff0-4374-b52d-c21f2f15c498",
		},
	}).Validate("11111111-1111-1111-1111-111111111111")
	if err != nil {
		t.Fatalf("RuleRequest.Validate() error = %v", err)
	}
	if input.Match["message_contains"] != "Quero casa, agora" {
		t.Fatalf("message_contains mismatch: %#v", input.Match)
	}
}

func TestResolveRuleMatchPatchRebuildsChangedWhatsAppValue(t *testing.T) {
	match := resolveRuleMatchPatch(
		map[string]any{
			"message_contains":      "valor antigo",
			whatsappSessionMatchKey: "0f7e8b58-8ff0-4374-b52d-c21f2f15c498",
		},
		whatsappMessageContainsConditionType,
		"Quero casa, agora",
		patchObject{},
		true,
	)
	if match["message_contains"] != "Quero casa, agora" {
		t.Fatalf("message_contains mismatch: %#v", match)
	}
	if match[whatsappSessionMatchKey] != "0f7e8b58-8ff0-4374-b52d-c21f2f15c498" {
		t.Fatalf("whatsapp session was not preserved: %#v", match)
	}
}

func TestWhatsAppMessageConditionRequiresSession(t *testing.T) {
	_, err := (ConditionInput{
		Type:   whatsappMessageContainsConditionType,
		Values: []string{"quero conhecer"},
	}).toRuleInput(0)
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid input, got %v", err)
	}
}

func TestResolveRuleMatchPatchKeepsExplicitMatch(t *testing.T) {
	match := resolveRuleMatchPatch(
		map[string]any{"message_contains": "valor antigo"},
		whatsappMessageContainsConditionType,
		"novo matchValue",
		patchObject{Set: true, Value: map[string]any{"message_contains": "match explícito"}},
		true,
	)
	if match["message_contains"] != "match explícito" {
		t.Fatalf("explicit match mismatch: %#v", match)
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

func TestCreateRequestValidateNormalizesAutoTagIDs(t *testing.T) {
	const firstTagID = "11111111-1111-4111-8111-111111111111"
	const secondTagID = "22222222-2222-4222-8222-222222222222"
	var request CreateRequest
	payload := []byte(`{"name":"Fila com tags","settings":{"auto_tag_ids":[" 11111111-1111-4111-8111-111111111111 ","22222222-2222-4222-8222-222222222222","11111111-1111-4111-8111-111111111111"]}}`)
	if err := json.Unmarshal(payload, &request); err != nil {
		t.Fatalf("UnmarshalJSON() error = %v", err)
	}

	input, err := request.Validate()
	if err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	tagIDs, ok := input.Settings[autoTagIDsSettingKey].([]string)
	if !ok {
		t.Fatalf("expected normalized []string, got %T", input.Settings[autoTagIDsSettingKey])
	}
	if len(tagIDs) != 2 || tagIDs[0] != firstTagID || tagIDs[1] != secondTagID {
		t.Fatalf("unexpected normalized auto tags: %#v", tagIDs)
	}
}

func TestCreateRequestValidateRejectsInvalidAutoTagIDs(t *testing.T) {
	for _, test := range []struct {
		name  string
		value any
	}{
		{name: "not an array", value: "11111111-1111-4111-8111-111111111111"},
		{name: "non string entry", value: []any{42}},
		{name: "invalid UUID", value: []any{"not-a-uuid"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := (CreateRequest{
				Name:     "Fila inválida",
				Settings: map[string]any{autoTagIDsSettingKey: test.value},
			}).Validate()
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("expected ErrInvalidInput, got %v", err)
			}
		})
	}
}

func TestCreateRequestValidateLimitsAutoTagIDs(t *testing.T) {
	tagIDs := make([]string, maxQueueAutoTagIDs+1)
	for index := range tagIDs {
		tagIDs[index] = "11111111-1111-4111-8111-111111111111"
	}

	_, err := (CreateRequest{
		Name:     "Fila acima do limite",
		Settings: map[string]any{autoTagIDsSettingKey: tagIDs},
	}).Validate()
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestNormalizeManagedWhatsAppAutoReplySettingsLeavesUnconfiguredQueuesUntouched(t *testing.T) {
	t.Parallel()

	settings, err := normalizeManagedWhatsAppAutoReplySettings(map[string]any{
		"existing_setting": "preserved",
	})
	if err != nil {
		t.Fatalf("normalize settings: %v", err)
	}
	for _, key := range []string{
		whatsAppDistributionAutoReplyEnabledKey,
		whatsAppDistributionAutoReplyMessageKey,
		whatsAppDistributionAutoReplyDelayKey,
	} {
		if _, exists := settings[key]; exists {
			t.Fatalf("unconfigured queue must not receive %q: %#v", key, settings)
		}
	}
	if settings["existing_setting"] != "preserved" {
		t.Fatalf("existing setting was not preserved: %#v", settings)
	}
}

func TestNormalizeManagedWhatsAppAutoReplySettingsKeepsOptInDisabled(t *testing.T) {
	t.Parallel()

	settings, err := normalizeManagedWhatsAppAutoReplySettings(map[string]any{
		whatsAppDistributionAutoReplyMessageKey: "  Mensagem configurada  ",
		whatsAppDistributionAutoReplyDelayKey:   float64(15),
	})
	if err != nil {
		t.Fatalf("normalize settings: %v", err)
	}
	if enabled, ok := settings[whatsAppDistributionAutoReplyEnabledKey].(bool); !ok || enabled {
		t.Fatalf("configured fields without explicit opt-in must remain disabled: %#v", settings)
	}
	if settings[whatsAppDistributionAutoReplyMessageKey] != "Mensagem configurada" {
		t.Fatalf("message was not normalized: %#v", settings)
	}
	if settings[whatsAppDistributionAutoReplyDelayKey] != 15 {
		t.Fatalf("delay was not normalized: %#v", settings)
	}

	disabled, err := normalizeManagedWhatsAppAutoReplySettings(map[string]any{
		whatsAppDistributionAutoReplyEnabledKey: false,
	})
	if err != nil {
		t.Fatalf("normalize disabled settings: %v", err)
	}
	if _, exists := disabled[whatsAppDistributionAutoReplyMessageKey]; exists {
		t.Fatalf("disabled queue must not receive a default message: %#v", disabled)
	}
	if _, exists := disabled[whatsAppDistributionAutoReplyDelayKey]; exists {
		t.Fatalf("disabled queue must not receive a default delay: %#v", disabled)
	}
}

func TestNormalizeManagedWhatsAppAutoReplySettingsDefaultsActivatedFields(t *testing.T) {
	t.Parallel()

	settings, err := normalizeManagedWhatsAppAutoReplySettings(map[string]any{
		whatsAppDistributionAutoReplyEnabledKey: true,
	})
	if err != nil {
		t.Fatalf("normalize settings: %v", err)
	}
	if settings[whatsAppDistributionAutoReplyMessageKey] != defaultWhatsAppDistributionAutoReply {
		t.Fatalf("default message mismatch: %#v", settings)
	}
	if settings[whatsAppDistributionAutoReplyDelayKey] != defaultWhatsAppDistributionReplyDelay {
		t.Fatalf("default delay mismatch: %#v", settings)
	}
}

func TestNormalizeManagedWhatsAppAutoReplySettingsValidatesConfiguredFields(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		settings map[string]any
	}{
		{name: "enabled must be boolean", settings: map[string]any{whatsAppDistributionAutoReplyEnabledKey: "true"}},
		{name: "message must be string", settings: map[string]any{whatsAppDistributionAutoReplyMessageKey: 42}},
		{name: "message cannot be blank", settings: map[string]any{whatsAppDistributionAutoReplyMessageKey: "   "}},
		{name: "message length is bounded", settings: map[string]any{whatsAppDistributionAutoReplyMessageKey: strings.Repeat("a", maxWhatsAppDistributionAutoReplyLength+1)}},
		{name: "delay must be integer", settings: map[string]any{whatsAppDistributionAutoReplyDelayKey: "30"}},
		{name: "delay must be positive", settings: map[string]any{whatsAppDistributionAutoReplyDelayKey: 0}},
		{name: "delay is bounded", settings: map[string]any{whatsAppDistributionAutoReplyDelayKey: maxWhatsAppDistributionReplyDelay + 1}},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if _, err := normalizeManagedWhatsAppAutoReplySettings(test.settings); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("expected ErrInvalidInput, got %v", err)
			}
		})
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
