package automations

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

const testUUID = "11111111-1111-4111-8111-111111111111"

func TestSaveFlowValidateAcceptsReachableAcyclicFlow(t *testing.T) {
	request := validSaveFlowRequest()

	input, err := request.Validate()
	if err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	if len(input.FlowDefinition.Nodes) != 2 {
		t.Fatalf("nodes = %d, want 2", len(input.FlowDefinition.Nodes))
	}
}

func TestSaveFlowValidateRejectsInvalidGraphShapes(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*SaveFlowRequest)
	}{
		{
			name: "multiple triggers",
			mutate: func(request *SaveFlowRequest) {
				request.FlowDefinition.Nodes = append(request.FlowDefinition.Nodes, FlowNode{
					ID: "trigger-2", Type: "trigger", Config: json.RawMessage(`{"trigger_type":"manual"}`),
				})
			},
		},
		{
			name: "dangling connection",
			mutate: func(request *SaveFlowRequest) {
				request.FlowDefinition.Connections[0].Target = "missing"
			},
		},
		{
			name: "cycle",
			mutate: func(request *SaveFlowRequest) {
				request.FlowDefinition.Connections = append(request.FlowDefinition.Connections, FlowConnection{
					Source: "message", Target: "trigger",
				})
			},
		},
		{
			name: "unreachable node",
			mutate: func(request *SaveFlowRequest) {
				action := "send_whatsapp"
				request.FlowDefinition.Nodes = append(request.FlowDefinition.Nodes, FlowNode{
					ID: "orphan", Type: "action", ActionType: &action,
					Config: json.RawMessage(`{"session_id":"` + testUUID + `","message":"oi"}`),
				})
			},
		},
		{
			name: "invalid action config",
			mutate: func(request *SaveFlowRequest) {
				request.FlowDefinition.Nodes[1].Config = json.RawMessage(`{"message":"oi"}`)
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := validSaveFlowRequest()
			test.mutate(&request)
			_, err := request.Validate()
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("Validate() error = %v, want ErrInvalidInput", err)
			}
		})
	}
}

func TestSaveFlowValidateRequiresTwoNamedConditionBranches(t *testing.T) {
	condition := FlowNode{
		ID: "condition", Type: "condition",
		Config: json.RawMessage(`{"condition_type":"custom","variable":"lead.source","operator":"equals","value":"site"}`),
	}
	action := "send_whatsapp"
	terminal := func(id string) FlowNode {
		return FlowNode{
			ID: id, Type: "action", ActionType: &action,
			Config: json.RawMessage(`{"session_id":"` + testUUID + `","message":"oi"}`),
		}
	}
	trueBranch := "true"
	falseBranch := "false"
	request := SaveFlowRequest{FlowDefinition: FlowDefinition{
		Nodes: []FlowNode{
			{ID: "trigger", Type: "trigger", Config: json.RawMessage(`{"trigger_type":"manual"}`)},
			condition,
			terminal("yes"),
			terminal("no"),
		},
		Connections: []FlowConnection{
			{Source: "trigger", Target: "condition"},
			{Source: "condition", Target: "yes", ConditionBranch: &trueBranch},
			{Source: "condition", Target: "no", ConditionBranch: &falseBranch},
		},
	}}

	if _, err := request.Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}

	request.FlowDefinition.Connections[2].ConditionBranch = &trueBranch
	if _, err := request.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("Validate() error = %v, want ErrInvalidInput", err)
	}
}

func TestSaveFlowValidateRejectsActionTypeOutsideActionNode(t *testing.T) {
	request := validSaveFlowRequest()
	actionType := "send_whatsapp"
	request.FlowDefinition.Nodes[0].ActionType = &actionType
	if _, err := request.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("Validate() error = %v, want ErrInvalidInput", err)
	}
}

func TestSaveFlowValidateResponseSentimentRequiresKeywords(t *testing.T) {
	request := validSaveFlowRequest()
	request.FlowDefinition.Nodes[1].Type = "condition"
	request.FlowDefinition.Nodes[1].ActionType = nil
	request.FlowDefinition.Nodes[1].Config = json.RawMessage(`{"condition_type":"response_sentiment","positive_keywords":"","negative_keywords":""}`)
	trueBranch := "true"
	falseBranch := "false"
	action := "send_whatsapp"
	request.FlowDefinition.Nodes = append(request.FlowDefinition.Nodes,
		FlowNode{ID: "yes", Type: "action", ActionType: &action, Config: json.RawMessage(`{"session_id":"` + testUUID + `","message":"sim"}`)},
		FlowNode{ID: "no", Type: "action", ActionType: &action, Config: json.RawMessage(`{"session_id":"` + testUUID + `","message":"nao"}`)},
	)
	request.FlowDefinition.Connections = []FlowConnection{
		{Source: "trigger", Target: "message"},
		{Source: "message", Target: "yes", ConditionBranch: &trueBranch, SourceHandle: &trueBranch},
		{Source: "message", Target: "no", ConditionBranch: &falseBranch, SourceHandle: &falseBranch},
	}
	if _, err := request.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("Validate() error = %v, want ErrInvalidInput", err)
	}
}

