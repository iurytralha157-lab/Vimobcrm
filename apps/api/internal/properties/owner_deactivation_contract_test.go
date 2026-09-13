package properties

import (
	"os"
	"strings"
	"testing"
)

const ownerDeactivationMigrationPath = "../../../../supabase/migrations/20260908114000_guard_legacy_property_owner_deactivation.sql"
const propertyCatalogSerializationMigrationPath = "../../../../supabase/migrations/20260908115000_serialize_property_catalog_references.sql"

func TestOwnerDeactivationUsesCanonicalAndLegacyAssociations(t *testing.T) {
	query := strings.ToLower(ownerDeactivationInUseSQL())

	for _, fragment := range []string{
		"property.owner_id = owner.id",
		"from public.property_ownerships as normalized_ownership",
		"from public.property_ownerships scheduled_ownership",
		"scheduled_ownership.valid_to is null or current_date < scheduled_ownership.valid_to",
		"property.owner_id is null",
		"lower(trim(property.owner_name)) = lower(trim(owner.name))",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("owner deactivation guard is missing %q", fragment)
		}
	}
	if strings.Contains(query, "scheduled_ownership.valid_from <= current_date") {
		t.Fatal("owner deactivation must reserve future ownerships before their validity starts")
	}
}

func TestOwnerDeactivationMigrationGuardsLegacyNameOnlyAssociations(t *testing.T) {
	sourceBytes, err := os.ReadFile(ownerDeactivationMigrationPath)
	if err != nil {
		t.Fatalf("read owner deactivation migration: %v", err)
	}
	source := strings.ToLower(string(sourceBytes))

	for _, fragment := range []string{
		"property.owner_id = v_owner_id",
		"from public.property_ownerships ownership",
		"ownership.valid_to is null or current_date < ownership.valid_to",
		"property.owner_id is null",
		"lower(btrim(property.owner_name)) = lower(btrim(old.name))",
		"constraint = 'property_owner_active_reference'",
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("owner deactivation migration is missing %q", fragment)
		}
	}
	ownershipGuard := source[strings.Index(source, "from public.property_ownerships ownership"):]
	if strings.Contains(ownershipGuard, "ownership.valid_from <= current_date") {
		t.Fatal("owner deactivation migration must reserve future ownerships before their validity starts")
	}
}

func TestOwnerRenameChecksLegacyNameOnlyAssociations(t *testing.T) {
	query := strings.ToLower(ownerLegacyNameInUseSQL())
	for _, fragment := range []string{
		"property.organization_id = $1::uuid",
		"property.owner_id is null",
		"lower(trim(property.owner_name)) = lower(trim($2))",
		"lower(trim(property.owner_name)) = lower(trim($3))",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("owner rename guard is missing %q", fragment)
		}
	}
}

