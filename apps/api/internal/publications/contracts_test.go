package publications

import (
	"os"
	"strings"
	"testing"
)

func TestWorkerUsesDurableClaimAndLeaseFencing(t *testing.T) {
	raw, err := os.ReadFile("worker.go")
	if err != nil {
		t.Fatalf("read worker: %v", err)
	}
	worker := string(raw)
	for _, required := range []string{
		"private.claim_property_channel_publication_jobs",
		"lease_token = $3::uuid",
		"private.complete_property_channel_publication_job",
		"private.fail_property_channel_publication_job",
		"snapshot_changed",
	} {
		if !strings.Contains(worker, required) {
			t.Fatalf("worker is missing durable contract %q", required)
		}
	}
}

func TestPublicationCommandsTimestampJobsAfterThePublicationLock(t *testing.T) {
	repositoryRaw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	repository := string(repositoryRaw)
	lock := strings.Index(repository, "loadPublicationSource(ctx, tx, tenantContext, propertyID, true)")
	enqueue := strings.Index(repository, "func (repo Repository) enqueueJob(")
	if lock < 0 || enqueue < 0 || lock >= enqueue {
		t.Fatal("publication command must lock the source before enqueueing")
	}
	if !strings.Contains(repository[enqueue:], "clock_timestamp()") {
		t.Fatal("publication jobs must receive clock_timestamp() only after the command acquired its property/publication lock")
	}
}

func TestPublicMediaContractKeepsEveryDeliveredVersionUntilImmediateUnpublish(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository: %v", err)
	}
	repository := string(raw)
	for _, required := range []string{
		"publication.desired_state = 'published'",
		"publication.published_version = version.version",
		"delivered_job.version_id = version.id",
		"delivered_job.action in ('publish', 'update', 'revalidate')",
		"delivered_job.status = 'succeeded'",
		"version.version = $2",
		"media->>'source_hash'",
		"asset.checksum_sha256",
		"extensions.digest",
		"asset.visibility = 'public'",
	} {
		if !strings.Contains(repository, required) {
			t.Fatalf("public media resolver is missing %q", required)
		}
	}
}

func TestPropertyAssetGuardMatchesEveryServablePublicationVersion(t *testing.T) {
	raw, err := os.ReadFile("../properties/workspace_ownership_assets.go")
	if err != nil {
		t.Fatal(err)
	}
	guard := string(raw)
	for _, required := range []string{
		"publication.desired_state = 'published'",
		"publication.published_version = version.version",
		"delivered_job.version_id = version.id",
		"delivered_job.action in ('publish', 'update', 'revalidate')",
		"delivered_job.status = 'succeeded'",
		"media->>'asset_id' = $3",
	} {
		if !strings.Contains(guard, required) {
			t.Fatalf("servable-version asset guard is missing %q", required)
		}
	}
}

func TestWorkerKeepsLegacySiteFlagScopedToSiteChannel(t *testing.T) {
	raw, err := os.ReadFile("worker.go")
	if err != nil {
		t.Fatalf("read worker: %v", err)
	}
	worker := string(raw)
	if strings.Count(worker, "if scope.Channel == SiteChannel") < 4 {
		t.Fatal("site publisher and published_on_site projections must remain guarded by the site channel")
	}
	for _, required := range []string{
		"evaluatePublicationReadiness(scope, source)",
		"buildPublicationSnapshot(scope, source",
		"source.GrupoOLXIntegrationID != scope.AccountKey",
	} {
		if !strings.Contains(worker, required) {
			t.Fatalf("channel-aware worker contract is missing %q", required)
		}
	}
}

func TestWorkerFailureIsFencedAndKeepsLastGoodVersionAvailable(t *testing.T) {
	raw, err := os.ReadFile("worker.go")
	if err != nil {
		t.Fatalf("read worker: %v", err)
	}
	worker := string(raw)
	for _, required := range []string{
		"current_version = $9",
		"action = $8",
		"version_id is not distinct from nullif($10, '')::uuid",
		"order by latest_job.created_at desc, latest_job.id desc",
		"when desired_state = 'published' and published_version is not null then 'published'",
		"case when published_version is not null then 'published' else 'error' end",
	} {
		if !strings.Contains(worker, required) {
			t.Fatalf("worker failure fence is missing %q", required)
		}
	}
	if strings.Contains(worker, "last_requested_at <=") {
		t.Fatal("job.updated_at must not be used as a stale failure fence")
	}
}

