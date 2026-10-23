package developments

import (
	"context"
	"errors"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	propertiesdomain "github.com/vimob-crm/vimob-crm/apps/api/internal/properties"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestPropertyInventoryEligibilityRejectsEveryClosedParentAgainstDatabase(t *testing.T) {
	if os.Getenv("VIMOB_PROPERTY_HARDENING_WRITE_TEST") != "LOCAL_WRITE_TEST" {
		t.Skip("requires the isolated synthetic property database; not a PostgreSQL proof when skipped")
	}
	connection := os.Getenv("VIMOB_PROPERTY_HARDENING_TEST_DATABASE_URL")
	parsed, err := url.Parse(connection)
	if err != nil || parsed.Path != "/vimob_properties_fixes_20261012_fb58fe98" || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") {
		t.Fatal("inventory tests refuse any database except the named loopback property fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: connection, MaxConns: 2, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(database.Close)
	tx, err := database.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	actor := tenant.Context{MemberRole: "admin", Permissions: []string{permissions.PropertyManage}}
	if err := tx.QueryRow(ctx, `select member.organization_id::text, member.user_id::text
		from public.organization_members member join public.users app_user on app_user.id = member.user_id
		where member.is_active and member.deleted_at is null and app_user.is_active limit 1`).Scan(&actor.OrganizationID, &actor.UserID); err != nil {
		t.Fatal(err)
	}
	property, err := propertiesdomain.NewRepository(database, propertiesdomain.StorageConfig{}).CreateFromDevelopmentUnitTx(ctx, tx, actor, propertiesdomain.DevelopmentUnitPropertyInput{
		Title: "Unidade sintética para elegibilidade", PropertyType: "Apartamento", DealType: "lancamento", Status: "active",
	})
	if err != nil {
		t.Fatal(err)
	}
	propertyID := property["id"].(string)
	assertVisibility := func(expected bool) {
		t.Helper()
		var visible bool
		if err := tx.QueryRow(ctx, `select `+PropertyInventoryOpenSQL("p")+` from public.properties p
			where p.organization_id = $1::uuid and p.id = $2::uuid`, actor.OrganizationID, propertyID).Scan(&visible); err != nil || visible != expected {
			t.Fatalf("inventory eligibility=%t, expected=%t: %v", visible, expected, err)
		}
	}
	assertVisibility(true) // Unlinked regular property.
	var developmentID, phaseID, buildingID, planID, unitID string
	if err := tx.QueryRow(ctx, `insert into public.property_developments
		(organization_id, code, name, status, commercial_status, created_by, updated_by)
		values ($1::uuid, 'INV-' || gen_random_uuid()::text, 'Sintético', 'launched', 'active', $2::uuid, $2::uuid)
		returning id::text`, actor.OrganizationID, actor.UserID).Scan(&developmentID); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `insert into public.property_development_phases
		(organization_id, development_id, code, name, status, created_by, updated_by)
		values ($1::uuid, $2::uuid, 'FASE', 'Fase', 'planned', $3::uuid, $3::uuid) returning id::text`, actor.OrganizationID, developmentID, actor.UserID).Scan(&phaseID); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `insert into public.property_development_buildings
		(organization_id, development_id, phase_id, code, name, status, created_by, updated_by)
		values ($1::uuid, $2::uuid, $3::uuid, 'TORRE', 'Torre', 'active', $4::uuid, $4::uuid) returning id::text`, actor.OrganizationID, developmentID, phaseID, actor.UserID).Scan(&buildingID); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `insert into public.property_development_floor_plans
		(organization_id, development_id, code, name, status, created_by, updated_by)
		values ($1::uuid, $2::uuid, 'PLANTA', 'Planta', 'active', $3::uuid, $3::uuid) returning id::text`, actor.OrganizationID, developmentID, actor.UserID).Scan(&planID); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `insert into public.property_development_units
		(organization_id, development_id, building_id, floor_plan_id, property_id, code, unit_number, status, published, publication_pending, created_by, updated_by)
		values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'U901', '901', 'available', false, false, $6::uuid, $6::uuid)
		returning id::text`, actor.OrganizationID, developmentID, buildingID, planID, propertyID, actor.UserID).Scan(&unitID); err != nil {
		t.Fatal(err)
	}
	assertVisibility(true)
	for _, change := range []struct{ table, field, id, closed, original string }{
		{"property_developments", "status", developmentID, "archived", "launched"},
		{"property_developments", "status", developmentID, "cancelled", "launched"},
		{"property_developments", "status", developmentID, "suspended", "launched"},
		{"property_developments", "commercial_status", developmentID, "closed", "active"},
		{"property_developments", "commercial_status", developmentID, "sold_out", "active"},
		{"property_development_phases", "status", phaseID, "cancelled", "planned"},
		{"property_development_phases", "status", phaseID, "suspended", "planned"},
		{"property_development_buildings", "status", buildingID, "inactive", "active"},
		{"property_development_floor_plans", "status", planID, "inactive", "active"},
		{"property_development_floor_plans", "status", planID, "archived", "active"},
	} {
		query := `update public.` + change.table + ` set ` + change.field + ` = $3 where organization_id = $1::uuid and id = $2::uuid`
		if _, err := tx.Exec(ctx, query, actor.OrganizationID, change.id, change.closed); err != nil {
			t.Fatal(err)
		}
		assertVisibility(false)
		if err := requireUnitInventoryOpen(ctx, tx, actor.OrganizationID, developmentID, unitID); !errors.Is(err, ErrConflict) {
			t.Fatalf("closed %s=%s granted mutation: %v", change.table, change.closed, err)
		}
		// Closed state does not prevent taking the ordered publication locks;
		// unpublish must still be available.
		if err := LockPropertyInventory(ctx, tx, actor.OrganizationID, propertyID); err != nil {
			t.Fatalf("closed inventory prevented withdrawal locks: %v", err)
		}
		if _, err := tx.Exec(ctx, query, actor.OrganizationID, change.id, change.original); err != nil {
			t.Fatal(err)
		}
	}
	otherOrganizationID := "11111111-1111-4111-8111-111111111111"
	if otherOrganizationID == actor.OrganizationID {
		otherOrganizationID = "22222222-2222-4222-8222-222222222222"
	}
	if err := requireUnitInventoryOpen(ctx, tx, otherOrganizationID, developmentID, unitID); !errors.Is(err, ErrConflict) {
		t.Fatalf("foreign organization inventory accepted: %v", err)
	}
}
