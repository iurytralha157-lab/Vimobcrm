package attention

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var (
	ErrInvalidInput = errors.New("invalid attention input")
	ErrNotFound     = errors.New("attention resource not found")
	ErrForbidden    = errors.New("attention access denied")
)

type Envelope[T any] struct {
	Data T `json:"data"`
}

type Policy struct {
	ID                     string         `json:"id"`
	OrganizationID         string         `json:"organizationId"`
	PolicyKey              string         `json:"policyKey"`
	Version                int            `json:"version"`
	Name                   string         `json:"name"`
	PolicyType             string         `json:"policyType"`
	Status                 string         `json:"status"`
	PipelineID             *string        `json:"pipelineId,omitempty"`
	PipelineName           *string        `json:"pipelineName,omitempty"`
	StageID                *string        `json:"stageId,omitempty"`
	StageName              *string        `json:"stageName,omitempty"`
	ThresholdMinutes       int            `json:"thresholdMinutes"`
	WarningMinutes         int            `json:"warningMinutes"`
	RepeatMinutes          *int           `json:"repeatMinutes,omitempty"`
	EscalationMinutes      *int           `json:"escalationMinutes,omitempty"`
	RedistributionMinutes  *int           `json:"redistributionMinutes,omitempty"`
	BusinessHoursOnly      bool           `json:"businessHoursOnly"`
	RedistributeBeforeOnly bool           `json:"redistributeBeforeContactOnly"`
	NotifyAssignee         bool           `json:"notifyAssignee"`
	NotifyLeaders          bool           `json:"notifyLeaders"`
	NotifyAdmins           bool           `json:"notifyAdmins"`
	Config                 map[string]any `json:"config"`
	CreatedBy              *string        `json:"createdBy,omitempty"`
	CreatedAt              time.Time      `json:"createdAt"`
	UpdatedAt              time.Time      `json:"updatedAt"`
}

type PolicyRequest struct {
	Name                          *string        `json:"name,omitempty"`
	PolicyType                    *string        `json:"policyType,omitempty"`
	Status                        *string        `json:"status,omitempty"`
	PipelineID                    *string        `json:"pipelineId,omitempty"`
	StageID                       *string        `json:"stageId,omitempty"`
	ThresholdMinutes              *int           `json:"thresholdMinutes,omitempty"`
	WarningMinutes                *int           `json:"warningMinutes,omitempty"`
	RepeatMinutes                 *int           `json:"repeatMinutes,omitempty"`
	EscalationMinutes             *int           `json:"escalationMinutes,omitempty"`
	RedistributionMinutes         *int           `json:"redistributionMinutes,omitempty"`
	BusinessHoursOnly             *bool          `json:"businessHoursOnly,omitempty"`
	RedistributeBeforeContactOnly *bool          `json:"redistributeBeforeContactOnly,omitempty"`
	NotifyAssignee                *bool          `json:"notifyAssignee,omitempty"`
	NotifyLeaders                 *bool          `json:"notifyLeaders,omitempty"`
	NotifyAdmins                  *bool          `json:"notifyAdmins,omitempty"`
	Config                        map[string]any `json:"config,omitempty"`
}

type policyInput struct {
	Name                          string
	PolicyType                    string
	Status                        string
	PipelineID                    *string
	StageID                       *string
	ThresholdMinutes              int
	WarningMinutes                int
	RepeatMinutes                 *int
	EscalationMinutes             *int
	RedistributionMinutes         *int
	BusinessHoursOnly             bool
	RedistributeBeforeContactOnly bool
	NotifyAssignee                bool
	NotifyLeaders                 bool
	NotifyAdmins                  bool
	Config                        map[string]any
}