func TestSaveFlowValidateScheduledContract(t *testing.T) {
	location, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		t.Fatal(err)
	}
	scheduledAt := time.Now().Add(24 * time.Hour).In(location).Format(time.RFC3339)
	request := validSaveFlowRequest()
	request.FlowDefinition.Nodes[0].Config = json.RawMessage(
		fmt.Sprintf(`{"trigger_type":"scheduled","scheduled_at":%q,"timezone":"America/Sao_Paulo","target_type":"lead","target_lead_id":"%s"}`, scheduledAt, testUUID),
	)
	if _, err := request.Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}

	request.FlowDefinition.Nodes[0].Config = json.RawMessage(
		`{"trigger_type":"scheduled","scheduled_at":"2026-07-13 09:00","timezone":"GMT-3"}`,
	)
	if _, err := request.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("Validate() error = %v, want ErrInvalidInput", err)
	}
}

func TestSaveFlowValidateScheduledTimezoneDSTOffset(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	localTime := time.Now().Add(180 * 24 * time.Hour).In(location)
	request := validSaveFlowRequest()
	request.FlowDefinition.Nodes[0].Config = json.RawMessage(fmt.Sprintf(
		`{"trigger_type":"scheduled","scheduled_at":%q,"timezone":"America/New_York","target_type":"lead","target_lead_id":"%s"}`,
		localTime.Format(time.RFC3339), testUUID,
	))
	if _, err := request.Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}

	_, correctOffset := localTime.Zone()
	wrongTime := time.Date(localTime.Year(), localTime.Month(), localTime.Day(), localTime.Hour(), localTime.Minute(), 0, 0, time.FixedZone("wrong", correctOffset+3600))
	request.FlowDefinition.Nodes[0].Config = json.RawMessage(fmt.Sprintf(
		`{"trigger_type":"scheduled","scheduled_at":%q,"timezone":"America/New_York","target_type":"lead","target_lead_id":"%s"}`,
		wrongTime.Format(time.RFC3339), testUUID,
	))
	if _, err := request.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("Validate() error = %v, want ErrInvalidInput", err)
	}
}

func TestSaveFlowValidateInactivityLimits(t *testing.T) {
	tests := []struct {
		name    string
		config  string
		wantErr bool
	}{
		{name: "one hour", config: `{"trigger_type":"inactivity","inactivity_value":1,"inactivity_unit":"hours"}`},
		{name: "one year hours", config: `{"trigger_type":"inactivity","inactivity_value":8760,"inactivity_unit":"hours"}`},
		{name: "one year days", config: `{"trigger_type":"inactivity","inactivity_value":365,"inactivity_unit":"days"}`},
		{name: "hours above limit", config: `{"trigger_type":"inactivity","inactivity_value":8761,"inactivity_unit":"hours"}`, wantErr: true},
		{name: "days above limit", config: `{"trigger_type":"inactivity","inactivity_value":366,"inactivity_unit":"days"}`, wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := validSaveFlowRequest()
			request.FlowDefinition.Nodes[0].Config = json.RawMessage(test.config)
			_, err := request.Validate()
			if test.wantErr && !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("Validate() error = %v, want ErrInvalidInput", err)
			}
			if !test.wantErr && err != nil {
				t.Fatalf("Validate() error = %v", err)
			}
		})
	}
}

func TestValidHTTPSURLRejectsLocalAndPrivateTargets(t *testing.T) {
	for _, target := range []string{
		"http://example.com/hook",
		"https://localhost/hook",
		"https://127.0.0.1/hook",
		"https://10.0.0.1/hook",
		"https://100.64.0.1/hook",
		"https://192.0.2.1/hook",
		"https://[::ffff:127.0.0.1]/hook",
		"https://[2001:db8::1]/hook",
		"https://example.com:8443/hook",
		"https://service.local/hook",
	} {
		if validHTTPSURL(target) {
			t.Fatalf("validHTTPSURL(%q) = true, want false", target)
		}
	}
	if !validHTTPSURL("https://hooks.example.com/v1/automation") {
		t.Fatal("expected public https URL to be valid")
	}
}

