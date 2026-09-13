package properties

import (
	"errors"
	"strings"
	"testing"
)

const (
	testOrganizationID = "11111111-1111-4111-8111-111111111111"
	testPropertyID     = "22222222-2222-4222-8222-222222222222"
	testAssetID        = "33333333-3333-4333-8333-333333333333"
)

func TestCreatePropertyOwnershipInputRequiresExactlyOneOwnerSource(t *testing.T) {
	base := CreatePropertyOwnershipInput{OwnershipPercentage: 100, ValidFrom: "2026-08-01"}
	if err := base.Validate(); err == nil {
		t.Fatal("expected missing owner source to fail")
	}
	ownerID := "44444444-4444-4444-8444-444444444444"
	base.OwnerID = &ownerID
	base.NewOwner = &PropertyOwnerDetailsInput{Name: "Maria"}
	if err := base.Validate(); err == nil {
		t.Fatal("expected two owner sources to fail")
	}
	base.NewOwner = nil
	if err := base.Validate(); err != nil {
		t.Fatalf("expected an existing owner link to pass: %v", err)
	}
}

func TestPropertyAssetValidationEnforcesTenantLocatorAndSafeURL(t *testing.T) {
	mimeType := "image/jpeg"
	size := int64(1024)
	validPath := "orgs/" + testOrganizationID + "/properties/" + testPropertyID + "/" + testAssetID + "/photo.jpg"
	input := CreatePropertyAssetInput{
		AssetType: "photo", Visibility: "public", StoragePath: &validPath,
		MIMEType: &mimeType, FileSizeBytes: &size, Metadata: map[string]any{},
	}
	if err := input.Validate(testOrganizationID, testPropertyID); err != nil {
		t.Fatalf("expected canonical private asset path to pass: %v", err)
	}

	wrongPath := "orgs/" + testOrganizationID + "/properties/" + testPropertyID + "/photo.jpg"
	input.StoragePath = &wrongPath
	if err := input.Validate(testOrganizationID, testPropertyID); err == nil {
		t.Fatal("expected path without asset UUID segment to fail")
	}

	unsafeURL := "javascript:alert(1)"
	input = CreatePropertyAssetInput{AssetType: "photo", Visibility: "public", ExternalURL: &unsafeURL}
	if err := input.Validate(testOrganizationID, testPropertyID); err == nil {
		t.Fatal("expected a non-http external URL to fail")
	}

	internalURL := "https://example.test/photo.jpg"
	input = CreatePropertyAssetInput{AssetType: "photo", Visibility: "internal", ExternalURL: &internalURL, IsPrimary: true}
	if err := input.Validate(testOrganizationID, testPropertyID); err == nil {
		t.Fatal("expected an internal photo to be rejected as primary")
	}
}

func TestPropertyAssetInputRejectsIntegrationLifecycleMetadata(t *testing.T) {
	externalURL := "https://example.test/photo.jpg"
	for _, key := range []string{
		"integration_retired",
		"integration_managed",
		"integration_provider",
		"integration_providers",
		" Integration_Retired ",
	} {
		t.Run(strings.TrimSpace(key), func(t *testing.T) {
			create := CreatePropertyAssetInput{
				AssetType: "photo", Visibility: "public", ExternalURL: &externalURL,
				Metadata: map[string]any{key: true},
			}
			if err := create.Validate(testOrganizationID, testPropertyID); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("create metadata key %q error = %v, want invalid input", key, err)
			}

			update := UpdatePropertyAssetInput{
				AssetType: "photo", Visibility: "public", Metadata: map[string]any{key: true},
				ExpectedUpdatedAt: "2026-08-01T10:00:00Z",
			}
			if err := update.Validate(); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("update metadata key %q error = %v, want invalid input", key, err)
			}
		})
	}
}