type Item struct {
	ID                     string         `json:"id"`
	OrganizationID         string         `json:"organizationId"`
	LeadID                 string         `json:"leadId"`
	LeadName               string         `json:"leadName"`
	PolicyID               string         `json:"policyId"`
	PolicyName             string         `json:"policyName"`
	PolicyType             string         `json:"policyType"`
	PolicyStatus           string         `json:"policyStatus"`
	PolicyVersion          int            `json:"policyVersion"`
	Status                 string         `json:"status"`
	Shadow                 bool           `json:"shadow"`
	AssignedUserID         *string        `json:"assignedUserId,omitempty"`
	AssignedUserName       *string        `json:"assignedUserName,omitempty"`
	PipelineID             *string        `json:"pipelineId,omitempty"`
	PipelineName           *string        `json:"pipelineName,omitempty"`
	StageID                *string        `json:"stageId,omitempty"`
	StageName              *string        `json:"stageName,omitempty"`
	CycleKey               string         `json:"cycleKey"`
	BaselineAt             time.Time      `json:"baselineAt"`
	LastValidActionAt      *time.Time     `json:"lastValidActionAt,omitempty"`
	WarningAt              *time.Time     `json:"warningAt,omitempty"`
	DueAt                  time.Time      `json:"dueAt"`
	NextEvaluationAt       *time.Time     `json:"nextEvaluationAt,omitempty"`
	WarningSentAt          *time.Time     `json:"warningSentAt,omitempty"`
	BreachedAt             *time.Time     `json:"breachedAt,omitempty"`
	EscalatedAt            *time.Time     `json:"escalatedAt,omitempty"`
	LastReminderAt         *time.Time     `json:"lastReminderAt,omitempty"`
	ReminderCount          int            `json:"reminderCount"`
	AcknowledgedAt         *time.Time     `json:"acknowledgedAt,omitempty"`
	AcknowledgedBy         *string        `json:"acknowledgedBy,omitempty"`
	SnoozedUntil           *time.Time     `json:"snoozedUntil,omitempty"`
	ResolvedAt             *time.Time     `json:"resolvedAt,omitempty"`
	ResolvedBy             *string        `json:"resolvedBy,omitempty"`
	ResolutionReason       *string        `json:"resolutionReason,omitempty"`
	RedistributedAt        *time.Time     `json:"redistributedAt,omitempty"`
	RedistributionAttempts int            `json:"redistributionAttempts"`
	Metadata               map[string]any `json:"metadata"`
	CreatedAt              time.Time      `json:"createdAt"`
	UpdatedAt              time.Time      `json:"updatedAt"`
}

type ItemPage struct {
	Items      []Item  `json:"items"`
	NextCursor *string `json:"nextCursor,omitempty"`
}

type Summary struct {
	Total           int `json:"total"`
	Monitoring      int `json:"monitoring"`
	Warning         int `json:"warning"`
	Breached        int `json:"breached"`
	Escalated       int `json:"escalated"`
	Acknowledged    int `json:"acknowledged"`
	DueToday        int `json:"dueToday"`
	Overdue         int `json:"overdue"`
	Unassigned      int `json:"unassigned"`
	FirstContact    int `json:"firstContact"`
	StageInactivity int `json:"stageInactivity"`
	StageAge        int `json:"stageAge"`
}

type ListFilter struct {
	Scope  string
	Status []string
	Limit  int
	Cursor string
}

type AcknowledgeRequest struct {
	Note *string `json:"note,omitempty"`
}

type SnoozeRequest struct {
	Minutes int     `json:"minutes"`
	Note    *string `json:"note,omitempty"`
}

type ResolveRequest struct {
	Reason string  `json:"reason"`
	Note   *string `json:"note,omitempty"`
}

type Settings struct {
	OrganizationID        string          `json:"organizationId"`
	EngineMode            string          `json:"engineMode"`
	NotificationsEnabled  bool            `json:"notificationsEnabled"`
	RedistributionEnabled bool            `json:"redistributionEnabled"`
	Timezone              string          `json:"timezone"`
	BusinessHours         json.RawMessage `json:"businessHours"`
	DefaultRepeatMinutes  int             `json:"defaultRepeatMinutes"`
	MaxReminders          int             `json:"maxReminders"`
	CreatedBy             *string         `json:"createdBy,omitempty"`
	CreatedAt             time.Time       `json:"createdAt"`
	UpdatedAt             time.Time       `json:"updatedAt"`
}

