package properties

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestLocationCatalogsRespectPropertyVisibilityAgainstDatabase(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DB_TESTS") != "1" {
		t.Skip("set VIMOB_RUN_DB_TESTS=1 to run database integration tests")
	}
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		t.Fatal("DATABASE_URL is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL: databaseURL, MaxConns: 3, MinConns: 0, HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewPostgres() returned error: %v", err)
	}
	t.Cleanup(postgres.Close)

	rows, err := postgres.Pool().Query(ctx, `
		select member.organization_id::text, member.user_id::text
		from public.organization_members member
		join public.users app_user on app_user.id = member.user_id
		where coalesce(member.is_active, true)
		  and coalesce(app_user.is_active, true)
		order by member.organization_id, member.created_at, member.user_id
	`)
	if err != nil {
		t.Fatalf("organization member lookup returned error: %v", err)
	}
	defer rows.Close()
	organizationID := ""
	userIDs := []string{}
	for rows.Next() {
		var candidateOrganizationID, userID string
		if err := rows.Scan(&candidateOrganizationID, &userID); err != nil {
			t.Fatalf("organization member scan returned error: %v", err)
		}
		if organizationID == "" {
			organizationID = candidateOrganizationID
		}
		if candidateOrganizationID == organizationID && len(userIDs) < 2 {
			userIDs = append(userIDs, userID)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("organization member iteration returned error: %v", err)
	}
	if len(userIDs) < 2 {
		t.Skip("an organization with two active members is required")
	}

	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	type locationFixture struct {
		cityID         string
		neighborhoodID string
		condominiumID  string
		propertyID     string
		cityName       string
		neighborhood   string
		condominium    string
		notes          string
	}
	createFixture := func(ownerID string, label string) locationFixture {
		t.Helper()
		fixture := locationFixture{
			cityName:     "Cidade " + label + " " + suffix,
			neighborhood: "Bairro " + label + " " + suffix,
			condominium:  "Condominio " + label + " " + suffix,
			notes:        "segredo-" + label + "-" + suffix,
		}
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.property_cities (organization_id, name, uf)
			values ($1::uuid, $2, 'SP')
			returning id::text
		`, organizationID, fixture.cityName).Scan(&fixture.cityID); err != nil {
			t.Fatalf("create %s city: %v", label, err)
		}
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.property_neighborhoods (organization_id, city_id, name)
			values ($1::uuid, $2::uuid, $3)
			returning id::text
		`, organizationID, fixture.cityID, fixture.neighborhood).Scan(&fixture.neighborhoodID); err != nil {
			t.Fatalf("create %s neighborhood: %v", label, err)
		}
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.property_condominiums (
				organization_id, city_id, neighborhood_id, name,
				address, cep, number, complement, default_condominium_fee,
				has_concierge, concierge_type, notes, latitude, longitude
			) values (
				$1::uuid, $2::uuid, $3::uuid, $4,
				'Rua privada', '01001000', '99', 'Bloco secreto', 987.65,
				true, '24h', $5, -23.5505, -46.6333
			)
			returning id::text
		`, organizationID, fixture.cityID, fixture.neighborhoodID, fixture.condominium, fixture.notes).Scan(&fixture.condominiumID); err != nil {
			t.Fatalf("create %s condominium: %v", label, err)
		}
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.properties (
				organization_id, code, title, tipo, tipo_de_imovel, status,
				created_by, responsible_user_id,
				city_id, neighborhood_id, condominium_id, cidade, bairro, uf
			) values (
				$1::uuid, $2, $3, 'Apartamento', 'Apartamento', 'active',
				$4::uuid, $4::uuid,
				$5::uuid, $6::uuid, $7::uuid, $8, $9, 'SP'
			)
			returning id::text
		`, organizationID, "LOC-"+label+"-"+suffix, "Imovel "+label, ownerID,
			fixture.cityID, fixture.neighborhoodID, fixture.condominiumID,
			fixture.cityName, fixture.neighborhood,
		).Scan(&fixture.propertyID); err != nil {
			t.Fatalf("create %s property: %v", label, err)
		}
		return fixture
	}

	own := createFixture(userIDs[0], "proprio")
	hidden := createFixture(userIDs[1], "oculto")
	t.Cleanup(func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cleanupCancel()
		for _, fixture := range []locationFixture{own, hidden} {
			_, _ = postgres.Pool().Exec(cleanupContext, `delete from public.properties where organization_id = $1::uuid and id = $2::uuid`, organizationID, fixture.propertyID)
			_, _ = postgres.Pool().Exec(cleanupContext, `delete from public.property_condominiums where organization_id = $1::uuid and id = $2::uuid`, organizationID, fixture.condominiumID)
			_, _ = postgres.Pool().Exec(cleanupContext, `delete from public.property_neighborhoods where organization_id = $1::uuid and id = $2::uuid`, organizationID, fixture.neighborhoodID)
			_, _ = postgres.Pool().Exec(cleanupContext, `delete from public.property_cities where organization_id = $1::uuid and id = $2::uuid`, organizationID, fixture.cityID)
		}
	})

	repo := NewRepository(postgres, StorageConfig{})
	viewer := tenant.Context{
		OrganizationID: organizationID,
		UserID:         userIDs[0],
		MemberRole:     "user",
		Permissions:    []string{permissions.PropertyView},
	}
	manager := tenant.Context{OrganizationID: organizationID, UserID: userIDs[0], MemberRole: "admin"}
	unscopedRoleManager := viewer
	unscopedRoleManager.MemberRole = "manager"

	var hiddenUpdatedAt time.Time
	if err := postgres.Pool().QueryRow(ctx, `
		select updated_at
		from public.properties
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, hidden.propertyID).Scan(&hiddenUpdatedAt); err != nil {
		t.Fatalf("read hidden property revision: %v", err)
	}
	hiddenUpdate, err := (propertyRequest{
		"title":               "Escopo de edicao violado",
		"expected_updated_at": hiddenUpdatedAt.Format(time.RFC3339Nano),
	}).ValidateUpdate()
	if err != nil {
		t.Fatalf("validate hidden property update: %v", err)
	}
	if _, err := repo.Update(ctx, unscopedRoleManager, hidden.propertyID, hiddenUpdate); !errors.Is(err, ErrPropertyNotFound) {
		t.Fatalf("out-of-scope manager update error = %v, want ErrPropertyNotFound", err)
	}
	var hiddenTitle string
	if err := postgres.Pool().QueryRow(ctx, `
		select title
		from public.properties
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, hidden.propertyID).Scan(&hiddenTitle); err != nil {
		t.Fatalf("read hidden property after denied update: %v", err)
	}
	if hiddenTitle != "Imovel oculto" {
		t.Fatalf("denied update changed hidden property title to %q", hiddenTitle)
	}

	assertScopedNames := func(label string, items []Location, ownName string, hiddenName string) {
		t.Helper()
		if !locationListContainsName(items, ownName) {
			t.Fatalf("%s omitted visible value %q: %#v", label, ownName, items)
		}
		if locationListContainsName(items, hiddenName) {
			t.Fatalf("%s leaked hidden value %q: %#v", label, hiddenName, items)
		}
	}

	cities, err := repo.ListCities(ctx, viewer)
	if err != nil {
		t.Fatalf("viewer ListCities: %v", err)
	}
	assertScopedNames("cities", cities, own.cityName, hidden.cityName)

	neighborhoods, err := repo.ListNeighborhoods(ctx, viewer, "")
	if err != nil {
		t.Fatalf("viewer ListNeighborhoods: %v", err)
	}
	assertScopedNames("neighborhoods", neighborhoods, own.neighborhood, hidden.neighborhood)

	condominiums, err := repo.ListCondominiums(ctx, viewer, "")
	if err != nil {
		t.Fatalf("viewer ListCondominiums: %v", err)
	}
	assertScopedNames("condominiums", condominiums, own.condominium, hidden.condominium)
	visibleCondominium, err := findLocationByName(condominiums, own.condominium)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{
		"address", "photo_url", "cep", "number", "complement",
		"default_condominium_fee", "has_concierge", "concierge_type",
		"notes", "latitude", "longitude",
	} {
		if visibleCondominium[field] != nil {
			t.Fatalf("restricted condominium leaked %s: %#v", field, visibleCondominium[field])
		}
	}

	managerCondominiums, err := repo.ListCondominiums(ctx, manager, "")
	if err != nil {
		t.Fatalf("manager ListCondominiums: %v", err)
	}
	if !locationListContainsName(managerCondominiums, own.condominium) || !locationListContainsName(managerCondominiums, hidden.condominium) {
		t.Fatalf("manager catalog lost organization values: %#v", managerCondominiums)
	}
	hiddenCondominium, err := findLocationByName(managerCondominiums, hidden.condominium)
	if err != nil {
		t.Fatal(err)
	}
	if hiddenCondominium["notes"] != hidden.notes {
		t.Fatalf("manager condominium notes = %#v, want %q", hiddenCondominium["notes"], hidden.notes)
	}
}

func locationListContainsName(items []Location, name string) bool {
	_, err := findLocationByName(items, name)
	return err == nil
}

func findLocationByName(items []Location, name string) (Location, error) {
	for _, item := range items {
		if itemName, _ := item["name"].(string); itemName == name {
			return item, nil
		}
	}
	return nil, fmt.Errorf("location %q not found", name)
}
