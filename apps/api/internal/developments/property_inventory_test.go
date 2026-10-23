package developments

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

type inventoryTestRow struct {
	values []any
	err    error
}

func (row inventoryTestRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	for index, value := range row.values {
		switch target := dest[index].(type) {
		case *string:
			*target = value.(string)
		case *bool:
			*target = value.(bool)
		}
	}
	return nil
}

type inventoryTestTx struct {
	pgx.Tx
	query func(string, ...any) pgx.Row
}

func (tx inventoryTestTx) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	return tx.query(sql, args...)
}

func TestPropertyInventoryLocksParentsBeforeUnitAndRetainsTenantScope(t *testing.T) {
	for _, organizationID := range []string{"org-a", "org-b"} {
		t.Run(organizationID, func(t *testing.T) {
			calls := 0
			tx := inventoryTestTx{query: func(sql string, args ...any) pgx.Row {
				calls++
				if args[0] != organizationID || !strings.Contains(sql, "organization_id = $1::uuid") {
					t.Fatal("inventory lock lost its organization")
				}
				switch calls {
				case 1:
					if !reflect.DeepEqual(args, []any{organizationID, "property"}) || strings.Contains(sql, "for share") {
						t.Fatal("initial lookup acquired child locks ahead of parent")
					}
					return inventoryTestRow{values: []any{"development", "unit"}}
				case 2:
					if !strings.Contains(sql, "from public.property_developments") || !strings.Contains(sql, "for share") {
						t.Fatal("development must be locked before unit/property")
					}
					return inventoryTestRow{values: []any{"development"}}
				case 3:
					if !reflect.DeepEqual(args, []any{organizationID, "development", "unit", "property"}) || !strings.Contains(sql, "property_id = $4::uuid") || !strings.Contains(sql, "for share") {
						t.Fatal("unit lock must revalidate the discovered property link")
					}
					return inventoryTestRow{values: []any{"unit"}}
				case 4:
					if !reflect.DeepEqual(args, []any{organizationID, "property"}) || !strings.Contains(sql, "from public.properties") || !strings.Contains(sql, "for update") {
						t.Fatal("property must be locked after its inventory parents")
					}
					return inventoryTestRow{values: []any{"property"}}
				case 5:
					if !reflect.DeepEqual(args, []any{organizationID, "property"}) || !strings.Contains(sql, "property_id = $2::uuid") {
						t.Fatal("property link must be checked again after its row lock")
					}
					return inventoryTestRow{values: []any{"unit"}}
				default:
					t.Fatal("unexpected query")
					return inventoryTestRow{err: errors.New("unexpected")}
				}
			}}
			if err := LockPropertyInventory(context.Background(), tx, organizationID, "property"); err != nil || calls != 5 {
				t.Fatalf("inventory lock = %v, calls=%d", err, calls)
			}
		})
	}
}

func TestPropertyInventoryChangedLinkFailsClosedAndUnlinkedPropertyIsAllowed(t *testing.T) {
	for _, test := range []struct {
		name     string
		rows     []inventoryTestRow
		conflict bool
	}{
		{"unlinked", []inventoryTestRow{{err: pgx.ErrNoRows}, {values: []any{"property"}}, {err: pgx.ErrNoRows}}, false},
		{"new link before property lock", []inventoryTestRow{{err: pgx.ErrNoRows}, {values: []any{"property"}}, {values: []any{"unit"}}}, true},
		{"missing property", []inventoryTestRow{{err: pgx.ErrNoRows}, {err: pgx.ErrNoRows}, {err: pgx.ErrNoRows}}, false},
		{"parent removed", []inventoryTestRow{{values: []any{"development", "unit"}}, {err: pgx.ErrNoRows}}, true},
		{"unit link changed", []inventoryTestRow{{values: []any{"development", "unit"}}, {values: []any{"development"}}, {err: pgx.ErrNoRows}}, true},
		{"different link after property lock", []inventoryTestRow{{values: []any{"development", "unit"}}, {values: []any{"development"}}, {values: []any{"unit"}}, {values: []any{"property"}}, {values: []any{"other-unit"}}}, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			tx := inventoryTestTx{query: func(sql string, args ...any) pgx.Row {
				if args[0] != "organization" || !strings.Contains(sql, "organization_id = $1::uuid") {
					t.Fatal("changed-link lookup lost its organization")
				}
				if calls >= len(test.rows) {
					t.Fatal("unexpected parent acquisition after property lock")
				}
				row := test.rows[calls]
				calls++
				return row
			}}
			err := LockPropertyInventory(context.Background(), tx, "organization", "property")
			if !test.conflict && err != nil || test.conflict && !errors.Is(err, ErrConflict) || calls != len(test.rows) {
				t.Fatalf("changed-link guard: %v, calls=%d", err, calls)
			}
		})
	}
}

func TestUnitInventoryGuardRejectsClosedMissingAndFailedLookup(t *testing.T) {
	for _, result := range []inventoryTestRow{{values: []any{false}}, {values: []any{true}}, {err: errors.New("connection lost")}} {
		tx := inventoryTestTx{query: func(sql string, args ...any) pgx.Row {
			if !reflect.DeepEqual(args, []any{"org", "development", "unit"}) || !strings.Contains(sql, "inventory_unit.development_id = $2::uuid") {
				t.Fatal("inventory guard lost its resource scope")
			}
			return result
		}}
		err := requireUnitInventoryOpen(context.Background(), tx, "org", "development", "unit")
		if result.err != nil && !errors.Is(err, result.err) || result.err == nil && result.values[0] == false && !errors.Is(err, ErrConflict) || result.err == nil && result.values[0] == true && err != nil {
			t.Fatalf("inventory result %#v: %v", result, err)
		}
	}
}

func TestInventoryEligibilityIncludesEveryParentAndMissingPlanFailsClosed(t *testing.T) {
	sql := PropertyInventoryOpenSQL("p")
	for _, requirement := range []string{
		"inventory_link.organization_id = p.organization_id", "inventory_unit.property_id = p.id",
		"inventory_building.development_id = inventory_development.id",
		"inventory_phase.development_id = inventory_building.development_id",
		"inventory_plan.development_id = inventory_unit.development_id",
		"inventory_development.status in ('planning', 'pre_launch', 'launched', 'under_construction', 'ready', 'delivered')",
		"inventory_development.commercial_status in ('draft', 'active', 'paused')",
		"inventory_building.status in ('planned', 'active', 'delivered')",
		"inventory_phase.status in ('planned', 'pre_launch', 'launched', 'under_construction', 'delivered')",
		"inventory_plan.status in ('draft', 'active')",
		"inventory_unit.floor_plan_id is null", "inventory_plan.id is not null",
	} {
		if !strings.Contains(sql, requirement) {
			t.Fatalf("eligibility lacks %q", requirement)
		}
	}
	if !strings.Contains(sql, "not exists") || !strings.Contains(sql, "or exists") {
		t.Fatal("unlinked standard properties must remain eligible")
	}
}
