package stageconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

var (
	ErrInvalidInput = errors.New("invalid stage config input")
	ErrNotFound     = errors.New("stage config resource not found")
	ErrNoChanges    = errors.New("no stage config changes provided")
)

type Envelope[T any] struct {
	Data T `json:"data"`
}

type StageAutomation struct {
	ID             string `json:"id"`
	OrganizationID string `json:"organization_id"`
	StageID        string `json:"stage_id"`
	TriggerType    string `json:"trigger_type"`
	Config         any    `json:"config"`
	IsActive       bool   `json:"is_active"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}

type StageAutomationRequest struct {
	StageID          string         `json:"stage_id,omitempty"`
	AutomationType   string         `json:"automation_type"`
	TriggerDays      *int           `json:"trigger_days"`
	TargetStageID    *string        `json:"target_stage_id"`
	WhatsAppTemplate *string        `json:"whatsapp_template"`
	AlertMessage     *string        `json:"alert_message"`
	TargetUserID     *string        `json:"target_user_id"`
	DealStatus       *string        `json:"deal_status"`
	ActionConfig     map[string]any `json:"action_config"`
	IsActive         *bool          `json:"is_active,omitempty"`
}

type StageAutomationStatusRequest struct {
	IsActive bool `json:"is_active"`
}

type stageAutomationInput struct {
	StageID     string
	TriggerType string
	Config      map[string]any
	IsActive    bool
}

type StageOperationalConfig struct {
	ID                           string    `json:"id,omitempty"`
	OrganizationID               string    `json:"organization_id"`
	StageID                      string    `json:"stage_id"`
	OperationContext             string    `json:"operation_context"`
	ResponsibleSector            *string   `json:"responsible_sector"`
	SLAHours                     int       `json:"sla_hours"`
	AutomaticTasks               any       `json:"automatic_tasks"`
	AutomaticNotifications       any       `json:"automatic_notifications"`
	AutomaticOperationalRequests any       `json:"automatic_operational_requests"`
	ChecklistTemplate            any       `json:"checklist_template"`
	ApprovalFlow                 any       `json:"approval_flow"`
	DashboardDestination         *string   `json:"dashboard_destination"`
	VisibilityRules              any       `json:"visibility_rules"`
	Stage                        *StageRef `json:"stage"`
}

type StageRef struct {
	ID         string  `json:"id,omitempty"`
	Name       string  `json:"name"`
	PipelineID *string `json:"pipeline_id,omitempty"`
}

type StageOperationalConfigRequest struct {
	StageID                      string           `json:"stage_id"`
	OperationContext             *string          `json:"operation_context,omitempty"`
	ResponsibleSector            *string          `json:"responsible_sector,omitempty"`
	SLAHours                     *int             `json:"sla_hours,omitempty"`
	AutomaticTasks               *json.RawMessage `json:"automatic_tasks,omitempty"`
	AutomaticNotifications       *json.RawMessage `json:"automatic_notifications,omitempty"`
	AutomaticOperationalRequests *json.RawMessage `json:"automatic_operational_requests,omitempty"`
	ChecklistTemplate            *json.RawMessage `json:"checklist_template,omitempty"`
	ApprovalFlow                 *json.RawMessage `json:"approval_flow,omitempty"`
	DashboardDestination         *string          `json:"dashboard_destination,omitempty"`
	VisibilityRules              *json.RawMessage `json:"visibility_rules,omitempty"`
}

func (request StageAutomationRequest) Validate(requireStage bool) (stageAutomationInput, error) {
	input := stageAutomationInput{
		StageID:  strings.TrimSpace(request.StageID),
		IsActive: true,
	}
	if requireStage && input.StageID == "" {
		return stageAutomationInput{}, fmt.Errorf("%w: stage_id is required", ErrInvalidInput)
	}
	if input.StageID != "" {
		stageID, ok := normalizeUUID(input.StageID)
		if !ok {
			return stageAutomationInput{}, fmt.Errorf("%w: stage_id is invalid", ErrInvalidInput)
		}
		input.StageID = stageID
	}
	if request.IsActive != nil {
		input.IsActive = *request.IsActive
	}

	automationType := strings.TrimSpace(request.AutomationType)
	switch automationType {
	case "alert_on_inactivity":
		input.TriggerType = "inactivity"
	case "change_assignee_on_enter", "change_deal_status_on_enter":
		input.TriggerType = "on_enter"
	default:
		return stageAutomationInput{}, fmt.Errorf("%w: automation_type is invalid", ErrInvalidInput)
	}

	actionConfig := map[string]any{}
	for key, value := range request.ActionConfig {
		if value == nil {
			continue
		}
		if text, ok := value.(string); ok {
			text = strings.TrimSpace(text)
			if text == "" {
				continue
			}
			actionConfig[key] = text
			continue
		}
		actionConfig[key] = value
	}

	if request.TargetStageID != nil {
		targetStageID := cleanString(request.TargetStageID)
		if targetStageID != nil {
			normalized, ok := normalizeUUID(*targetStageID)
			if !ok {
				return stageAutomationInput{}, fmt.Errorf("%w: target_stage_id is invalid", ErrInvalidInput)
			}
			request.TargetStageID = &normalized
		}
	}

	switch automationType {
	case "change_assignee_on_enter":
		targetUserID, err := requiredAutomationConfigString(actionConfig, "target_user_id", request.TargetUserID)
		if err != nil {
			return stageAutomationInput{}, err
		}
		normalized, ok := normalizeUUID(targetUserID)
		if !ok {
			return stageAutomationInput{}, fmt.Errorf("%w: target_user_id is invalid", ErrInvalidInput)
		}
		actionConfig["target_user_id"] = normalized
	case "change_deal_status_on_enter":
		dealStatus, err := requiredAutomationConfigString(actionConfig, "deal_status", request.DealStatus)
		if err != nil {
			return stageAutomationInput{}, err
		}
		dealStatus = strings.ToLower(dealStatus)
		if dealStatus != "open" && dealStatus != "won" && dealStatus != "lost" {
			return stageAutomationInput{}, fmt.Errorf("%w: deal_status is invalid", ErrInvalidInput)
		}
		actionConfig["deal_status"] = dealStatus
	case "alert_on_inactivity":
		if request.TriggerDays != nil && (*request.TriggerDays < 1 || *request.TriggerDays > 3650) {
			return stageAutomationInput{}, fmt.Errorf("%w: trigger_days must be between 1 and 3650", ErrInvalidInput)
		}
	}

	var actionConfigValue any
	if len(actionConfig) > 0 {
		actionConfigValue = actionConfig
	}

	input.Config = map[string]any{
		"automation_type":   automationType,
		"action_type":       automationType,
		"trigger_days":      request.TriggerDays,
		"target_stage_id":   cleanString(request.TargetStageID),
		"whatsapp_template": cleanString(request.WhatsAppTemplate),
		"alert_message":     cleanString(request.AlertMessage),
		"action_config":     actionConfigValue,
	}

	return input, nil
}

func requiredAutomationConfigString(actionConfig map[string]any, key string, fallback *string) (string, error) {
	configured := ""
	if value, exists := actionConfig[key]; exists {
		text, ok := value.(string)
		if !ok {
			return "", fmt.Errorf("%w: %s must be a string", ErrInvalidInput, key)
		}
		configured = strings.TrimSpace(text)
	}
	fallbackValue := cleanString(fallback)
	if configured != "" && fallbackValue != nil && configured != *fallbackValue {
		return "", fmt.Errorf("%w: conflicting %s values", ErrInvalidInput, key)
	}
	if configured == "" && fallbackValue != nil {
		configured = *fallbackValue
	}
	if configured == "" {
		return "", fmt.Errorf("%w: %s is required", ErrInvalidInput, key)
	}
	return configured, nil
}

func (request StageOperationalConfigRequest) Validate() (StageOperationalConfigRequest, error) {
	request.StageID = strings.TrimSpace(request.StageID)
	if request.StageID == "" {
		return StageOperationalConfigRequest{}, fmt.Errorf("%w: stage_id is required", ErrInvalidInput)
	}

	if request.OperationContext != nil {
		value := strings.TrimSpace(*request.OperationContext)
		if !isOperationContext(value) {
			return StageOperationalConfigRequest{}, fmt.Errorf("%w: operation_context is invalid", ErrInvalidInput)
		}
		request.OperationContext = &value
	}
	if request.SLAHours != nil && *request.SLAHours < 0 {
		return StageOperationalConfigRequest{}, fmt.Errorf("%w: sla_hours is invalid", ErrInvalidInput)
	}
	request.ResponsibleSector = cleanString(request.ResponsibleSector)
	request.DashboardDestination = cleanString(request.DashboardDestination)

	return request, nil
}

func isOperationContext(value string) bool {
	switch value {
	case "comercial", "financeiro", "arquitetura", "compras", "documental", "juridico", "pos-venda":
		return true
	default:
		return false
	}
}

func cleanString(value *string) *string {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	return &cleaned
}
