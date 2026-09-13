package properties

import (
	"os"
	"strings"
	"testing"
)

const propertyMediaLifecycleMigration = "../../../../supabase/migrations/20260908000636_normalize_property_media_lifecycle.sql"
const propertyOpenAPIContract = "../../../../packages/contracts/openapi/v1.yaml"

func TestPropertyMediaLifecycleMigrationHasDurablePrivateCleanupAndLegacyMirror(t *testing.T) {
	raw, err := os.ReadFile(propertyMediaLifecycleMigration)
	if err != nil {
		t.Fatal(err)
	}
	source := strings.ToLower(string(raw))
	for _, required := range []string{
		"property_asset_upload_intents",
		"property_asset_storage_cleanup_queue",
		"property_assets_queue_storage_cleanup",
		"property_asset_upload_intents_queue_cleanup_on_cascade",
		"properties_mirror_legacy_photos_to_assets",
		"for each row",
		"external_origin_uncontrolled",
		"property_assets_primary_public_check",
		"drop_property_browser_mutation_policies",
		"enable row level security",
		"from public, anon, authenticated, service_role",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("property media lifecycle migration is missing %q", required)
		}
	}
	if !strings.Contains(source, "not exists (\n      select 1\n      from public.property_assets as existing_primary") {
		t.Fatal("legacy backfill can still conflict with an existing canonical primary photo")
	}
}

func TestPropertyAssetCleanupWorkerUsesLeasesAndRemovesOnlyPrivateBucketObjects(t *testing.T) {
	raw, err := os.ReadFile("workspace_asset_lifecycle.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, required := range []string{
		"for update skip locked",
		"cleanup_claimed_until",
		"propertyPrivateBucket",
		"repo.storage.remove",
		"StartAssetCleanupWorker",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("property asset cleanup worker is missing %q", required)
		}
	}
}

func TestSinglePathPropertyAssetCleanupClaimsTheQueueBeforeStorageRemoval(t *testing.T) {
	raw, err := os.ReadFile("workspace_asset_lifecycle.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) cleanupQueuedPropertyAssetStoragePath(")
	if start < 0 {
		t.Fatal("single-path property asset cleanup implementation was not found")
	}
	remaining := source[start+1:]
	end := strings.Index(remaining, "\nfunc (repo Repository)")
	if end < 0 {
		t.Fatal("single-path property asset cleanup boundary was not found")
	}
	cleanup := source[start : start+1+end]
	for _, required := range []string{
		"for update skip locked",
		"cleanup_attempts = queued.cleanup_attempts + 1",
		"available_at = now() + interval '2 minutes'",
		"returning queued.id::text, queued.storage_path",
		"recordQueuedPropertyAssetCleanupFailure(context.WithoutCancel(ctx), candidate.ID, err)",
	} {
		if !strings.Contains(cleanup, required) {
			t.Fatalf("single-path cleanup does not claim/lease by queue identity before Storage removal: missing %q", required)
		}
	}
	if strings.Contains(cleanup, "select exists") {
		t.Fatal("single-path cleanup still has an unclaimed check-then-remove race")
	}
}

func TestPropertyAssetUploadPendingLimitIgnoresConsumedTombstones(t *testing.T) {
	raw, err := os.ReadFile("workspace_ownership_assets.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) CreatePropertyAssetUploadIntent(")
	if start < 0 {
		t.Fatal("property asset upload intent implementation was not found")
	}
	pendingStart := strings.Index(source[start:], "select count(*)::integer")
	if pendingStart < 0 {
		t.Fatal("pending upload count query was not found")
	}
	pendingStart += start
	pendingEnd := strings.Index(source[pendingStart:], ").Scan(&pendingCount)")
	if pendingEnd < 0 {
		t.Fatal("pending upload count query boundary was not found")
	}
	pendingQuery := source[pendingStart : pendingStart+pendingEnd]
	if !strings.Contains(pendingQuery, "and consumed_at is null") {
		t.Fatal("consumed upload tombstones still count against the pending-intent limit")
	}
	if strings.Contains(pendingQuery, "discard_requested_at is null") {
		t.Fatal("discarded intents still carry a live signed token and must count against the upload-intent quota")
	}
	if !strings.Contains(pendingQuery, "propertyAssetUploadExpiryMargin/time.Second") {
		t.Fatal("upload-intent quota must cover the conservative signed-token expiry margin")
	}
}

