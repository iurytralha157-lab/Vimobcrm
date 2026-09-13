package properties

import (
	"os"
	"strings"
	"testing"
)

const legacyLocationGuardMigrationPath = "../../../../supabase/migrations/20260908130733_guard_legacy_property_location_catalog_mutations.sql"

func TestCityLegacyFallbackMutationMatchesCatalogReader(t *testing.T) {
	query := strings.ToLower(cityLegacyFallbackMutationSQL())
	for _, fragment := range []string{
		"property.organization_id = $1::uuid",
		"property.city_id is null",
		"lower(btrim(property.cidade)) = lower(btrim($2))",
		"upper(btrim(coalesce(property.uf, ''))) = upper(btrim($3))",
		"lower(btrim(property.cidade)) = lower(btrim($4))",
		"upper(btrim(coalesce(property.uf, ''))) = upper(btrim($5))",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("city legacy mutation guard is missing %q", fragment)
		}
	}
}

func TestNeighborhoodLegacyFallbackMutationMatchesCatalogReader(t *testing.T) {
	query := strings.ToLower(neighborhoodLegacyFallbackMutationSQL())
	for _, fragment := range []string{
		"property.organization_id = $1::uuid",
		"property.neighborhood_id is null",
		"lower(btrim(property.bairro)) = lower(btrim($2))",
		"property.city_id = nullif($3, '')::uuid",
		"lower(btrim(coalesce(property.cidade, ''))) = lower(btrim(coalesce(old_city.name, '')))",
		"lower(btrim(property.bairro)) = lower(btrim($4))",
		"property.city_id = nullif($5, '')::uuid",
		"lower(btrim(coalesce(property.cidade, ''))) = lower(btrim(coalesce(new_city.name, '')))",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("neighborhood legacy mutation guard is missing %q", fragment)
		}
	}
}

func TestLegacyLocationAdvisoryKeysAreTenantScopedByCallerAndNameCanonical(t *testing.T) {
	if got := legacyLocationAdvisoryKey("city", "  Curitiba  "); got != "property-location-city:curitiba" {
		t.Fatalf("city advisory key = %q", got)
	}
	if got := legacyLocationAdvisoryKey("neighborhood", " Centro "); got != "property-location-neighborhood:centro" {
		t.Fatalf("neighborhood advisory key = %q", got)
	}
}

func TestLegacyLocationMigrationFailsClosedWithoutHeuristicRewrites(t *testing.T) {
	sourceBytes, err := os.ReadFile(legacyLocationGuardMigrationPath)
	if err != nil {
		t.Fatalf("read legacy location guard migration: %v", err)
	}
	source := strings.ToLower(string(sourceBytes))

	for _, fragment := range []string{
		"property legacy location guard prerequisites are missing",
		"pg_try_advisory_xact_lock",
		"pg_try_advisory_xact_lock_shared",
		"'property-location-' || p_kind || ':' || lower(btrim(p_name))",
		"create trigger a1_properties_legacy_location_serialization",
		"before insert or update of organization_id, city_id, neighborhood_id, cidade, uf, bairro",
		"create trigger a1_property_city_legacy_catalog_mutation",
		"before insert or update of organization_id, name, uf",
		"create trigger a1_property_neighborhood_legacy_catalog_mutation",
		"before insert or update of organization_id, city_id, name",
		"legacy property location must be attached before catalog rename or move",
		"constraint = 'property_location_in_use'",
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("legacy location migration is missing %q", fragment)
		}
	}
	if strings.Contains(source, "update public.properties") {
		t.Fatal("legacy location migration must not rewrite property associations heuristically")
	}

	assignmentStart := strings.Index(source, "create or replace function private.serialize_property_legacy_location_assignment()")
	if assignmentStart < 0 {
		t.Fatal("legacy property assignment trigger function boundaries are missing")
	}
	assignmentEnd := strings.Index(source[assignmentStart:], "revoke all on function private.serialize_property_legacy_location_assignment()")
	if assignmentEnd < 0 {
		t.Fatal("legacy property assignment trigger function boundaries are missing")
	}
	assignmentBody := source[assignmentStart : assignmentStart+assignmentEnd]
	if !strings.Contains(assignmentBody, "private.lock_property_legacy_location_assignment_name(") {
		t.Fatal("legacy property assignments must use the shared advisory lock")
	}
	if strings.Contains(assignmentBody, "private.lock_property_legacy_location_name(") {
		t.Fatal("legacy property assignments must not serialize each other through the exclusive advisory lock")
	}

	catalogStart := strings.Index(source, "create or replace function private.guard_property_legacy_location_catalog_mutation()")
	if catalogStart < 0 {
		t.Fatal("legacy location catalog mutation guard boundaries are missing")
	}
	catalogEnd := strings.Index(source[catalogStart:], "revoke all on function private.guard_property_legacy_location_catalog_mutation()")
	if catalogEnd < 0 {
		t.Fatal("legacy location catalog mutation guard boundaries are missing")
	}
	catalogBody := source[catalogStart : catalogStart+catalogEnd]
	if !strings.Contains(catalogBody, "private.lock_property_legacy_location_name(") ||
		strings.Contains(catalogBody, "private.lock_property_legacy_location_assignment_name(") {
		t.Fatal("catalog mutations must retain the exclusive advisory lock")
	}

	deactivationStart := strings.Index(source, "create or replace function private.guard_property_location_deactivation()")
	if deactivationStart < 0 {
		t.Fatal("location deactivation guard boundaries are missing")
	}
	deactivationEnd := strings.Index(source[deactivationStart:], "revoke all on function private.guard_property_location_deactivation()")
	if deactivationEnd < 0 {
		t.Fatal("location deactivation guard boundaries are missing")
	}
	deactivationBody := source[deactivationStart : deactivationStart+deactivationEnd]
	if !strings.Contains(deactivationBody, "private.lock_property_legacy_location_name(") ||
		strings.Contains(deactivationBody, "private.lock_property_legacy_location_assignment_name(") {
		t.Fatal("catalog deactivation must retain the exclusive advisory lock")
	}
}