type SettingsRequest struct {
	EngineMode            *string          `json:"engineMode,omitempty"`
	NotificationsEnabled  *bool            `json:"notificationsEnabled,omitempty"`
	RedistributionEnabled *bool            `json:"redistributionEnabled,omitempty"`
	Timezone              *string          `json:"timezone,omitempty"`
	BusinessHours         *json.RawMessage `json:"businessHours,omitempty"`
	DefaultRepeatMinutes  *int             `json:"defaultRepeatMinutes,omitempty"`
	MaxReminders          *int             `json:"maxReminders,omitempty"`
}

func normalizeCreatePolicy(request PolicyRequest) (policyInput, error) {
	defaults := policyInput{
		Status:                        "shadow",
		RedistributeBeforeContactOnly: true,
		NotifyAssignee:                true,
		NotifyLeaders:                 true,
		NotifyAdmins:                  true,
		Config:                        map[string]any{},
	}
	return mergePolicyInput(defaults, request, true)
}

func normalizeUpdatePolicy(current Policy, request PolicyRequest) (policyInput, error) {
	base := policyInput{
		Name:                          current.Name,
		PolicyType:                    current.PolicyType,
		Status:                        current.Status,
		PipelineID:                    current.PipelineID,
		StageID:                       current.StageID,
		ThresholdMinutes:              current.ThresholdMinutes,
		WarningMinutes:                current.WarningMinutes,
		RepeatMinutes:                 current.RepeatMinutes,
		EscalationMinutes:             current.EscalationMinutes,
		RedistributionMinutes:         current.RedistributionMinutes,
		BusinessHoursOnly:             current.BusinessHoursOnly,
		RedistributeBeforeContactOnly: current.RedistributeBeforeOnly,
		NotifyAssignee:                current.NotifyAssignee,
		NotifyLeaders:                 current.NotifyLeaders,
		NotifyAdmins:                  current.NotifyAdmins,
		Config:                        cloneMap(current.Config),
	}
	return mergePolicyInput(base, request, false)
}

