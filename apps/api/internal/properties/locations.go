package properties

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Location map[string]any

type CityInput struct {
	Name string
	UF   string
}

type NeighborhoodInput struct {
	Name   string
	CityID string
}

type CondominiumInput struct {
	Name           string
	CityID         string
	NeighborhoodID string
	Address        string
	Latitude       *float64
	Longitude      *float64
}

func (repo Repository) ListCities(ctx context.Context, tenantContext tenant.Context) ([]Location, error) {
	return repo.listLocationRows(ctx, `
		select to_jsonb(c)::text
		from public.property_cities c
		where c.organization_id = $1::uuid
		  and coalesce(c.is_active, true) = true
		order by lower(c.name), c.uf
	`, tenantContext.OrganizationID)
}

func (repo Repository) CreateCity(ctx context.Context, tenantContext tenant.Context, input CityInput) (Location, error) {
	if !canManageProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	input.Name = trimMax(input.Name, 120)
	input.UF = strings.ToUpper(trimMax(input.UF, 2))
	if input.Name == "" {
		return nil, fmt.Errorf("%w: city name is required", ErrInvalidInput)
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`, tenantContext.OrganizationID, "city:"+strings.ToLower(input.Name)+":"+input.UF); err != nil {
		return nil, err
	}

	city, err := scanLocation(tx.QueryRow(ctx, `
		select to_jsonb(c)::text
		from public.property_cities c
		where c.organization_id = $1::uuid
		  and lower(c.name) = lower($2)
		  and coalesce(c.uf, '') = $3
		limit 1
	`, tenantContext.OrganizationID, input.Name, input.UF))
	if err == nil {
		return city, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	city, err = scanLocation(tx.QueryRow(ctx, `
		insert into public.property_cities (organization_id, name, uf)
		values ($1::uuid, $2, $3)
		returning to_jsonb(property_cities)::text
	`, tenantContext.OrganizationID, input.Name, input.UF))
	if err != nil {
		return nil, err
	}

	return city, tx.Commit(ctx)
}

func (repo Repository) DeleteCity(ctx context.Context, tenantContext tenant.Context, id string) error {
	return repo.deleteLocation(ctx, tenantContext, "property_cities", id)
}

func (repo Repository) ListNeighborhoods(ctx context.Context, tenantContext tenant.Context, cityID string) ([]Location, error) {
	args := []any{tenantContext.OrganizationID}
	where := "n.organization_id = $1::uuid and coalesce(n.is_active, true) = true"
	if strings.TrimSpace(cityID) != "" {
		normalized, ok := normalizeUUID(cityID)
		if !ok {
			return nil, ErrInvalidInput
		}
		args = append(args, normalized)
		where += " and n.city_id = $2::uuid"
	}

	return repo.listLocationRows(ctx, `
		select (
			to_jsonb(n) ||
			jsonb_build_object('city', to_jsonb(c))
		)::text
		from public.property_neighborhoods n
		left join public.property_cities c
		  on c.id = n.city_id
		 and c.organization_id = n.organization_id
		where `+where+`
		order by lower(n.name)
	`, args...)
}

func (repo Repository) CreateNeighborhood(ctx context.Context, tenantContext tenant.Context, input NeighborhoodInput) (Location, error) {
	if !canManageProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	input.Name = trimMax(input.Name, 120)
	cityID, ok := normalizeUUID(input.CityID)
	if input.Name == "" || !ok {
		return nil, fmt.Errorf("%w: neighborhood name and city_id are required", ErrInvalidInput)
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if err := repo.ensureCityScope(ctx, tx, tenantContext.OrganizationID, cityID); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`, tenantContext.OrganizationID, "neighborhood:"+cityID+":"+strings.ToLower(input.Name)); err != nil {
		return nil, err
	}

	neighborhood, err := scanLocation(tx.QueryRow(ctx, `
		select (
			to_jsonb(n) ||
			jsonb_build_object('city', to_jsonb(c))
		)::text
		from public.property_neighborhoods n
		left join public.property_cities c on c.id = n.city_id
		where n.organization_id = $1::uuid
		  and n.city_id = $2::uuid
		  and lower(n.name) = lower($3)
		limit 1
	`, tenantContext.OrganizationID, cityID, input.Name))
	if err == nil {
		return neighborhood, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	neighborhood, err = scanLocation(tx.QueryRow(ctx, `
		with inserted as (
			insert into public.property_neighborhoods (organization_id, city_id, name)
			values ($1::uuid, $2::uuid, $3)
			returning *
		)
		select (
			to_jsonb(inserted) ||
			jsonb_build_object('city', to_jsonb(c))
		)::text
		from inserted
		left join public.property_cities c on c.id = inserted.city_id
	`, tenantContext.OrganizationID, cityID, input.Name))
	if err != nil {
		return nil, err
	}

	return neighborhood, tx.Commit(ctx)
}

func (repo Repository) DeleteNeighborhood(ctx context.Context, tenantContext tenant.Context, id string) error {
	return repo.deleteLocation(ctx, tenantContext, "property_neighborhoods", id)
}

func (repo Repository) ListCondominiums(ctx context.Context, tenantContext tenant.Context, neighborhoodID string) ([]Location, error) {
	args := []any{tenantContext.OrganizationID}
	where := "co.organization_id = $1::uuid and coalesce(co.is_active, true) = true"
	if strings.TrimSpace(neighborhoodID) != "" {
		normalized, ok := normalizeUUID(neighborhoodID)
		if !ok {
			return nil, ErrInvalidInput
		}
		args = append(args, normalized)
		where += " and co.neighborhood_id = $2::uuid"
	}

	return repo.listLocationRows(ctx, `
		select (
			to_jsonb(co) ||
			jsonb_build_object(
				'city', to_jsonb(c),
				'neighborhood', to_jsonb(n)
			)
		)::text
		from public.property_condominiums co
		left join public.property_cities c
		  on c.id = co.city_id
		 and c.organization_id = co.organization_id
		left join public.property_neighborhoods n
		  on n.id = co.neighborhood_id
		 and n.organization_id = co.organization_id
		where `+where+`
		order by lower(co.name)
	`, args...)
}

func (repo Repository) CreateCondominium(ctx context.Context, tenantContext tenant.Context, input CondominiumInput) (Location, error) {
	if !canManageProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	input.Name = trimMax(input.Name, 120)
	input.Address = trimMax(input.Address, 300)
	cityID, hasCity := normalizeOptionalUUID(input.CityID)
	neighborhoodID, hasNeighborhood := normalizeOptionalUUID(input.NeighborhoodID)
	if input.Name == "" {
		return nil, fmt.Errorf("%w: condominium name is required", ErrInvalidInput)
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if hasCity {
		if err := repo.ensureCityScope(ctx, tx, tenantContext.OrganizationID, cityID); err != nil {
			return nil, err
		}
	}
	if hasNeighborhood {
		if err := repo.ensureNeighborhoodScope(ctx, tx, tenantContext.OrganizationID, neighborhoodID); err != nil {
			return nil, err
		}
	}

	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`, tenantContext.OrganizationID, "condominium:"+strings.ToLower(input.Name)); err != nil {
		return nil, err
	}

	condominium, err := scanLocation(tx.QueryRow(ctx, `
		select (
			to_jsonb(co) ||
			jsonb_build_object(
				'city', to_jsonb(c),
				'neighborhood', to_jsonb(n)
			)
		)::text
		from public.property_condominiums co
		left join public.property_cities c on c.id = co.city_id
		left join public.property_neighborhoods n on n.id = co.neighborhood_id
		where co.organization_id = $1::uuid
		  and lower(co.name) = lower($2)
		limit 1
	`, tenantContext.OrganizationID, input.Name))
	if err == nil {
		return condominium, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	condominium, err = repo.insertCondominium(ctx, tx, tenantContext.OrganizationID, cityID, neighborhoodID, input)
	if err != nil {
		return nil, err
	}

	return condominium, tx.Commit(ctx)
}

func (repo Repository) DeleteCondominium(ctx context.Context, tenantContext tenant.Context, id string) error {
	return repo.deleteLocation(ctx, tenantContext, "property_condominiums", id)
}

func (repo Repository) insertCondominium(ctx context.Context, tx pgx.Tx, organizationID string, cityID string, neighborhoodID string, input CondominiumInput) (Location, error) {
	hasLatitude, err := repo.tableHasColumn(ctx, "property_condominiums", "latitude")
	if err != nil {
		return nil, err
	}
	hasLongitude, err := repo.tableHasColumn(ctx, "property_condominiums", "longitude")
	if err != nil {
		return nil, err
	}

	if hasLatitude && hasLongitude {
		return scanLocation(tx.QueryRow(ctx, `
			with inserted as (
				insert into public.property_condominiums (
					organization_id, city_id, neighborhood_id, name, address, latitude, longitude
				)
				values ($1::uuid, nullif($2, '')::uuid, nullif($3, '')::uuid, $4, nullif($5, ''), $6, $7)
				returning *
			)
			select (
				to_jsonb(inserted) ||
				jsonb_build_object('city', to_jsonb(c), 'neighborhood', to_jsonb(n))
			)::text
			from inserted
			left join public.property_cities c on c.id = inserted.city_id
			left join public.property_neighborhoods n on n.id = inserted.neighborhood_id
		`, organizationID, cityID, neighborhoodID, input.Name, input.Address, input.Latitude, input.Longitude))
	}

	return scanLocation(tx.QueryRow(ctx, `
		with inserted as (
			insert into public.property_condominiums (
				organization_id, city_id, neighborhood_id, name, address
			)
			values ($1::uuid, nullif($2, '')::uuid, nullif($3, '')::uuid, $4, nullif($5, ''))
			returning *
		)
		select (
			to_jsonb(inserted) ||
			jsonb_build_object(
				'city', to_jsonb(c),
				'neighborhood', to_jsonb(n),
				'latitude', null,
				'longitude', null
			)
		)::text
		from inserted
		left join public.property_cities c on c.id = inserted.city_id
		left join public.property_neighborhoods n on n.id = inserted.neighborhood_id
	`, organizationID, cityID, neighborhoodID, input.Name, input.Address))
}

func (repo Repository) listLocationRows(ctx context.Context, query string, args ...any) ([]Location, error) {
	rows, err := repo.db.Pool().Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []Location{}
	for rows.Next() {
		item, err := scanLocation(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) deleteLocation(ctx context.Context, tenantContext tenant.Context, table string, id string) error {
	if !canManageProperties(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	locationID, ok := normalizeUUID(id)
	if !ok {
		return ErrPropertyNotFound
	}

	tag, err := repo.db.Pool().Exec(ctx, `
		delete from public.`+table+`
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, locationID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrPropertyNotFound
	}
	return nil
}

func (repo Repository) ensureCityScope(ctx context.Context, tx pgx.Tx, organizationID string, cityID string) error {
	var exists bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1 from public.property_cities
			where organization_id = $1::uuid and id = $2::uuid
		)
	`, organizationID, cityID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrInvalidInput
	}
	return nil
}

func (repo Repository) ensureNeighborhoodScope(ctx context.Context, tx pgx.Tx, organizationID string, neighborhoodID string) error {
	var exists bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1 from public.property_neighborhoods
			where organization_id = $1::uuid and id = $2::uuid
		)
	`, organizationID, neighborhoodID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrInvalidInput
	}
	return nil
}

func normalizeOptionalUUID(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false
	}
	return normalizeUUID(value)
}

func scanLocation(row scanner) (Location, error) {
	var location Location
	if err := row.Scan((*jsonTextProperty)(&location)); err != nil {
		return nil, err
	}
	return location, nil
}
