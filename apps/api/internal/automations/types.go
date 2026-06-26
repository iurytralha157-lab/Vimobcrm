package automations

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
)

var (
	ErrInvalidInput            = errors.New("invalid automation input")
	ErrAutomationNotFound      = errors.New("automation not found")
	ErrAutomationMisconfigured = errors.New("automation misconfigured")
	ErrTemplateNotFound        = errors.New("automation template not found")
	ErrExecutionNotFound       = errors.New("automation execution not found")
	ErrAutomationMediaNotFound = errors.New("automation media not found")
	ErrAutomationStorage       = errors.New("automation storage operation failed")
)

var uuidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

type Envelope[T any] struct {
	Data T `json:"data"`
}

type Automation struct {
	ID             string          `json:"id"`
	OrganizationID string          `json:"organization_id"`
	Name           string          `json:"name"`
	Description    *string         `json:"description"`
	IsActive       bool            `json:"is_active"`
	TriggerType    string          `json:"trigger_type"`
	TriggerConfig  json.RawMessage `json:"trigger_config"`
	FlowDefinition json.RawMessage `json:"flow_definition"`
	CreatedBy      *string         `json:"created_by"`
	CreatedAt      string          `json:"created_at"`
	UpdatedAt      string          `json:"updated_at"`
}

type AutomationNode struct {
	ID         string          `json:"id"`
	AutomationID string       `json:"automation_id"`
	NodeType   string          `json:"node_type"`
	ActionType *string         `json:"action_type"`
	Config     json.RawMessage `json:"config"`
	PositionX  float64         `json:"position_x"`
	PositionY  float64         `json:"position_y"`
	CreatedAt  string          `json:"created_at"`
}

type AutomationConnection struct {
	ID              string  `json:"id"`
	AutomationID    string  `json:"automation_id"`
	SourceNodeID    string  `json:"source_node_id"`
	TargetNodeID    string  `json:"target_node_id"`
	SourceHandle    *string `json:"source_handle"`
	ConditionBranch *string `json:"condition_branch"`
}

type AutomationWithNodes struct {
	Automation
	Nodes       []AutomationNode       `json:"nodes"`
	Connections []AutomationConnection `json:"connections"`
}

type AutomationTemplate struct {
	ID             string  `json:"id"`
	OrganizationID string `json:"organization_id"`
	Name           string `json:"name"`
	Content        string `json:"content"`
	MediaURL       *string `json:"media_url"`
	MediaType      *string `json:"media_type"`
	CreatedBy      *string `json:"created_by"`
	CreatedAt      string  `json:"created_at"`
	UpdatedAt      string  `json:"updated_at"`
}

type Ref struct {
	ID   string  `json:"id"`
	Name *string `json:"name"`
}

type AutomationExecution struct {
	ID              string          `json:"id"`
	AutomationID    *string         `json:"automation_id"`
	LeadID          *string         `json:"lead_id"`
	ConversationID  *string         `json:"conversation_id"`
	OrganizationID  string          `json:"organization_id"`
	Status          string          `json:"status"`
	CurrentNodeID   *string         `json:"current_node_id"`
	StartedAt       string          `json:"started_at"`
	CompletedAt     *string         `json:"completed_at"`
	ErrorMessage    *string         `json:"error_message"`
	ExecutionData   json.RawMessage `json:"execution_data"`
	NextExecutionAt *string         `json:"next_execution_at"`
	Lead            *Ref            `json:"lead,omitempty"`
	Automation      *Ref            `json:"automation,omitempty"`
}

type FlowDefinition struct {
	Nodes       []FlowNode       `json:"nodes"`
	Connections []FlowConnection `json:"connections"`
	Settings    map[string]any   `json:"settings"`
}

type FlowNode struct {
	ID         string          `json:"id"`
	Type       string          `json:"type"`
	ActionType *string         `json:"action_type"`
	Position   FlowPosition    `json:"position"`
	Config     json.RawMessage `json:"config"`
}

type FlowPosition struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type FlowConnection struct {
	Source          string  `json:"source"`
	Target          string  `json:"target"`
	SourceHandle    *string `json:"source_handle"`
	ConditionBranch *string `json:"condition_branch"`
}