func TestPropertyAssetMetadataMergePreservesIntegrationLifecycleFields(t *testing.T) {
	current := map[string]any{
		"integration_retired":   false,
		"integration_managed":   true,
		"integration_provider":  "vista",
		"integration_providers": []any{"vista"},
		"old_user_field":        "remove",
	}
	merged := mergePropertyAssetMetadata(current, map[string]any{"caption_source": "broker"})

	for _, key := range []string{
		"integration_retired",
		"integration_managed",
		"integration_provider",
		"integration_providers",
	} {
		if _, exists := merged[key]; !exists {
			t.Fatalf("reserved metadata %q was removed: %#v", key, merged)
		}
	}
	if merged["caption_source"] != "broker" {
		t.Fatalf("requested metadata was not retained: %#v", merged)
	}
	if _, exists := merged["old_user_field"]; exists {
		t.Fatalf("non-reserved previous metadata survived replacement: %#v", merged)
	}
}

func TestActivePropertyAssetPredicateRecognizesIntegrationRetirementMarker(t *testing.T) {
	predicate := activePropertyAssetSQL("asset")
	for _, required := range []string{"asset.metadata->>'integration_retired'", "not in", "'true'", "'1'"} {
		if !strings.Contains(predicate, required) {
			t.Fatalf("active asset predicate is missing %q: %s", required, predicate)
		}
	}
}

func TestPropertyAssetUploadIntentValidationMatchesPrivateBucket(t *testing.T) {
	valid := CreatePropertyAssetUploadIntentInput{
		AssetType: "floor_plan", FileName: "Planta final.pdf",
		MIMEType: "application/pdf", FileSizeBytes: 2048,
	}
	if err := valid.Validate(); err != nil {
		t.Fatalf("expected floor plan PDF to pass: %v", err)
	}
	if valid.FileName != "Planta-final.pdf" {
		t.Fatalf("sanitized file name = %q", valid.FileName)
	}
	invalid := CreatePropertyAssetUploadIntentInput{
		AssetType: "document", FileName: "document.png",
		MIMEType: "image/png", FileSizeBytes: 100,
	}
	if err := invalid.Validate(); err == nil {
		t.Fatal("expected non-PDF document upload to fail")
	}
}

func TestPropertyAssetTextValidationRejectsOverflowWithoutTruncating(t *testing.T) {
	externalURL := "https://example.test/photo.jpg"
	longTitle := strings.Repeat("a", 241)
	create := CreatePropertyAssetInput{
		AssetType: "photo", Visibility: "public", ExternalURL: &externalURL, Title: &longTitle,
	}
	if err := create.Validate(testOrganizationID, testPropertyID); err == nil {
		t.Fatal("expected an overlong asset title to fail")
	}
	if create.Title == nil || *create.Title != longTitle {
		t.Fatalf("overlong title was mutated to %#v", create.Title)
	}

	longURL := "https://example.test/" + strings.Repeat("a", 2_000)
	update := UpdatePropertyAssetInput{
		AssetType: "photo", Visibility: "public",
		ExternalURL:       workspaceOptionalString{Set: true, Value: &longURL},
		ExpectedUpdatedAt: "2026-08-01T10:00:00Z",
	}
	if err := update.Validate(); err == nil {
		t.Fatal("expected an overlong external URL to fail")
	}
	if update.ExternalURL.Value == nil || *update.ExternalURL.Value != longURL {
		t.Fatalf("overlong URL was mutated to %#v", update.ExternalURL.Value)
	}
}

func TestPropertyAssetUploadFileNameRejectsOverflowInsteadOfTruncating(t *testing.T) {
	input := CreatePropertyAssetUploadIntentInput{
		AssetType: "photo", FileName: strings.Repeat("a", propertyAssetMaxUploadFileName+1),
		MIMEType: "image/jpeg", FileSizeBytes: 1024,
	}
	if err := input.Validate(); err == nil {
		t.Fatal("expected an overlong upload file name to fail")
	}
	if len(input.FileName) != propertyAssetMaxUploadFileName+1 {
		t.Fatalf("overlong upload file name was truncated to %d bytes", len(input.FileName))
	}
}

