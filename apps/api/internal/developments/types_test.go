package developments

import (
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"
)

const testUUID = "11111111-1111-4111-8111-111111111111"

func TestCreateDevelopmentInputAppliesSafeDefaults(t *testing.T) {
	input := CreateDevelopmentInput{Code: "  RES-01  ", Name: "  Reserva do Parque  "}
	if err := input.Validate(); err != nil {
		t.Fatalf("Validate returned %v", err)
	}
	if input.Code != "RES-01" || input.Name != "Reserva do Parque" {
		t.Fatalf("identity was not normalized: %#v", input)
	}
	if input.DevelopmentType != "vertical" || input.Status != "planning" || input.CommercialStatus != "draft" {
		t.Fatalf("safe defaults were not applied: %#v", input)
	}
	if input.Metadata == nil {
		t.Fatal("metadata must be normalized to an object")
	}
}

func TestCreateDevelopmentInputRejectsInvalidDateSequence(t *testing.T) {
	launch := "2027-06-01"
	delivery := "2027-05-31"
	input := CreateDevelopmentInput{
		Code: "RES-01", Name: "Reserva", LaunchDate: &launch, ExpectedDeliveryDate: &delivery,
	}
	if err := input.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("Validate error = %v, want ErrInvalidInput", err)
	}
}

func TestCreateDevelopmentInputRejectsPrematurePublication(t *testing.T) {
	input := CreateDevelopmentInput{Code: "RES-01", Name: "Reserva", PublishedOnSite: true}
	if err := input.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("published create error = %v, want ErrInvalidInput", err)
	}
}

func TestDevelopmentInputsRejectUnsafeImageURLs(t *testing.T) {
	unsafeURL := "javascript:alert(1)"
	development := CreateDevelopmentInput{Code: "RES-01", Name: "Reserva", MainImageURL: &unsafeURL}
	if err := development.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unsafe development image error = %v, want ErrInvalidInput", err)
	}

	ftpURL := "ftp://example.com/planta.png"
	floorPlan := CreateFloorPlanInput{Code: "PL-01", Name: "Planta", ImageURL: &ftpURL}
	if err := floorPlan.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unsafe floor-plan image error = %v, want ErrInvalidInput", err)
	}
}

func TestBulkCreateUnitsInputBoundaries(t *testing.T) {
	initialPrice := 750000.0
	valid := BulkCreateUnitsInput{
		BuildingID:       testUUID,
		StartNumber:      1,
		Count:            500,
		UnitsPerFloor:    10,
		NumberPadding:    3,
		InitialListPrice: &initialPrice,
	}
	if err := valid.Validate(); err != nil {
		t.Fatalf("maximum supported bulk should be valid: %v", err)
	}
	invalid := valid
	invalid.Count = 501
	if err := invalid.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("count 501 error = %v, want ErrInvalidInput", err)
	}
	extremePrice := 1e100
	invalid = valid
	invalid.InitialListPrice = &extremePrice
	if err := invalid.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("extreme price error = %v, want ErrInvalidInput", err)
	}
	invalid = valid
	invalid.Metadata = map[string]any{"large": strings.Repeat("x", 9<<10)}
	if err := invalid.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("large metadata error = %v, want ErrInvalidInput", err)
	}
}

func TestUpdateUnitInputRejectsManualReservation(t *testing.T) {
	status := "reserved"
	input := UpdateUnitInput{Status: &status}
	if err := input.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("manual reservation error = %v, want ErrInvalidInput", err)
	}
	published := true
	input = UpdateUnitInput{Published: &published}
	if err := input.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("missing optimistic precondition error = %v, want ErrInvalidInput", err)
	}
}

func TestParseListFilterValidatesPaginationAndEnums(t *testing.T) {
	filter, err := ParseListFilter(url.Values{
		"development_type":  {"vertical"},
		"status":            {"launched"},
		"commercial_status": {"active"},
		"limit":             {"48"},
		"offset":            {"24"},
	})
	if err != nil {
		t.Fatalf("ParseListFilter returned %v", err)
	}
	if filter.Limit != 48 || filter.Offset != 24 {
		t.Fatalf("unexpected pagination: %#v", filter)
	}
	if filter.DevelopmentType != "vertical" {
		t.Fatalf("development type = %q, want vertical", filter.DevelopmentType)
	}
	if _, err := ParseListFilter(url.Values{"limit": {"101"}}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("limit 101 error = %v, want ErrInvalidInput", err)
	}
	if _, err := ParseListFilter(url.Values{"development_type": {"castle"}}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid development type error = %v, want ErrInvalidInput", err)
	}
}

