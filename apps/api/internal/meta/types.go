package meta

import "errors"

var (
	ErrInvalidInput       = errors.New("invalid meta webhook input")
	ErrInvalidSignature   = errors.New("invalid meta webhook signature")
	ErrMissingAppSecret   = errors.New("missing meta app secret")
	ErrMissingVerifyToken = errors.New("missing meta webhook verify token")
)

type Config struct {
	AppSecret          string
	WebhookVerifyToken string
	GraphVersion       string
	GraphBaseURL       string
}

type Envelope[T any] struct {
	Data T `json:"data"`
}

type WebhookResponse struct {
	OK        bool            `json:"ok"`
	EventID   string          `json:"eventId,omitempty"`
	Processed int             `json:"processed"`
	Results   []LeadgenResult `json:"results,omitempty"`
	Warnings  []string        `json:"warnings,omitempty"`
}

type LeadgenResult struct {
	Status         string `json:"status"`
	OrganizationID string `json:"organizationId,omitempty"`
	LeadID         string `json:"leadId,omitempty"`
	LeadgenID      string `json:"leadgenId,omitempty"`
	FormID         string `json:"formId,omitempty"`
	PageID         string `json:"pageId,omitempty"`
	Reentry        bool   `json:"reentry,omitempty"`
	Error          string `json:"error,omitempty"`
}

type webhookEventContext struct {
	Object    string
	PageID    string
	FormID    string
	LeadgenID string
	EventType string
}

type webhookEventJob struct {
	ID      string
	Payload map[string]any
}

type leadgenChange struct {
	PageID      string
	FormID      string
	LeadgenID   string
	CreatedTime string
	Raw         map[string]any
}

type fieldData struct {
	Name   string
	Values []string
}

type metaIntegration struct {
	ID             string
	OrganizationID string
	PageID         *string
	PageName       *string
	AccessToken    *string
	PipelineID     *string
	StageID        *string
	AssignedUserID *string
	DefaultStatus  *string
	FieldMapping   map[string]string
}

type metaFormConfig struct {
	ID                 string
	OrganizationID     string
	IntegrationID      string
	PageID             *string
	FormID             string
	FormName           *string
	PipelineID         *string
	StageID            *string
	DefaultStatus      *string
	AssignedUserID     *string
	RoundRobinID       *string
	PropertyID         *string
	Purpose            *string
	Source             *string
	SourceDetails      *string
	DefaultValues      map[string]any
	AutoTags           []string
	FieldMapping       map[string]string
	CustomFieldsConfig []string
}

type resolvedDestination struct {
	PipelineID             *string
	StageID                *string
	AssignedUserID         *string
	TeamID                 *string
	RoundRobinID           *string
	RoundRobinMemberID     *string
	RedistributionSettings map[string]any
}

type leadData struct {
	Name      string
	Email     *string
	Phone     *string
	Message   *string
	Cargo     *string
	Empresa   *string
	Cidade    *string
	Bairro    *string
	Custom    map[string]any
	RawFields map[string]any
	Meta      map[string]any
}
