package developments

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	ErrInvalidInput = errors.New("invalid development input")
	ErrNotFound     = errors.New("development not found")
	ErrConflict     = errors.New("development conflict")
)

type ListFilter struct {
	Search           string
	DevelopmentType  string
	Status           string
	CommercialStatus string
	Limit            int
	Offset           int
}

type Developer struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	LegalName *string `json:"legal_name,omitempty"`
	LogoURL   *string `json:"logo_url,omitempty"`
	Status    string  `json:"status"`
}

type Development struct {
	ID                      string         `json:"id"`
	OrganizationID          string         `json:"organization_id"`
	DeveloperID             *string        `json:"developer_id,omitempty"`
	Developer               *Developer     `json:"developer,omitempty"`
	Code                    string         `json:"code"`
	Name                    string         `json:"name"`
	DevelopmentType         string         `json:"development_type"`
	Status                  string         `json:"status"`
	CommercialStatus        string         `json:"commercial_status"`
	ConstructionProgress    float64        `json:"construction_progress"`
	RegistrationNumber      *string        `json:"registration_number,omitempty"`
	Summary                 *string        `json:"summary,omitempty"`
	Description             *string        `json:"description,omitempty"`
	Address                 *string        `json:"address,omitempty"`
	AddressNumber           *string        `json:"address_number,omitempty"`
	Complement              *string        `json:"complement,omitempty"`
	Neighborhood            *string        `json:"neighborhood,omitempty"`
	City                    *string        `json:"city,omitempty"`
	State                   *string        `json:"state,omitempty"`
	PostalCode              *string        `json:"postal_code,omitempty"`
	Latitude                *float64       `json:"latitude,omitempty"`
	Longitude               *float64       `json:"longitude,omitempty"`
	PublicAddressVisibility string         `json:"public_address_visibility"`
	LaunchDate              *string        `json:"launch_date,omitempty"`
	ConstructionStartedAt   *string        `json:"construction_started_at,omitempty"`
	ExpectedDeliveryDate    *string        `json:"expected_delivery_date,omitempty"`
	DeliveredAt             *string        `json:"delivered_at,omitempty"`
	MainImageURL            *string        `json:"main_image_url,omitempty"`
	ImageURLs               []string       `json:"image_urls"`
	Amenities               []string       `json:"amenities"`
	VideoURL                *string        `json:"video_url,omitempty"`
	VirtualTourURL          *string        `json:"virtual_tour_url,omitempty"`
	PublishedOnSite         bool           `json:"published_on_site"`
	ResponsibleUserID       *string        `json:"responsible_user_id,omitempty"`
	Metadata                map[string]any `json:"metadata"`
	CreatedAt               string         `json:"created_at"`
	UpdatedAt               string         `json:"updated_at"`
}

type InventoryCounts struct {
	Total       int `json:"total"`
	Available   int `json:"available"`
	Negotiation int `json:"negotiation"`
	Reserved    int `json:"reserved"`
	Sold        int `json:"sold"`
	Blocked     int `json:"blocked"`
	Unavailable int `json:"unavailable"`
	Withdrawn   int `json:"withdrawn"`
}

type PriceRange struct {
	Minimum  *float64 `json:"minimum"`
	Maximum  *float64 `json:"maximum"`
	Currency *string  `json:"currency,omitempty"`
}

type DevelopmentListItem struct {
	Development
	Inventory      InventoryCounts `json:"inventory"`
	PriceRange     PriceRange      `json:"price_range"`
	FloorPlanCount int             `json:"floor_plan_count"`
}

type ListMeta struct {
	Total              int  `json:"total"`
	Limit              int  `json:"limit"`
	Offset             int  `json:"offset"`
	InventoryTotal     int  `json:"inventory_total"`
	InventoryAvailable int  `json:"inventory_available"`
	CommercialActive   int  `json:"commercial_active"`
	UnderConstruction  int  `json:"under_construction"`
	CanManage          bool `json:"can_manage"`
}

type ListResponse struct {
	Data []DevelopmentListItem `json:"data"`
	Meta ListMeta              `json:"meta"`
}

type UnitListFilter struct {
	BuildingID  string
	FloorPlanID string
	Status      string
	Search      string
	Limit       int
	Offset      int
}

type UnitListMeta struct {
	Total  int `json:"total"`
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
}

type UnitListResponse struct {
	Data []Unit       `json:"data"`
	Meta UnitListMeta `json:"meta"`
}

type Phase struct {
	ID                    string         `json:"id"`
	OrganizationID        string         `json:"organization_id"`
	DevelopmentID         string         `json:"development_id"`
	Code                  string         `json:"code"`
	Name                  string         `json:"name"`
	SortOrder             int            `json:"sort_order"`
	Status                string         `json:"status"`
	LaunchDate            *string        `json:"launch_date,omitempty"`
	ConstructionStartedAt *string        `json:"construction_started_at,omitempty"`
	ExpectedDeliveryDate  *string        `json:"expected_delivery_date,omitempty"`
	DeliveredAt           *string        `json:"delivered_at,omitempty"`
	Metadata              map[string]any `json:"metadata"`
	CreatedAt             string         `json:"created_at"`
	UpdatedAt             string         `json:"updated_at"`
}

