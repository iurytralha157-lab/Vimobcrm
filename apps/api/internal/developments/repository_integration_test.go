package developments

import (
	"context"
	"errors"
	"net"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestDevelopmentInventoryLifecycleAgainstDatabase(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DB_TESTS") != "1" {
		t.Skip("set VIMOB_RUN_DB_TESTS=1 to run database integration tests")
	}
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		t.Fatal("DATABASE_URL is required")
	}
	assertLoopbackDatabase(t, databaseURL)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL: databaseURL, MaxConns: 4, HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewPostgres() returned error: %v", err)
	}
	t.Cleanup(postgres.Close)

	var organizationID, userID string
	err = postgres.Pool().QueryRow(ctx, `
		select member.organization_id::text, member.user_id::text
		from public.organization_members as member
		join public.users as app_user on app_user.id = member.user_id
		where coalesce(member.is_active, true)
		order by member.created_at
		limit 1
	`).Scan(&organizationID, &userID)
	if errors.Is(err, pgx.ErrNoRows) {
		t.Skip("no active organization member is available")
	}
	if err != nil {
		t.Fatalf("organization fixture lookup returned error: %v", err)
	}

	repository := NewRepository(postgres)
	tenantContext := tenant.Context{
		OrganizationID: organizationID,
		UserID:         userID,
		MemberRole:     "admin",
	}
	suffix := time.Now().UTC().Format("20060102150405.000000000")
	code := "DEV-TEST-" + suffix
	developerName := "Incorporadora Teste " + suffix
	developmentID := ""
	developerID := ""
	leadID := ""
	t.Cleanup(func() {
		if developmentID == "" {
			return
		}
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cleanupCancel()
		tx, cleanupErr := postgres.Pool().Begin(cleanupCtx)
		if cleanupErr != nil {
			t.Errorf("begin development cleanup: %v", cleanupErr)
			return
		}
		defer tx.Rollback(cleanupCtx)
		// The test runs only against a loopback superuser database. Commercial
		// tables are deliberately immutable after activation, so fixture cleanup
		// disables user triggers inside this local transaction only.
		if _, cleanupErr = tx.Exec(cleanupCtx, "set local session_replication_role = replica"); cleanupErr != nil {
			t.Errorf("prepare development cleanup: %v", cleanupErr)
			return
		}
		statements := []string{
			"delete from public.property_development_unit_events where organization_id = $1::uuid and development_id = $2::uuid",
			"delete from public.property_development_reservations where organization_id = $1::uuid and development_id = $2::uuid",
			"delete from public.property_development_unit_prices where organization_id = $1::uuid and development_id = $2::uuid",
			"delete from public.property_development_units where organization_id = $1::uuid and development_id = $2::uuid",
			"delete from public.property_development_price_tables where organization_id = $1::uuid and development_id = $2::uuid",
			"delete from public.property_development_floor_plans where organization_id = $1::uuid and development_id = $2::uuid",
			"delete from public.property_development_buildings where organization_id = $1::uuid and development_id = $2::uuid",
			"delete from public.property_development_phases where organization_id = $1::uuid and development_id = $2::uuid",
			"delete from public.property_developments where organization_id = $1::uuid and id = $2::uuid",
		}
		for _, statement := range statements {
			if _, cleanupErr = tx.Exec(cleanupCtx, statement, organizationID, developmentID); cleanupErr != nil {
				t.Errorf("development cleanup statement failed: %v", cleanupErr)
				return
			}
		}
		if developerID != "" {
			if _, cleanupErr = tx.Exec(cleanupCtx, `
				delete from public.property_developers
				where organization_id = $1::uuid and id = $2::uuid
			`, organizationID, developerID); cleanupErr != nil {
				t.Errorf("developer cleanup failed: %v", cleanupErr)
				return
			}
		}
		if leadID != "" {
			if _, cleanupErr = tx.Exec(cleanupCtx, `
				delete from public.leads
				where organization_id = $1::uuid and id = $2::uuid
			`, organizationID, leadID); cleanupErr != nil {
				t.Errorf("lead cleanup failed: %v", cleanupErr)
				return
			}
		}
		if cleanupErr = tx.Commit(cleanupCtx); cleanupErr != nil {
			t.Errorf("commit development cleanup: %v", cleanupErr)
		}
	})

	created, err := repository.Create(ctx, tenantContext, CreateDevelopmentInput{
		DeveloperName:    &developerName,
		Code:             code,
		Name:             "Residencial Horizonte",
		DevelopmentType:  "vertical",
		Status:           "launched",
		CommercialStatus: "active",
		City:             stringPointer("São Paulo"),
		Neighborhood:     stringPointer("Pinheiros"),
	})
	if err != nil {
		t.Fatalf("Create() returned error: %v", err)
	}
	developmentID = created.Data.Development.ID
	if created.Data.Development.DeveloperID != nil {
		developerID = *created.Data.Development.DeveloperID
	}
	if len(created.Data.Phases) != 1 || created.Data.Phases[0].Name != "Fase única" {
		t.Fatalf("default phase = %#v, want one Fase única", created.Data.Phases)
	}

	building, err := repository.CreateBuilding(ctx, tenantContext, developmentID, CreateBuildingInput{
		PhaseID: created.Data.Phases[0].ID, Code: "TORRE-A", Name: "Torre A",
		BuildingType: "tower", Status: "active", FloorCount: intPointer(10),
	})
	if err != nil {
		t.Fatalf("CreateBuilding() returned error: %v", err)
	}
	floorPlan, err := repository.CreateFloorPlan(ctx, tenantContext, developmentID, CreateFloorPlanInput{
		Code: "PL-68", Name: "Planta 68 m²", Status: "active",
		Bedrooms: intPointer(2), Suites: intPointer(1), PrivateArea: floatPointer(68),
	})
	if err != nil {
		t.Fatalf("CreateFloorPlan() returned error: %v", err)
	}
	overflowPrice := 700000.0
	_, err = repository.BulkCreateUnits(ctx, tenantContext, developmentID, BulkCreateUnitsInput{
		BuildingID: building.ID, FloorPlanID: &floorPlan.ID, Prefix: "X",
		StartNumber: 1, Count: 1, StartFloor: 11, UnitsPerFloor: 1,
		NumberPadding: 3, InitialListPrice: &overflowPrice,
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("floor overflow error = %v, want ErrInvalidInput", err)
	}

	creatorLifecycleTx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatalf("begin creator lifecycle transaction: %v", err)
	}
	if _, err := creatorLifecycleTx.Exec(ctx, `
		update public.users set is_active = false where id = $1::uuid
	`, userID); err != nil {
		_ = creatorLifecycleTx.Rollback(ctx)
		t.Fatalf("deactivate historical creator: %v", err)
	}
	if _, err := creatorLifecycleTx.Exec(ctx, `
		update public.property_development_phases
		set sort_order = sort_order + 1
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, created.Data.Phases[0].ID); err != nil {
		_ = creatorLifecycleTx.Rollback(ctx)
		t.Fatalf("historical creator must not block unchanged audit references: %v", err)
	}
	if err := creatorLifecycleTx.Rollback(ctx); err != nil {
		t.Fatalf("rollback creator lifecycle transaction: %v", err)
	}

	bulk, err := repository.BulkCreateUnits(ctx, tenantContext, developmentID, BulkCreateUnitsInput{
		BuildingID: building.ID, FloorPlanID: &floorPlan.ID, Prefix: "A",
		StartNumber: 101, Count: 4, StartFloor: 1, UnitsPerFloor: 2,
		NumberPadding: 3, InitialListPrice: floatPointer(750000),
	})
	if err != nil {
		t.Fatalf("BulkCreateUnits() returned error: %v", err)
	}
	if len(bulk.Units) != 4 || bulk.PriceTable == nil {
		t.Fatalf("bulk result = %#v, want four priced units", bulk)
	}
	_, err = postgres.Pool().Exec(ctx, `
		insert into public.property_development_reservations (
			organization_id, development_id, unit_id, price_table_id,
			status, reserved_by, expires_at, list_price_snapshot,
			currency, payment_snapshot, metadata
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			'active', $5::uuid, now() + interval '1 hour', 750000,
			'BRL', '{}'::jsonb, '{}'::jsonb
		)
	`, organizationID, developmentID, bulk.Units[0].ID, bulk.PriceTable.ID, userID)
	var pgError *pgconn.PgError
	if !errors.As(err, &pgError) || pgError.Code != "23514" {
		t.Fatalf("pre-activation reservation error = %v, want SQLSTATE 23514", err)
	}
	priceTable, err := repository.ActivatePriceTable(ctx, tenantContext, developmentID, bulk.PriceTable.ID, ActivatePriceTableInput{
		ExpectedUpdatedAt: &bulk.PriceTable.UpdatedAt,
	})
	if err != nil {
		t.Fatalf("ActivatePriceTable() returned error: %v", err)
	}
	if priceTable.Status != "active" {
		t.Fatalf("price table status = %q, want active", priceTable.Status)
	}
	firstActivatedUnits, err := repository.ListUnits(ctx, tenantContext, developmentID, UnitListFilter{Limit: 50})
	if err != nil {
		t.Fatalf("ListUnits() after first activation returned error: %v", err)
	}
	var unitForStatusUpdate Unit
	var deliberatelyHidden Unit
	for _, listedUnit := range firstActivatedUnits.Data {
		switch listedUnit.ID {
		case bulk.Units[0].ID:
			unitForStatusUpdate = listedUnit
		case bulk.Units[1].ID:
			deliberatelyHidden = listedUnit
		}
	}
	if unitForStatusUpdate.ID == "" || deliberatelyHidden.ID == "" {
		t.Fatalf("activated units were not returned: %#v", firstActivatedUnits)
	}
	hidden := false
	deliberatelyHidden, err = repository.UpdateUnit(ctx, tenantContext, developmentID, deliberatelyHidden.ID, UpdateUnitInput{
		Published: &hidden, ExpectedUpdatedAt: &deliberatelyHidden.UpdatedAt,
	})
	if err != nil {
		t.Fatalf("deliberate unit hiding returned error: %v", err)
	}
	if deliberatelyHidden.Published {
		t.Fatal("deliberately hidden unit must be unpublished")
	}
	secondBulk, err := repository.BulkCreateUnits(ctx, tenantContext, developmentID, BulkCreateUnitsInput{
		BuildingID: building.ID, FloorPlanID: &floorPlan.ID, Prefix: "A",
		StartNumber: 105, Count: 1, StartFloor: 3, UnitsPerFloor: 2,
		NumberPadding: 3, InitialListPrice: floatPointer(800000),
	})
	if err != nil {
		t.Fatalf("second BulkCreateUnits() returned error: %v", err)
	}
	if secondBulk.PriceTable == nil || secondBulk.PriceTable.Version != 2 {
		t.Fatalf("second bulk price table = %#v, want draft version 2", secondBulk.PriceTable)
	}
	var secondDraftPriceEvents int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer
		from public.property_development_unit_events
		where organization_id = $1::uuid
		  and development_id = $2::uuid
		  and event_type = 'price_changed'
		  and metadata ->> 'price_table_id' = $3
	`, organizationID, developmentID, secondBulk.PriceTable.ID).Scan(&secondDraftPriceEvents); err != nil {
		t.Fatalf("second draft event lookup returned error: %v", err)
	}
	if secondDraftPriceEvents != 1 {
		t.Fatalf("second draft price event count = %d, want only the newly priced unit", secondDraftPriceEvents)
	}
	secondPriceTable, err := repository.ActivatePriceTable(
		ctx,
		tenantContext,
		developmentID,
		secondBulk.PriceTable.ID,
		ActivatePriceTableInput{ExpectedUpdatedAt: &secondBulk.PriceTable.UpdatedAt},
	)
	if err != nil {
		t.Fatalf("second ActivatePriceTable() returned error: %v", err)
	}
	if secondPriceTable.Status != "active" {
		t.Fatalf("second price table status = %q, want active", secondPriceTable.Status)
	}
	var hiddenAfterActivation bool
	var hiddenPendingAfterActivation bool
	if err := postgres.Pool().QueryRow(ctx, `
		select published, publication_pending
		from public.property_development_units
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, deliberatelyHidden.ID).Scan(&hiddenAfterActivation, &hiddenPendingAfterActivation); err != nil {
		t.Fatalf("hidden unit lookup after activation returned error: %v", err)
	}
	if hiddenAfterActivation || hiddenPendingAfterActivation {
		t.Fatal("activating a new price version must not republish or requeue a deliberately hidden unit")
	}
	var newlyActivatedPublished bool
	var newlyActivatedPending bool
	if err := postgres.Pool().QueryRow(ctx, `
		select published, publication_pending
		from public.property_development_units
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, secondBulk.Units[0].ID).Scan(&newlyActivatedPublished, &newlyActivatedPending); err != nil {
		t.Fatalf("newly activated unit lookup returned error: %v", err)
	}
	if !newlyActivatedPublished || newlyActivatedPending {
		t.Fatal("activating the covering price table must publish and dequeue newly generated inventory")
	}
	_, err = postgres.Pool().Exec(ctx, `
		insert into public.property_development_reservations (
			organization_id, development_id, unit_id, price_table_id,
			status, reserved_by, expires_at, list_price_snapshot,
			currency, payment_snapshot, metadata, created_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			'active', $5::uuid, now() - interval '1 hour', 750000,
			'BRL', '{}'::jsonb, '{}'::jsonb, now() - interval '2 hours'
		)
	`, organizationID, developmentID, bulk.Units[0].ID, secondPriceTable.ID, userID)
	pgError = nil
	if !errors.As(err, &pgError) || pgError.Code != "23514" {
		t.Fatalf("already elapsed reservation error = %v, want SQLSTATE 23514", err)
	}
	var previousPriceTableStatus string
	var previousValidUntil *string
	if err := postgres.Pool().QueryRow(ctx, `
		select status, valid_until::text
		from public.property_development_price_tables
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, priceTable.ID).Scan(&previousPriceTableStatus, &previousValidUntil); err != nil {
		t.Fatalf("previous price table lookup returned error: %v", err)
	}
	if previousPriceTableStatus != "expired" {
		t.Fatalf("previous price table status = %q, want expired", previousPriceTableStatus)
	}
	if previousValidUntil == nil {
		t.Fatal("expired price table must retain an auditable validity end date")
	}

	reservedUnitID := secondBulk.Units[0].ID
	var reservationID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.property_development_reservations (
			organization_id, development_id, unit_id, price_table_id,
			status, reserved_by, expires_at, list_price_snapshot,
			currency, payment_snapshot, metadata
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			'active', $5::uuid, now() + interval '1 hour', 800000,
			'BRL', '{}'::jsonb, '{}'::jsonb
		)
		returning id::text
	`, organizationID, developmentID, reservedUnitID, secondPriceTable.ID, userID).Scan(&reservationID); err != nil {
		t.Fatalf("active reservation insert returned error: %v", err)
	}
	_, err = postgres.Pool().Exec(ctx, `
		update public.property_development_reservations
		set unit_id = $3::uuid
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, reservationID, bulk.Units[1].ID)
	pgError = nil
	if !errors.As(err, &pgError) || pgError.Code != "23514" {
		t.Fatalf("reservation identity update error = %v, want SQLSTATE 23514", err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.property_development_reservations
		set status = 'cancelled', cancellation_reason = 'integration test cleanup'
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, reservationID); err != nil {
		t.Fatalf("reservation cancellation returned error: %v", err)
	}
	var releasedUnitStatus string
	if err := postgres.Pool().QueryRow(ctx, `
		select status
		from public.property_development_units
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, reservedUnitID).Scan(&releasedUnitStatus); err != nil {
		t.Fatalf("released unit lookup returned error: %v", err)
	}
	if releasedUnitStatus != "available" {
		t.Fatalf("released unit status = %q, want available", releasedUnitStatus)
	}

	convertedUnitID := bulk.Units[2].ID
	var convertedReservationID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.property_development_reservations (
			organization_id, development_id, unit_id, price_table_id,
			status, reserved_by, expires_at, list_price_snapshot,
			currency, payment_snapshot, metadata
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			'active', $5::uuid, now() + interval '1 hour', 750000,
			'BRL', '{}'::jsonb, '{}'::jsonb
		)
		returning id::text
	`, organizationID, developmentID, convertedUnitID, secondPriceTable.ID, userID).Scan(&convertedReservationID); err != nil {
		t.Fatalf("converted reservation insert returned error: %v", err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.property_development_reservations
		set status = 'converted', updated_by = $3::uuid
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, convertedReservationID, userID); err != nil {
		t.Fatalf("reservation conversion returned error: %v", err)
	}
	var convertedUnitStatus string
	var convertedUnitPublished bool
	if err := postgres.Pool().QueryRow(ctx, `
		select status, published
		from public.property_development_units
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, convertedUnitID).Scan(&convertedUnitStatus, &convertedUnitPublished); err != nil {
		t.Fatalf("converted unit lookup returned error: %v", err)
	}
	if convertedUnitStatus != "sold" || convertedUnitPublished {
		t.Fatalf("converted unit state = (%q, %t), want sold and unpublished", convertedUnitStatus, convertedUnitPublished)
	}

	expirationUnitID := bulk.Units[3].ID
	var expirationReservationID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.property_development_reservations (
			organization_id, development_id, unit_id, price_table_id,
			status, reserved_by, expires_at, list_price_snapshot,
			currency, payment_snapshot, metadata
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			'active', $5::uuid, clock_timestamp() + interval '5 milliseconds', 750000,
			'BRL', '{}'::jsonb, '{}'::jsonb
		)
		returning id::text
	`, organizationID, developmentID, expirationUnitID, secondPriceTable.ID, userID).Scan(&expirationReservationID); err != nil {
		t.Fatalf("short reservation insert returned error: %v", err)
	}
	if _, err := postgres.Pool().Exec(ctx, `select pg_sleep(0.01)`); err != nil {
		t.Fatalf("wait for reservation expiration returned error: %v", err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.property_development_reservations
		set notes = 'expired reservation audit update', updated_by = $3::uuid
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, expirationReservationID, userID); err != nil {
		t.Fatalf("incidental update on elapsed reservation returned error: %v", err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.property_development_reservations
		set status = 'expired', updated_by = $3::uuid
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, expirationReservationID, userID); err != nil {
		t.Fatalf("elapsed reservation transition returned error: %v", err)
	}

	unit := unitForStatusUpdate
	status := "negotiation"
	updated, err := repository.UpdateUnit(ctx, tenantContext, developmentID, unit.ID, UpdateUnitInput{
		Status: &status, ExpectedUpdatedAt: &unit.UpdatedAt,
	})
	if err != nil {
		t.Fatalf("UpdateUnit() returned error: %v", err)
	}
	if updated.Status != "negotiation" {
		t.Fatalf("updated unit status = %q, want negotiation", updated.Status)
	}
	staleStatus := "blocked"
	_, err = repository.UpdateUnit(ctx, tenantContext, developmentID, unit.ID, UpdateUnitInput{
		Status: &staleStatus, ExpectedUpdatedAt: &unit.UpdatedAt,
	})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("stale update error = %v, want ErrConflict", err)
	}

	workspace, err := repository.GetWorkspace(ctx, tenantContext, developmentID)
	if err != nil {
		t.Fatalf("GetWorkspace() returned error: %v", err)
	}
	if workspace.Data.Summary.Inventory.Total != 5 || workspace.Data.Summary.Inventory.Negotiation != 1 {
		t.Fatalf("workspace inventory = %#v", workspace.Data.Summary.Inventory)
	}
	if workspace.Data.Summary.PriceRange.Minimum == nil || *workspace.Data.Summary.PriceRange.Minimum != 750000 {
		t.Fatalf("workspace price range = %#v", workspace.Data.Summary.PriceRange)
	}
	if workspace.Data.Summary.PriceRange.Maximum == nil || *workspace.Data.Summary.PriceRange.Maximum != 800000 {
		t.Fatalf("workspace maximum price = %#v", workspace.Data.Summary.PriceRange)
	}
	if len(workspace.Data.Units) != 0 {
		t.Fatalf("workspace must not embed the unbounded inventory, got %d units", len(workspace.Data.Units))
	}
	if len(workspace.Data.Buildings) != 1 || workspace.Data.Buildings[0].UnitCount != 5 {
		t.Fatalf("workspace building unit count = %#v", workspace.Data.Buildings)
	}
	if len(workspace.Data.FloorPlans) != 1 || workspace.Data.FloorPlans[0].UnitCount != 5 {
		t.Fatalf("workspace floor plan unit count = %#v", workspace.Data.FloorPlans)
	}

	unitPage, err := repository.ListUnits(ctx, tenantContext, developmentID, UnitListFilter{
		BuildingID: building.ID,
		Limit:      2,
	})
	if err != nil {
		t.Fatalf("ListUnits() returned error: %v", err)
	}
	if unitPage.Meta.Total != 5 || len(unitPage.Data) != 2 {
		t.Fatalf("paginated unit result = %#v", unitPage)
	}
	for _, listedUnit := range unitPage.Data {
		if listedUnit.BuildingName == nil || *listedUnit.BuildingName != building.Name {
			t.Fatalf("listed unit = %#v, want building name", listedUnit)
		}
		if listedUnit.ID == deliberatelyHidden.ID && listedUnit.Published {
			t.Fatalf("deliberately hidden listed unit was republished: %#v", listedUnit)
		}
	}
	negotiationPage, err := repository.ListUnits(ctx, tenantContext, developmentID, UnitListFilter{
		Status: "negotiation",
		Limit:  50,
	})
	if err != nil {
		t.Fatalf("filtered ListUnits() returned error: %v", err)
	}
	if negotiationPage.Meta.Total != 1 || len(negotiationPage.Data) != 1 || negotiationPage.Data[0].ID != updated.ID {
		t.Fatalf("filtered unit result = %#v", negotiationPage)
	}

	list, err := repository.List(ctx, tenantContext, ListFilter{Search: code, Limit: 10})
	if err != nil {
		t.Fatalf("List() returned error: %v", err)
	}
	if list.Meta.Total != 1 || len(list.Data) != 1 || list.Data[0].ID != developmentID {
		t.Fatalf("catalog result = %#v", list)
	}

	paddingRegression, err := repository.BulkCreateUnits(ctx, tenantContext, developmentID, BulkCreateUnitsInput{
		BuildingID: building.ID, FloorPlanID: &floorPlan.ID, Prefix: "PAD",
		StartNumber: 1000, Count: 1, StartFloor: 4, UnitsPerFloor: 1,
		NumberPadding: 3, InitialListPrice: floatPointer(900000),
	})
	if err != nil {
		t.Fatalf("padding regression BulkCreateUnits() returned error: %v", err)
	}
	if len(paddingRegression.Units) != 1 || paddingRegression.Units[0].UnitNumber != "PAD1000" {
		t.Fatalf("padding regression unit = %#v, want unit number PAD1000", paddingRegression.Units)
	}

	loadUnit := func(unitID string) Unit {
		t.Helper()
		page, loadErr := repository.ListUnits(ctx, tenantContext, developmentID, UnitListFilter{Limit: 200})
		if loadErr != nil {
			t.Fatalf("load unit %s: %v", unitID, loadErr)
		}
		for _, candidate := range page.Data {
			if candidate.ID == unitID {
				return candidate
			}
		}
		t.Fatalf("unit %s was not listed", unitID)
		return Unit{}
	}

	// A draft belongs to the whole development even when a legacy or imported
	// unit is missing its row. Optimistic concurrency must therefore check the
	// latest draft table, not fall back to the active table for that unit.
	if paddingRegression.PriceTable == nil {
		t.Fatal("padding regression must reuse or create the current draft table")
	}
	if _, err := postgres.Pool().Exec(ctx, `
		delete from public.property_development_unit_prices
		where organization_id = $1::uuid
		  and development_id = $2::uuid
		  and price_table_id = $3::uuid
		  and unit_id = $4::uuid
	`, organizationID, developmentID, paddingRegression.PriceTable.ID, deliberatelyHidden.ID); err != nil {
		t.Fatalf("remove imported unit draft price fixture: %v", err)
	}
	missingDraftPriceUnit := loadUnit(deliberatelyHidden.ID)
	if missingDraftPriceUnit.DraftPriceTableID != nil {
		t.Fatalf("missing draft price fixture still has a draft projection: %#v", missingDraftPriceUnit)
	}
	missingDraftPriceResult, err := repository.UpdateUnitPrice(ctx, tenantContext, developmentID, deliberatelyHidden.ID, UpdateUnitPriceInput{
		ListPrice:                   755000,
		ExpectedPriceTableID:        &paddingRegression.PriceTable.ID,
		ExpectedPriceTableUpdatedAt: &paddingRegression.PriceTable.UpdatedAt,
	})
	if err != nil {
		t.Fatalf("UpdateUnitPrice() with a development draft but missing unit row returned error: %v", err)
	}
	if missingDraftPriceResult.Unit.DraftPriceTableID == nil ||
		*missingDraftPriceResult.Unit.DraftPriceTableID != paddingRegression.PriceTable.ID ||
		missingDraftPriceResult.Unit.DraftListPrice == nil ||
		*missingDraftPriceResult.Unit.DraftListPrice != 755000 {
		t.Fatalf("missing draft price repair result = %#v", missingDraftPriceResult)
	}

	pricedUnit := loadUnit(updated.ID)
	if pricedUnit.DraftPriceTableID == nil || pricedUnit.DraftPriceTableUpdatedAt == nil {
		t.Fatalf("latest draft projection is missing: %#v", pricedUnit)
	}
	minimumPrice := 880000.0
	priceResult, err := repository.UpdateUnitPrice(ctx, tenantContext, developmentID, pricedUnit.ID, UpdateUnitPriceInput{
		ListPrice:                   910000,
		MinimumPrice:                &minimumPrice,
		PaymentTerms:                map[string]any{"down_payment_percent": 20},
		ExpectedPriceTableID:        pricedUnit.DraftPriceTableID,
		ExpectedPriceTableUpdatedAt: pricedUnit.DraftPriceTableUpdatedAt,
	})
	if err != nil {
		t.Fatalf("UpdateUnitPrice() returned error: %v", err)
	}
	if priceResult.PriceTable.Status != "draft" || priceResult.Unit.DraftListPrice == nil || *priceResult.Unit.DraftListPrice != 910000 {
		t.Fatalf("price update result = %#v", priceResult)
	}
	if priceResult.Unit.DraftPricePerSqm == nil || *priceResult.Unit.DraftPricePerSqm <= 0 {
		t.Fatalf("server-derived price_per_sqm is missing: %#v", priceResult.Unit)
	}
	viewerContext := tenant.Context{
		OrganizationID: organizationID,
		UserID:         "ffffffff-ffff-4fff-8fff-ffffffffffff",
		Permissions:    []string{permissions.PropertyView, permissions.LeadViewOwn},
	}
	viewerUnits, err := repository.ListUnits(ctx, viewerContext, developmentID, UnitListFilter{Limit: 200})
	if err != nil {
		t.Fatalf("viewer ListUnits() returned error: %v", err)
	}
	for _, viewerUnit := range viewerUnits.Data {
		if viewerUnit.MinimumPrice != nil || viewerUnit.DraftListPrice != nil ||
			viewerUnit.DraftMinimumPrice != nil || viewerUnit.DraftPriceTableID != nil {
			t.Fatalf("viewer unit leaked commercial internals: %#v", viewerUnit)
		}
	}
	viewerWorkspace, err := repository.GetWorkspace(ctx, viewerContext, developmentID)
	if err != nil {
		t.Fatalf("viewer GetWorkspace() returned error: %v", err)
	}
	if len(viewerWorkspace.Data.PriceTables) != 1 || viewerWorkspace.Data.PriceTables[0].Status != "active" {
		t.Fatalf("viewer price tables = %#v, want only active", viewerWorkspace.Data.PriceTables)
	}
	for _, event := range viewerWorkspace.Data.RecentUnitEvents {
		if event.EventType == "price_changed" && (event.BeforeData != nil || event.AfterData != nil || len(event.Metadata) != 0) {
			t.Fatalf("viewer price event leaked commercial payload: %#v", event)
		}
	}
	_, err = repository.UpdateUnitPrice(ctx, tenantContext, developmentID, pricedUnit.ID, UpdateUnitPriceInput{
		ListPrice:                   920000,
		ExpectedPriceTableID:        pricedUnit.DraftPriceTableID,
		ExpectedPriceTableUpdatedAt: pricedUnit.DraftPriceTableUpdatedAt,
	})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("stale unit price update error = %v, want ErrConflict", err)
	}

	var firstKey, secondKey, expirationKey string
	if err := postgres.Pool().QueryRow(ctx, `
		select gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text
	`).Scan(&firstKey, &secondKey, &expirationKey); err != nil {
		t.Fatalf("generate idempotency keys: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.leads (organization_id, assigned_user_id, name, created_by)
		values ($1::uuid, $2::uuid, 'Lead reservado', $2::uuid)
		returning id::text
	`, organizationID, userID).Scan(&leadID); err != nil {
		t.Fatalf("create reservation lead fixture: %v", err)
	}
	reservationInput := CreateReservationInput{
		LeadID:                &leadID,
		ExpiresAt:             time.Now().UTC().Add(48 * time.Hour).Format(time.RFC3339Nano),
		Notes:                 stringPointer("visita confirmada"),
		ExpectedUnitUpdatedAt: priceResult.Unit.UpdatedAt,
	}
	forgedManagerContext := viewerContext
	forgedManagerContext.Permissions = append(forgedManagerContext.Permissions, permissions.PropertyManage)
	if _, err := repository.CreateReservation(
		ctx,
		forgedManagerContext,
		developmentID,
		pricedUnit.ID,
		"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
		reservationInput,
	); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("foreign lead reservation error = %v, want ErrInvalidInput", err)
	}
	firstReservation, err := repository.CreateReservation(
		ctx, tenantContext, developmentID, pricedUnit.ID, firstKey, reservationInput,
	)
	if err != nil {
		t.Fatalf("CreateReservation() returned error: %v", err)
	}
	if !firstReservation.Created || firstReservation.Reservation.Status != "active" || firstReservation.Reservation.ListPriceSnapshot == nil || *firstReservation.Reservation.ListPriceSnapshot != 750000 {
		t.Fatalf("created reservation = %#v", firstReservation)
	}
	if _, err := repository.CreateReservation(
		ctx,
		forgedManagerContext,
		developmentID,
		pricedUnit.ID,
		firstKey,
		reservationInput,
	); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("foreign lead idempotent replay error = %v, want ErrInvalidInput", err)
	}
	replayedReservation, err := repository.CreateReservation(
		ctx, tenantContext, developmentID, pricedUnit.ID, firstKey, reservationInput,
	)
	if err != nil {
		t.Fatalf("idempotent CreateReservation() returned error: %v", err)
	}
	if replayedReservation.Created || replayedReservation.Reservation.ID != firstReservation.Reservation.ID {
		t.Fatalf("idempotent reservation replay = %#v", replayedReservation)
	}
	divergentInput := reservationInput
	divergentInput.Notes = stringPointer("payload divergente")
	if _, err := repository.CreateReservation(ctx, tenantContext, developmentID, pricedUnit.ID, firstKey, divergentInput); !errors.Is(err, ErrConflict) {
		t.Fatalf("divergent idempotency reuse error = %v, want ErrConflict", err)
	}

	activeReservations, err := repository.ListReservations(ctx, tenantContext, developmentID, ReservationListFilter{
		Status: "active", UnitID: pricedUnit.ID, Limit: 50,
	})
	if err != nil {
		t.Fatalf("ListReservations() returned error: %v", err)
	}
	if activeReservations.Meta.Total != 1 || activeReservations.Meta.Active != 1 || len(activeReservations.Data) != 1 {
		t.Fatalf("active reservation page = %#v", activeReservations)
	}
	listedReservation := activeReservations.Data[0]
	if listedReservation.UnitNumber == nil || listedReservation.UnitCode == nil || listedReservation.BuildingName == nil {
		t.Fatalf("reservation safe projection lacks inventory labels: %#v", listedReservation)
	}
	if listedReservation.Notes != nil || listedReservation.IdempotencyKey != nil {
		t.Fatalf("reservation safe projection leaked private fields: %#v", listedReservation)
	}
	if _, err := repository.CancelReservation(ctx, forgedManagerContext, developmentID, listedReservation.ID, CancelReservationInput{
		ExpectedUpdatedAt: listedReservation.UpdatedAt, CancellationReason: "tentativa fora do escopo",
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign lead cancellation error = %v, want ErrNotFound", err)
	}
	if _, err := repository.ConvertReservation(ctx, forgedManagerContext, developmentID, listedReservation.ID, ReservationTransitionInput{
		ExpectedUpdatedAt: listedReservation.UpdatedAt,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign lead conversion error = %v, want ErrNotFound", err)
	}
	if _, err := repository.ExtendReservation(ctx, forgedManagerContext, developmentID, listedReservation.ID, ExtendReservationInput{
		ExpectedUpdatedAt: listedReservation.UpdatedAt,
		ExpiresAt:         time.Now().UTC().Add(72 * time.Hour).Format(time.RFC3339Nano),
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign lead extension error = %v, want ErrNotFound", err)
	}
	foreignLeadReservations, err := repository.ListReservations(ctx, viewerContext, developmentID, ReservationListFilter{
		Status: "active", UnitID: pricedUnit.ID, Limit: 50,
	})
	if err != nil {
		t.Fatalf("foreign viewer ListReservations() returned error: %v", err)
	}
	if len(foreignLeadReservations.Data) != 1 || foreignLeadReservations.Data[0].LeadID != nil || foreignLeadReservations.Data[0].LeadName != nil {
		t.Fatalf("foreign viewer reservation leaked lead identity: %#v", foreignLeadReservations)
	}
	if foreignLeadReservations.Data[0].CanOperate == nil || *foreignLeadReservations.Data[0].CanOperate {
		t.Fatalf("foreign viewer received an unsafe operation capability: %#v", foreignLeadReservations)
	}
	foreignManagerReservations, err := repository.ListReservations(ctx, forgedManagerContext, developmentID, ReservationListFilter{
		Status: "active", UnitID: pricedUnit.ID, Limit: 50,
	})
	if err != nil {
		t.Fatalf("foreign manager ListReservations() returned error: %v", err)
	}
	if len(foreignManagerReservations.Data) != 1 ||
		foreignManagerReservations.Data[0].CanOperate == nil ||
		*foreignManagerReservations.Data[0].CanOperate {
		t.Fatalf("foreign manager received an unsafe operation capability: %#v", foreignManagerReservations)
	}
	if _, err := repository.ListReservations(ctx, viewerContext, developmentID, ReservationListFilter{
		LeadID: leadID, Limit: 50,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign lead filter error = %v, want ErrNotFound", err)
	}

	extended, err := repository.ExtendReservation(ctx, tenantContext, developmentID, firstReservation.Reservation.ID, ExtendReservationInput{
		ExpectedUpdatedAt: firstReservation.Reservation.UpdatedAt,
		ExpiresAt:         time.Now().UTC().Add(72 * time.Hour).Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatalf("ExtendReservation() returned error: %v", err)
	}
	var extensionEvents int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer
		from public.property_development_unit_events
		where organization_id = $1::uuid
		  and development_id = $2::uuid
		  and event_type = 'reservation_extended'
		  and metadata ->> 'reservation_id' = $3
	`, organizationID, developmentID, extended.ID).Scan(&extensionEvents); err != nil {
		t.Fatalf("reservation extension audit lookup: %v", err)
	}
	if extensionEvents != 1 {
		t.Fatalf("reservation extension event count = %d, want 1", extensionEvents)
	}
	if _, err := repository.CancelReservation(ctx, tenantContext, developmentID, extended.ID, CancelReservationInput{
		ExpectedUpdatedAt:  firstReservation.Reservation.UpdatedAt,
		CancellationReason: "precondition antiga",
	}); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale cancellation error = %v, want ErrConflict", err)
	}
	cancelled, err := repository.CancelReservation(ctx, tenantContext, developmentID, extended.ID, CancelReservationInput{
		ExpectedUpdatedAt:  extended.UpdatedAt,
		CancellationReason: "cliente desistiu",
	})
	if err != nil {
		t.Fatalf("CancelReservation() returned error: %v", err)
	}
	if cancelled.Status != "cancelled" || cancelled.CancellationReason == nil || *cancelled.CancellationReason != "cliente desistiu" {
		t.Fatalf("cancelled reservation = %#v", cancelled)
	}
	foreignCancelledReservations, err := repository.ListReservations(ctx, viewerContext, developmentID, ReservationListFilter{
		Status: "cancelled", UnitID: pricedUnit.ID, Limit: 50,
	})
	if err != nil {
		t.Fatalf("foreign viewer cancelled reservations returned error: %v", err)
	}
	if len(foreignCancelledReservations.Data) != 1 ||
		foreignCancelledReservations.Data[0].LeadID != nil ||
		foreignCancelledReservations.Data[0].CancellationReason != nil {
		t.Fatalf("foreign viewer cancelled reservation leaked lead context: %#v", foreignCancelledReservations)
	}
	viewerWorkspaceAfterCancellation, err := repository.GetWorkspace(ctx, viewerContext, developmentID)
	if err != nil {
		t.Fatalf("viewer workspace after cancellation returned error: %v", err)
	}
	for _, event := range viewerWorkspaceAfterCancellation.Data.RecentUnitEvents {
		if event.EventType == "reservation_cancelled" {
			if _, exists := event.Metadata["reason"]; exists {
				t.Fatalf("viewer cancellation event leaked free-form reason: %#v", event)
			}
		}
	}

	releasedUnit := loadUnit(pricedUnit.ID)
	convertedReservation, err := repository.CreateReservation(ctx, tenantContext, developmentID, releasedUnit.ID, secondKey, CreateReservationInput{
		ExpiresAt:             time.Now().UTC().Add(48 * time.Hour).Format(time.RFC3339Nano),
		ExpectedUnitUpdatedAt: releasedUnit.UpdatedAt,
	})
	if err != nil {
		t.Fatalf("second CreateReservation() returned error: %v", err)
	}
	converted, err := repository.ConvertReservation(ctx, tenantContext, developmentID, convertedReservation.Reservation.ID, ReservationTransitionInput{
		ExpectedUpdatedAt: convertedReservation.Reservation.UpdatedAt,
	})
	if err != nil {
		t.Fatalf("ConvertReservation() returned error: %v", err)
	}
	if converted.Status != "converted" || loadUnit(releasedUnit.ID).Status != "sold" {
		t.Fatalf("converted reservation/unit = %#v / %#v", converted, loadUnit(releasedUnit.ID))
	}

	// Internal reservations deliberately do not depend on public portal
	// publication. This unit was hidden earlier but remains commercially priced.
	expirationUnit := loadUnit(deliberatelyHidden.ID)
	if expirationUnit.Published {
		t.Fatal("expiration fixture must remain deliberately unpublished")
	}
	expiringReservation, err := repository.CreateReservation(ctx, tenantContext, developmentID, expirationUnit.ID, expirationKey, CreateReservationInput{
		ExpiresAt:             time.Now().UTC().Add(250 * time.Millisecond).Format(time.RFC3339Nano),
		ExpectedUnitUpdatedAt: expirationUnit.UpdatedAt,
	})
	if err != nil {
		t.Fatalf("unpublished CreateReservation() returned error: %v", err)
	}

	blocker, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatalf("begin expiration blocker: %v", err)
	}
	blockedRows, err := blocker.Query(ctx, `
		select id
		from public.property_development_reservations
		where status = 'active'
		  and id <> $1::uuid
		for update
	`, expiringReservation.Reservation.ID)
	if err != nil {
		_ = blocker.Rollback(ctx)
		t.Fatalf("lock unrelated elapsed reservations: %v", err)
	}
	blockedRows.Close()
	if _, err := postgres.Pool().Exec(ctx, `select pg_sleep(0.3)`); err != nil {
		_ = blocker.Rollback(ctx)
		t.Fatalf("wait for worker expiration fixture: %v", err)
	}
	expiredCount, err := repository.ExpireDueReservations(ctx, 1)
	if rollbackErr := blocker.Rollback(ctx); rollbackErr != nil {
		t.Fatalf("rollback expiration blocker: %v", rollbackErr)
	}
	if err != nil {
		t.Fatalf("ExpireDueReservations() returned error: %v", err)
	}
	if expiredCount != 1 {
		t.Fatalf("expired count = %d, want 1", expiredCount)
	}
	expiredReservations, err := repository.ListReservations(ctx, tenantContext, developmentID, ReservationListFilter{
		Status: "expired", UnitID: expirationUnit.ID, Limit: 50,
	})
	if err != nil {
		t.Fatalf("list expired reservations: %v", err)
	}
	if expiredReservations.Meta.Total != 1 || len(expiredReservations.Data) != 1 || expiredReservations.Data[0].CancellationReason == nil || *expiredReservations.Data[0].CancellationReason != "ttl_elapsed" {
		t.Fatalf("expired reservation page = %#v", expiredReservations)
	}
	if loadUnit(expirationUnit.ID).Status != "available" {
		t.Fatal("expiration worker must release the reserved unit")
	}
	var expirationEvents int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer
		from public.property_development_unit_events
		where organization_id = $1::uuid
		  and development_id = $2::uuid
		  and unit_id = $3::uuid
		  and event_type = 'reservation_expired'
		  and metadata ->> 'reservation_id' = $4
		  and created_by is null
	`, organizationID, developmentID, expirationUnit.ID, expiringReservation.Reservation.ID).Scan(&expirationEvents); err != nil {
		t.Fatalf("reservation expiration audit lookup: %v", err)
	}
	if expirationEvents != 1 {
		t.Fatalf("reservation expiration event count = %d, want 1", expirationEvents)
	}
}

func assertLoopbackDatabase(t *testing.T, databaseURL string) {
	t.Helper()
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse DATABASE_URL: %v", err)
	}
	host := parsed.Hostname()
	if host != "localhost" && net.ParseIP(host) == nil {
		t.Fatalf("DATABASE_URL must use a loopback host, got %q", host)
	}
	if ip := net.ParseIP(host); ip != nil && !ip.IsLoopback() {
		t.Fatalf("DATABASE_URL must use a loopback host, got %q", host)
	}
}

func stringPointer(value string) *string  { return &value }
func intPointer(value int) *int           { return &value }
func floatPointer(value float64) *float64 { return &value }
