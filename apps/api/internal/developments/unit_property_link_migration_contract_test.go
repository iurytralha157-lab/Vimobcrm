package developments

import (
	"os"
	"strings"
	"testing"
)

const unitPropertyLinkHardeningMigration = "../../../../supabase/migrations/20260831045322_harden_development_unit_property_link.sql"

func TestUnitPropertyLinkHardeningMigrationKeepsOneWayTransactionalInvariant(t *testing.T) {
	raw, err := os.ReadFile(unitPropertyLinkHardeningMigration)
	if err != nil {
		t.Fatalf("read unit-property hardening migration: %v", err)
	}
	source := strings.ToLower(string(raw))

	for _, required := range []string{
		"create unique index if not exists property_development_unit_events_idempotency_uidx",
		"(metadata ->> 'idempotency_key_hash')",
		"where event_type = 'property_linked'",
		"create trigger trg_property_development_unit_property_sync",
		"after insert or update of property_id, status",
		"create trigger trg_property_development_price_table_property_sync",
		"after update of status",
		"create trigger trg_property_development_unit_price_property_sync",
		"after insert or update or delete",
		"if tg_op in ('update', 'delete')",
		"if tg_op in ('insert', 'update')",
		"set preco = active_list_price",
		"property.organization_id = source_organization_id",
		"property.preco is distinct from active_list_price",
		"create trigger trg_properties_development_unit_consistency",
		"before update of status, preco, published_on_site",
		"constraint = 'property_development_unit_status_sync'",
		"constraint = 'property_development_unit_price_sync'",
		"constraint = 'property_development_unit_publication_sync'",
		"using errcode = '23514'",
		"revoke all on function private.sync_property_from_development_unit()",
		"revoke all on function private.sync_linked_property_price_for_development_unit(uuid, uuid, uuid)",
		"revoke all on function private.sync_linked_property_from_unit_price()",
		"revoke all on function private.guard_linked_development_property_consistency()",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("unit-property hardening migration is missing %q", required)
		}
	}

	if strings.Contains(source, "update public.property_development_units") {
		t.Fatal("property-side guard must never write back to units and create a synchronization loop")
	}
}

func TestUnitPropertyLinkHardeningMigrationCanonicalizesLegacyStatuses(t *testing.T) {
	raw, err := os.ReadFile(unitPropertyLinkHardeningMigration)
	if err != nil {
		t.Fatalf("read unit-property hardening migration: %v", err)
	}
	source := strings.ToLower(string(raw))

	for _, alias := range []string{
		"when 'reservado' then 'reserved'",
		"when 'vendido' then 'sold'",
		"when 'alugado' then 'rented'",
		"when 'locado' then 'rented'",
		"when 'arquivado' then 'archived'",
	} {
		if !strings.Contains(source, alias) {
			t.Fatalf("legacy status mapping is missing %q", alias)
		}
	}
}

func TestUnitPriceMutationSyncUsesActiveScopedPriceAndClearsDeletedFallback(t *testing.T) {
	raw, err := os.ReadFile(unitPropertyLinkHardeningMigration)
	if err != nil {
		t.Fatalf("read unit-property hardening migration: %v", err)
	}
	source := strings.ToLower(string(raw))

	start := strings.Index(source, "create or replace function private.sync_linked_property_price_for_development_unit")
	if start < 0 {
		t.Fatal("unit-price synchronization helper is missing")
	}
	endOffset := strings.Index(source[start:], "revoke all on function private.sync_linked_property_price_for_development_unit")
	if endOffset < 0 {
		t.Fatal("unit-price synchronization helper terminator is missing")
	}
	helper := source[start : start+endOffset]

	for _, required := range []string{
		"price_table.organization_id = source_organization_id",
		"price_table.development_id = source_development_id",
		"price_table.status = 'active'",
		"unit_price.unit_id = source_unit_id",
		"unit.organization_id = source_organization_id",
		"unit.development_id = source_development_id",
		"unit.id = source_unit_id",
		"property.organization_id = source_organization_id",
		"set preco = active_list_price",
	} {
		if !strings.Contains(helper, required) {
			t.Fatalf("unit-price synchronization helper is missing %q", required)
		}
	}
	if strings.Contains(helper, "coalesce(active_list_price") {
		t.Fatal("deleting the active unit price must clear the stale property price instead of preserving it")
	}
}
