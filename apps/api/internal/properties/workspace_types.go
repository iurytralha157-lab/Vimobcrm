package properties

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrPropertyWorkspaceConflict = errors.New("property workspace conflict")
	ErrPropertyOwnerNotFound     = errors.New("property owner not found")
	ErrPropertyOwnershipNotFound = errors.New("property ownership not found")
	ErrPropertyAssetNotFound     = errors.New("property asset not found")
	ErrPropertyAssetPublished    = errors.New("property asset is referenced by a published version")
)

type PropertyWorkspace struct {
	Property           Property         `json:"property"`
	Offers             []map[string]any `json:"offers"`
	Ownerships         []map[string]any `json:"ownerships"`
	Assets             []map[string]any `json:"assets"`
	Keys               []map[string]any `json:"keys"`
	RecentKeyMovements []map[string]any `json:"recent_key_movements"`
	Summary            WorkspaceSummary `json:"summary"`
}

type PropertyWorkspaceResponse struct {
	Data PropertyWorkspace `json:"data"`
	Meta WorkspaceMeta     `json:"meta"`
}

type WorkspaceMeta struct {
	CanManage            bool `json:"can_manage"`
	CanViewOwnerContacts bool `json:"can_view_owner_contacts"`
	CanViewConfidential  bool `json:"can_view_confidential"`
	// Nil keeps the normalized response wire-compatible with older strict clients;
	// the fallback sends an explicit false value together with its unavailable resources.
	NormalizedResourcesAvailable *bool    `json:"normalized_resources_available,omitempty"`
	UnavailableResources         []string `json:"unavailable_resources,omitempty"`
}

type WorkspaceSummary struct {
	CompletenessScore int                  `json:"completeness_score"`
	PublicationReady  bool                 `json:"publication_ready"`
	Checklist         []PublicationCheck   `json:"checklist"`
	Counts            WorkspaceEntityCount `json:"counts"`
}

type PublicationCheck struct {
	Code     string `json:"code"`
	Label    string `json:"label"`
	Resolved bool   `json:"resolved"`
}

type WorkspaceEntityCount struct {
	Offers     int `json:"offers"`
	Owners     int `json:"owners"`
	Photos     int `json:"photos"`
	Documents  int `json:"documents"`
	Keys       int `json:"keys"`
	KeyHistory int `json:"key_history"`
}

type UpsertPropertyOfferInput struct {
	Status            string         `json:"status"`
	Price             *float64       `json:"price"`
	Currency          string         `json:"currency"`
	PricePeriod       *string        `json:"price_period"`
	Terms             map[string]any `json:"terms"`
	AvailableFrom     *string        `json:"available_from"`
	AvailableUntil    *string        `json:"available_until"`
	Metadata          map[string]any `json:"metadata"`
	ExpectedUpdatedAt *string        `json:"expected_updated_at"`
}

type CreatePropertyKeyInput struct {
	Label           string         `json:"label"`
	KeyCode         *string        `json:"key_code"`
	CurrentLocation *string        `json:"current_location"`
	Notes           *string        `json:"notes"`
	Metadata        map[string]any `json:"metadata"`
}

type PropertyKeyMovementInput struct {
	MovementType   string         `json:"movement_type"`
	HolderUserID   *string        `json:"holder_user_id"`
	HolderName     *string        `json:"holder_name"`
	FromLocation   *string        `json:"from_location"`
	ToLocation     *string        `json:"to_location"`
	ExpectedReturn *string        `json:"expected_return_at"`
	Notes          *string        `json:"notes"`
	Metadata       map[string]any `json:"metadata"`
	IdempotencyKey string         `json:"-"`
}

type PropertyKeyMovementResult struct {
	Movement map[string]any `json:"movement"`
	Key      map[string]any `json:"key"`
}

var validOfferTypes = map[string]struct{}{
	"sale": {}, "rent": {}, "seasonal": {},
}

var validOfferStatuses = map[string]struct{}{
	"draft": {}, "active": {}, "paused": {}, "reserved": {},
	"completed": {}, "withdrawn": {}, "expired": {},
}

var validPricePeriods = map[string]struct{}{
	"total": {}, "daily": {}, "weekly": {}, "monthly": {}, "yearly": {},
}

var validKeyMovementTypes = map[string]struct{}{
	"checkout": {}, "transfer": {}, "return": {}, "location_change": {},
	"mark_lost": {}, "mark_found": {}, "deactivate": {}, "reactivate": {},
}