func TestParseUnitListFilterValidatesScopeAndPagination(t *testing.T) {
	filter, err := ParseUnitListFilter(url.Values{
		"building_id": {testUUID},
		"status":      {"available"},
		"search":      {"  A-101  "},
		"limit":       {"75"},
		"offset":      {"25"},
	})
	if err != nil {
		t.Fatalf("ParseUnitListFilter returned %v", err)
	}
	if filter.BuildingID != testUUID || filter.Status != "available" || filter.Search != "A-101" {
		t.Fatalf("unexpected normalized unit filter: %#v", filter)
	}
	if filter.Limit != 75 || filter.Offset != 25 {
		t.Fatalf("unexpected unit pagination: %#v", filter)
	}
	if _, err := ParseUnitListFilter(url.Values{"building_id": {"not-a-uuid"}}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid building_id error = %v, want ErrInvalidInput", err)
	}
	if _, err := ParseUnitListFilter(url.Values{"status": {"reserved-by-hand"}}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid unit status error = %v, want ErrInvalidInput", err)
	}
	if _, err := ParseUnitListFilter(url.Values{"limit": {"201"}}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unit limit 201 error = %v, want ErrInvalidInput", err)
	}
}

func TestParseReservationListFilterValidatesFiltersAndPagination(t *testing.T) {
	filter, err := ParseReservationListFilter(url.Values{
		"status":  {"active"},
		"unit_id": {testUUID},
		"lead_id": {"22222222-2222-4222-8222-222222222222"},
		"limit":   {"100"},
		"offset":  {"25"},
	})
	if err != nil {
		t.Fatalf("ParseReservationListFilter returned %v", err)
	}
	if filter.Status != "active" || filter.UnitID != testUUID || filter.Limit != 100 || filter.Offset != 25 {
		t.Fatalf("unexpected reservation filter: %#v", filter)
	}
	if _, err := ParseReservationListFilter(url.Values{"status": {"elapsed"}}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid status error = %v, want ErrInvalidInput", err)
	}
	if _, err := ParseReservationListFilter(url.Values{"lead_id": {"cross-tenant"}}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid lead error = %v, want ErrInvalidInput", err)
	}
	if _, err := ParseReservationListFilter(url.Values{"limit": {"201"}}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("limit 201 error = %v, want ErrInvalidInput", err)
	}
}

func TestReservationInputsEnforceOperationalWindowAndOptimisticPreconditions(t *testing.T) {
	now := time.Date(2027, time.January, 2, 12, 0, 0, 0, time.UTC)
	validExpiration := now.Add(48 * time.Hour).Format(time.RFC3339Nano)
	input := CreateReservationInput{
		ExpiresAt:             validExpiration,
		ExpectedUnitUpdatedAt: now.Add(-time.Minute).Format(time.RFC3339Nano),
	}
	if err := input.Validate(now); err != nil {
		t.Fatalf("valid reservation input returned %v", err)
	}

	tooFar := input
	tooFar.ExpiresAt = now.Add(30*24*time.Hour + time.Nanosecond).Format(time.RFC3339Nano)
	if err := tooFar.Validate(now); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("31-day reservation error = %v, want ErrInvalidInput", err)
	}

	extend := ExtendReservationInput{
		ExpectedUpdatedAt: now.Format(time.RFC3339Nano),
		ExpiresAt:         now.Add(-time.Second).Format(time.RFC3339Nano),
	}
	if err := extend.Validate(now); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("past extension error = %v, want ErrInvalidInput", err)
	}

	cancel := CancelReservationInput{ExpectedUpdatedAt: now.Format(time.RFC3339Nano)}
	if err := cancel.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("missing cancellation reason error = %v, want ErrInvalidInput", err)
	}
}

func TestUpdateUnitPriceInputValidatesCommercialBounds(t *testing.T) {
	minimum := 900000.0
	input := UpdateUnitPriceInput{ListPrice: 850000, MinimumPrice: &minimum}
	if err := input.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("minimum above list error = %v, want ErrInvalidInput", err)
	}

	expectedID := testUUID
	input = UpdateUnitPriceInput{ListPrice: 850000, ExpectedPriceTableID: &expectedID}
	if err := input.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("partial optimistic precondition error = %v, want ErrInvalidInput", err)
	}

	input = UpdateUnitPriceInput{
		ListPrice:    850000,
		PaymentTerms: map[string]any{"signal": 0.2},
	}
	if err := input.Validate(); err != nil {
		t.Fatalf("valid price input returned %v", err)
	}
}

func TestReservationFingerprintIsStableAfterNormalization(t *testing.T) {
	now := time.Date(2027, time.January, 2, 12, 0, 0, 0, time.UTC)
	upperLeadID := "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF"
	lowerLeadID := strings.ToLower(upperLeadID)
	first := CreateReservationInput{
		LeadID:                &upperLeadID,
		ExpiresAt:             "2027-01-04T09:00:00-03:00",
		ExpectedUnitUpdatedAt: "2027-01-02T09:00:00-03:00",
	}
	second := CreateReservationInput{
		LeadID:                &lowerLeadID,
		ExpiresAt:             "2027-01-04T12:00:00Z",
		ExpectedUnitUpdatedAt: "2027-01-02T12:00:00Z",
	}
	if err := first.Validate(now); err != nil {
		t.Fatal(err)
	}
	if err := second.Validate(now); err != nil {
		t.Fatal(err)
	}
	firstHash := reservationFingerprint(strings.ToUpper(testUUID), strings.ToUpper(testUUID), strings.ToUpper(testUUID), first)
	secondHash := reservationFingerprint(testUUID, testUUID, testUUID, second)
	if firstHash != secondHash {
		t.Fatalf("equivalent timestamps produced different fingerprints: %s != %s", firstHash, secondHash)
	}
}
