package portals

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
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

func TestGrupoOLXReentryAdvancesBoardOrderWithoutResettingStageClock(t *testing.T) {
	repository := readPortalContractFile(t, "repository_leads.go")
	start := strings.Index(repository, "reentry = err == nil")
	if start < 0 {
		t.Fatal("Grupo OLX reentry branch was not found")
	}
	flow := repository[start:]
	end := strings.Index(flow, "\t} else {")
	if end < 0 {
		t.Fatal("Grupo OLX lead insert branch was not found")
	}
	update := flow[:end]

	if !strings.Contains(update, "stage_entered_at = case") ||
		!strings.Contains(update, "then stage_entered_at") {
		t.Fatal("Grupo OLX reentry must preserve stage_entered_at in the same stage")
	}
	if !strings.Contains(update, "board_order_at = clock_timestamp(),") {
		t.Fatal("Grupo OLX reentry must promote the card even in the same stage")
	}
	if strings.Contains(update, "board_order_at = case") {
		t.Fatal("Grupo OLX board ordering must not depend on a stage change")
	}
}

func TestGrupoOLXLeadIdentityIsQueueScopedAfterLegacyCutover(t *testing.T) {
	routing := readPortalContractFile(t, "repository_lead_routing.go")
	leads := readPortalContractFile(t, "repository_leads.go")
	for _, required := range []string{
		"reentry_behavior",
		"preserveAssigneeForPortalIntake(reentry, destination)",
		"RoundRobinResolved: destination.RoundRobinResolved",
	} {
		if !strings.Contains(routing+leads, required) {
			t.Fatalf("Grupo OLX reentry routing contract is missing %q", required)
		}
	}
	for _, required := range []string{
		"resolveAutomaticPortalIntakeDestination",
		"legacyPortalLeadPhoneUniquenessActive",
		"findPortalLeadByPhoneLegacy",
		"findPortalLeadByPhone(ctx",
		"portalLeadPhoneUniqueViolationConstraint",
		"attemptTx, err := tx.Begin(ctx)",
		`constraintName == "leads_org_phone_unique"`,
		"intake_scope_key",
		"origin_round_robin_id",
		"$1 || ':legacy-global:' || normalize_phone($2)",
		"$1 || ':' || $2 || ':' || normalize_phone($3)",
	} {
		if !strings.Contains(leads, required) {
			t.Fatalf("Grupo OLX scoped identity contract is missing %q", required)
		}
	}
	automaticResolution := strings.Index(leads, "resolveAutomaticPortalIntakeDestination")
	intakeScope := strings.Index(leads, "intakeScopeKey := portalLeadIntakeScopeKey")
	phoneLock := strings.Index(leads, "lockPortalLeadIntakeIdentity")
	if automaticResolution < 0 || intakeScope < 0 || phoneLock < 0 || automaticResolution >= intakeScope || intakeScope >= phoneLock {
		t.Fatal("Grupo OLX automatic queue must be frozen before intake scope and phone identity")
	}
}

func TestGrupoOLXAutomaticIntakeScopesQueueIdentityAndReentryBehavior(t *testing.T) {
	const (
		queueA = "11111111-1111-4111-8111-111111111111"
		queueB = "22222222-2222-4222-8222-222222222222"
	)
	queue := func(value string) *string { return &value }
	base := portalDestination{}
	autoA := applyPortalIntakeDestination(base, distribution.IntakeDestination{
		RoundRobinID: queue(queueA), ReentryBehavior: "keep_assignee", Resolved: true,
	})
	autoARepeat := applyPortalIntakeDestination(base, distribution.IntakeDestination{
		RoundRobinID: queue(queueA), ReentryBehavior: "keep_assignee", Resolved: true,
	})
	autoB := applyPortalIntakeDestination(base, distribution.IntakeDestination{
		RoundRobinID: queue(queueB), ReentryBehavior: "redistribute", Resolved: true,
	})
	explicitA := portalDestination{
		RoundRobinID: queueA, RoundRobinResolved: true, ReentryBehavior: "keep_assignee",
	}
	explicitAAfterAutomatic, err := resolveAutomaticPortalIntakeDestination(context.Background(), nil, "", explicitA, nil)
	if err != nil || explicitAAfterAutomatic != explicitA {
		t.Fatalf("Grupo OLX explicit queue lost precedence: destination=%#v error=%v", explicitAAfterAutomatic, err)
	}

	if portalLeadIntakeScopeKey(autoA.RoundRobinID) != portalLeadIntakeScopeKey(autoARepeat.RoundRobinID) {
		t.Fatal("Grupo OLX automatic A,A must reuse the same queue-scoped card")
	}
	if portalLeadIntakeScopeKey(autoA.RoundRobinID) == portalLeadIntakeScopeKey(autoB.RoundRobinID) {
		t.Fatal("Grupo OLX automatic A,B must create separate queue-scoped cards")
	}
	if portalLeadIntakeScopeKey(autoA.RoundRobinID) != portalLeadIntakeScopeKey(explicitA.RoundRobinID) {
		t.Fatal("Grupo OLX automatic A followed by explicit A must resolve to the same intake identity")
	}
	if !preserveAssigneeForPortalIntake(true, autoA) {
		t.Fatal("Grupo OLX keep_assignee queue must preserve the assignee on reentry")
	}
	if preserveAssigneeForPortalIntake(true, autoB) {
		t.Fatal("Grupo OLX redistribute queue must release the assignee on reentry")
	}
	noQueue := applyPortalIntakeDestination(base, distribution.IntakeDestination{Resolved: true})
	if !noQueue.RoundRobinResolved || noQueue.RoundRobinID != "" || portalLeadIntakeScopeKey(noQueue.RoundRobinID) != "unscoped" {
		t.Fatalf("Grupo OLX frozen no-queue decision = %#v", noQueue)
	}
}

func TestGrupoOLXPhoneConflictRetryDistinguishesLegacyAndScopedIndexes(t *testing.T) {
	for _, constraintName := range []string{"leads_org_phone_unique", "leads_org_scope_phone_unique"} {
		err := &pgconn.PgError{Code: "23505", ConstraintName: constraintName}
		if got := portalLeadPhoneUniqueViolationConstraint(err); got != constraintName {
			t.Fatalf("constraint = %q, want %q", got, constraintName)
		}
	}
	if got := portalLeadPhoneUniqueViolationConstraint(&pgconn.PgError{Code: "23505", ConstraintName: "other_unique"}); got != "" {
		t.Fatalf("unrelated constraint was recognized: %q", got)
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
	if name == "repository.go" {
		var repository strings.Builder
		for _, module := range []string{
			"repository.go",
			"repository_settings.go",
			"repository_publications.go",
			"repository_feed.go",
			"repository_lead_routing.go",
			"repository_leads.go",
			"repository_reports.go",
			"repository_integration.go",
			"repository_webhook.go",
			"repository_payload.go",
			"repository_helpers.go",
		} {
			raw, err := os.ReadFile(module)
			if err != nil {
				t.Fatalf("read %s: %v", module, err)
			}
			repository.Write(raw)
			repository.WriteByte('\n')
		}
		return repository.String()
	}
	raw, err := os.ReadFile(name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return string(raw)
}
