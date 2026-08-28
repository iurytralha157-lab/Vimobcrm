package integrations

import "errors"

var (
	ErrInvalidInput               = errors.New("invalid integration input")
	ErrBillingCheckoutUnavailable = errors.New("billing checkout security is unavailable")
	ErrIntegrationNotFound        = errors.New("integration not found")
	ErrFunctionNotAllowed         = errors.New("integration function is not allowed")
	ErrMetaUpstream               = errors.New("meta upstream request failed")
	ErrMetaDeliveryUncertain      = errors.New("meta delivery result is uncertain")
	ErrIdempotencyConflict        = errors.New("idempotency key is already bound to another request")
)

type Envelope[T any] struct {
	Data T `json:"data"`
}

type ExternalConfig struct {
	ProjectURL            string
	APIKey                string
	ClientIPSigningSecret string
	MetaAppSecret         string
	MetaGraphVersion      string
	MetaGraphBaseURL      string
}

type FunctionResponse struct {
	StatusCode  int
	ContentType string
	Body        []byte
}

type VistaIntegrationRequest struct {
	APIURL string `json:"api_url"`
	APIKey string `json:"api_key"`
}

type ImoviewIntegrationRequest struct {
	APIKey string `json:"api_key"`
}

type MetaFormConfigRequest struct {
	IntegrationID      string            `json:"integrationId"`
	FormID             string            `json:"formId"`
	FormName           *string           `json:"formName"`
	PropertyID         *string           `json:"propertyId"`
	RoundRobinID       *string           `json:"roundRobinId"`
	Purpose            *string           `json:"purpose"`
	Source             *string           `json:"source"`
	SourceDetails      *string           `json:"sourceDetails"`
	DefaultValues      map[string]any    `json:"defaultValues"`
	AutoTags           []string          `json:"autoTags"`
	FieldMapping       map[string]string `json:"fieldMapping"`
	CustomFieldsConfig []string          `json:"customFieldsConfig"`
	IsActive           *bool             `json:"isActive"`
}

type ToggleMetaFormConfigRequest struct {
	IntegrationID string `json:"integrationId"`
	FormID        string `json:"formId"`
	IsActive      bool   `json:"isActive"`
}

// MetaConversionFeedbackRequest configures the dedicated CRM Dataset
// credential used by Conversions API for CRM. DatasetAccessToken and
// TestEventCode are write-only and are never included in a response.
// ReplayRecentFacts explicitly queues all eligible real facts from Meta
// acquisition entries in the preceding seven days.
type MetaConversionFeedbackRequest struct {
	IntegrationID      string  `json:"integrationId"`
	DatasetID          *string `json:"datasetId"`
	DatasetName        *string `json:"datasetName"`
	DatasetAccessToken *string `json:"datasetAccessToken"`
	Enabled            bool    `json:"enabled"`
	ReplayRecentFacts  bool    `json:"replayRecentFacts"`
	TestEventCode      *string `json:"testEventCode,omitempty"`
}

type SendMetaMessageRequest struct {
	Text           string `json:"text"`
	IdempotencyKey string `json:"idempotencyKey"`
}

type SendMetaMessageResult struct {
	Message    map[string]any
	StatusCode int
}