func TestValidAutomationMediaPathRequiresCanonicalTenantFolderShape(t *testing.T) {
	valid := testUUID + "/images/1712345678-deadbeef.jpg"
	if !validAutomationMediaPath(valid) {
		t.Fatalf("validAutomationMediaPath(%q) = false", valid)
	}
	for _, value := range []string{
		"/" + valid,
		testUUID + "/documents/file.pdf",
		testUUID + "/images/../secret.jpg",
		"not-a-uuid/images/file.jpg",
	} {
		if validAutomationMediaPath(value) {
			t.Fatalf("validAutomationMediaPath(%q) = true, want false", value)
		}
	}
}

func TestUpdateRequestRejectsFlowAndTriggerMutations(t *testing.T) {
	trigger := "lead_created"
	config := json.RawMessage(`{}`)
	flow := json.RawMessage(`{"nodes":[],"connections":[],"settings":{}}`)
	for _, request := range []UpdateRequest{
		{TriggerType: &trigger},
		{TriggerConfig: &config},
		{FlowDefinition: &flow},
	} {
		if _, err := request.Validate(); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("Validate() error = %v, want ErrInvalidInput", err)
		}
	}
}

func TestAutomationRequestLengthLimits(t *testing.T) {
	longName := strings.Repeat("n", 181)
	longDescription := strings.Repeat("d", 2001)
	longContent := strings.Repeat("c", 10001)

	if _, err := (CreateRequest{Name: longName}).Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("CreateRequest.Validate() error = %v, want ErrInvalidInput", err)
	}
	name := "valid"
	if _, err := (UpdateRequest{Name: &name, Description: &longDescription}).Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("UpdateRequest.Validate() error = %v, want ErrInvalidInput", err)
	}
	if _, err := (CreateTemplateRequest{Name: "template", Content: longContent}).Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("CreateTemplateRequest.Validate() error = %v, want ErrInvalidInput", err)
	}
}

func TestCreateRequestAcceptsAtomicPublishedFlow(t *testing.T) {
	flow := validSaveFlowRequest().FlowDefinition
	raw, err := json.Marshal(flow)
	if err != nil {
		t.Fatal(err)
	}
	active := true
	input, err := (CreateRequest{
		Name:           "Atendimento inicial",
		FlowDefinition: (*json.RawMessage)(&raw),
		IsActive:       &active,
	}).Validate()
	if err != nil {
		t.Fatalf("CreateRequest.Validate() error = %v", err)
	}
	if input.ParsedFlow == nil || !input.IsActive || input.TriggerType != "manual" {
		t.Fatalf("unexpected atomic create input: %+v", input)
	}
}

func TestCreateRequestRejectsActiveDraftWithoutFlow(t *testing.T) {
	active := true
	if _, err := (CreateRequest{Name: "Rascunho", IsActive: &active}).Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("CreateRequest.Validate() error = %v, want ErrInvalidInput", err)
	}
}

func TestFlowRejectsActionsWithoutCanonicalLeadCommandService(t *testing.T) {
	tests := []struct {
		actionType string
		config     string
	}{
		{actionType: "move_lead", config: `{"pipeline_id":"` + testUUID + `","stage_id":"` + testUUID + `"}`},
		{actionType: "assign_user", config: `{"user_id":"` + testUUID + `"}`},
		{actionType: "set_variable", config: `{"actionType":"property_interest","property_id":"` + testUUID + `"}`},
		{actionType: "set_variable", config: `{"actionType":"deal_status","status":"won"}`},
	}
	for _, test := range tests {
		t.Run(test.actionType+test.config, func(t *testing.T) {
			request := validSaveFlowRequest()
			request.FlowDefinition.Nodes[1].ActionType = &test.actionType
			request.FlowDefinition.Nodes[1].Config = json.RawMessage(test.config)
			if _, err := request.Validate(); !errors.Is(err, ErrInvalidInput) || !strings.Contains(err.Error(), "canonical") {
				t.Fatalf("Validate() error = %v, want clear canonical-service rejection", err)
			}
		})
	}
}

func validSaveFlowRequest() SaveFlowRequest {
	action := "send_whatsapp"
	return SaveFlowRequest{FlowDefinition: FlowDefinition{
		Nodes: []FlowNode{
			{
				ID: "trigger", Type: "trigger", Config: json.RawMessage(`{"trigger_type":"manual"}`),
			},
			{
				ID: "message", Type: "action", ActionType: &action,
				Config: json.RawMessage(`{"session_id":"` + testUUID + `","message":"Ola {{lead.name}}"}`),
			},
		},
		Connections: []FlowConnection{{Source: "trigger", Target: "message"}},
		Settings:    map[string]any{},
	}}
}
