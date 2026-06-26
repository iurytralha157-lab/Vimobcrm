package webhooks

import "errors"

var (
	ErrInvalidInput    = errors.New("invalid webhook input")
	ErrInvalidToken    = errors.New("invalid webhook token")
	ErrWebhookNotFound = errors.New("webhook not found")
)

type Envelope[T any] struct {
	Data T `json:"data"`
}

type WebhookRequest struct {
	Name             *string           `json:"name"`
	Type             *string           `json:"type"`
	IsActive         *bool             `json:"is_active"`
	TargetPipelineID *string           `json:"target_pipeline_id"`
	TargetTeamID     *string           `json:"target_team_id"`
	TargetStageID    *string           `json:"target_stage_id"`
	TargetTagIDs     []string          `json:"target_tag_ids"`
	TargetPropertyID *string           `json:"target_property_id"`
	FieldMapping     map[string]string `json:"field_mapping"`
	WebhookURL       *string           `json:"webhook_url"`
	TriggerEvents    []string          `json:"trigger_events"`
}

type IncomingLeadResult struct {
	OK             bool   `json:"ok"`
	OrganizationID string `json:"organizationId,omitempty"`
	LeadID         string `json:"leadId"`
	Reentry        bool   `json:"reentry"`
	Message        string `json:"message"`
}

type incomingWebhook struct {
	ID               string            `json:"id"`
	OrganizationID   string            `json:"organization_id"`
	Name             string            `json:"name"`
	TargetPipelineID *string           `json:"target_pipeline_id"`
	TargetStageID    *string           `json:"target_stage_id"`
	TargetTagIDs     []string          `json:"target_tag_ids"`
	TargetPropertyID *string           `json:"target_property_id"`
	FieldMapping     map[string]string `json:"field_mapping"`
}
