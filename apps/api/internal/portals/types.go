package portals

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
)

const (
	PortalGrupoOLX          = "grupo_olx"
	PortalChavesNaMao       = "chaves_na_mao"
	maxGrupoOLXFeedListings = 50000
	maxChavesNaMaoListings  = 50000
)

var (
	ErrInvalidInput             = errors.New("invalid portal input")
	ErrNotFound                 = errors.New("portal integration not found")
	ErrUnauthorized             = errors.New("portal webhook unauthorized")
	ErrModuleUnavailable        = errors.New("portal module unavailable")
	ErrListingNotFound          = errors.New("portal listing not found")
	ErrDuplicateWebhook         = errors.New("duplicate portal webhook")
	ErrCanonicalManaged         = errors.New("portal listing is managed by the canonical publication center")
	ErrCanonicalListingIDLocked = errors.New("canonical portal ListingID cannot change while published")
	ErrCanonicalProductLocked   = errors.New("canonical portal product can change only while fully unpublished")
	ErrDuplicateListingID       = errors.New("portal ListingID is already used by another property")
	ErrFeedListingLimit         = errors.New("grupo olx feed listing limit exceeded")
	ErrChavesNaMaoListingLimit  = errors.New("chaves na mao feed listing limit exceeded")
	ErrChavesNaMaoFeedSize      = errors.New("chaves na mao feed size limit exceeded")
	ErrChavesNaMaoHomologation  = errors.New("chaves na mao integration is not homologated")
	ErrWebhookSecretUnavailable = errors.New("grupo olx CRM webhook secret is not configured")
	ErrRateLimited              = errors.New("portal public ingress rate limit exceeded")
	ErrFeedNotActivated         = errors.New("grupo olx feed is not activated")
)

type Envelope[T any] struct {
	Data T `json:"data"`
}

type GrupoOLXSettingsRequest struct {
	DefaultPipelineID     OptionalString `json:"defaultPipelineId"`
	DefaultStageID        OptionalString `json:"defaultStageId"`
	DefaultAssignedUserID OptionalString `json:"defaultAssignedUserId"`
	DefaultRoundRobinID   OptionalString `json:"defaultRoundRobinId"`
	Settings              map[string]any `json:"settings"`
}

// ChavesNaMaoSettingsRequest deliberately contains only feed settings. The
// provider does not publish a current real-estate lead webhook contract, so we
// do not expose routing or webhook configuration that could imply otherwise.
type ChavesNaMaoSettingsRequest struct {
	Settings map[string]any `json:"settings"`
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