func (input *UpsertPropertyOfferInput) Validate(offerType string) error {
	offerType = strings.ToLower(strings.TrimSpace(offerType))
	if _, ok := validOfferTypes[offerType]; !ok {
		return fmt.Errorf("%w: offer_type is invalid", ErrInvalidInput)
	}

	input.Status = strings.ToLower(strings.TrimSpace(input.Status))
	if input.Status == "" {
		input.Status = "draft"
	}
	if _, ok := validOfferStatuses[input.Status]; !ok {
		return fmt.Errorf("%w: offer status is invalid", ErrInvalidInput)
	}
	if input.Price != nil && *input.Price < 0 {
		return fmt.Errorf("%w: offer price cannot be negative", ErrInvalidInput)
	}
	if input.Status == "active" && (input.Price == nil || *input.Price <= 0) {
		return fmt.Errorf("%w: active offers require a positive price", ErrInvalidInput)
	}

	input.Currency = strings.ToUpper(strings.TrimSpace(input.Currency))
	if input.Currency == "" {
		input.Currency = "BRL"
	}
	if len(input.Currency) != 3 || !isUpperASCIICurrency(input.Currency) {
		return fmt.Errorf("%w: currency must use three letters", ErrInvalidInput)
	}

	if input.PricePeriod != nil {
		period := strings.ToLower(strings.TrimSpace(*input.PricePeriod))
		if period == "" {
			input.PricePeriod = nil
		} else {
			if _, ok := validPricePeriods[period]; !ok {
				return fmt.Errorf("%w: price_period is invalid", ErrInvalidInput)
			}
			if offerType == "sale" && period != "total" {
				return fmt.Errorf("%w: sale offers only accept the total period", ErrInvalidInput)
			}
			input.PricePeriod = &period
		}
	}
	if input.PricePeriod == nil {
		period := "total"
		if offerType == "rent" {
			period = "monthly"
		} else if offerType == "seasonal" {
			period = "daily"
		}
		input.PricePeriod = &period
	}

	availableFrom, err := parseOptionalWorkspaceDate(input.AvailableFrom)
	if err != nil {
		return fmt.Errorf("%w: available_from is invalid", ErrInvalidInput)
	}
	availableUntil, err := parseOptionalWorkspaceDate(input.AvailableUntil)
	if err != nil {
		return fmt.Errorf("%w: available_until is invalid", ErrInvalidInput)
	}
	if availableFrom != nil && availableUntil != nil && availableUntil.Before(*availableFrom) {
		return fmt.Errorf("%w: available_until cannot precede available_from", ErrInvalidInput)
	}
	if _, err := parseOptionalWorkspaceTimestamp(input.ExpectedUpdatedAt); err != nil {
		return fmt.Errorf("%w: expected_updated_at is invalid", ErrInvalidInput)
	}
	if input.Terms == nil {
		input.Terms = map[string]any{}
	}
	if input.Metadata == nil {
		input.Metadata = map[string]any{}
	}
	return nil
}

func isUpperASCIICurrency(value string) bool {
	if len(value) != 3 {
		return false
	}
	for index := 0; index < len(value); index++ {
		if value[index] < 'A' || value[index] > 'Z' {
			return false
		}
	}
	return true
}

func (input *CreatePropertyKeyInput) Validate() error {
	input.Label = trimMax(input.Label, 120)
	if input.Label == "" {
		input.Label = "Chave principal"
	}
	input.KeyCode = trimOptionalWorkspaceString(input.KeyCode, 120)
	input.CurrentLocation = trimOptionalWorkspaceString(input.CurrentLocation, 240)
	input.Notes = trimOptionalWorkspaceString(input.Notes, 1200)
	if input.Metadata == nil {
		input.Metadata = map[string]any{}
	}
	return nil
}

func (input *PropertyKeyMovementInput) Validate() error {
	input.MovementType = strings.ToLower(strings.TrimSpace(input.MovementType))
	if _, ok := validKeyMovementTypes[input.MovementType]; !ok {
		return fmt.Errorf("%w: movement_type is invalid", ErrInvalidInput)
	}
	input.IdempotencyKey = trimMax(input.IdempotencyKey, 200)
	if input.IdempotencyKey == "" {
		return fmt.Errorf("%w: Idempotency-Key header is required", ErrInvalidInput)
	}
	input.HolderUserID = trimOptionalWorkspaceString(input.HolderUserID, 80)
	if input.HolderUserID != nil && !isUUID(*input.HolderUserID) {
		return fmt.Errorf("%w: holder_user_id is invalid", ErrInvalidInput)
	}
	input.HolderName = trimOptionalWorkspaceString(input.HolderName, 160)
	input.FromLocation = trimOptionalWorkspaceString(input.FromLocation, 240)
	input.ToLocation = trimOptionalWorkspaceString(input.ToLocation, 240)
	input.Notes = trimOptionalWorkspaceString(input.Notes, 1200)
	if (input.MovementType == "checkout" || input.MovementType == "transfer") && input.HolderUserID == nil && input.HolderName == nil {
		return fmt.Errorf("%w: checkout and transfer require a holder", ErrInvalidInput)
	}
	if input.MovementType == "location_change" && input.ToLocation == nil {
		return fmt.Errorf("%w: location_change requires to_location", ErrInvalidInput)
	}
	if _, err := parseOptionalWorkspaceTimestamp(input.ExpectedReturn); err != nil {
		return fmt.Errorf("%w: expected_return_at is invalid", ErrInvalidInput)
	}
	if input.Metadata == nil {
		input.Metadata = map[string]any{}
	}
	return nil
}

func parseOptionalWorkspaceDate(value *string) (*time.Time, error) {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil, nil
	}
	parsed, err := time.Parse("2006-01-02", strings.TrimSpace(*value))
	return &parsed, err
}

func parseOptionalWorkspaceTimestamp(value *string) (*time.Time, error) {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(*value))
	return &parsed, err
}

func trimOptionalWorkspaceString(value *string, maxLength int) *string {
	if value == nil {
		return nil
	}
	trimmed := trimMax(*value, maxLength)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
