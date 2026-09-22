package meta

import (
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
)

func TestMetaIntakeNeverMaterializesFallbackBeforeProviderIdentity(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) processLeadgenChange")
	if start < 0 {
		t.Fatal("processLeadgenChange source was not found")
	}
	end := strings.Index(source[start:], "const findLeadgenRouteQuery")
	if end < 0 {
		t.Fatal("processLeadgenChange boundary was not found")
	}
	intake := source[start : start+end]

	for _, required := range []string{
		"result.DetailsPending = true",
		"result.Status = \"skipped\"",
		"classifyMetaLeadIntake(details, change.Raw, lead)",
		"metaLeadIntakeIgnoreTest",
		"metaLeadIntakeWaitForIdentity",
	} {
		if !strings.Contains(intake, required) {
			t.Fatalf("Meta intake guard is missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"fallbackMetaLeadName",
		"lead.Name = \"Lead Meta",
	} {
		if strings.Contains(intake, forbidden) {
			t.Fatalf("Meta intake can still materialize a fallback via %q", forbidden)
		}
	}
}

func TestMetaLeadPersistenceKeepsEntryDistributionAndNotificationAtomic(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) persistLead")
	if start < 0 {
		t.Fatal("persistLead source was not found")
	}
	end := strings.Index(source[start:], "func (repo Repository) discardUntouchedPendingMetaLeadForReentry")
	if end < 0 {
		t.Fatal("persistLead boundary was not found")
	}
	persist := source[start : start+end]

	requiredInOrder := []string{
		"repo.insertLeadEntry",
		"distribution.Distribute(ctx, tx",
		"repo.insertLeadNotification",
		"tx.Commit(ctx)",
	}
	previous := -1
	for _, required := range requiredInOrder {
		index := strings.Index(persist, required)
		if index < 0 {
			t.Fatalf("Meta persistence is missing %q", required)
		}
		if index <= previous {
			t.Fatalf("Meta persistence ordering is invalid around %q", required)
		}
		previous = index
	}
	for _, required := range []string{
		"distribution.StableKey(\"meta\", integration.ID, change.LeadgenID)",
		"preserveAssigneeForMetaIntake(reentry, destination)",
		"PreserveAssignee:   preserveAssignee",
		"RoundRobinID:       destination.RoundRobinID",
		"RoundRobinResolved: destination.RoundRobinResolved",
		"repo.insertLeadRedistributionJob(ctx, tx, integration.OrganizationID, leadID, destination, change, distributionResult.Reason)",
		"intake_scope_key",
		"origin_round_robin_id",
	} {
		if !strings.Contains(persist, required) {
			t.Fatalf("Meta distribution contract is missing %q", required)
		}
	}
	if strings.Contains(persist, "destination.RoundRobinID != nil && destination.AssignedUserID != nil") {
		t.Fatal("Meta persistence still suppresses the durable initial-distribution retry when no member is available")
	}
}

func TestLegacyPendingLeadCleanupIsValidatedThenDiscardedAtomically(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) prepareUntouchedPendingMetaLeadForReentry")
	if start < 0 {
		t.Fatal("legacy pending lead preparation source was not found")
	}
	end := strings.Index(source[start:], "func (repo Repository) discardUntouchedPendingMetaLeadForReentry")
	if end < 0 {
		t.Fatal("legacy pending lead preparation boundary was not found")
	}
	prepare := source[start : start+end]

	for _, required := range []string{
		"'lead-entry:meta:'",
		"pendingMetaLeadIntakeIdentity",
		"lockMetaLeadIntakeIdentity",
		"legacyMetaLeadPhoneUniquenessActive",
		"meta_details_status",
		"first_touch_at is null",
		"first_response_at is null",
		"owner_last_activity_at is null",
		"last_contact_at is null",
		"repo.findExistingLeadByPhoneLegacy",
		"repo.findExistingLeadByPhone",
	} {
		if !strings.Contains(prepare, required) {
			t.Fatalf("legacy pending lead preparation is missing %q", required)
		}
	}
	if strings.Contains(prepare, "delete from public.leads") {
		t.Fatal("pending placeholder is deleted before canonical persistence owns the provider-event transaction")
	}

	discardStart := start + end
	discardEnd := strings.Index(source[discardStart:], "func (repo Repository) enrichPendingMetaLead")
	if discardEnd < 0 {
		t.Fatal("legacy pending lead discard boundary was not found")
	}
	discard := source[discardStart : discardStart+discardEnd]
	for _, required := range []string{
		"currentIdentity != pendingReentry.IntakeIdentity",
		"pending Meta placeholder is no longer disposable",
		"repo.findExistingLeadByPhoneLegacy",
		"repo.findExistingLeadByPhone",
		"delete from public.leads",
	} {
		if !strings.Contains(discard, required) {
			t.Fatalf("atomic pending lead discard is missing %q", required)
		}
	}

	persistStart := strings.Index(source, "func (repo Repository) persistLead")
	persistEnd := strings.Index(source[persistStart:], "func (repo Repository) prepareUntouchedPendingMetaLeadForReentry")
	if persistStart < 0 || persistEnd < 0 {
		t.Fatal("Meta persistence source boundary was not found")
	}
	persist := source[persistStart : persistStart+persistEnd]
	if discardCall, entryInsert := strings.Index(persist, "repo.discardUntouchedPendingMetaLeadForReentry"), strings.Index(persist, "repo.insertLeadEntry"); discardCall < 0 || entryInsert < 0 || discardCall >= entryInsert {
		t.Fatal("pending placeholder must be discarded in the same transaction before the canonical reentry is inserted")
	}
}