func TestDeadLetterReconciliationUsesLatestRequestNotMutableJobTimestamp(t *testing.T) {
	raw, err := os.ReadFile("worker.go")
	if err != nil {
		t.Fatal(err)
	}
	worker := string(raw)
	for _, required := range []string{
		"with latest as",
		"order by job.organization_id, job.publication_id, job.created_at desc, job.id desc",
		"select * from latest where status = 'dead'",
		"publication.current_version = exhausted.version",
	} {
		if !strings.Contains(worker, required) {
			t.Fatalf("dead-letter fence is missing %q", required)
		}
	}
	if strings.Contains(worker, "newer.created_at >= exhausted.updated_at") {
		t.Fatal("dead-letter reconciliation must not fence with mutable updated_at")
	}
}

func TestRetryCapabilityIncludesLastGoodDeliveryErrorsWithoutProviderAnnotationFalsePositives(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository: %v", err)
	}
	repository := string(raw)
	for _, required := range []string{
		"publicationDeliveryError(publication.LastErrorCode)",
		"!hasActivePublicationJob(view.RecentJobs)",
		"view.DesiredState == DesiredPublished && view.ObservedState == ObservedPublished",
		"view.DesiredState == DesiredUnpublished",
	} {
		if !strings.Contains(repository, required) {
			t.Fatalf("retry capability is missing %q", required)
		}
	}
}

func TestAppRegistersGrupoOLXCanonicalPublicationRoutes(t *testing.T) {
	raw, err := os.ReadFile("../app/app.go")
	if err != nil {
		t.Fatalf("read app routes: %v", err)
	}
	routes := string(raw)
	for _, route := range []string{
		"POST /v1/properties/{id}/publications/grupo-olx/publish",
		"POST /v1/properties/{id}/publications/grupo-olx/unpublish",
		"POST /v1/properties/{id}/publications/grupo-olx/retry",
	} {
		if !strings.Contains(routes, route) {
			t.Fatalf("missing canonical Grupo OLX route %q", route)
		}
	}
}

func TestCanonicalGrupoOLXIdentityOverridesMutablePropertyCodeAndShadowConfig(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	repository := string(raw)
	for _, required := range []string{
		"nullif(trim(canonical.provider_listing_id), '')",
		"canonical.desired_state = 'unpublished'",
		"current_version.payload->'channel_config'->>'publication_type'",
	} {
		if !strings.Contains(repository, required) {
			t.Fatalf("canonical identity source precedence is missing %q", required)
		}
	}
}

func TestOfferAndAssetMutationsAdvanceThePublicationSourceRevision(t *testing.T) {
	raw, err := os.ReadFile("../../../../supabase/migrations/20260801163000_touch_property_revision_from_publication_sources.sql")
	if err != nil {
		t.Fatal(err)
	}
	migration := string(raw)
	for _, required := range []string{
		"touch_property_publication_source_revision",
		"after insert or update or delete",
		"on public.property_offers",
		"on public.property_assets",
		"greatest(properties.updated_at + interval '1 microsecond', clock_timestamp())",
		"zz_properties_monotonic_publication_revision",
		"old.updated_at + interval '1 microsecond'",
	} {
		if !strings.Contains(migration, required) {
			t.Fatalf("publication source revision trigger is missing %q", required)
		}
	}
}

func TestCanonicalAddressVisibilityPrecedesLegacyProjection(t *testing.T) {
	raw, err := os.ReadFile("projection.go")
	if err != nil {
		t.Fatal(err)
	}
	projection := string(raw)
	canonical := strings.Index(projection, "nullif(` + alias + `.address_visibility, '')")
	legacy := strings.Index(projection, "nullif(` + alias + `.public_address_visibility, '')")
	if canonical < 0 || legacy < 0 || canonical >= legacy {
		t.Fatal("canonical address_visibility must be the first non-empty privacy source")
	}
	for _, required := range []string{"when 'minimum' then 'minimo'", "when 'full' then 'completo'", "else 'parcial'"} {
		if !strings.Contains(projection, required) {
			t.Fatalf("address privacy normalization is missing %q", required)
		}
	}
}