func TestPropertyCatalogSerializationMigrationClosesAssignmentRaces(t *testing.T) {
	sourceBytes, err := os.ReadFile(propertyCatalogSerializationMigrationPath)
	if err != nil {
		t.Fatalf("read property catalog serialization migration: %v", err)
	}
	source := strings.ToLower(string(sourceBytes))

	for _, fragment := range []string{
		"do $property_owner_non_ended_reference_preflight$",
		"constraint = 'property_owner_non_ended_inactive_preflight'",
		"do $property_owner_legacy_resolution_preflight$",
		"count(*) filter (where coalesce(owner.is_active, true))",
		"constraint = 'property_owner_legacy_resolution_preflight'",
		"create or replace function private.guard_active_property_owner_assignment()",
		"for share nowait",
		"tg_table_name = 'property_ownerships'",
		"new.valid_to is null or current_date < new.valid_to",
		"inactive for a non-ended period",
		"before insert or update of organization_id, owner_id, valid_from, valid_to",
		"constraint = 'property_owner_assignment_invalid'",
		"legacy property owner is inactive or ambiguous",
		"pg_try_advisory_xact_lock_shared",
		"legacy property owner must be active when first cataloged",
		"v_existing_name_matches > 0",
		"property.organization_id = new.organization_id",
		"lower(btrim(property.owner_name)) = v_new_name",
		"create trigger a0_property_owner_guard_legacy_rename",
		"before insert or update of organization_id, name on public.property_owners",
		"create or replace function private.guard_property_owner_deactivation()",
		"do $property_owner_serialization_postflight$",
		"create or replace function private.guard_active_property_location_references()",
		"create trigger a0_properties_active_location_references",
		"errcode = '40001'",
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("property catalog serialization migration is missing %q", fragment)
		}
	}
	preflightIndex := strings.Index(source, "do $property_owner_legacy_resolution_preflight$")
	triggerIndex := strings.Index(source, "create trigger a0_properties_active_owner_reference")
	if preflightIndex < 0 || triggerIndex < 0 || preflightIndex > triggerIndex {
		t.Fatal("owner catalog preflights must run before assignment triggers are installed")
	}
	ownerTriggerIndex := strings.Index(source, "create trigger a0_property_owner_guard_legacy_rename")
	postflightIndex := strings.Index(source, "do $property_owner_serialization_postflight$")
	if ownerTriggerIndex < 0 || postflightIndex < 0 || ownerTriggerIndex > postflightIndex {
		t.Fatal("owner catalog invariants must be rechecked after all owner-association trigger locks are held")
	}
	ownerGuardStart := strings.Index(source, "create or replace function private.guard_active_property_owner_assignment()")
	ownerGuardEnd := strings.Index(source, "revoke all on function private.guard_active_property_owner_assignment()")
	locationGuardStart := strings.Index(source, "create or replace function private.guard_active_property_location_references()")
	locationGuardEnd := strings.Index(source, "revoke all on function private.guard_active_property_location_references()")
	if ownerGuardStart < 0 || ownerGuardEnd < ownerGuardStart || locationGuardStart < 0 || locationGuardEnd < locationGuardStart {
		t.Fatal("could not isolate assignment guard hot paths")
	}
	for name, block := range map[string]string{
		"owner":    source[ownerGuardStart:ownerGuardEnd],
		"location": source[locationGuardStart:locationGuardEnd],
	} {
		if !strings.Contains(block, "for share nowait") {
			t.Fatalf("%s assignment guard must share-lock lifecycle rows", name)
		}
		if strings.Contains(block, "for update nowait") {
			t.Fatalf("%s assignment guard must not exclusively serialize independent assignments", name)
		}
	}
	ownerAssignment := source[ownerGuardStart:ownerGuardEnd]
	if !strings.Contains(ownerAssignment, "pg_try_advisory_xact_lock_shared(") {
		t.Fatal("legacy name-only assignments must share the advisory owner-name lock")
	}
	if strings.Contains(ownerAssignment, "pg_try_advisory_xact_lock(") {
		t.Fatal("legacy name-only assignments must not exclusively serialize each other")
	}
	catalogGuardStart := strings.Index(source, "create or replace function private.guard_property_owner_legacy_rename()")
	deactivationGuardStart := strings.Index(source, "create or replace function private.guard_property_owner_deactivation()")
	if catalogGuardStart < 0 || deactivationGuardStart < catalogGuardStart || postflightIndex < deactivationGuardStart {
		t.Fatal("could not isolate owner catalog lifecycle guards")
	}
	for name, block := range map[string]string{
		"insert/rename": source[catalogGuardStart:deactivationGuardStart],
		"deactivation":  source[deactivationGuardStart:postflightIndex],
	} {
		if !strings.Contains(block, "pg_try_advisory_xact_lock(") {
			t.Fatalf("owner catalog %s must exclusively lock the legacy owner name", name)
		}
		if strings.Contains(block, "pg_try_advisory_xact_lock_shared(") {
			t.Fatalf("owner catalog %s must not use the assignment-only shared advisory lock", name)
		}
	}
}

func TestOwnerAssignmentHotPathSharesLifecycleRowLocks(t *testing.T) {
	sourceBytes, err := os.ReadFile("owner_projection.go")
	if err != nil {
		t.Fatalf("read owner projection source: %v", err)
	}
	source := strings.ToLower(string(sourceBytes))
	dedupStart := strings.Index(source, "func resolveorcreateinlinepropertyowner(")
	assignmentStart := strings.Index(source, "func lockactivepropertyownerforassignment(")
	if dedupStart < 0 || assignmentStart < dedupStart {
		t.Fatal("could not isolate inline deduplication and assignment lock helpers")
	}
	deduplication := source[dedupStart:assignmentStart]
	assignment := source[assignmentStart:]
	if !strings.Contains(deduplication, "for update nowait") {
		t.Fatal("inline owner deduplication must retain its exclusive row lock")
	}
	if !strings.Contains(assignment, "for share nowait") {
		t.Fatal("owner assignment must share-lock the lifecycle row")
	}
	if strings.Contains(assignment, "for update nowait") {
		t.Fatal("owner assignment must not exclusively serialize independent property writes")
	}
}