func TestMetaProviderIdentityPrecedesRolloutAwarePhoneIdentity(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) persistLead")
	if start < 0 {
		t.Fatal("persistLead source was not found")
	}
	end := strings.Index(source[start:], "func (repo Repository) discardUntouchedPendingMetaLeadForReentry")
	if end < 0 {
		t.Fatal("persistLead boundary was not found")
	}
	persist := source[start : start+end]

	providerIdentity := strings.Index(persist, "findLeadByProviderEventID")
	legacyProbe := strings.Index(persist, "legacyMetaLeadPhoneUniquenessActive")
	phoneLock := strings.Index(persist, "lockMetaLeadIntakeIdentity")
	if providerIdentity < 0 || legacyProbe < 0 || phoneLock < 0 || providerIdentity >= legacyProbe || legacyProbe >= phoneLock {
		t.Fatal("Meta provider idempotency must run before rollout-aware phone identity")
	}
	automaticResolution := strings.Index(persist, "repo.resolveAutomaticMetaIntakeDestination")
	intakeScope := strings.Index(persist, "intakeScopeKey := metaLeadIntakeScopeKey")
	if automaticResolution < 0 || intakeScope < 0 || automaticResolution >= intakeScope || intakeScope >= phoneLock {
		t.Fatal("Meta automatic queue must be frozen before intake scope and phone identity")
	}
	for _, required := range []string{
		"repo.findExistingLeadByPhoneLegacy",
		"repo.findExistingLeadByPhone(ctx",
		"metaLeadPhoneUniqueViolationConstraint",
		"persistLeadWithIdentityMode",
		`constraintName == "leads_org_phone_unique"`,
		"$1 || ':legacy-global:' || normalize_phone($2)",
		"$1 || ':' || $2 || ':' || normalize_phone($3)",
		"resolveStoredMetaLeadIntakeIdentity",
		"metadata->>'origin_round_robin_id'",
		"validateMetaLeadIntakeIdentity",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("Meta scoped identity contract is missing %q", required)
		}
	}
}