type CreateRequest struct {
	Name           string           `json:"name"`
	Description    *string          `json:"description"`
	TriggerType    string           `json:"trigger_type"`
	TriggerConfig  *json.RawMessage `json:"trigger_config"`
	FlowDefinition *json.RawMessage `json:"flow_definition"`
}

type CreateInput struct {
	Name           string
	Description    *string
	TriggerType    string
	TriggerConfig  json.RawMessage
	FlowDefinition json.RawMessage
}

type UpdateRequest struct {
	Name           *string          `json:"name"`
	Description    *string          `json:"description"`
	IsActive       *bool            `json:"is_active"`
	TriggerType    *string          `json:"trigger_type"`
	TriggerConfig  *json.RawMessage `json:"trigger_config"`
	FlowDefinition *json.RawMessage `json:"flow_definition"`
}

type UpdateInput struct {
	Name             *string
	Description      *string
	DescriptionSet   bool
	IsActive         *bool
	TriggerType      *string
	TriggerConfig    *json.RawMessage
	FlowDefinition   *json.RawMessage
}

type SaveFlowRequest struct {
	FlowDefinition FlowDefinition `json:"flowDefinition"`
}

type SaveFlowInput struct {
	FlowDefinition FlowDefinition
	Raw            json.RawMessage
}

type CreateTemplateRequest struct {
	Name      string  `json:"name"`
	Content   string  `json:"content"`
	MediaURL  *string `json:"media_url"`
	MediaType *string `json:"media_type"`
}

type CreateTemplateInput struct {
	Name      string
	Content   string
	MediaURL  *string
	MediaType *string
}

type StartRequest struct {
	LeadID         string  `json:"leadId"`
	ConversationID *string `json:"conversationId"`
}

type StartInput struct {
	LeadID         string
	ConversationID string
}

type StartResult struct {
	ExecutionID     string `json:"executionId"`
	AutomationID    string `json:"automationId"`
	AutomationName  string `json:"automationName"`
	ExecutorStarted bool   `json:"executorStarted"`
}

type AutomationMediaFile struct {
	Name        string         `json:"name"`
	Path        string         `json:"path"`
	Bucket      string         `json:"bucket"`
	PublicURL   string         `json:"publicUrl"`
	ContentType *string        `json:"contentType"`
	Size        *int64         `json:"size"`
	Metadata    map[string]any `json:"metadata"`
	CreatedAt   *string        `json:"createdAt"`
	UpdatedAt   *string        `json:"updatedAt"`
}

type AutomationMediaUpload struct {
	AutomationMediaFile
}

type AutomationMediaUploadInput struct {
	MediaType        string
	OriginalFileName string
	ContentType      string
	Size             int64
}

func (request CreateRequest) Validate() (CreateInput, error) {
	name := strings.TrimSpace(request.Name)
	if name == "" {
		return CreateInput{}, ErrInvalidInput
	}

	triggerType := strings.TrimSpace(request.TriggerType)
	if triggerType == "" {
		triggerType = "manual"
	}
	if !validTriggerType(triggerType) {
		return CreateInput{}, ErrInvalidInput
	}

	triggerConfig, err := normalizeJSON(request.TriggerConfig, `{}`)
	if err != nil {
		return CreateInput{}, err
	}

	flowDefinition, err := normalizeJSON(request.FlowDefinition, `null`)
	if err != nil {
		return CreateInput{}, err
	}

	return CreateInput{
		Name:           name,
		Description:    cleanStringPtr(request.Description),
		TriggerType:    triggerType,
		TriggerConfig:  triggerConfig,
		FlowDefinition: flowDefinition,
	}, nil
}

func (request UpdateRequest) Validate() (UpdateInput, error) {
	input := UpdateInput{
		Description:    cleanStringPtr(request.Description),
		DescriptionSet: request.Description != nil,
		IsActive:       request.IsActive,
	}
	if request.Name != nil {
		name := strings.TrimSpace(*request.Name)
		if name == "" {
			return UpdateInput{}, ErrInvalidInput
		}
		input.Name = &name
	}
	if request.TriggerType != nil {
		triggerType := strings.TrimSpace(*request.TriggerType)
		if !validTriggerType(triggerType) {
			return UpdateInput{}, ErrInvalidInput
		}
		input.TriggerType = &triggerType
	}
	if request.TriggerConfig != nil {
		triggerConfig, err := normalizeJSON(request.TriggerConfig, `{}`)
		if err != nil {
			return UpdateInput{}, err
		}
		input.TriggerConfig = &triggerConfig
	}
	if request.FlowDefinition != nil {
		flowDefinition, err := normalizeJSON(request.FlowDefinition, `null`)
		if err != nil {
			return UpdateInput{}, err
		}
		input.FlowDefinition = &flowDefinition
	}

	return input, nil
}

