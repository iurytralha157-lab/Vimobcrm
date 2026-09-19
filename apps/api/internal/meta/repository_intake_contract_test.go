package meta

import (
	"os"
	"strings"
	"testing"
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
		"PreserveAssignee: true",
		"RoundRobinID:     destination.RoundRobinID",
	} {
		if !strings.Contains(persist, required) {
			t.Fatalf("Meta distribution contract is missing %q", required)
		}
	}
}

func TestLegacyPendingLeadCleanupIsLockedAndRequiresNoHumanActivity(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) discardUntouchedPendingMetaLeadForReentry")
	if start < 0 {
		t.Fatal("legacy pending lead cleanup source was not found")
	}
	end := strings.Index(source[start:], "func (repo Repository) enrichPendingMetaLead")
	if end < 0 {
		t.Fatal("legacy pending lead cleanup boundary was not found")
	}
	cleanup := source[start : start+end]

	for _, required := range []string{
		"'lead-entry:meta:'",
		"'lead-phone:'",
		"errors.Is(err, pgx.ErrNoRows)",
		"return true, tx.Commit(ctx)",
		"meta_details_status",
		"first_touch_at is null",
		"first_response_at is null",
		"owner_last_activity_at is null",
		"last_contact_at is null",
		"repo.findExistingLeadByPhone",
		"delete from public.leads",
	} {
		if !strings.Contains(cleanup, required) {
			t.Fatalf("legacy pending lead cleanup is missing %q", required)
		}
	}
}