func TestStoredMetaLeadIntakeIdentityPrefersValidatedQueueEvidence(t *testing.T) {
	t.Parallel()

	const queueA = "11111111-1111-4111-8111-111111111111"
	const queueB = "22222222-2222-4222-8222-222222222222"
	tests := []struct {
		name           string
		storedScope    string
		storedOrigin   string
		metadataScope  string
		metadataOrigin string
		want           metaLeadIntakeIdentity
		wantErr        bool
	}{
		{
			name: "plain legacy placeholder remains unscoped instead of using current form",
			want: metaLeadIntakeIdentity{ScopeKey: "unscoped"},
		},
		{
			name:           "metadata queue overrides default stored unscoped",
			storedScope:    "unscoped",
			metadataScope:  "queue:" + queueA,
			metadataOrigin: queueA,
			want:           metaLeadIntakeIdentity{ScopeKey: "queue:" + queueA, OriginRoundRobinID: queueA},
		},
		{
			name:           "metadata origin derives canonical scope",
			storedScope:    "unscoped",
			metadataOrigin: queueA,
			want:           metaLeadIntakeIdentity{ScopeKey: "queue:" + queueA, OriginRoundRobinID: queueA},
		},
		{
			name:         "stored queue derives canonical origin",
			storedScope:  "QUEUE:" + strings.ToUpper(queueA),
			storedOrigin: queueA,
			want:         metaLeadIntakeIdentity{ScopeKey: "queue:" + queueA, OriginRoundRobinID: queueA},
		},
		{
			name:           "conflicting queue evidence fails closed",
			storedScope:    "queue:" + queueA,
			metadataOrigin: queueB,
			wantErr:        true,
		},
		{
			name:          "malformed metadata scope fails closed",
			metadataScope: "queue:not-a-uuid",
			wantErr:       true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, err := resolveStoredMetaLeadIntakeIdentity(test.storedScope, test.storedOrigin, test.metadataScope, test.metadataOrigin)
			if test.wantErr {
				if !errors.Is(err, ErrInvalidInput) {
					t.Fatalf("error = %v, want ErrInvalidInput", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got != test.want {
				t.Fatalf("identity = %#v, want %#v", got, test.want)
			}
		})
	}
}

func TestPendingMetaIdentityNeverUsesMutableFormRouting(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) pendingMetaLeadIntakeIdentity")
	end := strings.Index(source[start:], "func (repo Repository) validateMetaLeadIntakeIdentity")
	if start < 0 || end < 0 {
		t.Fatal("pending Meta identity source boundary was not found")
	}
	pendingIdentity := source[start : start+end]
	for _, required := range []string{
		"metadata->>'intake_scope_key'",
		"metadata->>'origin_round_robin_id'",
		"resolveStoredMetaLeadIntakeIdentity",
		"validateMetaLeadIntakeIdentity(ctx, tx, organizationID, identity, false)",
	} {
		if !strings.Contains(pendingIdentity, required) {
			t.Fatalf("pending Meta identity is missing %q", required)
		}
	}
	for _, forbidden := range []string{"resolveDestination", "formConfig"} {
		if strings.Contains(pendingIdentity, forbidden) {
			t.Fatalf("pending Meta identity still depends on mutable form routing via %q", forbidden)
		}
	}

	validationStart := strings.Index(source, "func (repo Repository) validateMetaLeadIntakeIdentity")
	if validationStart < 0 {
		t.Fatal("Meta intake identity validation source boundary was not found")
	}
	validationEnd := strings.Index(source[validationStart:], "func normalizeMetaReentryBehavior")
	if validationEnd < 0 {
		t.Fatal("Meta intake identity validation source boundary was not found")
	}
	validation := source[validationStart : validationStart+validationEnd]
	if !strings.Contains(validation, "identity.OriginRoundRobinID == \"\" || !requireLiveQueue") {
		t.Fatal("durable stored Meta intake identity still requires its source queue to remain live")
	}
}

func TestMetaPhoneConflictRetryKeepsPreparedIntakeIdentity(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) persistLead")
	end := strings.Index(source[start:], "func (repo Repository) persistLeadWithIdentityMode")
	if start < 0 || end < 0 {
		t.Fatal("persistLead retry wrapper source boundary was not found")
	}
	retryWrapper := source[start : start+end]
	if occurrences := strings.Count(retryWrapper, "pendingReentry"); occurrences < 3 {
		t.Fatalf("pending intake identity is not threaded through both persistence attempts: %d occurrences", occurrences)
	}
	for _, required := range []string{
		"detailsError, pendingReentry, nil",
		"detailsError, pendingReentry, &legacyIdentity",
	} {
		if !strings.Contains(retryWrapper, required) {
			t.Fatalf("Meta retry wrapper is missing %q", required)
		}
	}

	persistModeStart := strings.Index(source, "func (repo Repository) persistLeadWithIdentityMode")
	persistModeEnd := strings.Index(source[persistModeStart:], "func (repo Repository) prepareUntouchedPendingMetaLeadForReentry")
	if persistModeStart < 0 || persistModeEnd < 0 {
		t.Fatal("persistLeadWithIdentityMode source boundary was not found")
	}
	persistMode := source[persistModeStart : persistModeStart+persistModeEnd]
	for _, required := range []string{
		"resolveDestinationForIntakeIdentity",
		"intakeScopeKey != pendingReentry.IntakeIdentity.ScopeKey",
		"preserved Meta intake identity was reclassified",
	} {
		if !strings.Contains(persistMode, required) {
			t.Fatalf("Meta retry persistence is missing %q", required)
		}
	}

	destinationStart := strings.Index(source, "func (repo Repository) resolveDestinationForIntakeIdentity")
	if destinationStart < 0 {
		t.Fatal("preserved Meta destination source boundary was not found")
	}
	destinationEnd := strings.Index(source[destinationStart:], "func (repo Repository) resolveDestinationWithRoundRobin")
	if destinationEnd < 0 {
		t.Fatal("preserved Meta destination source boundary was not found")
	}
	preservedDestination := source[destinationStart : destinationStart+destinationEnd]
	for _, required := range []string{
		"errors.Is(err, ErrInvalidInput)",
		"RoundRobinID:       &value",
		"RoundRobinResolved: true",
		"ReentryBehavior:    \"keep_assignee\"",
		"no_matching_queue instead of silently selecting a different queue",
	} {
		if !strings.Contains(preservedDestination, required) {
			t.Fatalf("deleted Meta origin queue fallback is missing %q", required)
		}
	}
	for _, required := range []string{
		"PreservedQueueIdentity",
		"tombstone_pipeline_id",
		"tombstone_stage_id",
		"destination.ReentryBehavior = \"keep_assignee\"",
		"return roundRobin, nil",
		"Never substitute current form/integration routing",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("tombstoned Meta intake destination is missing %q", required)
		}
	}
}

