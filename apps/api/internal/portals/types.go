package portals

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
)

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
	LeadWebhookSecret     OptionalString `json:"leadWebhookSecret"`
	DefaultPipelineID     OptionalString `json:"defaultPipelineId"`
	DefaultStageID        OptionalString `json:"defaultStageId"`
	DefaultAssignedUserID OptionalString `json:"defaultAssignedUserId"`
	DefaultRoundRobinID   OptionalString `json:"defaultRoundRobinId"`
	Settings              map[string]any `json:"settings"`
}

// OptionalString distinguishes an omitted field from an explicit null or empty
// value, allowing settings to be cleared without overwriting untouched fields.
type OptionalString struct {
	Set   bool
	Value *string
}

func (value *OptionalString) UnmarshalJSON(data []byte) error {
	value.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		value.Value = nil
		return nil
	}
	var text string
	if err := json.Unmarshal(data, &text); err != nil {
		return err
	}
	text = strings.TrimSpace(text)
	if text == "" {
		value.Value = nil
		return nil
	}
	value.Value = &text
	return nil
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
