package properties

import (
	"os"
	"strings"
	"testing"
)

const propertyInvariantMigrationPath = "../../../../supabase/migrations/20260908000631_harden_property_domain_invariants.sql"

func readPropertyInvariantMigration(t *testing.T) string {
	t.Helper()
	sourceBytes, err := os.ReadFile(propertyInvariantMigrationPath)
	if err != nil {
		t.Fatalf("read property invariant migration: %v", err)
	}
	return strings.ToLower(string(sourceBytes))
}

func requireMigrationOrder(t *testing.T, source string, fragments ...string) {
	t.Helper()
	previous := -1
	for _, fragment := range fragments {
		position := strings.Index(source, strings.ToLower(fragment))
		if position < 0 {
			t.Fatalf("property invariant migration is missing %q", fragment)
		}
		if position <= previous {
			t.Fatalf("property invariant migration orders %q before its prerequisite", fragment)
		}
		previous = position
	}
}

func TestPropertyInvariantMigrationProjectsLegacyOwnersBeforeReaddingContactChecks(t *testing.T) {
	source := readPropertyInvariantMigration(t)

	requireMigrationOrder(t, source,
		"alter table public.property_owners\n  drop constraint if exists property_owners_contact_contract_check",
		"update public.property_owners as owner\nset is_active = true",
		"with selected_owner as (\n  select distinct on",
		"alter table public.property_owners\n  add constraint property_owners_contact_contract_check",
	)
	requireMigrationOrder(t, source,
		"alter table public.properties\n  drop constraint if exists properties_embedded_owner_contract_check",
		"with selected_owner as (\n  select distinct on",
		"alter table public.properties\n  add constraint properties_embedded_owner_contract_check",
	)
	if strings.Count(source, "add constraint property_owners_contact_contract_check") != 1 {
		t.Fatal("owner contact contract must be re-added exactly once after reconciliation")
	}
}

func TestPropertyInvariantMigrationBoundsLegacyOwnershipBeforeFutureAllocations(t *testing.T) {
	source := readPropertyInvariantMigration(t)

	for _, fragment := range []string{
		"future_ownership.next_valid_from",
		"select min(ownership.valid_from) as next_valid_from",
		"ownership.valid_from > current_date",
		"v_next_valid_from date",
		"true, current_date, v_next_valid_from, new.created_by",
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("future-safe owner reconciliation is missing %q", fragment)
		}
	}
}

func TestPropertyInvariantMigrationRejectsOrphanNeighborhoodsAndOwnerProjectionDrift(t *testing.T) {
	source := readPropertyInvariantMigration(t)

	for _, fragment := range []string{
		"active property neighborhoods without city_id must be repaired before this migration",
		"and city_id is not null",
		"constraint = 'property_neighborhood_city_required'",
		"char_length(coalesce(origin_media, '')) <= 80",
		"when (old.owner_id is distinct from new.owner_id)",
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("property invariant migration is missing %q", fragment)
		}
	}
}
