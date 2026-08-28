package properties

import "testing"

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
