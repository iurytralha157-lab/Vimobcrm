package portals

import (
	"os"
	"strings"
	"testing"
)

func TestGrupoOLXFeedIsCanonicalFirstWithPropertyScopedLegacyFallback(t *testing.T) {
	repository := readPortalContractFile(t, "repository.go")
	for _, required := range []string{
		"canonical_scope as",
		"publication.channel = 'grupo_olx'",
		"publication.channel_account_key = $1",
		"publication.desired_state = 'published'",
		"publication.observed_state in ('published', 'queued', 'publishing')",
		"version.version = publication.published_version",
		"version.payload->'channel_config'->>'client_listing_id'",
		"version.payload->'property'",
		"not exists (",
		"canonical.property_id = legacy.property_id",
	} {
		if !strings.Contains(repository, required) {
			t.Fatalf("canonical feed contract is missing %q", required)
		}
	}
}

func TestLegacyPortalSettingsExposeAndProtectCanonicalManagement(t *testing.T) {
	repository := readPortalContractFile(t, "repository.go")
	for _, required := range []string{
		"'canonical_managed', canonical.id is not null",
		"'canonical_desired_state', canonical.desired_state",
		"'canonical_observed_state', canonical.observed_state",
		"scope_properties as",
		"if item.IsEnabled != nil",
		"legacyClientListingID",
		"legacyProductChanged",
		"return nil, ErrCanonicalManaged",
		"return nil, ErrCanonicalListingIDLocked",
	} {
		if !strings.Contains(repository, required) {
			t.Fatalf("canonical management compatibility contract is missing %q", required)
		}
	}
}

func TestLeadsResolveCanonicalProviderIdentityBeforeLegacy(t *testing.T) {
	repository := readPortalContractFile(t, "repository.go")
	canonical := strings.Index(repository, "from public.property_channel_publications publication")
	legacy := strings.Index(repository[canonical+1:], "from public.portal_listing_publications publication")
	if canonical < 0 || legacy < 0 {
		t.Fatal("lead resolution must query canonical and legacy publication identities")
	}
	for _, required := range []string{
		"publication.provider_listing_id = $2",
		"publication.channel_account_key = $1",
	} {
		if !strings.Contains(repository, required) {
			t.Fatalf("canonical provider identity contract is missing %q", required)
		}
	}
}

func TestImportIssuesAreUnversionedFeedbackAndNeverMutateCanonicalState(t *testing.T) {
	repository := readPortalContractFile(t, "repository.go")
	worker := readPortalContractFile(t, "import_worker.go")
	for _, required := range []string{
		"from jsonb_each($2::jsonb)",
		"not exists (",
		"reportOccurredAt == nil",
	} {
		if !strings.Contains(repository, required) {
			t.Fatalf("import report contract is missing %q", required)
		}
	}
	if !strings.Contains(worker, "provider_feedback") {
		t.Fatal("worker must persist unversioned provider feedback in the report inbox")
	}
	if strings.Contains(repository, "last_error_code = 'grupo_olx_import_error'") {
		t.Fatal("unversioned provider reports must not mutate canonical errors or state")
	}
}

func TestFeedTelemetryCannotOverwriteConcurrentActivationState(t *testing.T) {
	repository := readPortalContractFile(t, "repository.go")
	for _, required := range []string{
		"$5::boolean and portal_integrations.is_active",
		"portal_integrations.status <> 'paused'",
		"else portal_integrations.status",
	} {
		if !strings.Contains(repository, required) {
			t.Fatalf("feed status update is missing concurrency guard %q", required)
		}
	}
}

