package developments

import (
	"context"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type reservationRegressionFixture struct {
	database      *dbpkg.Postgres
	repo          Repository
	actor         tenant.Context
	developmentID string
	leadID        string
	units         []Unit
	priceTable    *PriceTable
}

// Opt-in only; rejects production, other databases and remote hosts before Dial.
func newReservationRegressionFixture(t *testing.T, activate bool) *reservationRegressionFixture {
	t.Helper()
	if os.Getenv("VIMOB_PROPERTY_HARDENING_WRITE_TEST") != "LOCAL_WRITE_TEST" {
		t.Skip("requires explicit isolated synthetic property PostgreSQL fixture; not PG proof when skipped")
	}
	connection := os.Getenv("VIMOB_PROPERTY_HARDENING_TEST_DATABASE_URL")
	parsed, err := url.Parse(connection)
	if err != nil || parsed.Path != "/vimob_properties_fixes_20261012_fb58fe98" || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") {
		t.Fatal("regressions refuse any database except the named loopback property fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: connection, MaxConns: 4, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(database.Close)
	fixture := &reservationRegressionFixture{database: database, repo: NewRepository(database), actor: tenant.Context{MemberRole: "admin"}}
	if err := database.Pool().QueryRow(ctx, `select member.organization_id::text, member.user_id::text
		from public.organization_members member join public.users app_user on app_user.id = member.user_id
		where member.is_active and member.deleted_at is null and app_user.is_active limit 1`).Scan(&fixture.actor.OrganizationID, &fixture.actor.UserID); err != nil {
		t.Fatal(err)
	}
	// Cleanup is scoped to UUIDs created below. Activated prices are immutable,
	// so only this named isolated superuser fixture suppresses its local triggers.
	t.Cleanup(func() {
		if fixture.developmentID == "" {
			return
		}
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cleanupCancel()
		tx, err := database.Pool().Begin(cleanupCtx)
		if err != nil {
			t.Error(err)
			return
		}
		defer tx.Rollback(cleanupCtx)
		if _, err := tx.Exec(cleanupCtx, "set local session_replication_role = replica"); err != nil {
			t.Error(err)
			return
		}
		for _, table := range []string{"property_development_unit_events", "property_development_reservations", "property_development_unit_prices", "property_development_units", "property_development_price_tables", "property_development_floor_plans", "property_development_buildings", "property_development_phases"} {
			if _, err := tx.Exec(cleanupCtx, "delete from public."+table+" where organization_id = $1::uuid and development_id = $2::uuid", fixture.actor.OrganizationID, fixture.developmentID); err != nil {
				t.Error(err)
				return
			}
		}
		if _, err := tx.Exec(cleanupCtx, "delete from public.property_developments where organization_id = $1::uuid and id = $2::uuid", fixture.actor.OrganizationID, fixture.developmentID); err != nil {
			t.Error(err)
			return
		}
		if fixture.leadID != "" {
			if _, err := tx.Exec(cleanupCtx, "delete from public.leads where organization_id = $1::uuid and id = $2::uuid", fixture.actor.OrganizationID, fixture.leadID); err != nil {
				t.Error(err)
				return
			}
		}
		if err := tx.Commit(cleanupCtx); err != nil {
			t.Error(err)
		}
	})
	created, err := fixture.repo.Create(ctx, fixture.actor, CreateDevelopmentInput{
		Code: "LOCK-" + time.Now().UTC().Format("150405.000000000"), Name: "Estoque sintético de regressão", Status: "launched", CommercialStatus: "active",
	})
	if err != nil {
		t.Fatal(err)
	}
	fixture.developmentID = created.Data.Development.ID
	building, err := fixture.repo.CreateBuilding(ctx, fixture.actor, fixture.developmentID, CreateBuildingInput{
		PhaseID: created.Data.Phases[0].ID, Code: "T1", Name: "Torre sintética", Status: "active",
	})
	if err != nil {
		t.Fatal(err)
	}
	price := 500000.0
	bulk, err := fixture.repo.BulkCreateUnits(ctx, fixture.actor, fixture.developmentID, BulkCreateUnitsInput{
		BuildingID: building.ID, StartNumber: 1, Count: 2, UnitsPerFloor: 2, InitialListPrice: &price,
	})
	if err != nil {
		t.Fatal(err)
	}
	fixture.units, fixture.priceTable = bulk.Units, bulk.PriceTable
	if fixture.priceTable == nil {
		t.Fatal("bulk did not create its draft price table")
	}
	if activate {
		active, err := fixture.repo.ActivatePriceTable(ctx, fixture.actor, fixture.developmentID, fixture.priceTable.ID, ActivatePriceTableInput{ExpectedUpdatedAt: &fixture.priceTable.UpdatedAt})
		if err != nil {
			t.Fatal(err)
		}
		fixture.priceTable = &active
	}
	if err := database.Pool().QueryRow(ctx, `insert into public.leads (organization_id, assigned_user_id, name, created_by)
		values ($1::uuid, $2::uuid, 'Lead sintético para regressão de locks', $2::uuid) returning id::text`, fixture.actor.OrganizationID, fixture.actor.UserID).Scan(&fixture.leadID); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func (fixture *reservationRegressionFixture) createReservation(t *testing.T, ctx context.Context) Reservation {
	t.Helper()
	var key string
	if err := fixture.database.Pool().QueryRow(ctx, "select gen_random_uuid()::text").Scan(&key); err != nil {
		t.Fatal(err)
	}
	unit, err := scanJSON[Unit](fixture.database.Pool().QueryRow(ctx, `select to_jsonb(unit) from public.property_development_units unit
		where organization_id=$1::uuid and development_id=$2::uuid and id=$3::uuid`, fixture.actor.OrganizationID, fixture.developmentID, fixture.units[0].ID))
	if err != nil {
		t.Fatal(err)
	}
	created, err := fixture.repo.CreateReservation(ctx, fixture.actor, fixture.developmentID, unit.ID, key, CreateReservationInput{
		LeadID: &fixture.leadID, ExpiresAt: time.Now().UTC().Add(time.Hour).Format(time.RFC3339Nano), ExpectedUnitUpdatedAt: unit.UpdatedAt,
	})
	if err != nil {
		t.Fatal(err)
	}
	return created.Reservation
}

func waitForReservationDatabaseLock(ctx context.Context, pid uint32, database *dbpkg.Postgres) error {
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var blocked bool
		if err := database.Pool().QueryRow(ctx, "select coalesce(wait_event_type='Lock',false) from pg_stat_activity where pid=$1", pid).Scan(&blocked); err != nil {
			return err
		}
		if blocked {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline.C:
			return context.DeadlineExceeded
		case <-ticker.C:
		}
	}
}
