package automations

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	ErrInvalidInput             = errors.New("invalid automation input")
	ErrAutomationNotFound       = errors.New("automation not found")
	ErrAutomationMisconfigured  = errors.New("automation misconfigured")
	ErrTemplateNotFound         = errors.New("automation template not found")
	ErrExecutionNotFound        = errors.New("automation execution not found")
	ErrExecutionNotCancellable  = errors.New("automation execution is not cancellable")
	ErrExecutionAlreadyActive   = errors.New("automation already has an active execution for this lead")
	ErrExecutionDispatchFailed  = errors.New("automation execution failed during initial dispatch")
	ErrFlowInUse                = errors.New("automation flow is used by a legacy active execution")
	ErrAutomationMediaNotFound  = errors.New("automation media not found")
	ErrAutomationMediaInUse     = errors.New("automation media is referenced by an active flow")
	ErrAutomationStorage        = errors.New("automation storage operation failed")
	ErrAutomationRuntime        = errors.New("automation runtime is not configured")
	ErrRuntimeIssueNotRetryable = errors.New("automation runtime issue is not safely retryable")
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
	ID           string          `json:"id"`
	AutomationID string          `json:"automation_id"`
	NodeType     string          `json:"node_type"`
	ActionType   *string         `json:"action_type"`
	Config       json.RawMessage `json:"config"`
	PositionX    float64         `json:"position_x"`
	PositionY    float64         `json:"position_y"`
	CreatedAt    string          `json:"created_at"`
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
	OrganizationID string  `json:"organization_id"`
	Name           string  `json:"name"`
	Content        string  `json:"content"`
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
	CurrentNodeKey  *string         `json:"current_node_key"`
	StartedAt       string          `json:"started_at"`
	CompletedAt     *string         `json:"completed_at"`
	ErrorMessage    *string         `json:"error_message"`
	ExecutionData   json.RawMessage `json:"execution_data"`
	NextExecutionAt *string         `json:"next_execution_at"`
	Lead            *Ref            `json:"lead,omitempty"`
	Automation      *Ref            `json:"automation,omitempty"`
}

type AutomationExecutionStep struct {
	ID           string  `json:"id"`
	ExecutionID  string  `json:"execution_id"`
	NodeKey      string  `json:"node_key"`
	NodeType     string  `json:"node_type"`
	ActionType   *string `json:"action_type"`
	Status       string  `json:"status"`
	Attempt      int     `json:"attempt"`
	StartedAt    string  `json:"started_at"`
	CompletedAt  *string `json:"completed_at"`
	ErrorMessage *string `json:"error_message"`
}

type AutomationExecutionSummary struct {
	AutomationID       string   `json:"automationId"`
	Total              int      `json:"total"`
	Queued             int      `json:"queued"`
	Running            int      `json:"running"`
	Waiting            int      `json:"waiting"`
	Completed          int      `json:"completed"`
	Failed             int      `json:"failed"`
	Cancelled          int      `json:"cancelled"`
	ActiveExecutionIDs []string `json:"activeExecutionIds"`
	ActiveIDsTruncated bool     `json:"activeIdsTruncated"`
	LastStartedAt      *string  `json:"lastStartedAt"`
}

type RuntimeIssueSummary struct {
	DeadLetters         int `json:"deadLetters"`
	FailedEvents        int `json:"failedEvents"`
	FailedEffects       int `json:"failedEffects"`
	OpenCircuits        int `json:"openCircuits"`
	DuplicateDecisions  int `json:"duplicateDecisions"`
	UnknownEffects      int `json:"unknownEffects"`
	StaleSendingEffects int `json:"staleSendingEffects"`
}

type RuntimeIssue struct {
	ID             string          `json:"id"`
	Kind           string          `json:"kind"`
	Severity       string          `json:"severity"`
	Status         string          `json:"status"`
	AutomationID   *string         `json:"automationId"`
	AutomationName *string         `json:"automationName"`
	ExecutionID    *string         `json:"executionId"`
	LeadID         *string         `json:"leadId"`
	Message        *string         `json:"message"`
	Details        json.RawMessage `json:"details"`
	Retryable      bool            `json:"retryable"`
	OccurredAt     string          `json:"occurredAt"`
}