func TestSignedUploadLifecycleRetainsTombstonesUntilTokenExpiryMargin(t *testing.T) {
	lifecycleRaw, err := os.ReadFile("workspace_asset_lifecycle.go")
	if err != nil {
		t.Fatal(err)
	}
	lifecycle := string(lifecycleRaw)
	for _, required := range []string{
		"set consumed_at = now()",
		"intent.consumed_at is null",
		"propertyAssetUploadExpiryMargin",
		"candidate.Consumed",
	} {
		if !strings.Contains(lifecycle, required) {
			t.Fatalf("signed upload tombstone lifecycle is missing %q", required)
		}
	}

	assetsRaw, err := os.ReadFile("workspace_ownership_assets.go")
	if err != nil {
		t.Fatal(err)
	}
	assets := string(assetsRaw)
	start := strings.Index(assets, "func (repo Repository) DiscardPropertyAssetUpload(")
	end := strings.Index(assets[start+1:], "\nfunc (repo Repository)")
	if start < 0 || end < 0 {
		t.Fatal("discard upload implementation was not found")
	}
	discard := assets[start : start+1+end]
	if strings.Contains(discard, "repo.storage.remove") ||
		!strings.Contains(discard, "discard_requested_at") {
		t.Fatal("discard must retain the object/tombstone until the signed token expires")
	}
}

func TestPropertyPhotoLimitIsCheckedAfterThePropertyLock(t *testing.T) {
	raw, err := os.ReadFile("workspace_ownership_assets.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	lockIndex := strings.Index(source, "lockWorkspaceProperty(ctx, tx, tenantContext.OrganizationID, propertyID)")
	limitIndex := strings.Index(source, "ensurePropertyPhotoAssetCapacity(")
	if lockIndex < 0 || limitIndex < 0 || limitIndex < lockIndex {
		t.Fatal("photo capacity must be checked while holding the property row lock")
	}
}

func TestPropertyPrimaryPhotoSyncPromotesAStoredReplacement(t *testing.T) {
	raw, err := os.ReadFile("workspace_ownership_assets.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func syncLegacyPropertyPrimaryPhoto(")
	if start < 0 {
		t.Fatal("primary photo synchronization implementation was not found")
	}
	remaining := source[start+1:]
	end := strings.Index(remaining, "\nfunc ")
	if end < 0 {
		t.Fatal("primary photo synchronization boundary was not found")
	}
	syncPrimary := source[start : start+1+end]
	promotionEnd := strings.Index(syncPrimary, "\n\t_, err = tx.Exec")
	if promotionEnd < 0 {
		t.Fatal("canonical primary promotion query boundary was not found")
	}
	promotion := syncPrimary[:promotionEnd]
	for _, required := range []string{
		"with replacement_primary as",
		"and asset.visibility = 'public'",
		"and current_primary.is_primary",
		"order by asset.sort_order, asset.created_at, asset.id",
		"set is_primary = true",
	} {
		if !strings.Contains(syncPrimary, required) {
			t.Fatalf("primary photo synchronization cannot promote a canonical replacement: missing %q", required)
		}
	}
	if strings.Contains(promotion, "external_url") {
		t.Fatal("canonical replacement promotion is still restricted to external URLs")
	}
}

func TestPropertyAssetUploadDiscardRouteIsDocumented(t *testing.T) {
	raw, err := os.ReadFile(propertyOpenAPIContract)
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	pathIndex := strings.Index(source, "  /v1/properties/{id}/assets/upload-intents:")
	nextPathIndex := strings.Index(source[pathIndex+1:], "\n  /v1/")
	if pathIndex < 0 || nextPathIndex < 0 {
		t.Fatal("property upload-intent path is missing from OpenAPI")
	}
	operation := source[pathIndex : pathIndex+1+nextPathIndex]
	for _, required := range []string{
		"    delete:",
		"#/components/schemas/DiscardPropertyAssetUploadRequest",
		"#/components/schemas/PropertyAssetUploadDiscardResponse",
		"        \"200\":",
		"        \"400\":",
		"        \"403\":",
		"        \"404\":",
	} {
		if !strings.Contains(operation, required) {
			t.Fatalf("property upload discard OpenAPI operation is missing %q", required)
		}
	}
}