type Building struct {
	ID             string         `json:"id"`
	OrganizationID string         `json:"organization_id"`
	DevelopmentID  string         `json:"development_id"`
	PhaseID        string         `json:"phase_id"`
	Code           string         `json:"code"`
	Name           string         `json:"name"`
	BuildingType   string         `json:"building_type"`
	FloorCount     *int           `json:"floor_count,omitempty"`
	SortOrder      int            `json:"sort_order"`
	Status         string         `json:"status"`
	UnitCount      int            `json:"unit_count"`
	Metadata       map[string]any `json:"metadata"`
	CreatedAt      string         `json:"created_at"`
	UpdatedAt      string         `json:"updated_at"`
}

type FloorPlan struct {
	ID             string         `json:"id"`
	OrganizationID string         `json:"organization_id"`
	DevelopmentID  string         `json:"development_id"`
	Code           string         `json:"code"`
	Name           string         `json:"name"`
	Status         string         `json:"status"`
	PropertyType   *string        `json:"property_type,omitempty"`
	Bedrooms       *int           `json:"bedrooms,omitempty"`
	Suites         *int           `json:"suites,omitempty"`
	Bathrooms      *int           `json:"bathrooms,omitempty"`
	ParkingSpaces  *int           `json:"parking_spaces,omitempty"`
	PrivateArea    *float64       `json:"private_area,omitempty"`
	TotalArea      *float64       `json:"total_area,omitempty"`
	BalconyArea    *float64       `json:"balcony_area,omitempty"`
	GardenArea     *float64       `json:"garden_area,omitempty"`
	Description    *string        `json:"description,omitempty"`
	ImageURL       *string        `json:"image_url,omitempty"`
	UnitCount      int            `json:"unit_count"`
	Metadata       map[string]any `json:"metadata"`
	CreatedAt      string         `json:"created_at"`
	UpdatedAt      string         `json:"updated_at"`
}

type Unit struct {
	ID                       string         `json:"id"`
	OrganizationID           string         `json:"organization_id"`
	DevelopmentID            string         `json:"development_id"`
	BuildingID               string         `json:"building_id"`
	BuildingName             *string        `json:"building_name,omitempty"`
	FloorPlanID              *string        `json:"floor_plan_id,omitempty"`
	FloorPlanName            *string        `json:"floor_plan_name,omitempty"`
	PropertyID               *string        `json:"property_id,omitempty"`
	Code                     string         `json:"code"`
	UnitNumber               string         `json:"unit_number"`
	FloorNumber              *int           `json:"floor_number,omitempty"`
	Position                 *string        `json:"position,omitempty"`
	Orientation              *string        `json:"orientation,omitempty"`
	PrivateArea              *float64       `json:"private_area,omitempty"`
	TotalArea                *float64       `json:"total_area,omitempty"`
	IdealFraction            *float64       `json:"ideal_fraction,omitempty"`
	Status                   string         `json:"status"`
	Published                bool           `json:"published"`
	Metadata                 map[string]any `json:"metadata"`
	ListPrice                *float64       `json:"list_price,omitempty"`
	MinimumPrice             *float64       `json:"minimum_price,omitempty"`
	PricePerSqm              *float64       `json:"price_per_sqm,omitempty"`
	Currency                 *string        `json:"currency,omitempty"`
	PriceTableID             *string        `json:"price_table_id,omitempty"`
	PriceTableName           *string        `json:"price_table_name,omitempty"`
	PriceTableStatus         *string        `json:"price_table_status,omitempty"`
	DraftListPrice           *float64       `json:"draft_list_price,omitempty"`
	DraftMinimumPrice        *float64       `json:"draft_minimum_price,omitempty"`
	DraftPricePerSqm         *float64       `json:"draft_price_per_sqm,omitempty"`
	DraftPriceTableID        *string        `json:"draft_price_table_id,omitempty"`
	DraftPriceTableName      *string        `json:"draft_price_table_name,omitempty"`
	DraftPriceTableUpdatedAt *string        `json:"draft_price_table_updated_at,omitempty"`
	CreatedAt                string         `json:"created_at"`
	UpdatedAt                string         `json:"updated_at"`
}

type PriceTable struct {
	ID               string         `json:"id"`
	OrganizationID   string         `json:"organization_id"`
	DevelopmentID    string         `json:"development_id"`
	Name             string         `json:"name"`
	Version          int            `json:"version"`
	Status           string         `json:"status"`
	Currency         string         `json:"currency"`
	ValidFrom        *string        `json:"valid_from,omitempty"`
	ValidUntil       *string        `json:"valid_until,omitempty"`
	Notes            *string        `json:"notes,omitempty"`
	ApprovedBy       *string        `json:"approved_by,omitempty"`
	ApprovedAt       *string        `json:"approved_at,omitempty"`
	PricedUnitCount  int            `json:"priced_unit_count"`
	MinimumListPrice *float64       `json:"minimum_list_price,omitempty"`
	MaximumListPrice *float64       `json:"maximum_list_price,omitempty"`
	Metadata         map[string]any `json:"metadata"`
	CreatedAt        string         `json:"created_at"`
	UpdatedAt        string         `json:"updated_at"`
}