func TestCanonicalFeedValidationIsBulkIdempotentAndDoesNotChangeCommandETag(t *testing.T) {
	repository := readPortalContractFile(t, "repository.go")
	start := strings.Index(repository, "func clearCanonicalFeedValidationIssues(")
	end := strings.Index(repository, "type portalDestination struct")
	if start < 0 || end <= start {
		t.Fatal("canonical feed validation functions were not found")
	}
	section := repository[start:end]
	for _, required := range []string{
		"jsonb_to_recordset",
		"is distinct from eligible.cleaned_validation_errors",
		"is distinct from eligible.next_validation_errors",
		"version.payload_hash = input.payload_hash",
	} {
		if !strings.Contains(section, required) {
			t.Fatalf("bulk canonical feed validation is missing %q", required)
		}
	}
	if strings.Contains(section, "tx.QueryRow") {
		t.Fatal("canonical feed validation regressed to one database roundtrip per publication")
	}
	if strings.Contains(section, "updated_at =") {
		t.Fatal("a feed GET must not mutate the publication command ETag")
	}
}

func TestWebhookIdempotencyInfersItsPartialUniqueIndex(t *testing.T) {
	repository := readPortalContractFile(t, "repository.go")
	if !strings.Contains(repository, "on conflict (integration_id, event_type, event_key) where event_key is not null") {
		t.Fatal("webhook idempotency conflict target must include the partial-index predicate")
	}
}

func TestPausedSettingsKeepTheDrainFeedHeaderValid(t *testing.T) {
	repository := readPortalContractFile(t, "repository.go")
	for _, required := range []string{
		"select is_active, status",
		"existingActive || existingStatus == \"paused\"",
		"validateActivationSettings",
	} {
		if !strings.Contains(repository, required) {
			t.Fatalf("paused drain settings guard is missing %q", required)
		}
	}
}

func TestImportReportAdminErrorNeverPersistsInternalCause(t *testing.T) {
	repository := readPortalContractFile(t, "repository.go")
	start := strings.Index(repository, "func (repo Repository) markImportReportAnnotationFailure(")
	end := strings.Index(repository, "func importReportRetryDelay(")
	if start < 0 || end <= start {
		t.Fatal("annotation failure function was not found")
	}
	section := repository[start:end]
	if !strings.Contains(section, "annotation_processing_failed") {
		t.Fatal("annotation failure must persist a stable public code")
	}
	if strings.Contains(section, "cause.Error()") {
		t.Fatal("annotation failure must not persist raw SQL or infrastructure errors")
	}
}

func TestActivePartialSettingsRemainActivationValidated(t *testing.T) {
	repository := readPortalContractFile(t, "repository.go")
	for _, required := range []string{
		"for update",
		"existingActive",
		"if existingActive",
		"validateActivationSettings",
		"tx.QueryRow",
	} {
		if !strings.Contains(repository, required) {
			t.Fatalf("active PATCH validation is missing %q", required)
		}
	}
}

func TestAuthenticatedWebhooksRemainAvailableDuringPortalDrain(t *testing.T) {
	repository := readPortalContractFile(t, "repository.go")
	worker := readPortalContractFile(t, "import_worker.go")
	if strings.Count(repository, `integrationByPublicToken(ctx, token, "webhook_token", false)`) < 2 {
		t.Fatal("lead and import report webhooks must accept valid paused-account tokens during provider drain")
	}
	for _, required := range []struct {
		source string
		value  string
	}{
		{repository, "case when is_active and status <> 'paused' then 'connected' else status end"},
		{worker, "when is_active and status <> 'paused' then case when $2 = 'error'"},
	} {
		if !strings.Contains(required.source, required.value) {
			t.Fatalf("drain webhook status guard is missing %q", required.value)
		}
	}
}

func TestFeedNeverConvertsModuleLookupFailureIntoEmptyDrainXML(t *testing.T) {
	repository := readPortalContractFile(t, "repository.go")
	for _, required := range []string{
		"func (repo Repository) portalModuleEnabled(ctx context.Context, organizationID string) (bool, error)",
		"integration.ModuleEnabled, err = repo.portalModuleEnabled",
		"return publicIntegration{}, err",
		"return enabled, err",
	} {
		if !strings.Contains(repository, required) {
			t.Fatalf("module lookup error propagation is missing %q", required)
		}
	}
	if strings.Contains(repository, "return err == nil && enabled") {
		t.Fatal("database failures must not be interpreted as a disabled module")
	}
}

func readPortalContractFile(t *testing.T, name string) string {
	t.Helper()
	raw, err := os.ReadFile(name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return string(raw)
}