func (request SaveFlowRequest) Validate() (SaveFlowInput, error) {
	if len(request.FlowDefinition.Nodes) == 0 {
		return SaveFlowInput{}, ErrInvalidInput
	}
	if request.FlowDefinition.Settings == nil {
		request.FlowDefinition.Settings = map[string]any{}
	}
	for index := range request.FlowDefinition.Nodes {
		node := &request.FlowDefinition.Nodes[index]
		if strings.TrimSpace(node.ID) == "" || !validNodeType(node.Type) {
			return SaveFlowInput{}, ErrInvalidInput
		}
		if len(node.Config) == 0 {
			node.Config = json.RawMessage(`{}`)
		}
		if !json.Valid(node.Config) {
			return SaveFlowInput{}, ErrInvalidInput
		}
	}
	for _, connection := range request.FlowDefinition.Connections {
		if strings.TrimSpace(connection.Source) == "" || strings.TrimSpace(connection.Target) == "" {
			return SaveFlowInput{}, ErrInvalidInput
		}
	}

	raw, err := json.Marshal(request.FlowDefinition)
	if err != nil {
		return SaveFlowInput{}, err
	}

	return SaveFlowInput{FlowDefinition: request.FlowDefinition, Raw: raw}, nil
}

func (request CreateTemplateRequest) Validate() (CreateTemplateInput, error) {
	name := strings.TrimSpace(request.Name)
	content := strings.TrimSpace(request.Content)
	if name == "" || content == "" {
		return CreateTemplateInput{}, ErrInvalidInput
	}

	return CreateTemplateInput{
		Name:      name,
		Content:   content,
		MediaURL:  cleanStringPtr(request.MediaURL),
		MediaType: cleanStringPtr(request.MediaType),
	}, nil
}

func (request StartRequest) Validate() (StartInput, error) {
	leadID, ok := normalizeUUID(request.LeadID)
	if !ok {
		return StartInput{}, ErrInvalidInput
	}

	input := StartInput{LeadID: leadID}
	if request.ConversationID != nil && strings.TrimSpace(*request.ConversationID) != "" {
		conversationID, ok := normalizeUUID(*request.ConversationID)
		if !ok {
			return StartInput{}, ErrInvalidInput
		}
		input.ConversationID = conversationID
	}

	return input, nil
}

func normalizeUUID(value string) (string, bool) {
	value = strings.ToLower(strings.TrimSpace(value))
	if !uuidPattern.MatchString(value) {
		return "", false
	}

	return value, true
}

func normalizeJSON(value *json.RawMessage, fallback string) (json.RawMessage, error) {
	if value == nil || len(*value) == 0 {
		return json.RawMessage(fallback), nil
	}
	if !json.Valid(*value) {
		return nil, ErrInvalidInput
	}
	out := make(json.RawMessage, len(*value))
	copy(out, *value)
	return out, nil
}

func cleanStringPtr(value *string) *string {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	return &cleaned
}

func rawJSON(value string, fallback string) json.RawMessage {
	value = strings.TrimSpace(value)
	if value == "" {
		value = fallback
	}
	if !json.Valid([]byte(value)) {
		value = fallback
	}
	return json.RawMessage(value)
}

func stringPtrFromSQL(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func timeStringPtr(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.Format(time.RFC3339)
	return &formatted
}

func validTriggerType(value string) bool {
	switch value {
	case "message_received", "scheduled", "lead_stage_changed", "lead_created", "tag_added", "inactivity", "manual":
		return true
	default:
		return false
	}
}

func validNodeType(value string) bool {
	switch value {
	case "trigger", "action", "condition", "delay":
		return true
	default:
		return false
	}
}