type UnitEvent struct {
	ID             string         `json:"id"`
	OrganizationID string         `json:"organization_id"`
	DevelopmentID  string         `json:"development_id"`
	UnitID         string         `json:"unit_id"`
	EventType      string         `json:"event_type"`
	BeforeData     map[string]any `json:"before_data,omitempty"`
	AfterData      map[string]any `json:"after_data,omitempty"`
	Metadata       map[string]any `json:"metadata"`
	CreatedBy      *string        `json:"created_by,omitempty"`
	CreatedAt      string         `json:"created_at"`
}

type WorkspaceSummary struct {
	Phases            int             `json:"phases"`
	Buildings         int             `json:"buildings"`
	FloorPlans        int             `json:"floor_plans"`
	Inventory         InventoryCounts `json:"inventory"`
	PriceRange        PriceRange      `json:"price_range"`
	CompletenessScore int             `json:"completeness_score"`
	PublicationReady  bool            `json:"publication_ready"`
	Checklist         []ChecklistItem `json:"checklist"`
}

type ChecklistItem struct {
	Code     string `json:"code"`
	Label    string `json:"label"`
	Resolved bool   `json:"resolved"`
}

type Workspace struct {
	Development      Development      `json:"development"`
	Phases           []Phase          `json:"phases"`
	Buildings        []Building       `json:"buildings"`
	FloorPlans       []FloorPlan      `json:"floor_plans"`
	Units            []Unit           `json:"units"`
	PriceTables      []PriceTable     `json:"price_tables"`
	RecentUnitEvents []UnitEvent      `json:"recent_unit_events"`
	Summary          WorkspaceSummary `json:"summary"`
}

type WorkspaceResponse struct {
	Data Workspace     `json:"data"`
	Meta WorkspaceMeta `json:"meta"`
}

type WorkspaceMeta struct {
	CanManage bool `json:"can_manage"`
}

type CreateDevelopmentInput struct {
	DeveloperID           *string        `json:"developer_id"`
	DeveloperName         *string        `json:"developer_name"`
	Code                  string         `json:"code"`
	Name                  string         `json:"name"`
	DevelopmentType       string         `json:"development_type"`
	Status                string         `json:"status"`
	CommercialStatus      string         `json:"commercial_status"`
	ConstructionProgress  float64        `json:"construction_progress"`
	RegistrationNumber    *string        `json:"registration_number"`
	Summary               *string        `json:"summary"`
	Description           *string        `json:"description"`
	Address               *string        `json:"address"`
	AddressNumber         *string        `json:"address_number"`
	Complement            *string        `json:"complement"`
	Neighborhood          *string        `json:"neighborhood"`
	City                  *string        `json:"city"`
	State                 *string        `json:"state"`
	PostalCode            *string        `json:"postal_code"`
	LaunchDate            *string        `json:"launch_date"`
	ConstructionStartedAt *string        `json:"construction_started_at"`
	ExpectedDeliveryDate  *string        `json:"expected_delivery_date"`
	MainImageURL          *string        `json:"main_image_url"`
	PublishedOnSite       bool           `json:"published_on_site"`
	ResponsibleUserID     *string        `json:"responsible_user_id"`
	Metadata              map[string]any `json:"metadata"`
}

type CreatePhaseInput struct {
	Code                  string         `json:"code"`
	Name                  string         `json:"name"`
	SortOrder             int            `json:"sort_order"`
	Status                string         `json:"status"`
	LaunchDate            *string        `json:"launch_date"`
	ConstructionStartedAt *string        `json:"construction_started_at"`
	ExpectedDeliveryDate  *string        `json:"expected_delivery_date"`
	Metadata              map[string]any `json:"metadata"`
}

type CreateBuildingInput struct {
	PhaseID      string         `json:"phase_id"`
	Code         string         `json:"code"`
	Name         string         `json:"name"`
	BuildingType string         `json:"building_type"`
	FloorCount   *int           `json:"floor_count"`
	SortOrder    int            `json:"sort_order"`
	Status       string         `json:"status"`
	Metadata     map[string]any `json:"metadata"`
}

type CreateFloorPlanInput struct {
	Code          string         `json:"code"`
	Name          string         `json:"name"`
	Status        string         `json:"status"`
	PropertyType  *string        `json:"property_type"`
	Bedrooms      *int           `json:"bedrooms"`
	Suites        *int           `json:"suites"`
	Bathrooms     *int           `json:"bathrooms"`
	ParkingSpaces *int           `json:"parking_spaces"`
	PrivateArea   *float64       `json:"private_area"`
	TotalArea     *float64       `json:"total_area"`
	BalconyArea   *float64       `json:"balcony_area"`
	GardenArea    *float64       `json:"garden_area"`
	Description   *string        `json:"description"`
	ImageURL      *string        `json:"image_url"`
	Metadata      map[string]any `json:"metadata"`
}