type RuntimeIssuesResult struct {
	Summary RuntimeIssueSummary `json:"summary"`
	Issues  []RuntimeIssue      `json:"issues"`
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
	IsActive       *bool            `json:"is_active"`
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
	ParsedFlow     *FlowDefinition
	IsActive       bool
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
	Name           *string
	Description    *string
	DescriptionSet bool
	IsActive       *bool
	TriggerType    *string
	TriggerConfig  *json.RawMessage
	FlowDefinition *json.RawMessage
}

type SaveFlowRequest struct {
	FlowDefinition FlowDefinition `json:"flowDefinition"`
	Name           *string        `json:"name"`
	Description    *string        `json:"description"`
	IsActive       *bool          `json:"isActive"`
}

type SaveFlowInput struct {
	FlowDefinition FlowDefinition
	Raw            json.RawMessage
	Name           *string
	Description    *string
	IsActive       *bool
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
	Status          string `json:"status"`
	DispatchPending bool   `json:"dispatchPending"`
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

type AutomationMediaPage struct {
	Files      []AutomationMediaFile `json:"files"`
	NextOffset *int                  `json:"nextOffset"`
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
	if name == "" || len(name) > 180 {
		return CreateInput{}, ErrInvalidInput
	}
	description := cleanStringPtr(request.Description)
	if description != nil && len(*description) > 2000 {
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
	var parsedFlow *FlowDefinition
	if string(flowDefinition) != "null" {
		var flow FlowDefinition
		if err := json.Unmarshal(flowDefinition, &flow); err != nil {
			return CreateInput{}, invalidFlow("flow_definition must be a valid flow object")
		}
		if err := validateFlowDefinition(&flow); err != nil {
			return CreateInput{}, err
		}
		flowDefinition, err = json.Marshal(flow)
		if err != nil {
			return CreateInput{}, err
		}
		triggerType, triggerConfig, _ = publishedFlowMetadata(flow)
		parsedFlow = &flow
	} else if request.IsActive != nil && *request.IsActive {
		return CreateInput{}, invalidFlow("an automation cannot be active before an atomic flow is published")
	}

	return CreateInput{
		Name:           name,
		Description:    description,
		TriggerType:    triggerType,
		TriggerConfig:  triggerConfig,
		FlowDefinition: flowDefinition,
		ParsedFlow:     parsedFlow,
		IsActive:       request.IsActive != nil && *request.IsActive,
	}, nil
}

func (request UpdateRequest) Validate() (UpdateInput, error) {
	if request.TriggerType != nil || request.TriggerConfig != nil || request.FlowDefinition != nil {
		return UpdateInput{}, invalidFlow("trigger and flow changes must use the atomic flow publish endpoint")
	}
	input := UpdateInput{
		Description:    cleanStringPtr(request.Description),
		DescriptionSet: request.Description != nil,
		IsActive:       request.IsActive,
	}
	if input.Description != nil && len(*input.Description) > 2000 {
		return UpdateInput{}, ErrInvalidInput
	}
	if request.Name != nil {
		name := strings.TrimSpace(*request.Name)
		if name == "" || len(name) > 180 {
			return UpdateInput{}, ErrInvalidInput
		}
		input.Name = &name
	}
	return input, nil
}

func (request SaveFlowRequest) Validate() (SaveFlowInput, error) {
	if err := validateFlowDefinition(&request.FlowDefinition); err != nil {
		return SaveFlowInput{}, err
	}

	raw, err := json.Marshal(request.FlowDefinition)
	if err != nil {
		return SaveFlowInput{}, err
	}

	var name *string
	if request.Name != nil {
		cleaned := strings.TrimSpace(*request.Name)
		if cleaned == "" || len(cleaned) > 180 {
			return SaveFlowInput{}, ErrInvalidInput
		}
		name = &cleaned
	}
	description := cleanStringPtr(request.Description)
	if description != nil && len(*description) > 2000 {
		return SaveFlowInput{}, ErrInvalidInput
	}

	return SaveFlowInput{
		FlowDefinition: request.FlowDefinition,
		Raw:            raw,
		Name:           name,
		Description:    description,
		IsActive:       request.IsActive,
	}, nil
}

const (
	maxFlowNodes       = 250
	maxFlowConnections = 500
	maxDelaySeconds    = 30 * 24 * 60 * 60
)

func validateFlowDefinition(flow *FlowDefinition) error {
	if flow == nil || len(flow.Nodes) == 0 || len(flow.Nodes) > maxFlowNodes || len(flow.Connections) > maxFlowConnections {
		return invalidFlow("flow size is outside the supported limits")
	}
	if flow.Settings == nil {
		flow.Settings = map[string]any{}
	}

	nodes := make(map[string]FlowNode, len(flow.Nodes))
	triggerID := ""
	for index := range flow.Nodes {
		node := &flow.Nodes[index]
		node.ID = strings.TrimSpace(node.ID)
		node.Type = strings.ToLower(strings.TrimSpace(node.Type))
		if node.ID == "" || len(node.ID) > 200 || !validNodeType(node.Type) {
			return invalidFlow("node id or type is invalid")
		}
		if _, exists := nodes[node.ID]; exists {
			return invalidFlow("node ids must be unique")
		}
		if len(node.Config) == 0 || string(node.Config) == "null" {
			node.Config = json.RawMessage(`{}`)
		}
		if len(node.Config) > 64*1024 {
			return invalidFlow("node config exceeds the 64 KiB limit")
		}
		var config map[string]any
		if !json.Valid(node.Config) || json.Unmarshal(node.Config, &config) != nil || config == nil {
			return invalidFlow("node config must be a JSON object")
		}

		switch node.Type {
		case "trigger":
			if node.ActionType != nil && strings.TrimSpace(*node.ActionType) != "" {
				return invalidFlow("trigger nodes cannot define action_type")
			}
			if triggerID != "" {
				return invalidFlow("a flow must have exactly one trigger")
			}
			triggerID = node.ID
			if err := validateTriggerConfig(config); err != nil {
				return err
			}
		case "action":
			if node.ActionType == nil || strings.TrimSpace(*node.ActionType) == "" {
				return invalidFlow("action nodes require action_type")
			}
			actionType := strings.ToLower(strings.TrimSpace(*node.ActionType))
			node.ActionType = &actionType
			if err := validateActionConfig(actionType, config); err != nil {
				return err
			}
		case "delay":
			if node.ActionType != nil && strings.TrimSpace(*node.ActionType) != "" {
				return invalidFlow("delay nodes cannot define action_type")
			}
			if err := validateDelayConfig(config); err != nil {
				return err
			}
		case "condition":
			if node.ActionType != nil && strings.TrimSpace(*node.ActionType) != "" {
				return invalidFlow("condition nodes cannot define action_type")
			}
			if err := validateConditionConfig(config); err != nil {
				return err
			}
		}
		nodes[node.ID] = *node
	}
	if triggerID == "" {
		return invalidFlow("a flow must have exactly one trigger")
	}

	adjacency := make(map[string][]string, len(nodes))
	incoming := make(map[string]int, len(nodes))
	branches := make(map[string]map[string]struct{}, len(nodes))
	connections := make(map[string]struct{}, len(flow.Connections))
	for index := range flow.Connections {
		connection := &flow.Connections[index]
		connection.Source = strings.TrimSpace(connection.Source)
		connection.Target = strings.TrimSpace(connection.Target)
		if _, ok := nodes[connection.Source]; !ok {
			return invalidFlow("connection source does not exist")
		}
		if _, ok := nodes[connection.Target]; !ok {
			return invalidFlow("connection target does not exist")
		}
		if connection.Source == connection.Target {
			return invalidFlow("self connections are not allowed")
		}
		branch := connectionBranch(*connection)
		if connection.SourceHandle != nil && connection.ConditionBranch != nil &&
			strings.TrimSpace(*connection.SourceHandle) != strings.TrimSpace(*connection.ConditionBranch) {
			return invalidFlow("source_handle and condition_branch must match")
		}
		key := connection.Source + "\x00" + connection.Target + "\x00" + branch
		if _, exists := connections[key]; exists {
			return invalidFlow("duplicate connections are not allowed")
		}
		connections[key] = struct{}{}
		adjacency[connection.Source] = append(adjacency[connection.Source], connection.Target)
		incoming[connection.Target]++
		if branches[connection.Source] == nil {
			branches[connection.Source] = map[string]struct{}{}
		}
		if branch != "" {
			branches[connection.Source][branch] = struct{}{}
		}
	}
	if incoming[triggerID] != 0 || len(adjacency[triggerID]) != 1 {
		return invalidFlow("the trigger must be the root and have exactly one output")
	}

	terminalCount := 0
	for id, node := range nodes {
		outgoing := len(adjacency[id])
		switch node.Type {
		case "condition":
			if outgoing != 2 || !hasExactBranches(branches[id], "true", "false") {
				return invalidFlow("condition nodes require true and false branches")
			}
		case "delay":
			config := flowNodeConfig(node)
			if boolConfig(config, "stop_on_reply") {
				if outgoing != 2 || !hasExactBranches(branches[id], "no_reply", "replied") {
					return invalidFlow("reply-aware delays require no_reply and replied branches")
				}
			} else if outgoing > 1 {
				return invalidFlow("delay nodes may have only one output")
			}
		default:
			if outgoing > 1 {
				return invalidFlow("trigger and action nodes may have only one output")
			}
		}
		if outgoing == 0 {
			terminalCount++
		}
	}
	if terminalCount == 0 {
		return invalidFlow("the flow must have a terminal node")
	}

	color := make(map[string]uint8, len(nodes))
	visited := make(map[string]bool, len(nodes))
	var visit func(string) error
	visit = func(id string) error {
		if color[id] == 1 {
			return invalidFlow("cycles are not allowed")
		}
		if color[id] == 2 {
			return nil
		}
		color[id] = 1
		visited[id] = true
		for _, target := range adjacency[id] {
			if err := visit(target); err != nil {
				return err
			}
		}
		color[id] = 2
		return nil
	}
	if err := visit(triggerID); err != nil {
		return err
	}
	if len(visited) != len(nodes) {
		return invalidFlow("all nodes must be reachable from the trigger")
	}

	return nil
}

func validateTriggerConfig(config map[string]any) error {
	triggerType := stringConfig(config, "trigger_type")
	if !validTriggerType(triggerType) {
		return invalidFlow("trigger_type is invalid")
	}
	for _, key := range []string{"tag_id", "pipeline_id", "to_stage_id", "session_id"} {
		if value := stringConfig(config, key); value != "" {
			if _, ok := normalizeUUID(value); !ok {
				return invalidFlow(key + " must be a uuid")
			}
		}
	}
	if value := stringConfig(config, "filter_user_id"); value != "" && value != "__me__" {
		if _, ok := normalizeUUID(value); !ok {
			return invalidFlow("filter_user_id must be a uuid")
		}
	}
	switch triggerType {
	case "tag_added":
		return requireUUIDConfig(config, "tag_id")
	case "lead_stage_changed":
		if err := requireUUIDConfig(config, "pipeline_id"); err != nil {
			return err
		}
		return requireUUIDConfig(config, "to_stage_id")
	case "scheduled":
		scheduledAt := stringConfig(config, "scheduled_at")
		timezone := stringConfig(config, "timezone")
		scheduledTime, err := time.Parse(time.RFC3339, scheduledAt)
		if err != nil {
			return invalidFlow("scheduled_at must be an ISO 8601 datetime with offset")
		}
		if !scheduledTime.After(time.Now().UTC().Add(time.Minute)) {
			return invalidFlow("scheduled_at must be at least one minute in the future")
		}
		if timezone == "" {
			return invalidFlow("timezone is required for scheduled triggers")
		}
		location, err := time.LoadLocation(timezone)
		if err != nil {
			return invalidFlow("timezone must be a valid IANA timezone")
		}
		_, providedOffset := scheduledTime.Zone()
		_, expectedOffset := scheduledTime.In(location).Zone()
		if providedOffset != expectedOffset {
			return invalidFlow("scheduled_at offset does not match timezone at that date")
		}
		if stringConfig(config, "target_type") != "lead" {
			return invalidFlow("scheduled triggers currently require target_type=lead")
		}
		if err := requireUUIDConfig(config, "target_lead_id"); err != nil {
			return err
		}
	case "inactivity":
		value := integerConfig(config, "inactivity_value")
		unit := stringConfig(config, "inactivity_unit")
		validDuration := (unit == "hours" && value >= 1 && value <= 8760) ||
			(unit == "days" && value >= 1 && value <= 365)
		if !validDuration {
			return invalidFlow("inactivity trigger duration is invalid")
		}
	}
	return nil
}

func validateActionConfig(actionType string, config map[string]any) error {
	switch actionType {
	case "send_whatsapp":
		if err := requireUUIDConfig(config, "session_id"); err != nil {
			return err
		}
		message := stringConfig(config, "message")
		if message == "" || len(message) > 4000 {
			return invalidFlow("WhatsApp message must contain 1 to 4000 characters")
		}
	case "send_image", "send_audio", "send_video":
		if err := requireUUIDConfig(config, "session_id"); err != nil {
			return err
		}
		if stringConfig(config, "media_bucket") != automationMediaBucket || !validAutomationMediaPath(stringConfig(config, "media_path")) {
			return invalidFlow("media actions require media_bucket=automation-media and a canonical media_path")
		}
		if len(stringConfig(config, "caption")) > 4000 || len(stringConfig(config, "filename")) > 255 || len(stringConfig(config, "mimetype")) > 100 {
			return invalidFlow("media caption, filename or mimetype exceeds the supported limit")
		}
	case "webhook":
		if len(stringConfig(config, "webhook_url")) > 2048 || !validHTTPSURL(stringConfig(config, "webhook_url")) {
			return invalidFlow("webhook_url must be a public https URL")
		}
		method := strings.ToUpper(stringConfig(config, "method"))
		if method == "" {
			method = "POST"
		}
		if method != "POST" && method != "PUT" && method != "PATCH" {
			return invalidFlow("webhook method is invalid")
		}
	case "add_tag", "remove_tag":
		return requireUUIDConfig(config, "tag_id")
	case "move_lead":
		if err := requireUUIDConfig(config, "stage_id"); err != nil {
			return err
		}
		if pipelineID := stringConfig(config, "pipeline_id"); pipelineID != "" {
			if _, ok := normalizeUUID(pipelineID); !ok {
				return invalidFlow("pipeline_id must be a uuid")
			}
		}
	case "assign_user":
		return invalidFlow("assign_user automation requires the canonical Leads command service and is not publishable yet")
	case "set_variable":
		switch stringConfig(config, "actionType") {
		case "property_interest":
			return invalidFlow("property_interest automation requires the canonical Leads command service and is not publishable yet")
		case "deal_status":
			return invalidFlow("deal_status automation requires the canonical lead service and is not publishable yet")
		default:
			return invalidFlow("set_variable action is not supported")
		}
	default:
		return invalidFlow("action_type is not supported")
	}
	return nil
}

func validateDelayConfig(config map[string]any) error {
	value := integerConfig(config, "delay_value")
	unit := stringConfig(config, "delay_type")
	multiplier := map[string]int{"seconds": 1, "minutes": 60, "hours": 3600, "days": 86400}[unit]
	if value < 1 || multiplier == 0 || value > maxDelaySeconds/multiplier {
		return invalidFlow("delay duration is invalid")
	}
	matchMode := strings.ToLower(stringConfig(config, "reply_match_mode"))
	if matchMode != "" && matchMode != "any_text" && matchMode != "keywords" {
		return invalidFlow("reply_match_mode must be any_text or keywords")
	}
	if matchMode == "keywords" {
		rawKeywords, ok := config["expected_reply_keywords"].([]any)
		if !ok || len(rawKeywords) == 0 || len(rawKeywords) > 50 {
			return invalidFlow("keyword reply matching requires 1 to 50 keywords")
		}
		for _, rawKeyword := range rawKeywords {
			keyword, ok := rawKeyword.(string)
			if !ok || strings.TrimSpace(keyword) == "" || len(strings.TrimSpace(keyword)) > 120 {
				return invalidFlow("reply keywords must contain 1 to 120 characters")
			}
		}
	}
	if rawBurstLimit, exists := config["handoff_after_message_burst"]; exists && rawBurstLimit != nil {
		burstLimit := integerConfig(config, "handoff_after_message_burst")
		if burstLimit < 0 || burstLimit > 20 {
			return invalidFlow("handoff_after_message_burst must be between 0 and 20")
		}
	}
	return nil
}

func validateConditionConfig(config map[string]any) error {
	conditionType := stringConfig(config, "condition_type")
	if conditionType == "response_sentiment" {
		if stringConfig(config, "positive_keywords") == "" && stringConfig(config, "negative_keywords") == "" {
			return invalidFlow("response sentiment requires at least one keyword list")
		}
		return nil
	}
	if conditionType != "custom" || stringConfig(config, "variable") == "" {
		return invalidFlow("condition configuration is invalid")
	}
	operator := stringConfig(config, "operator")
	for _, allowed := range []string{"equals", "not_equals", "contains", "not_contains", "greater_than", "less_than", "is_set", "is_not_set"} {
		if operator == allowed {
			return nil
		}
	}
	return invalidFlow("condition operator is invalid")
}

func invalidFlow(reason string) error {
	return fmt.Errorf("%w: %s", ErrInvalidInput, reason)
}

func flowNodeConfig(node FlowNode) map[string]any {
	var config map[string]any
	_ = json.Unmarshal(node.Config, &config)
	return config
}

func connectionBranch(connection FlowConnection) string {
	if connection.ConditionBranch != nil {
		return strings.TrimSpace(*connection.ConditionBranch)
	}
	if connection.SourceHandle != nil {
		return strings.TrimSpace(*connection.SourceHandle)
	}
	return ""
}

func hasExactBranches(branches map[string]struct{}, expected ...string) bool {
	if len(branches) != len(expected) {
		return false
	}
	for _, branch := range expected {
		if _, ok := branches[branch]; !ok {
			return false
		}
	}
	return true
}

func stringConfig(config map[string]any, key string) string {
	value, ok := config[key]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func integerConfig(config map[string]any, key string) int {
	value := stringConfig(config, key)
	number, _ := strconv.Atoi(value)
	return number
}

func boolConfig(config map[string]any, key string) bool {
	value, _ := config[key].(bool)
	return value
}

func requireUUIDConfig(config map[string]any, key string) error {
	if _, ok := normalizeUUID(stringConfig(config, key)); !ok {
		return invalidFlow(key + " must be a uuid")
	}
	return nil
}

func validHTTPSURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || (parsed.Port() != "" && parsed.Port() != "443") {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") {
		return false
	}
	if ip := net.ParseIP(host); ip != nil {
		if !ip.IsGlobalUnicast() || ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			return false
		}
		if v4 := ip.To4(); v4 != nil {
			if (v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127) ||
				(v4[0] == 192 && (v4[1] == 0 || v4[1] == 2)) ||
				(v4[0] == 198 && (v4[1] == 18 || v4[1] == 19 || (v4[1] == 51 && v4[2] == 100))) ||
				(v4[0] == 203 && v4[1] == 0 && v4[2] == 113) {
				return false
			}
		} else if strings.HasPrefix(strings.ToLower(ip.String()), "2001:db8:") {
			return false
		}
	}
	return true
}

func validAutomationMediaPath(value string) bool {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if value == "" || strings.HasPrefix(value, "/") || strings.Contains(value, "..") {
		return false
	}
	parts := strings.Split(value, "/")
	if len(parts) != 3 || parts[0] == "" || parts[2] == "" {
		return false
	}
	if _, ok := normalizeUUID(parts[0]); !ok {
		return false
	}
	return parts[1] == "images" || parts[1] == "audios" || parts[1] == "videos"
}

func (request CreateTemplateRequest) Validate() (CreateTemplateInput, error) {
	name := strings.TrimSpace(request.Name)
	content := strings.TrimSpace(request.Content)
	mediaURL := cleanStringPtr(request.MediaURL)
	mediaType := cleanStringPtr(request.MediaType)
	if name == "" || len(name) > 180 || content == "" || len(content) > 10000 ||
		(mediaURL != nil && len(*mediaURL) > 4000) || (mediaType != nil && len(*mediaType) > 80) {
		return CreateTemplateInput{}, ErrInvalidInput
	}

	return CreateTemplateInput{
		Name:      name,
		Content:   content,
		MediaURL:  mediaURL,
		MediaType: mediaType,
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
