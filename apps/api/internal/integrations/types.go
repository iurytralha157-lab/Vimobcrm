package integrations

import "errors"

var (
	ErrInvalidInput        = errors.New("invalid integration input")
	ErrIntegrationNotFound = errors.New("integration not found")
	ErrFunctionNotAllowed  = errors.New("integration function is not allowed")
)

type Envelope[T any] struct {
	Data T `json:"data"`
}

type ExternalConfig struct {
	ProjectURL string
	APIKey     string
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
	IntegrationID       string         `json:"integrationId"`
	FormID              string         `json:"formId"`
	FormName            *string        `json:"formName"`
	PropertyID          *string        `json:"propertyId"`
	RoundRobinID        *string        `json:"roundRobinId"`
	Purpose             *string        `json:"purpose"`
	Source              *string        `json:"source"`
	SourceDetails       *string        `json:"sourceDetails"`
	DefaultValues        map[string]any `json:"defaultValues"`
	AutoTags            []string       `json:"autoTags"`
	FieldMapping         map[string]string `json:"fieldMapping"`
	CustomFieldsConfig  []string       `json:"customFieldsConfig"`
	IsActive            *bool          `json:"isActive"`
}

type ToggleMetaFormConfigRequest struct {
	IntegrationID string `json:"integrationId"`
	FormID        string `json:"formId"`
	IsActive      bool   `json:"isActive"`
}