type BulkCreateUnitsInput struct {
	BuildingID       string         `json:"building_id"`
	FloorPlanID      *string        `json:"floor_plan_id"`
	Prefix           string         `json:"prefix"`
	StartNumber      int            `json:"start_number"`
	Count            int            `json:"count"`
	StartFloor       int            `json:"start_floor"`
	UnitsPerFloor    int            `json:"units_per_floor"`
	NumberPadding    int            `json:"number_padding"`
	InitialListPrice *float64       `json:"initial_list_price"`
	PriceTableName   *string        `json:"price_table_name"`
	Metadata         map[string]any `json:"metadata"`
}

type UpdateUnitInput struct {
	Status            *string `json:"status"`
	Published         *bool   `json:"published"`
	ExpectedUpdatedAt *string `json:"expected_updated_at"`
}

type ActivatePriceTableInput struct {
	ExpectedUpdatedAt *string `json:"expected_updated_at"`
}

type ReservationListFilter struct {
	Status string
	UnitID string
	LeadID string
	Limit  int
	Offset int
}

type ReservationListMeta struct {
	Total        int `json:"total"`
	Limit        int `json:"limit"`
	Offset       int `json:"offset"`
	Active       int `json:"active"`
	ExpiringSoon int `json:"expiring_soon"`
	Expired      int `json:"expired"`
}

// Reservation intentionally omits payment_snapshot and metadata. ListReservations
// additionally uses an explicit safe projection that omits notes and the
// idempotency key from reader-facing responses.
type Reservation struct {
	ID                 string   `json:"id"`
	OrganizationID     string   `json:"organization_id"`
	DevelopmentID      string   `json:"development_id"`
	UnitID             string   `json:"unit_id"`
	UnitNumber         *string  `json:"unit_number,omitempty"`
	UnitCode           *string  `json:"unit_code,omitempty"`
	BuildingName       *string  `json:"building_name,omitempty"`
	LeadID             *string  `json:"lead_id,omitempty"`
	LeadName           *string  `json:"lead_name,omitempty"`
	PriceTableID       *string  `json:"price_table_id,omitempty"`
	Status             string   `json:"status"`
	ReservedBy         string   `json:"reserved_by"`
	UpdatedBy          *string  `json:"updated_by,omitempty"`
	ExpiresAt          string   `json:"expires_at"`
	ConvertedAt        *string  `json:"converted_at,omitempty"`
	CancelledAt        *string  `json:"cancelled_at,omitempty"`
	CancellationReason *string  `json:"cancellation_reason,omitempty"`
	ListPriceSnapshot  *float64 `json:"list_price_snapshot,omitempty"`
	Currency           string   `json:"currency"`
	CanOperate         *bool    `json:"can_operate,omitempty"`
	IdempotencyKey     *string  `json:"idempotency_key,omitempty"`
	Notes              *string  `json:"notes,omitempty"`
	CreatedAt          string   `json:"created_at"`
	UpdatedAt          string   `json:"updated_at"`
}

type ReservationListResponse struct {
	Data []Reservation       `json:"data"`
	Meta ReservationListMeta `json:"meta"`
}

type CreateReservationInput struct {
	LeadID                *string `json:"lead_id"`
	ExpiresAt             string  `json:"expires_at"`
	Notes                 *string `json:"notes"`
	ExpectedUnitUpdatedAt string  `json:"expected_unit_updated_at"`
}

type ReservationTransitionInput struct {
	ExpectedUpdatedAt string `json:"expected_updated_at"`
}

type CancelReservationInput struct {
	ExpectedUpdatedAt  string `json:"expected_updated_at"`
	CancellationReason string `json:"cancellation_reason"`
}

type ExtendReservationInput struct {
	ExpectedUpdatedAt string `json:"expected_updated_at"`
	ExpiresAt         string `json:"expires_at"`
}

type UpdateUnitPriceInput struct {
	ListPrice                   float64        `json:"list_price"`
	MinimumPrice                *float64       `json:"minimum_price"`
	PaymentTerms                map[string]any `json:"payment_terms"`
	ExpectedPriceTableID        *string        `json:"expected_price_table_id"`
	ExpectedPriceTableUpdatedAt *string        `json:"expected_price_table_updated_at"`
}

type UpdateUnitPriceResult struct {
	Unit       Unit       `json:"unit"`
	PriceTable PriceTable `json:"price_table"`
}

var (
	uuidPattern              = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)
	validDevelopmentTypes    = stringSet("vertical", "horizontal", "mixed_use", "land_subdivision", "commercial")
	validDevelopmentStatuses = stringSet("planning", "pre_launch", "launched", "under_construction", "ready", "delivered", "suspended", "cancelled", "archived")
	validCommercialStatuses  = stringSet("draft", "active", "paused", "sold_out", "closed")
	validPhaseStatuses       = stringSet("planned", "pre_launch", "launched", "under_construction", "delivered", "suspended", "cancelled")
	validBuildingTypes       = stringSet("tower", "block", "quadra", "sector", "street")
	validBuildingStatuses    = stringSet("planned", "active", "delivered", "inactive")
	validFloorPlanStatuses   = stringSet("draft", "active", "inactive", "archived")
	validUnitStatuses        = stringSet("available", "negotiation", "reserved", "sold", "blocked", "unavailable", "withdrawn")
	validReservationStatuses = stringSet("active", "converted", "cancelled", "expired")
)

