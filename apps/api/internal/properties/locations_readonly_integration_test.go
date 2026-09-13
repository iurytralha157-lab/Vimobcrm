package properties

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// TestListLocationsIncludesPropertyBackedCatalogValues is opt-in because it
// exercises the real-data tunnel. The db package enforces a read-only session
// before the test proceeds, so this test never writes catalog or property data.
func TestListLocationsIncludesPropertyBackedCatalogValues(t *testing.T) {
	databaseURL := os.Getenv("VIMOB_PROPERTIES_READONLY_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("VIMOB_PROPERTIES_READONLY_DATABASE_URL is not configured")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      1,
		ForceReadOnly: true,
		HealthTimeout: 10 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect read-only database: %v", err)
	}
	defer postgres.Close()

	var readOnly string
	if err := postgres.Pool().QueryRow(ctx, "show default_transaction_read_only").Scan(&readOnly); err != nil {
		t.Fatalf("check read-only guard: %v", err)
	}
	if readOnly != "on" {
		t.Fatal("refusing to run location audit without a read-only database session")
	}

	var organizationID string
	err = postgres.Pool().QueryRow(ctx, `
		select p.organization_id::text
		from public.properties p
		where nullif(btrim(p.cidade), '') is not null
		  and not exists (
				select 1
				from public.property_cities c
				where c.organization_id = p.organization_id
				  and coalesce(c.is_active, true) = true
				  and lower(btrim(c.name)) = lower(btrim(p.cidade))
			)
		limit 1
	`).Scan(&organizationID)
	if err != nil {
		t.Fatalf("find organization needing read-only city fallback: %v", err)
	}

	repo := Repository{db: postgres}
	tenantContext := tenant.Context{OrganizationID: organizationID}
	cities, err := repo.ListCities(ctx, tenantContext)
	if err != nil {
		t.Fatalf("list cities: %v", err)
	}
	neighborhoods, err := repo.ListNeighborhoods(ctx, tenantContext, "")
	if err != nil {
		t.Fatalf("list neighborhoods: %v", err)
	}

	legacyCities := countLocationSource(cities, "property")
	legacyNeighborhoods := countLocationSource(neighborhoods, "property")
	if legacyCities == 0 {
		t.Fatal("expected at least one city recovered from the property portfolio")
	}
	if legacyNeighborhoods == 0 {
		t.Fatal("expected at least one neighborhood recovered from the property portfolio")
	}
	t.Logf("read-only location coverage: recovered_cities=%d recovered_neighborhoods=%d", legacyCities, legacyNeighborhoods)
}

func countLocationSource(locations []Location, source string) int {
	count := 0
	for _, location := range locations {
		if locationSource, _ := location["catalog_source"].(string); locationSource == source {
			count++
		}
	}
	return count
}
