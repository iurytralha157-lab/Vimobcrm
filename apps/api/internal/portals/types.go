package portals

import "errors"

const (
	PortalGrupoOLX = "grupo_olx"
)

var (
	ErrInvalidInput      = errors.New("invalid portal input")
	ErrNotFound          = errors.New("portal integration not found")
	ErrUnauthorized      = errors.New("portal webhook unauthorized")
	ErrModuleUnavailable = errors.New("portal module unavailable")
	ErrListingNotFound   = errors.New("portal listing not found")
	ErrDuplicateWebhook  = errors.New("duplicate portal webhook")
)

type Envelope[T any] struct {
	Data T `json:"data"`
}

type GrupoOLXSettingsRequest struct {
	IsActive              *bool          `json:"isActive"`
	LeadWebhookSecret     *string        `json:"leadWebhookSecret"`
	DefaultPipelineID     *string        `json:"defaultPipelineId"`
	DefaultStageID        *string        `json:"defaultStageId"`
	DefaultAssignedUserID *string        `json:"defaultAssignedUserId"`
	DefaultRoundRobinID   *string        `json:"defaultRoundRobinId"`
	Settings              map[string]any `json:"settings"`
}

type PortalPublicationRequest struct {
	PropertyID      string `json:"propertyId"`
	ClientListingID string `json:"clientListingId"`
	PublicationType string `json:"publicationType"`
	IsEnabled       *bool  `json:"isEnabled"`
}

type UpsertPublicationsRequest struct {
	Publications []PortalPublicationRequest `json:"publications"`
}

type leadWebhookResult struct {
	EventID    string  `json:"eventId"`
	LeadID     *string `json:"leadId,omitempty"`
	PropertyID *string `json:"propertyId,omitempty"`
	Duplicate  bool    `json:"duplicate"`
	Linked     bool    `json:"linked"`
}