func ParseListFilter(values url.Values) (ListFilter, error) {
	filter := ListFilter{
		Search:           trim(values.Get("search"), 120),
		DevelopmentType:  normalized(values.Get("development_type")),
		Status:           normalized(values.Get("status")),
		CommercialStatus: normalized(values.Get("commercial_status")),
		Limit:            24,
	}
	if filter.DevelopmentType != "" && !validDevelopmentTypes[filter.DevelopmentType] {
		return ListFilter{}, fmt.Errorf("%w: development_type is invalid", ErrInvalidInput)
	}
	if filter.Status != "" && !validDevelopmentStatuses[filter.Status] {
		return ListFilter{}, fmt.Errorf("%w: status is invalid", ErrInvalidInput)
	}
	if filter.CommercialStatus != "" && !validCommercialStatuses[filter.CommercialStatus] {
		return ListFilter{}, fmt.Errorf("%w: commercial_status is invalid", ErrInvalidInput)
	}
	if raw := strings.TrimSpace(values.Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 100 {
			return ListFilter{}, fmt.Errorf("%w: limit must be between 1 and 100", ErrInvalidInput)
		}
		filter.Limit = value
	}
	if raw := strings.TrimSpace(values.Get("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			return ListFilter{}, fmt.Errorf("%w: offset cannot be negative", ErrInvalidInput)
		}
		filter.Offset = value
	}
	return filter, nil
}

func ParseUnitListFilter(values url.Values) (UnitListFilter, error) {
	filter := UnitListFilter{
		BuildingID:  strings.TrimSpace(values.Get("building_id")),
		FloorPlanID: strings.TrimSpace(values.Get("floor_plan_id")),
		Status:      normalized(values.Get("status")),
		Search:      trim(values.Get("search"), 120),
		Limit:       50,
	}
	if filter.BuildingID != "" && !uuidPattern.MatchString(filter.BuildingID) {
		return UnitListFilter{}, fmt.Errorf("%w: building_id is invalid", ErrInvalidInput)
	}
	if filter.FloorPlanID != "" && !uuidPattern.MatchString(filter.FloorPlanID) {
		return UnitListFilter{}, fmt.Errorf("%w: floor_plan_id is invalid", ErrInvalidInput)
	}
	if filter.Status != "" && !validUnitStatuses[filter.Status] {
		return UnitListFilter{}, fmt.Errorf("%w: unit status is invalid", ErrInvalidInput)
	}
	if raw := strings.TrimSpace(values.Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 200 {
			return UnitListFilter{}, fmt.Errorf("%w: unit limit must be between 1 and 200", ErrInvalidInput)
		}
		filter.Limit = value
	}
	if raw := strings.TrimSpace(values.Get("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			return UnitListFilter{}, fmt.Errorf("%w: unit offset cannot be negative", ErrInvalidInput)
		}
		filter.Offset = value
	}
	return filter, nil
}

func ParseReservationListFilter(values url.Values) (ReservationListFilter, error) {
	filter := ReservationListFilter{
		Status: normalized(values.Get("status")),
		UnitID: strings.TrimSpace(values.Get("unit_id")),
		LeadID: strings.TrimSpace(values.Get("lead_id")),
		Limit:  50,
	}
	if filter.Status != "" && !validReservationStatuses[filter.Status] {
		return ReservationListFilter{}, fmt.Errorf("%w: reservation status is invalid", ErrInvalidInput)
	}
	if filter.UnitID != "" && !uuidPattern.MatchString(filter.UnitID) {
		return ReservationListFilter{}, fmt.Errorf("%w: unit_id is invalid", ErrInvalidInput)
	}
	if filter.LeadID != "" && !uuidPattern.MatchString(filter.LeadID) {
		return ReservationListFilter{}, fmt.Errorf("%w: lead_id is invalid", ErrInvalidInput)
	}
	if raw := strings.TrimSpace(values.Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 200 {
			return ReservationListFilter{}, fmt.Errorf("%w: reservation limit must be between 1 and 200", ErrInvalidInput)
		}
		filter.Limit = value
	}
	if raw := strings.TrimSpace(values.Get("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			return ReservationListFilter{}, fmt.Errorf("%w: reservation offset cannot be negative", ErrInvalidInput)
		}
		filter.Offset = value
	}
	return filter, nil
}