func TestPropertyAssetUploadDiscardStaysInsideCanonicalNamespace(t *testing.T) {
	valid := DiscardPropertyAssetUploadInput{
		StoragePath: "orgs/" + testOrganizationID + "/properties/" + testPropertyID + "/" + testAssetID + "/photo.jpg",
	}
	if err := valid.Validate(testOrganizationID, testPropertyID); err != nil {
		t.Fatalf("expected canonical discard path to pass: %v", err)
	}
	invalid := DiscardPropertyAssetUploadInput{StoragePath: "orgs/another/properties/" + testPropertyID + "/" + testAssetID + "/photo.jpg"}
	if err := invalid.Validate(testOrganizationID, testPropertyID); err == nil {
		t.Fatal("expected cross-organization discard path to fail")
	}
}

func TestPropertyAssetOrderRejectsDuplicatePositions(t *testing.T) {
	input := ReorderPropertyAssetsInput{Items: []PropertyAssetOrderItem{
		{ID: testAssetID, SortOrder: 0, ExpectedUpdatedAt: "2026-08-01T10:00:00Z"},
		{ID: "55555555-5555-4555-8555-555555555555", SortOrder: 0, ExpectedUpdatedAt: "2026-08-01T10:00:00Z"},
	}}
	if err := input.Validate(); err == nil {
		t.Fatal("expected duplicate asset order positions to fail")
	}
}

func TestCompletePropertyAssetOrderRejectsOmittedAndMixedTypeAssets(t *testing.T) {
	const (
		firstID  = "44444444-4444-4444-8444-444444444444"
		secondID = "55555555-5555-4555-8555-555555555555"
		videoID  = "66666666-6666-4666-8666-666666666666"
		version  = "2026-08-01T10:00:00Z"
	)
	versions := map[string]propertyAssetOrderVersion{
		firstID:  {AssetType: "photo", UpdatedAt: version},
		secondID: {AssetType: "photo", UpdatedAt: version},
		videoID:  {AssetType: "video", UpdatedAt: version},
	}
	typeCounts := map[string]int{"photo": 2, "video": 1}

	partial := []PropertyAssetOrderItem{{ID: firstID, SortOrder: 0, ExpectedUpdatedAt: version}}
	if err := validateCompletePropertyAssetOrder(partial, versions, typeCounts); !errors.Is(err, ErrPropertyWorkspaceConflict) {
		t.Fatalf("partial order error = %v, want workspace conflict", err)
	}

	mixed := []PropertyAssetOrderItem{
		{ID: firstID, SortOrder: 0, ExpectedUpdatedAt: version},
		{ID: videoID, SortOrder: 1, ExpectedUpdatedAt: version},
	}
	if err := validateCompletePropertyAssetOrder(mixed, versions, typeCounts); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("mixed-type order error = %v, want invalid input", err)
	}

	complete := []PropertyAssetOrderItem{
		{ID: firstID, SortOrder: 1, ExpectedUpdatedAt: version},
		{ID: secondID, SortOrder: 0, ExpectedUpdatedAt: version},
	}
	if err := validateCompletePropertyAssetOrder(complete, versions, typeCounts); err != nil {
		t.Fatalf("complete same-type order returned error: %v", err)
	}
}

func TestOwnershipEndUsesHalfOpenInterval(t *testing.T) {
	input := EndPropertyOwnershipInput{ValidTo: "2026-08-02", ExpectedUpdatedAt: "2026-08-01T10:00:00Z"}
	if err := input.Validate(); err != nil {
		t.Fatalf("expected valid half-open end input: %v", err)
	}
	invalid := EndPropertyOwnershipInput{ValidTo: "2026-08-02", ExpectedUpdatedAt: "yesterday"}
	if err := invalid.Validate(); err == nil {
		t.Fatal("expected invalid optimistic version to fail")
	}
}

func TestWorkspaceTimestampsEqualAcceptsPostgresTextAndRFC3339(t *testing.T) {
	if !workspaceTimestampsEqual(
		"2026-08-01 12:34:56.123456+00",
		"2026-08-01T12:34:56.123456Z",
	) {
		t.Fatal("expected PostgreSQL timestamptz text to equal its RFC3339 representation")
	}
	if workspaceTimestampsEqual(
		"2026-08-01 12:34:56.123456+00",
		"2026-08-01T12:34:57.123456Z",
	) {
		t.Fatal("different timestamps must not compare equal")
	}
}