func TestMetaAutomaticIntakeScopesQueueIdentityAndReentryBehavior(t *testing.T) {
	t.Parallel()
	const (
		queueA = "11111111-1111-4111-8111-111111111111"
		queueB = "22222222-2222-4222-8222-222222222222"
	)
	queue := func(value string) *string { return &value }
	base := resolvedDestination{}
	autoA := applyMetaIntakeDestination(base, distribution.IntakeDestination{
		RoundRobinID: queue(queueA), ReentryBehavior: "keep_assignee", Resolved: true,
	})
	autoARepeat := applyMetaIntakeDestination(base, distribution.IntakeDestination{
		RoundRobinID: queue(queueA), ReentryBehavior: "keep_assignee", Resolved: true,
	})
	autoB := applyMetaIntakeDestination(base, distribution.IntakeDestination{
		RoundRobinID: queue(queueB), ReentryBehavior: "redistribute", Resolved: true,
	})
	explicitA := resolvedDestination{
		RoundRobinID: queue(queueA), RoundRobinResolved: true, ReentryBehavior: "keep_assignee",
	}
	if shouldResolveAutomaticMetaIntake(nil, metaFormConfig{RoundRobinID: queue(queueA)}) {
		t.Fatal("Meta explicit queue must take precedence over automatic routing")
	}

	if metaLeadIntakeScopeKey(autoA.RoundRobinID) != metaLeadIntakeScopeKey(autoARepeat.RoundRobinID) {
		t.Fatal("Meta automatic A,A must reuse the same queue-scoped card")
	}
	if metaLeadIntakeScopeKey(autoA.RoundRobinID) == metaLeadIntakeScopeKey(autoB.RoundRobinID) {
		t.Fatal("Meta automatic A,B must create separate queue-scoped cards")
	}
	if metaLeadIntakeScopeKey(autoA.RoundRobinID) != metaLeadIntakeScopeKey(explicitA.RoundRobinID) {
		t.Fatal("Meta automatic A followed by explicit A must resolve to the same intake identity")
	}
	if !preserveAssigneeForMetaIntake(true, autoA) {
		t.Fatal("Meta keep_assignee queue must preserve the assignee on reentry")
	}
	if preserveAssigneeForMetaIntake(true, autoB) {
		t.Fatal("Meta redistribute queue must release the assignee on reentry")
	}
	noQueue := applyMetaIntakeDestination(base, distribution.IntakeDestination{Resolved: true})
	if !noQueue.RoundRobinResolved || noQueue.RoundRobinID != nil || metaLeadIntakeScopeKey(noQueue.RoundRobinID) != "unscoped" {
		t.Fatalf("Meta frozen no-queue decision = %#v", noQueue)
	}
}

func TestMetaPhoneConflictRetryDistinguishesLegacyAndScopedIndexes(t *testing.T) {
	for _, constraintName := range []string{"leads_org_phone_unique", "leads_org_scope_phone_unique"} {
		err := &pgconn.PgError{Code: "23505", ConstraintName: constraintName}
		if got := metaLeadPhoneUniqueViolationConstraint(err); got != constraintName {
			t.Fatalf("constraint = %q, want %q", got, constraintName)
		}
	}
	if got := metaLeadPhoneUniqueViolationConstraint(&pgconn.PgError{Code: "23505", ConstraintName: "other_unique"}); got != "" {
		t.Fatalf("unrelated constraint was recognized: %q", got)
	}
}