func (input *CreateDevelopmentInput) Validate() error {
	input.Code = trim(input.Code, 80)
	input.Name = trim(input.Name, 200)
	if input.Code == "" || input.Name == "" {
		return fmt.Errorf("%w: code and name are required", ErrInvalidInput)
	}
	input.DeveloperID = optionalUUID(input.DeveloperID)
	if input.DeveloperID != nil && !uuidPattern.MatchString(*input.DeveloperID) {
		return fmt.Errorf("%w: developer_id is invalid", ErrInvalidInput)
	}
	input.DeveloperName = optionalText(input.DeveloperName, 160)
	input.DevelopmentType = defaultNormalized(input.DevelopmentType, "vertical")
	input.Status = defaultNormalized(input.Status, "planning")
	input.CommercialStatus = defaultNormalized(input.CommercialStatus, "draft")
	if !validDevelopmentTypes[input.DevelopmentType] || !validDevelopmentStatuses[input.Status] || !validCommercialStatuses[input.CommercialStatus] {
		return fmt.Errorf("%w: development type or status is invalid", ErrInvalidInput)
	}
	if input.ConstructionProgress < 0 || input.ConstructionProgress > 100 {
		return fmt.Errorf("%w: construction_progress must be between 0 and 100", ErrInvalidInput)
	}
	if input.PublishedOnSite {
		return fmt.Errorf("%w: publication requires the readiness workflow", ErrInvalidInput)
	}
	input.RegistrationNumber = optionalText(input.RegistrationNumber, 120)
	input.Summary = optionalText(input.Summary, 500)
	input.Description = optionalText(input.Description, 10000)
	input.Address = optionalText(input.Address, 240)
	input.AddressNumber = optionalText(input.AddressNumber, 40)
	input.Complement = optionalText(input.Complement, 120)
	input.Neighborhood = optionalText(input.Neighborhood, 120)
	input.City = optionalText(input.City, 120)
	input.State = optionalUpper(input.State, 2)
	if input.State != nil && !regexp.MustCompile(`^[A-Z]{2}$`).MatchString(*input.State) {
		return fmt.Errorf("%w: state is invalid", ErrInvalidInput)
	}
	input.PostalCode = optionalText(input.PostalCode, 20)
	var err error
	input.MainImageURL, err = optionalHTTPURL(input.MainImageURL, 2000)
	if err != nil {
		return fmt.Errorf("%w: main_image_url is invalid", ErrInvalidInput)
	}
	input.ResponsibleUserID = optionalUUID(input.ResponsibleUserID)
	if input.ResponsibleUserID != nil && !uuidPattern.MatchString(*input.ResponsibleUserID) {
		return fmt.Errorf("%w: responsible_user_id is invalid", ErrInvalidInput)
	}
	if err := validateDateSequence(input.LaunchDate, input.ExpectedDeliveryDate); err != nil {
		return err
	}
	if _, err := parseDate(input.ConstructionStartedAt); err != nil {
		return fmt.Errorf("%w: construction_started_at is invalid", ErrInvalidInput)
	}
	if input.Metadata == nil {
		input.Metadata = map[string]any{}
	}
	return validateMetadata(input.Metadata, 32<<10)
}

func (input *CreatePhaseInput) Validate() error {
	input.Code = trim(input.Code, 80)
	input.Name = trim(input.Name, 160)
	input.Status = defaultNormalized(input.Status, "planned")
	if input.Code == "" || input.Name == "" || !validPhaseStatuses[input.Status] || input.SortOrder < 0 {
		return fmt.Errorf("%w: phase data is invalid", ErrInvalidInput)
	}
	if err := validateDateSequence(input.LaunchDate, input.ExpectedDeliveryDate); err != nil {
		return err
	}
	if _, err := parseDate(input.ConstructionStartedAt); err != nil {
		return fmt.Errorf("%w: construction_started_at is invalid", ErrInvalidInput)
	}
	if input.Metadata == nil {
		input.Metadata = map[string]any{}
	}
	return validateMetadata(input.Metadata, 32<<10)
}

func (input *CreateBuildingInput) Validate() error {
	input.PhaseID = strings.TrimSpace(input.PhaseID)
	input.Code = trim(input.Code, 80)
	input.Name = trim(input.Name, 160)
	input.BuildingType = defaultNormalized(input.BuildingType, "tower")
	input.Status = defaultNormalized(input.Status, "planned")
	if !uuidPattern.MatchString(input.PhaseID) || input.Code == "" || input.Name == "" || !validBuildingTypes[input.BuildingType] || !validBuildingStatuses[input.Status] || input.SortOrder < 0 {
		return fmt.Errorf("%w: building data is invalid", ErrInvalidInput)
	}
	if input.FloorCount != nil && (*input.FloorCount < 0 || *input.FloorCount > 1000) {
		return fmt.Errorf("%w: floor_count must be between 0 and 1000", ErrInvalidInput)
	}
	if input.Metadata == nil {
		input.Metadata = map[string]any{}
	}
	return validateMetadata(input.Metadata, 32<<10)
}

func (input *CreateFloorPlanInput) Validate() error {
	input.Code = trim(input.Code, 80)
	input.Name = trim(input.Name, 160)
	input.Status = defaultNormalized(input.Status, "draft")
	input.PropertyType = optionalText(input.PropertyType, 120)
	input.Description = optionalText(input.Description, 5000)
	var err error
	input.ImageURL, err = optionalHTTPURL(input.ImageURL, 2000)
	if err != nil {
		return fmt.Errorf("%w: image_url is invalid", ErrInvalidInput)
	}
	if input.Code == "" || input.Name == "" || !validFloorPlanStatuses[input.Status] {
		return fmt.Errorf("%w: floor plan data is invalid", ErrInvalidInput)
	}
	for _, value := range []*int{input.Bedrooms, input.Suites, input.Bathrooms, input.ParkingSpaces} {
		if value != nil && (*value < 0 || *value > 1000) {
			return fmt.Errorf("%w: floor plan counts must be between 0 and 1000", ErrInvalidInput)
		}
	}
	if input.Suites != nil && input.Bedrooms != nil && *input.Suites > *input.Bedrooms {
		return fmt.Errorf("%w: suites cannot exceed bedrooms", ErrInvalidInput)
	}
	for _, value := range []*float64{input.PrivateArea, input.TotalArea, input.BalconyArea, input.GardenArea} {
		if value != nil && (*value <= 0 || *value > 10000000) {
			return fmt.Errorf("%w: floor plan areas must be positive and at most 10000000", ErrInvalidInput)
		}
	}
	if input.TotalArea != nil && input.PrivateArea != nil && *input.TotalArea < *input.PrivateArea {
		return fmt.Errorf("%w: total_area cannot be less than private_area", ErrInvalidInput)
	}
	if input.Metadata == nil {
		input.Metadata = map[string]any{}
	}
	return validateMetadata(input.Metadata, 32<<10)
}