func mergePolicyInput(input policyInput, request PolicyRequest, creating bool) (policyInput, error) {
	if request.Name != nil {
		input.Name = strings.TrimSpace(*request.Name)
	}
	if request.PolicyType != nil {
		input.PolicyType = strings.ToLower(strings.TrimSpace(*request.PolicyType))
	}
	if request.Status != nil {
		input.Status = strings.ToLower(strings.TrimSpace(*request.Status))
	}
	if request.PipelineID != nil {
		input.PipelineID = cleanOptionalString(request.PipelineID)
	}
	if request.StageID != nil {
		input.StageID = cleanOptionalString(request.StageID)
	}
	if request.ThresholdMinutes != nil {
		input.ThresholdMinutes = *request.ThresholdMinutes
	}
	if request.WarningMinutes != nil {
		input.WarningMinutes = *request.WarningMinutes
	}
	if request.RepeatMinutes != nil {
		input.RepeatMinutes = nonZeroInt(request.RepeatMinutes)
	}
	if request.EscalationMinutes != nil {
		input.EscalationMinutes = copyInt(request.EscalationMinutes)
	}
	if request.RedistributionMinutes != nil {
		input.RedistributionMinutes = copyInt(request.RedistributionMinutes)
	}
	if request.BusinessHoursOnly != nil {
		input.BusinessHoursOnly = *request.BusinessHoursOnly
	}
	if request.RedistributeBeforeContactOnly != nil {
		input.RedistributeBeforeContactOnly = *request.RedistributeBeforeContactOnly
	}
	if request.NotifyAssignee != nil {
		input.NotifyAssignee = *request.NotifyAssignee
	}
	if request.NotifyLeaders != nil {
		input.NotifyLeaders = *request.NotifyLeaders
	}
	if request.NotifyAdmins != nil {
		input.NotifyAdmins = *request.NotifyAdmins
	}
	if request.Config != nil {
		input.Config = cloneMap(request.Config)
	}

	if creating && (request.Name == nil || request.PolicyType == nil || request.ThresholdMinutes == nil) {
		return policyInput{}, fmt.Errorf("%w: name, policyType and thresholdMinutes are required", ErrInvalidInput)
	}
	if input.Name == "" || len(input.Name) > 160 {
		return policyInput{}, fmt.Errorf("%w: name is required and must have at most 160 characters", ErrInvalidInput)
	}
	if !validPolicyType(input.PolicyType) {
		return policyInput{}, fmt.Errorf("%w: policyType is invalid", ErrInvalidInput)
	}
	if !validPolicyStatus(input.Status) || input.Status == "archived" {
		return policyInput{}, fmt.Errorf("%w: status is invalid", ErrInvalidInput)
	}
	if input.ThresholdMinutes <= 0 {
		return policyInput{}, fmt.Errorf("%w: thresholdMinutes must be positive", ErrInvalidInput)
	}
	if input.WarningMinutes < 0 || input.WarningMinutes >= input.ThresholdMinutes {
		return policyInput{}, fmt.Errorf("%w: warningMinutes must be between zero and less than thresholdMinutes", ErrInvalidInput)
	}
	if input.RepeatMinutes != nil && *input.RepeatMinutes < 5 {
		return policyInput{}, fmt.Errorf("%w: repeatMinutes must be at least 5", ErrInvalidInput)
	}
	if input.EscalationMinutes != nil && *input.EscalationMinutes < 0 {
		return policyInput{}, fmt.Errorf("%w: escalationMinutes must be non-negative", ErrInvalidInput)
	}
	if input.RedistributionMinutes != nil && *input.RedistributionMinutes < 0 {
		return policyInput{}, fmt.Errorf("%w: redistributionMinutes must be non-negative", ErrInvalidInput)
	}
	return input, nil
}

func validPolicyType(value string) bool {
	switch value {
	case "unassigned", "first_contact", "stage_inactivity", "stage_age":
		return true
	default:
		return false
	}
}

func validPolicyStatus(value string) bool {
	switch value {
	case "shadow", "enabled", "paused", "archived":
		return true
	default:
		return false
	}
}

func validItemStatus(value string) bool {
	switch value {
	case "monitoring", "warning", "breached", "escalated", "acknowledged", "resolved", "redistributed", "cancelled", "exception":
		return true
	default:
		return false
	}
}

func canManagePolicies(context tenant.Context) bool {
	return context.IsSuperAdmin ||
		context.HasRole("owner", "admin", "manager") ||
		context.HasPermission("settings_manage") ||
		context.HasPermission("settings_pipelines") ||
		context.HasPermission("pipeline_edit") ||
		context.HasPermission("automations_edit") ||
		context.HasPermission("lead_manage")
}

func canViewOrganizationAttention(context tenant.Context) bool {
	return context.IsSuperAdmin ||
		context.HasRole("owner", "admin", "manager") ||
		context.HasPermission("lead_view_all") ||
		context.HasPermission("lead_manage")
}

func canActOnItem(context tenant.Context, assignedUserID string) bool {
	return canViewOrganizationAttention(context) ||
		strings.EqualFold(strings.TrimSpace(context.UserID), strings.TrimSpace(assignedUserID)) ||
		context.LeadsUser(assignedUserID)
}

func cleanOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	return &cleaned
}

func nonZeroInt(value *int) *int {
	if value == nil || *value == 0 {
		return nil
	}
	copy := *value
	return &copy
}

func copyInt(value *int) *int {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

func cloneMap(source map[string]any) map[string]any {
	if source == nil {
		return map[string]any{}
	}
	result := make(map[string]any, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}
