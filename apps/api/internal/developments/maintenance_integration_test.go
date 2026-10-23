package developments

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestDevelopmentMaintenancePersistsSameEntitiesAndProtectsInventory(t *testing.T) {
	if os.Getenv("VIMOB_PROPERTY_HARDENING_WRITE_TEST") != "LOCAL_WRITE_TEST" {
		t.Skip("requires the isolated synthetic property database")
	}
	connection := os.Getenv("VIMOB_PROPERTY_HARDENING_TEST_DATABASE_URL")
	parsed, err := url.Parse(connection)
	if err != nil || parsed.Path != "/vimob_properties_fixes_20261012_fb58fe98" || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") {
		t.Fatal("development tests refuse any database except the named loopback property fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: connection, MaxConns: 3, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(database.Close)
	actor := tenant.Context{MemberRole: "admin"}
	if err := database.Pool().QueryRow(ctx, `select member.organization_id::text, member.user_id::text
		from public.organization_members member join public.users actor_user on actor_user.id = member.user_id
		where member.is_active and member.deleted_at is null and actor_user.is_active
		  and exists (select 1 from public.users outsider where outsider.is_active and not exists
		    (select 1 from public.organization_members outsider_member where outsider_member.organization_id = member.organization_id
		      and outsider_member.user_id = outsider.id and outsider_member.is_active and outsider_member.deleted_at is null))
		order by member.organization_id, member.user_id limit 1`).Scan(&actor.OrganizationID, &actor.UserID); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(database)
	var outsiderID string
	if err := database.Pool().QueryRow(ctx, `select outsider.id::text from public.users outsider
		where outsider.is_active and not exists (select 1 from public.organization_members member
		  where member.organization_id = $1::uuid and member.user_id = outsider.id and member.is_active and member.deleted_at is null)
		limit 1`, actor.OrganizationID).Scan(&outsiderID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Create(ctx, actor, CreateDevelopmentInput{Code: "FORGED-" + time.Now().Format("150405.000000000"), Name: "Cadastro sintético", ResponsibleUserID: &outsiderID}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("cross-tenant responsible member accepted during create: %v", err)
	}
	created, err := repo.Create(ctx, actor, CreateDevelopmentInput{Code: "MAINT-" + time.Now().Format("150405.000000000"), Name: "Empreendimento sintético", Status: "launched", CommercialStatus: "active"})
	if err != nil {
		t.Fatal(err)
	}
	developmentID := created.Data.Development.ID
	version := created.Data.Development.UpdatedAt
	input := MaintenanceInput{ExpectedUpdatedAt: version, Changes: map[string]json.RawMessage{"name": json.RawMessage(`"Nome corrigido"`)}}
	updated, err := repo.UpdateMaintenance(ctx, actor, developmentID, developmentID, maintenanceDevelopment, input)
	if err != nil {
		t.Fatal(err)
	}
	var development Development
	if err := json.Unmarshal(updated, &development); err != nil || development.ID != developmentID || development.Name != "Nome corrigido" {
		t.Fatalf("development identity changed: %s %v", updated, err)
	}
	outsiderJSON, _ := json.Marshal(outsiderID)
	if _, err := repo.UpdateMaintenance(ctx, actor, developmentID, developmentID, maintenanceDevelopment, MaintenanceInput{ExpectedUpdatedAt: development.UpdatedAt, Changes: map[string]json.RawMessage{"responsible_user_id": outsiderJSON}}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("cross-tenant responsible member accepted during edit: %v", err)
	}
	if _, err := repo.UpdateMaintenance(ctx, actor, developmentID, developmentID, maintenanceDevelopment, input); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale development edit accepted: %v", err)
	}
	otherActor := actor
	if err := database.Pool().QueryRow(ctx, `select organization_id::text, user_id::text from public.organization_members where is_active and deleted_at is null and organization_id <> $1::uuid limit 1`, actor.OrganizationID).Scan(&otherActor.OrganizationID, &otherActor.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpdateMaintenance(ctx, otherActor, developmentID, developmentID, maintenanceDevelopment, input); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-tenant development edit accepted: %v", err)
	}
	phase := created.Data.Phases[0]
	updated, err = repo.UpdateMaintenance(ctx, actor, developmentID, phase.ID, maintenancePhase, MaintenanceInput{ExpectedUpdatedAt: phase.UpdatedAt, Changes: map[string]json.RawMessage{"name": json.RawMessage(`"Fase corrigida"`)}})
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(updated, &phase); err != nil || phase.Name != "Fase corrigida" {
		t.Fatalf("phase update failed: %v", err)
	}
	floors := 10
	building, err := repo.CreateBuilding(ctx, actor, developmentID, CreateBuildingInput{PhaseID: phase.ID, Code: "T-A", Name: "Torre A", Status: "active", FloorCount: &floors})
	if err != nil {
		t.Fatal(err)
	}
	updated, err = repo.UpdateMaintenance(ctx, actor, developmentID, building.ID, maintenanceBuilding, MaintenanceInput{ExpectedUpdatedAt: building.UpdatedAt, Changes: map[string]json.RawMessage{"name": json.RawMessage(`"Torre corrigida"`)}})
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(updated, &building); err != nil || building.Name != "Torre corrigida" {
		t.Fatalf("building update failed: %v", err)
	}
	plan, err := repo.CreateFloorPlan(ctx, actor, developmentID, CreateFloorPlanInput{Code: "PL-A", Name: "Planta A", Status: "active"})
	if err != nil {
		t.Fatal(err)
	}
	updated, err = repo.UpdateMaintenance(ctx, actor, developmentID, plan.ID, maintenanceFloorPlan, MaintenanceInput{ExpectedUpdatedAt: plan.UpdatedAt, Changes: map[string]json.RawMessage{"name": json.RawMessage(`"Planta corrigida"`)}})
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(updated, &plan); err != nil || plan.Name != "Planta corrigida" {
		t.Fatalf("floor plan update failed: %v", err)
	}
	price := 500000.0
	bulkInput := BulkCreateUnitsInput{BuildingID: building.ID, FloorPlanID: &plan.ID, Prefix: "U", StartNumber: 1, Count: 1, UnitsPerFloor: 1, InitialListPrice: &price}
	units, err := repo.BulkCreateUnits(ctx, actor, developmentID, bulkInput)
	if err != nil {
		t.Fatal(err)
	}
	unit := units.Units[0]
	status := "sold"
	if _, err := repo.UpdateUnit(ctx, actor, developmentID, unit.ID, UpdateUnitInput{Status: &status, ExpectedUpdatedAt: &unit.UpdatedAt}); err != nil {
		t.Fatal(err)
	}
	_, err = repo.UpdateMaintenance(ctx, actor, developmentID, plan.ID, maintenanceFloorPlan, MaintenanceInput{ExpectedUpdatedAt: plan.UpdatedAt, Changes: map[string]json.RawMessage{"bedrooms": json.RawMessage(`3`)}})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("structural change mutated sold inventory: %v", err)
	}
	updated, err = repo.UpdateMaintenance(ctx, actor, developmentID, plan.ID, maintenanceFloorPlan, MaintenanceInput{ExpectedUpdatedAt: plan.UpdatedAt, Changes: map[string]json.RawMessage{"status": json.RawMessage(`"archived"`)}})
	if err != nil {
		t.Fatal(err)
	}
	bulkInput.StartNumber = 2
	if _, err := repo.BulkCreateUnits(ctx, actor, developmentID, bulkInput); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("new unit used archived floor plan: %v", err)
	}
	// Phase guards follow the building relationship; units have no phase_id.
	if _, err := repo.UpdateMaintenance(ctx, actor, developmentID, phase.ID, maintenancePhase, MaintenanceInput{ExpectedUpdatedAt: phase.UpdatedAt, Changes: map[string]json.RawMessage{"status": json.RawMessage(`"cancelled"`)}}); err != nil {
		t.Fatalf("phase archive with no live inventory failed: %v", err)
	}
}