func (input *BulkCreateUnitsInput) Validate() error {
	input.BuildingID = strings.TrimSpace(input.BuildingID)
	input.FloorPlanID = optionalUUID(input.FloorPlanID)
	input.Prefix = trim(input.Prefix, 24)
	input.PriceTableName = optionalText(input.PriceTableName, 160)
	if !uuidPattern.MatchString(input.BuildingID) || (input.FloorPlanID != nil && !uuidPattern.MatchString(*input.FloorPlanID)) {
		return fmt.Errorf("%w: structure reference is invalid", ErrInvalidInput)
	}
	if input.StartNumber < 0 || input.StartNumber > 1000000000 || input.StartFloor < -1000 || input.StartFloor > 10000 || input.Count < 1 || input.Count > 500 || input.UnitsPerFloor < 1 || input.UnitsPerFloor > 100 || input.NumberPadding < 0 || input.NumberPadding > 8 {
		return fmt.Errorf("%w: unit generation settings are invalid", ErrInvalidInput)
	}
	if input.InitialListPrice == nil || *input.InitialListPrice <= 0 || *input.InitialListPrice > 1000000000000 {
		return fmt.Errorf("%w: initial_list_price is required and must be at most 1000000000000", ErrInvalidInput)
	}
	if input.Metadata == nil {
		input.Metadata = map[string]any{}
	}
	return validateMetadata(input.Metadata, 8<<10)
}

func (input *UpdateUnitInput) Validate() error {
	if input.Status == nil && input.Published == nil {
		return fmt.Errorf("%w: at least one unit change is required", ErrInvalidInput)
	}
	if input.ExpectedUpdatedAt == nil {
		return fmt.Errorf("%w: expected_updated_at is required", ErrInvalidInput)
	}
	if input.Status != nil {
		status := normalized(*input.Status)
		if !validUnitStatuses[status] || status == "reserved" {
			return fmt.Errorf("%w: reserved status requires the reservation workflow", ErrInvalidInput)
		}
		input.Status = &status
	}
	if _, err := parseTimestamp(input.ExpectedUpdatedAt); err != nil {
		return fmt.Errorf("%w: expected_updated_at is invalid", ErrInvalidInput)
	}
	return nil
}

func (input *ActivatePriceTableInput) Validate() error {
	if _, err := parseTimestamp(input.ExpectedUpdatedAt); err != nil {
		return fmt.Errorf("%w: expected_updated_at is invalid", ErrInvalidInput)
	}
	return nil
}

func (input *CreateReservationInput) Validate(now time.Time) error {
	input.LeadID = optionalUUID(input.LeadID)
	if input.LeadID != nil && !uuidPattern.MatchString(*input.LeadID) {
		return fmt.Errorf("%w: lead_id is invalid", ErrInvalidInput)
	}
	input.Notes = optionalText(input.Notes, 2000)
	expiresAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(input.ExpiresAt))
	if err != nil {
		return fmt.Errorf("%w: expires_at is invalid", ErrInvalidInput)
	}
	if !expiresAt.After(now) || expiresAt.After(now.Add(30*24*time.Hour)) {
		return fmt.Errorf("%w: expires_at must be in the future and at most 30 days away", ErrInvalidInput)
	}
	input.ExpiresAt = expiresAt.UTC().Format(time.RFC3339Nano)
	expected, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(input.ExpectedUnitUpdatedAt))
	if err != nil {
		return fmt.Errorf("%w: expected_unit_updated_at is invalid", ErrInvalidInput)
	}
	input.ExpectedUnitUpdatedAt = expected.UTC().Format(time.RFC3339Nano)
	return nil
}

func (input *ReservationTransitionInput) Validate() error {
	expected, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(input.ExpectedUpdatedAt))
	if err != nil {
		return fmt.Errorf("%w: expected_updated_at is invalid", ErrInvalidInput)
	}
	input.ExpectedUpdatedAt = expected.UTC().Format(time.RFC3339Nano)
	return nil
}

func (input *CancelReservationInput) Validate() error {
	transition := ReservationTransitionInput{ExpectedUpdatedAt: input.ExpectedUpdatedAt}
	if err := transition.Validate(); err != nil {
		return err
	}
	input.ExpectedUpdatedAt = transition.ExpectedUpdatedAt
	input.CancellationReason = trim(input.CancellationReason, 500)
	if input.CancellationReason == "" {
		return fmt.Errorf("%w: cancellation reason is required", ErrInvalidInput)
	}
	return nil
}

func (input *ExtendReservationInput) Validate(now time.Time) error {
	transition := ReservationTransitionInput{ExpectedUpdatedAt: input.ExpectedUpdatedAt}
	if err := transition.Validate(); err != nil {
		return err
	}
	input.ExpectedUpdatedAt = transition.ExpectedUpdatedAt
	expiresAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(input.ExpiresAt))
	if err != nil {
		return fmt.Errorf("%w: expires_at is invalid", ErrInvalidInput)
	}
	if !expiresAt.After(now) || expiresAt.After(now.Add(30*24*time.Hour)) {
		return fmt.Errorf("%w: expires_at must be in the future and at most 30 days away", ErrInvalidInput)
	}
	input.ExpiresAt = expiresAt.UTC().Format(time.RFC3339Nano)
	return nil
}

func (input *UpdateUnitPriceInput) Validate() error {
	if input.ListPrice <= 0 || input.ListPrice > 1000000000000 {
		return fmt.Errorf("%w: list_price must be positive and at most 1000000000000", ErrInvalidInput)
	}
	if input.MinimumPrice != nil && (*input.MinimumPrice <= 0 || *input.MinimumPrice > input.ListPrice) {
		return fmt.Errorf("%w: minimum_price must be positive and no greater than list_price", ErrInvalidInput)
	}
	if input.PaymentTerms != nil {
		if err := validateMetadata(input.PaymentTerms, 16<<10); err != nil {
			return fmt.Errorf("%w: payment_terms is invalid", ErrInvalidInput)
		}
	}
	input.ExpectedPriceTableID = optionalUUID(input.ExpectedPriceTableID)
	input.ExpectedPriceTableUpdatedAt = optionalText(input.ExpectedPriceTableUpdatedAt, 80)
	if (input.ExpectedPriceTableID == nil) != (input.ExpectedPriceTableUpdatedAt == nil) {
		return fmt.Errorf("%w: price table optimistic preconditions must be provided together", ErrInvalidInput)
	}
	if input.ExpectedPriceTableID != nil && !uuidPattern.MatchString(*input.ExpectedPriceTableID) {
		return fmt.Errorf("%w: expected_price_table_id is invalid", ErrInvalidInput)
	}
	if input.ExpectedPriceTableUpdatedAt != nil {
		expected, err := time.Parse(time.RFC3339Nano, *input.ExpectedPriceTableUpdatedAt)
		if err != nil {
			return fmt.Errorf("%w: expected_price_table_updated_at is invalid", ErrInvalidInput)
		}
		normalizedTimestamp := expected.UTC().Format(time.RFC3339Nano)
		input.ExpectedPriceTableUpdatedAt = &normalizedTimestamp
	}
	return nil
}

func stringSet(values ...string) map[string]bool {
	set := make(map[string]bool, len(values))
	for _, value := range values {
		set[value] = true
	}
	return set
}

func normalized(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func defaultNormalized(value, fallback string) string {
	value = normalized(value)
	if value == "" {
		return fallback
	}
	return value
}

func trim(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > limit {
		runes = runes[:limit]
	}
	return string(runes)
}

func optionalText(value *string, limit int) *string {
	if value == nil {
		return nil
	}
	result := trim(*value, limit)
	if result == "" {
		return nil
	}
	return &result
}

func optionalUpper(value *string, limit int) *string {
	value = optionalText(value, limit)
	if value == nil {
		return nil
	}
	result := strings.ToUpper(*value)
	return &result
}

func optionalUUID(value *string) *string {
	return optionalText(value, 80)
}

func optionalHTTPURL(value *string, limit int) (*string, error) {
	value = optionalText(value, limit)
	if value == nil {
		return nil, nil
	}
	parsed, err := url.ParseRequestURI(*value)
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return nil, ErrInvalidInput
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return nil, ErrInvalidInput
	}
	return value, nil
}

func parseDate(value *string) (*time.Time, error) {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil, nil
	}
	parsed, err := time.Parse("2006-01-02", strings.TrimSpace(*value))
	return &parsed, err
}

func validateDateSequence(start, end *string) error {
	startDate, err := parseDate(start)
	if err != nil {
		return fmt.Errorf("%w: launch_date is invalid", ErrInvalidInput)
	}
	endDate, err := parseDate(end)
	if err != nil {
		return fmt.Errorf("%w: expected_delivery_date is invalid", ErrInvalidInput)
	}
	if startDate != nil && endDate != nil && endDate.Before(*startDate) {
		return fmt.Errorf("%w: expected_delivery_date cannot precede launch_date", ErrInvalidInput)
	}
	return nil
}

func parseTimestamp(value *string) (*time.Time, error) {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(*value))
	return &parsed, err
}

func validateMetadata(metadata map[string]any, maximumBytes int) error {
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("%w: metadata must be valid JSON", ErrInvalidInput)
	}
	if len(encoded) > maximumBytes {
		return fmt.Errorf("%w: metadata exceeds %d bytes", ErrInvalidInput, maximumBytes)
	}
	return nil
}
