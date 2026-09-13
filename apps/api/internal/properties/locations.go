package properties

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Location map[string]any

type CityInput struct {
	Name string
	UF   string
}

type CityUpdateInput struct {
	Name              locationPatchValue[string] `json:"name"`
	UF                locationPatchValue[string] `json:"uf"`
	ExpectedUpdatedAt string                     `json:"expected_updated_at"`
}

type NeighborhoodInput struct {
	Name   string
	CityID string
}

type NeighborhoodUpdateInput struct {
	Name              locationPatchValue[string] `json:"name"`
	CityID            locationPatchValue[string] `json:"city_id"`
	ExpectedUpdatedAt string                     `json:"expected_updated_at"`
}

type CondominiumInput struct {
	Name                  string
	CityID                string
	NeighborhoodID        string
	Address               string
	PhotoURL              string
	CEP                   string
	Number                string
	Complement            string
	DefaultCondominiumFee *float64
	HasConcierge          bool
	ConciergeType         string
	Notes                 string
	Latitude              *float64
	Longitude             *float64
}

type CondominiumUpdateInput struct {
	Name                  locationPatchValue[string]  `json:"name"`
	CityID                locationPatchValue[string]  `json:"city_id"`
	NeighborhoodID        locationPatchValue[string]  `json:"neighborhood_id"`
	Address               locationPatchValue[string]  `json:"address"`
	PhotoURL              locationPatchValue[string]  `json:"photo_url"`
	CEP                   locationPatchValue[string]  `json:"cep"`
	Number                locationPatchValue[string]  `json:"number"`
	Complement            locationPatchValue[string]  `json:"complement"`
	DefaultCondominiumFee locationPatchValue[float64] `json:"default_condominium_fee"`
	HasConcierge          locationPatchValue[bool]    `json:"has_concierge"`
	ConciergeType         locationPatchValue[string]  `json:"concierge_type"`
	Notes                 locationPatchValue[string]  `json:"notes"`
	Latitude              locationPatchValue[float64] `json:"latitude"`
	Longitude             locationPatchValue[float64] `json:"longitude"`
	ExpectedUpdatedAt     string                      `json:"expected_updated_at"`
}

// locationPatchValue distinguishes an omitted PATCH field from an explicit
// JSON null. Nullable columns can therefore be cleared without turning omitted
// fields into destructive updates.
type locationPatchValue[T any] struct {
	Set   bool
	Value *T
}

func (value *locationPatchValue[T]) UnmarshalJSON(data []byte) error {
	value.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		value.Value = nil
		return nil
	}
	var decoded T
	if err := json.Unmarshal(data, &decoded); err != nil {
		return fmt.Errorf("%w: invalid location patch value", ErrInvalidInput)
	}
	value.Value = &decoded
	return nil
}

// The aliases below are source constants supplied by this repository. Keeping
// the legacy text fallback next to the canonical foreign-key match lets scoped
// readers see old records without exposing unrelated catalog entries.
func cityCatalogPropertyMatchSQL(propertyAlias string, cityAlias string) string {
	return `(
		` + propertyAlias + `.city_id = ` + cityAlias + `.id
		or (
			` + propertyAlias + `.city_id is null
			and lower(btrim(coalesce(` + propertyAlias + `.cidade, ''))) = lower(btrim(` + cityAlias + `.name))
			and (
				nullif(btrim(coalesce(` + cityAlias + `.uf, '')), '') is null
				or upper(btrim(coalesce(` + propertyAlias + `.uf, ''))) = upper(btrim(` + cityAlias + `.uf))
			)
		)
	)`
}

func neighborhoodCatalogPropertyMatchSQL(propertyAlias string, neighborhoodAlias string, cityAlias string) string {
	return `(
		` + propertyAlias + `.neighborhood_id = ` + neighborhoodAlias + `.id
		or (
			` + propertyAlias + `.neighborhood_id is null
			and lower(btrim(coalesce(` + propertyAlias + `.bairro, ''))) = lower(btrim(` + neighborhoodAlias + `.name))
			and (
				` + neighborhoodAlias + `.city_id is null
				or ` + propertyAlias + `.city_id = ` + neighborhoodAlias + `.city_id
				or (
					` + propertyAlias + `.city_id is null
					and lower(btrim(coalesce(` + propertyAlias + `.cidade, ''))) = lower(btrim(coalesce(` + cityAlias + `.name, '')))
				)
			)
		)
	)`
}

func condominiumCatalogPropertyMatchSQL(propertyAlias string, condominiumAlias string) string {
	return propertyAlias + `.condominium_id = ` + condominiumAlias + `.id`
}

func legacyLocationAdvisoryKey(kind string, name string) string {
	return "property-location-" + kind + ":" + strings.ToLower(strings.TrimSpace(name))
}

func tryLockLegacyLocationName(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	kind string,
	name string,
) error {
	if strings.TrimSpace(name) == "" {
		return nil
	}
	var acquired bool
	if err := tx.QueryRow(
		ctx,
		`select pg_try_advisory_xact_lock(hashtext($1), hashtext($2))`,
		organizationID,
		legacyLocationAdvisoryKey(kind, name),
	).Scan(&acquired); err != nil {
		return err
	}
	if !acquired {
		return ErrPropertyWorkspaceConflict
	}
	return nil
}

func cityLegacyFallbackMutationSQL() string {
	return `
		select exists (
			select 1
			from public.properties property
			where property.organization_id = $1::uuid
			  and property.city_id is null
			  and nullif(btrim(property.cidade), '') is not null
			  and (
				(
				  lower(btrim(property.cidade)) = lower(btrim($2))
				  and (nullif(btrim($3), '') is null or upper(btrim(coalesce(property.uf, ''))) = upper(btrim($3)))
				)
				or (
				  lower(btrim(property.cidade)) = lower(btrim($4))
				  and (nullif(btrim($5), '') is null or upper(btrim(coalesce(property.uf, ''))) = upper(btrim($5)))
				)
			  )
			limit 1
		)
	`
}

func neighborhoodLegacyFallbackMutationSQL() string {
	return `
		select exists (
			select 1
			from public.properties property
			left join public.property_cities old_city
			  on old_city.organization_id = property.organization_id
			 and old_city.id = nullif($3, '')::uuid
			left join public.property_cities new_city
			  on new_city.organization_id = property.organization_id
			 and new_city.id = nullif($5, '')::uuid
			where property.organization_id = $1::uuid
			  and property.neighborhood_id is null
			  and nullif(btrim(property.bairro), '') is not null
			  and (
				(
				  lower(btrim(property.bairro)) = lower(btrim($2))
				  and (
					nullif($3, '')::uuid is null
					or property.city_id = nullif($3, '')::uuid
					or (
					  property.city_id is null
					  and lower(btrim(coalesce(property.cidade, ''))) = lower(btrim(coalesce(old_city.name, '')))
					)
				  )
				)
				or (
				  lower(btrim(property.bairro)) = lower(btrim($4))
				  and (
					nullif($5, '')::uuid is null
					or property.city_id = nullif($5, '')::uuid
					or (
					  property.city_id is null
					  and lower(btrim(coalesce(property.cidade, ''))) = lower(btrim(coalesce(new_city.name, '')))
					)
				  )
				)
			  )
			limit 1
		)
	`
}

func (repo Repository) ListCities(ctx context.Context, tenantContext tenant.Context) ([]Location, error) {
	args := []any{
		tenantContext.OrganizationID,
		canViewAllProperties(tenantContext),
		tenantContext.UserID,
		canViewTeamProperties(tenantContext),
	}
	cityMatch := cityCatalogPropertyMatchSQL("visible_property", "c")
	return repo.listLocationRows(ctx, `
		with visible_properties as (
			select p.organization_id, p.city_id, p.cidade, p.uf, p.created_at
			from public.properties p
			where p.organization_id = $1::uuid
			  and `+propertyVisibilitySQL("$2", "$3", "$4", "p")+`
		), catalog as (
			select
				to_jsonb(c) || jsonb_build_object(
					'catalog_source', 'catalog',
					'property_count', (
						select count(*)::bigint
						from visible_properties visible_property
						where `+cityMatch+`
					)
				) as item,
				lower(c.name) as sort_name,
				coalesce(c.uf, '') as sort_uf
			from public.property_cities c
			where c.organization_id = $1::uuid
			  and coalesce(c.is_active, true) = true
			  and (
				$2::boolean
				or exists (
					select 1
					from visible_properties visible_property
					where `+cityMatch+`
				)
			  )
		), legacy as (
			select
				p.organization_id,
				btrim(p.cidade) as name,
				max(nullif(btrim(p.uf), '')) as uf,
				coalesce(min(p.created_at), now()) as created_at,
				count(*)::bigint as property_count
			from visible_properties p
			where nullif(btrim(p.cidade), '') is not null
			group by p.organization_id, btrim(p.cidade)
		)
		select item
		from (
			select item::text as item, sort_name, sort_uf
			from catalog
			union all
			select jsonb_build_object(
			'id', (
				substr(md5(legacy.organization_id::text || ':legacy-city:' || lower(legacy.name)), 1, 8) || '-' ||
				substr(md5(legacy.organization_id::text || ':legacy-city:' || lower(legacy.name)), 9, 4) || '-' ||
				substr(md5(legacy.organization_id::text || ':legacy-city:' || lower(legacy.name)), 13, 4) || '-' ||
				substr(md5(legacy.organization_id::text || ':legacy-city:' || lower(legacy.name)), 17, 4) || '-' ||
				substr(md5(legacy.organization_id::text || ':legacy-city:' || lower(legacy.name)), 21, 12)
			)::uuid,
			'organization_id', legacy.organization_id,
			'name', legacy.name,
			'uf', legacy.uf,
			'is_active', true,
			'created_at', legacy.created_at,
			'updated_at', legacy.created_at,
			'catalog_source', 'property',
			'property_count', legacy.property_count
			)::text as item,
			lower(legacy.name) as sort_name,
			coalesce(legacy.uf, '') as sort_uf
			from legacy
			where not exists (
				select 1
				from public.property_cities c
				where c.organization_id = legacy.organization_id
				  and coalesce(c.is_active, true) = true
				  and lower(btrim(c.name)) = lower(legacy.name)
			)
		) entries
		order by sort_name, sort_uf
	`, args...)
}

func (repo Repository) CreateCity(ctx context.Context, tenantContext tenant.Context, input CityInput) (Location, error) {
	if !canCreateProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	var err error
	input.Name, err = validateLocationText(input.Name, "name", 120, true)
	if err != nil {
		return nil, err
	}
	input.UF = strings.ToUpper(strings.TrimSpace(input.UF))
	if input.Name == "" || (input.UF != "" && !isLocationStateCode(input.UF)) {
		return nil, fmt.Errorf("%w: city data is invalid", ErrInvalidInput)
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if err := tryLockLegacyLocationName(ctx, tx, tenantContext.OrganizationID, "city", input.Name); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`, tenantContext.OrganizationID, "city:"+strings.ToLower(input.Name)+":"+input.UF); err != nil {
		return nil, err
	}

	city, err := scanLocation(tx.QueryRow(ctx, `
		select to_jsonb(c)::text
		from public.property_cities c
		where c.organization_id = $1::uuid
		  and lower(c.name) = lower($2)
		  and coalesce(c.uf, '') = $3
		  and coalesce(c.is_active, true)
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
		values ($1::uuid, $2, nullif($3, ''))
		returning to_jsonb(property_cities)::text
	`, tenantContext.OrganizationID, input.Name, input.UF))
	if err != nil {
		return nil, normalizeWorkspaceDatabaseError(err)
	}

	return city, tx.Commit(ctx)
}

func (repo Repository) UpdateCity(ctx context.Context, tenantContext tenant.Context, id string, input CityUpdateInput) (Location, error) {
	if !canManageProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	cityID, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrPropertyNotFound
	}
	if !input.Name.Set && !input.UF.Set {
		return nil, ErrNoChanges
	}
	if err := validateRequiredWorkspaceTimestamp(input.ExpectedUpdatedAt, "expected_updated_at"); err != nil {
		return nil, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var name, state string
	var currentUpdatedAt time.Time
	if err := tx.QueryRow(ctx, `
		select name, coalesce(uf, ''), updated_at
		from public.property_cities
		where organization_id = $1::uuid and id = $2::uuid and coalesce(is_active, true)
		for update
	`, tenantContext.OrganizationID, cityID).Scan(&name, &state, &currentUpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrPropertyNotFound
		}
		return nil, err
	}
	if err := validateCatalogMutationVersion(currentUpdatedAt, input.ExpectedUpdatedAt); err != nil {
		return nil, err
	}
	currentName, currentState := name, state
	if input.Name.Set {
		if input.Name.Value == nil {
			return nil, fmt.Errorf("%w: city name cannot be null", ErrInvalidInput)
		}
		name, err = validateLocationText(*input.Name.Value, "name", 120, true)
		if err != nil {
			return nil, err
		}
	}
	if input.UF.Set {
		state = ""
		if input.UF.Value != nil {
			state = strings.ToUpper(strings.TrimSpace(*input.UF.Value))
		}
	}
	if name == "" || (state != "" && !isLocationStateCode(state)) {
		return nil, fmt.Errorf("%w: city data is invalid", ErrInvalidInput)
	}
	if !strings.EqualFold(strings.TrimSpace(currentName), strings.TrimSpace(name)) ||
		!strings.EqualFold(strings.TrimSpace(currentState), strings.TrimSpace(state)) {
		if err := tryLockLegacyLocationName(ctx, tx, tenantContext.OrganizationID, "city", currentName); err != nil {
			return nil, err
		}
		if err := tryLockLegacyLocationName(ctx, tx, tenantContext.OrganizationID, "city", name); err != nil {
			return nil, err
		}
		var legacyFallbackInUse bool
		if err := tx.QueryRow(
			ctx,
			cityLegacyFallbackMutationSQL(),
			tenantContext.OrganizationID,
			currentName,
			currentState,
			name,
			state,
		).Scan(&legacyFallbackInUse); err != nil {
			return nil, err
		}
		if legacyFallbackInUse {
			return nil, ErrPropertyLocationInUse
		}
	}

	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`, tenantContext.OrganizationID, "city:"+strings.ToLower(name)+":"+state); err != nil {
		return nil, err
	}
	var duplicate bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1 from public.property_cities
			where organization_id = $1::uuid and id <> $2::uuid
			  and lower(btrim(name)) = lower(btrim($3))
			  and coalesce(uf, '') = $4
			  and coalesce(is_active, true)
		)
	`, tenantContext.OrganizationID, cityID, name, state).Scan(&duplicate); err != nil {
		return nil, err
	}
	if duplicate {
		return nil, fmt.Errorf("%w: city already exists", ErrInvalidInput)
	}

	city, err := scanLocation(tx.QueryRow(ctx, `
		update public.property_cities
		set name = $3, uf = nullif($4, ''), updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
		returning to_jsonb(property_cities)::text
	`, tenantContext.OrganizationID, cityID, name, state))
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		update public.properties
		set cidade = $3, uf = nullif($4, ''), updated_at = now()
		where organization_id = $1::uuid and city_id = $2::uuid
	`, tenantContext.OrganizationID, cityID, name, state); err != nil {
		return nil, err
	}
	return city, tx.Commit(ctx)
}

func (repo Repository) DeleteCity(ctx context.Context, tenantContext tenant.Context, id string, expectedUpdatedAt string) error {
	return repo.deleteLocation(ctx, tenantContext, "property_cities", id, expectedUpdatedAt)
}

func (repo Repository) ListNeighborhoods(ctx context.Context, tenantContext tenant.Context, cityID string) ([]Location, error) {
	args := []any{
		tenantContext.OrganizationID,
		canViewAllProperties(tenantContext),
		tenantContext.UserID,
		canViewTeamProperties(tenantContext),
	}
	where := "n.organization_id = $1::uuid and coalesce(n.is_active, true) = true"
	if strings.TrimSpace(cityID) != "" {
		normalized, ok := normalizeUUID(cityID)
		if !ok {
			return nil, ErrInvalidInput
		}
		args = append(args, normalized)
		where += " and n.city_id = $5::uuid"
	}
	neighborhoodMatch := neighborhoodCatalogPropertyMatchSQL("visible_property", "n", "c")

	if strings.TrimSpace(cityID) != "" {
		return repo.listLocationRows(ctx, `
			with visible_properties as (
				select p.organization_id, p.city_id, p.neighborhood_id, p.cidade, p.bairro
				from public.properties p
				where p.organization_id = $1::uuid
				  and `+propertyVisibilitySQL("$2", "$3", "$4", "p")+`
			)
			select (
				to_jsonb(n) ||
				jsonb_build_object(
					'city', to_jsonb(c),
					'catalog_source', 'catalog',
					'property_count', (
						select count(*)::bigint
						from visible_properties visible_property
						where `+neighborhoodMatch+`
					)
				)
			)::text
			from public.property_neighborhoods n
			left join public.property_cities c
			  on c.id = n.city_id
			 and c.organization_id = n.organization_id
			where `+where+`
			  and (
				$2::boolean
				or exists (
					select 1
					from visible_properties visible_property
					where `+neighborhoodMatch+`
				)
			  )
			order by lower(n.name)
		`, args...)
	}

	return repo.listLocationRows(ctx, `
		with visible_properties as (
			select p.organization_id, p.city_id, p.neighborhood_id, p.cidade, p.bairro, p.uf, p.created_at
			from public.properties p
			where p.organization_id = $1::uuid
			  and `+propertyVisibilitySQL("$2", "$3", "$4", "p")+`
		), catalog as (
			select (
				to_jsonb(n) || jsonb_build_object(
					'city', to_jsonb(c),
					'catalog_source', 'catalog',
					'property_count', (
						select count(*)::bigint
						from visible_properties visible_property
						where `+neighborhoodMatch+`
					)
				)
			) as item
			from public.property_neighborhoods n
			left join public.property_cities c
			  on c.id = n.city_id
			 and c.organization_id = n.organization_id
			where n.organization_id = $1::uuid
			  and coalesce(n.is_active, true) = true
			  and (
				$2::boolean
				or exists (
					select 1
					from visible_properties visible_property
					where `+neighborhoodMatch+`
				)
			  )
		), legacy as (
			select
				p.organization_id,
				btrim(p.bairro) as name,
				nullif(btrim(p.cidade), '') as city_name,
				max(nullif(btrim(p.uf), '')) as city_uf,
				coalesce(min(p.created_at), now()) as created_at,
				count(*)::bigint as property_count
			from visible_properties p
			where nullif(btrim(p.bairro), '') is not null
			group by p.organization_id, btrim(p.bairro), nullif(btrim(p.cidade), '')
		), legacy_with_catalog_city as (
			select legacy.*, c.id as catalog_city_id
			from legacy
			left join public.property_cities c
			  on c.organization_id = legacy.organization_id
			 and coalesce(c.is_active, true) = true
			 and lower(btrim(c.name)) = lower(legacy.city_name)
		)
		select item
		from (
			select item::text as item, lower(item->>'name') as sort_name, coalesce(lower(item->'city'->>'name'), '') as sort_city
			from catalog
			union all
			select jsonb_build_object(
			'id', (
				substr(md5(legacy.organization_id::text || ':legacy-neighborhood:' || lower(legacy.name) || ':' || coalesce(lower(legacy.city_name), '')), 1, 8) || '-' ||
				substr(md5(legacy.organization_id::text || ':legacy-neighborhood:' || lower(legacy.name) || ':' || coalesce(lower(legacy.city_name), '')), 9, 4) || '-' ||
				substr(md5(legacy.organization_id::text || ':legacy-neighborhood:' || lower(legacy.name) || ':' || coalesce(lower(legacy.city_name), '')), 13, 4) || '-' ||
				substr(md5(legacy.organization_id::text || ':legacy-neighborhood:' || lower(legacy.name) || ':' || coalesce(lower(legacy.city_name), '')), 17, 4) || '-' ||
				substr(md5(legacy.organization_id::text || ':legacy-neighborhood:' || lower(legacy.name) || ':' || coalesce(lower(legacy.city_name), '')), 21, 12)
			)::uuid,
			'organization_id', legacy.organization_id,
			'city_id', case
				when legacy.catalog_city_id is not null then legacy.catalog_city_id
				when legacy.city_name is null then null
				else (
					substr(md5(legacy.organization_id::text || ':legacy-city:' || lower(legacy.city_name)), 1, 8) || '-' ||
					substr(md5(legacy.organization_id::text || ':legacy-city:' || lower(legacy.city_name)), 9, 4) || '-' ||
					substr(md5(legacy.organization_id::text || ':legacy-city:' || lower(legacy.city_name)), 13, 4) || '-' ||
					substr(md5(legacy.organization_id::text || ':legacy-city:' || lower(legacy.city_name)), 17, 4) || '-' ||
					substr(md5(legacy.organization_id::text || ':legacy-city:' || lower(legacy.city_name)), 21, 12)
				)::uuid
			end,
			'name', legacy.name,
			'is_active', true,
			'created_at', legacy.created_at,
			'updated_at', legacy.created_at,
			'catalog_source', 'property',
			'property_count', legacy.property_count,
			'city', case when legacy.city_name is null then null else jsonb_build_object(
				'id', coalesce(legacy.catalog_city_id, (
					substr(md5(legacy.organization_id::text || ':legacy-city:' || lower(legacy.city_name)), 1, 8) || '-' ||
					substr(md5(legacy.organization_id::text || ':legacy-city:' || lower(legacy.city_name)), 9, 4) || '-' ||
					substr(md5(legacy.organization_id::text || ':legacy-city:' || lower(legacy.city_name)), 13, 4) || '-' ||
					substr(md5(legacy.organization_id::text || ':legacy-city:' || lower(legacy.city_name)), 17, 4) || '-' ||
					substr(md5(legacy.organization_id::text || ':legacy-city:' || lower(legacy.city_name)), 21, 12)
				)::uuid),
				'organization_id', legacy.organization_id,
				'name', legacy.city_name,
				'uf', legacy.city_uf,
				'is_active', true,
				'created_at', legacy.created_at,
				'updated_at', legacy.created_at,
				'catalog_source', case when legacy.catalog_city_id is null then 'property' else 'catalog' end
			) end
			)::text as item,
			lower(legacy.name) as sort_name,
			coalesce(lower(legacy.city_name), '') as sort_city
			from legacy_with_catalog_city legacy
			where not exists (
				select 1
				from public.property_neighborhoods n
				left join public.property_cities c on c.id = n.city_id
				where n.organization_id = legacy.organization_id
				  and coalesce(n.is_active, true) = true
				  and lower(btrim(n.name)) = lower(legacy.name)
				  and coalesce(lower(btrim(c.name)), '') = coalesce(lower(legacy.city_name), '')
			)
		) entries
		order by sort_name, sort_city
	`, args...)
}

func (repo Repository) CreateNeighborhood(ctx context.Context, tenantContext tenant.Context, input NeighborhoodInput) (Location, error) {
	if !canCreateProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	var err error
	input.Name, err = validateLocationText(input.Name, "name", 120, true)
	if err != nil {
		return nil, err
	}
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

	if err := tryLockLegacyLocationName(ctx, tx, tenantContext.OrganizationID, "neighborhood", input.Name); err != nil {
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
		  and coalesce(n.is_active, true)
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
		return nil, normalizeWorkspaceDatabaseError(err)
	}

	return neighborhood, tx.Commit(ctx)
}

func (repo Repository) UpdateNeighborhood(ctx context.Context, tenantContext tenant.Context, id string, input NeighborhoodUpdateInput) (Location, error) {
	if !canManageProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	neighborhoodID, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrPropertyNotFound
	}
	if !input.Name.Set && !input.CityID.Set {
		return nil, ErrNoChanges
	}
	if err := validateRequiredWorkspaceTimestamp(input.ExpectedUpdatedAt, "expected_updated_at"); err != nil {
		return nil, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var name, cityID string
	var currentUpdatedAt time.Time
	if err := tx.QueryRow(ctx, `
		select name, coalesce(city_id::text, ''), updated_at
		from public.property_neighborhoods
		where organization_id = $1::uuid and id = $2::uuid and coalesce(is_active, true)
		for update
	`, tenantContext.OrganizationID, neighborhoodID).Scan(&name, &cityID, &currentUpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrPropertyNotFound
		}
		return nil, err
	}
	if err := validateCatalogMutationVersion(currentUpdatedAt, input.ExpectedUpdatedAt); err != nil {
		return nil, err
	}
	currentName, currentCityID := name, cityID
	if input.Name.Set {
		if input.Name.Value == nil {
			return nil, fmt.Errorf("%w: neighborhood name cannot be null", ErrInvalidInput)
		}
		name, err = validateLocationText(*input.Name.Value, "name", 120, true)
		if err != nil {
			return nil, err
		}
	}
	if input.CityID.Set {
		if input.CityID.Value == nil {
			return nil, fmt.Errorf("%w: city_id cannot be null", ErrInvalidInput)
		}
		var valid bool
		cityID, valid = normalizeUUID(*input.CityID.Value)
		if !valid {
			return nil, fmt.Errorf("%w: city_id is required", ErrInvalidInput)
		}
	}
	if name == "" || cityID == "" {
		return nil, fmt.Errorf("%w: neighborhood name and city_id are required", ErrInvalidInput)
	}
	if err := repo.ensureCityScope(ctx, tx, tenantContext.OrganizationID, cityID); err != nil {
		return nil, err
	}
	if !strings.EqualFold(strings.TrimSpace(currentName), strings.TrimSpace(name)) || currentCityID != cityID {
		if err := tryLockLegacyLocationName(ctx, tx, tenantContext.OrganizationID, "neighborhood", currentName); err != nil {
			return nil, err
		}
		if err := tryLockLegacyLocationName(ctx, tx, tenantContext.OrganizationID, "neighborhood", name); err != nil {
			return nil, err
		}
		var legacyFallbackInUse bool
		if err := tx.QueryRow(
			ctx,
			neighborhoodLegacyFallbackMutationSQL(),
			tenantContext.OrganizationID,
			currentName,
			currentCityID,
			name,
			cityID,
		).Scan(&legacyFallbackInUse); err != nil {
			return nil, err
		}
		if legacyFallbackInUse {
			return nil, ErrPropertyLocationInUse
		}
	}

	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`, tenantContext.OrganizationID, "neighborhood:"+cityID+":"+strings.ToLower(name)); err != nil {
		return nil, err
	}
	var duplicate bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1 from public.property_neighborhoods
			where organization_id = $1::uuid and id <> $2::uuid
			  and city_id = $3::uuid
			  and lower(btrim(name)) = lower(btrim($4))
			  and coalesce(is_active, true)
		)
	`, tenantContext.OrganizationID, neighborhoodID, cityID, name).Scan(&duplicate); err != nil {
		return nil, err
	}
	if duplicate {
		return nil, fmt.Errorf("%w: neighborhood already exists in city", ErrInvalidInput)
	}

	neighborhood, err := scanLocation(tx.QueryRow(ctx, `
		with updated as (
			update public.property_neighborhoods
			set name = $3, city_id = $4::uuid, updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
			returning *
		)
		select (to_jsonb(updated) || jsonb_build_object('city', to_jsonb(city)))::text
		from updated
		join public.property_cities city
		  on city.organization_id = updated.organization_id and city.id = updated.city_id
	`, tenantContext.OrganizationID, neighborhoodID, name, cityID))
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		update public.property_condominiums
		set city_id = $3::uuid, updated_at = now()
		where organization_id = $1::uuid and neighborhood_id = $2::uuid
	`, tenantContext.OrganizationID, neighborhoodID, cityID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		update public.properties property
		set neighborhood_id = $2::uuid,
			city_id = $3::uuid,
			bairro = $4,
			cidade = city.name,
			uf = city.uf,
			updated_at = now()
		from public.property_cities city
		where property.organization_id = $1::uuid
		  and city.organization_id = property.organization_id
		  and city.id = $3::uuid
		  and (
			property.neighborhood_id = $2::uuid
			or property.condominium_id in (
				select condominium.id
				from public.property_condominiums condominium
				where condominium.organization_id = $1::uuid
				  and condominium.neighborhood_id = $2::uuid
			)
		  )
	`, tenantContext.OrganizationID, neighborhoodID, cityID, name); err != nil {
		return nil, err
	}
	return neighborhood, tx.Commit(ctx)
}

func (repo Repository) DeleteNeighborhood(ctx context.Context, tenantContext tenant.Context, id string, expectedUpdatedAt string) error {
	return repo.deleteLocation(ctx, tenantContext, "property_neighborhoods", id, expectedUpdatedAt)
}

func (repo Repository) ListCondominiums(ctx context.Context, tenantContext tenant.Context, neighborhoodID string) ([]Location, error) {
	args := []any{
		tenantContext.OrganizationID,
		canViewAllProperties(tenantContext),
		tenantContext.UserID,
		canViewTeamProperties(tenantContext),
	}
	where := "co.organization_id = $1::uuid and coalesce(co.is_active, true) = true"
	if strings.TrimSpace(neighborhoodID) != "" {
		normalized, ok := normalizeUUID(neighborhoodID)
		if !ok {
			return nil, ErrInvalidInput
		}
		args = append(args, normalized)
		where += " and co.neighborhood_id = $5::uuid"
	}
	condominiumMatch := condominiumCatalogPropertyMatchSQL("visible_property", "co")

	return repo.listLocationRows(ctx, `
		with visible_properties as (
			select
				p.organization_id,
				p.city_id,
				p.neighborhood_id,
				p.condominium_id,
				p.cidade,
				p.bairro
			from public.properties p
			where p.organization_id = $1::uuid
			  and `+propertyVisibilitySQL("$2", "$3", "$4", "p")+`
		)
		select (
			case
				when $2::boolean then to_jsonb(co)
				else jsonb_build_object(
					'id', co.id,
					'organization_id', co.organization_id,
					'city_id', co.city_id,
					'neighborhood_id', co.neighborhood_id,
					'name', co.name,
					'address', null,
					'photo_url', null,
					'cep', null,
					'number', null,
					'complement', null,
					'default_condominium_fee', null,
					'has_concierge', null,
					'concierge_type', null,
					'notes', null,
					'latitude', null,
					'longitude', null,
					'is_active', co.is_active,
					'created_at', co.created_at,
					'updated_at', co.updated_at,
					'catalog_source', 'catalog',
					'property_count', (
						select count(*)::bigint
						from visible_properties visible_property
						where `+condominiumMatch+`
					)
				)
			end ||
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
		  and (
			$2::boolean
			or exists (
				select 1
				from visible_properties visible_property
				where `+condominiumMatch+`
			)
		  )
		order by lower(co.name)
	`, args...)
}

func (repo Repository) CreateCondominium(ctx context.Context, tenantContext tenant.Context, input CondominiumInput) (Location, error) {
	if !canCreateProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	if err := validateCondominiumInput(&input); err != nil {
		return nil, err
	}
	cityID, hasCity, err := parseOptionalLocationUUID(input.CityID)
	if err != nil {
		return nil, err
	}
	neighborhoodID, hasNeighborhood, err := parseOptionalLocationUUID(input.NeighborhoodID)
	if err != nil {
		return nil, err
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	cityID, neighborhoodID, err = repo.resolveCondominiumLocationChain(
		ctx,
		tx,
		tenantContext.OrganizationID,
		cityID,
		hasCity,
		neighborhoodID,
		hasNeighborhood,
	)
	if err != nil {
		return nil, err
	}

	lockKey := "condominium:" + cityID + ":" + neighborhoodID + ":" + strings.ToLower(input.Name)
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`, tenantContext.OrganizationID, lockKey); err != nil {
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
		  and lower(btrim(co.name)) = lower(btrim($2))
		  and co.city_id is not distinct from nullif($3, '')::uuid
		  and co.neighborhood_id is not distinct from nullif($4, '')::uuid
		  and coalesce(co.is_active, true)
		limit 1
	`, tenantContext.OrganizationID, input.Name, cityID, neighborhoodID))
	if err == nil {
		return condominium, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	condominium, err = repo.insertCondominium(ctx, tx, tenantContext.OrganizationID, cityID, neighborhoodID, input)
	if err != nil {
		return nil, normalizeWorkspaceDatabaseError(err)
	}

	return condominium, tx.Commit(ctx)
}

func (repo Repository) UpdateCondominium(ctx context.Context, tenantContext tenant.Context, id string, patch CondominiumUpdateInput) (Location, error) {
	if !canManageProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	condominiumID, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrPropertyNotFound
	}
	if condominiumPatchIsEmpty(patch) {
		return nil, ErrNoChanges
	}
	if err := validateRequiredWorkspaceTimestamp(patch.ExpectedUpdatedAt, "expected_updated_at"); err != nil {
		return nil, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	current, err := scanLocation(tx.QueryRow(ctx, `
		select to_jsonb(condominium)::text
		from public.property_condominiums condominium
		where condominium.organization_id = $1::uuid
		  and condominium.id = $2::uuid
		  and coalesce(condominium.is_active, true)
		for update
	`, tenantContext.OrganizationID, condominiumID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPropertyNotFound
	}
	if err != nil {
		return nil, err
	}
	currentUpdatedAt, err := time.Parse(time.RFC3339Nano, locationString(current, "updated_at"))
	if err != nil {
		return nil, err
	}
	if err := validateCatalogMutationVersion(currentUpdatedAt, patch.ExpectedUpdatedAt); err != nil {
		return nil, err
	}

	input := CondominiumInput{
		Name:                  locationString(current, "name"),
		CityID:                locationString(current, "city_id"),
		NeighborhoodID:        locationString(current, "neighborhood_id"),
		Address:               locationString(current, "address"),
		PhotoURL:              locationString(current, "photo_url"),
		CEP:                   locationString(current, "cep"),
		Number:                locationString(current, "number"),
		Complement:            locationString(current, "complement"),
		DefaultCondominiumFee: locationFloatPointer(current, "default_condominium_fee"),
		HasConcierge:          locationBool(current, "has_concierge"),
		ConciergeType:         locationString(current, "concierge_type"),
		Notes:                 locationString(current, "notes"),
		Latitude:              locationFloatPointer(current, "latitude"),
		Longitude:             locationFloatPointer(current, "longitude"),
	}
	if err := applyCondominiumPatch(&input, patch); err != nil {
		return nil, err
	}
	if err := validateCondominiumInput(&input); err != nil {
		return nil, err
	}
	cityID, hasCity, err := parseOptionalLocationUUID(input.CityID)
	if err != nil {
		return nil, err
	}
	neighborhoodID, hasNeighborhood, err := parseOptionalLocationUUID(input.NeighborhoodID)
	if err != nil {
		return nil, err
	}
	cityID, neighborhoodID, err = repo.resolveCondominiumLocationChain(
		ctx, tx, tenantContext.OrganizationID, cityID, hasCity, neighborhoodID, hasNeighborhood,
	)
	if err != nil {
		return nil, err
	}

	lockKey := "condominium:" + cityID + ":" + neighborhoodID + ":" + strings.ToLower(input.Name)
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`, tenantContext.OrganizationID, lockKey); err != nil {
		return nil, err
	}
	var duplicate bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1 from public.property_condominiums
			where organization_id = $1::uuid and id <> $2::uuid
			  and lower(btrim(name)) = lower(btrim($3))
			  and city_id is not distinct from nullif($4, '')::uuid
			  and neighborhood_id is not distinct from nullif($5, '')::uuid
			  and coalesce(is_active, true)
		)
	`, tenantContext.OrganizationID, condominiumID, input.Name, cityID, neighborhoodID).Scan(&duplicate); err != nil {
		return nil, err
	}
	if duplicate {
		return nil, fmt.Errorf("%w: condominium already exists in this location", ErrInvalidInput)
	}

	condominium, err := scanLocation(tx.QueryRow(ctx, `
		with updated as (
			update public.property_condominiums
			set city_id = nullif($3, '')::uuid,
				neighborhood_id = nullif($4, '')::uuid,
				name = $5,
				address = nullif($6, ''),
				photo_url = nullif($7, ''),
				cep = nullif($8, ''),
				number = nullif($9, ''),
				complement = nullif($10, ''),
				default_condominium_fee = $11,
				has_concierge = $12,
				concierge_type = nullif($13, ''),
				notes = nullif($14, ''),
				latitude = $15,
				longitude = $16,
				updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
			returning *
		)
		select (
			to_jsonb(updated) || jsonb_build_object('city', to_jsonb(city), 'neighborhood', to_jsonb(neighborhood))
		)::text
		from updated
		left join public.property_cities city on city.organization_id = updated.organization_id and city.id = updated.city_id
		left join public.property_neighborhoods neighborhood on neighborhood.organization_id = updated.organization_id and neighborhood.id = updated.neighborhood_id
	`, tenantContext.OrganizationID, condominiumID, cityID, neighborhoodID, input.Name, input.Address,
		input.PhotoURL, input.CEP, input.Number, input.Complement, input.DefaultCondominiumFee,
		input.HasConcierge, input.ConciergeType, input.Notes, input.Latitude, input.Longitude))
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		update public.properties property
		set city_id = nullif($3, '')::uuid,
			neighborhood_id = nullif($4, '')::uuid,
			cidade = city.name,
			uf = city.uf,
			bairro = neighborhood.name,
			updated_at = now()
		from (select 1) marker
		left join public.property_cities city
		  on city.organization_id = $1::uuid and city.id = nullif($3, '')::uuid
		left join public.property_neighborhoods neighborhood
		  on neighborhood.organization_id = $1::uuid and neighborhood.id = nullif($4, '')::uuid
		where property.organization_id = $1::uuid and property.condominium_id = $2::uuid
	`, tenantContext.OrganizationID, condominiumID, cityID, neighborhoodID); err != nil {
		return nil, err
	}
	return condominium, tx.Commit(ctx)
}

func (repo Repository) DeleteCondominium(ctx context.Context, tenantContext tenant.Context, id string, expectedUpdatedAt string) error {
	return repo.deleteLocation(ctx, tenantContext, "property_condominiums", id, expectedUpdatedAt)
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
	hasRichColumns, err := repo.tableHasColumn(ctx, "property_condominiums", "default_condominium_fee")
	if err != nil {
		return nil, err
	}

	if hasLatitude && hasLongitude && hasRichColumns {
		return scanLocation(tx.QueryRow(ctx, `
			with inserted as (
				insert into public.property_condominiums (
					organization_id, city_id, neighborhood_id, name, address,
					photo_url, cep, number, complement, default_condominium_fee,
					has_concierge, concierge_type, notes, latitude, longitude
				)
				values (
					$1::uuid, nullif($2, '')::uuid, nullif($3, '')::uuid, $4, nullif($5, ''),
					nullif($6, ''), nullif($7, ''), nullif($8, ''), nullif($9, ''), $10,
					$11, nullif($12, ''), nullif($13, ''), $14, $15
				)
				returning *
			)
			select (
				to_jsonb(inserted) ||
				jsonb_build_object('city', to_jsonb(c), 'neighborhood', to_jsonb(n))
			)::text
			from inserted
			left join public.property_cities c on c.id = inserted.city_id
			left join public.property_neighborhoods n on n.id = inserted.neighborhood_id
		`, organizationID, cityID, neighborhoodID, input.Name, input.Address,
			input.PhotoURL, input.CEP, input.Number, input.Complement, input.DefaultCondominiumFee,
			input.HasConcierge, input.ConciergeType, input.Notes, input.Latitude, input.Longitude))
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

func (repo Repository) resolveCondominiumLocationChain(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	cityID string,
	hasCity bool,
	neighborhoodID string,
	hasNeighborhood bool,
) (string, string, error) {
	if hasCity {
		if err := repo.ensureCityScope(ctx, tx, organizationID, cityID); err != nil {
			return "", "", err
		}
	}
	if !hasNeighborhood {
		return cityID, neighborhoodID, nil
	}

	var neighborhoodCityID string
	if err := tx.QueryRow(ctx, `
		select coalesce(city_id::text, '')
		from public.property_neighborhoods
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_active, true)
	`, organizationID, neighborhoodID).Scan(&neighborhoodCityID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", fmt.Errorf("%w: neighborhood_id is invalid", ErrInvalidInput)
		}
		return "", "", err
	}
	if neighborhoodCityID == "" {
		return "", "", fmt.Errorf("%w: neighborhood has no city", ErrInvalidInput)
	}
	if hasCity && cityID != neighborhoodCityID {
		return "", "", fmt.Errorf("%w: neighborhood_id does not belong to city_id", ErrInvalidInput)
	}
	return neighborhoodCityID, neighborhoodID, nil
}

func condominiumPatchIsEmpty(input CondominiumUpdateInput) bool {
	return !input.Name.Set && !input.CityID.Set && !input.NeighborhoodID.Set &&
		!input.Address.Set && !input.PhotoURL.Set && !input.CEP.Set &&
		!input.Number.Set && !input.Complement.Set && !input.DefaultCondominiumFee.Set &&
		!input.HasConcierge.Set && !input.ConciergeType.Set && !input.Notes.Set &&
		!input.Latitude.Set && !input.Longitude.Set
}

func applyCondominiumPatch(target *CondominiumInput, input CondominiumUpdateInput) error {
	if input.Name.Set {
		if input.Name.Value == nil {
			return fmt.Errorf("%w: condominium name cannot be null", ErrInvalidInput)
		}
		target.Name = *input.Name.Value
	}
	if input.CityID.Set {
		target.CityID = ""
		if input.CityID.Value != nil {
			target.CityID = *input.CityID.Value
		}
	}
	if input.NeighborhoodID.Set {
		target.NeighborhoodID = ""
		if input.NeighborhoodID.Value != nil {
			target.NeighborhoodID = *input.NeighborhoodID.Value
		}
	}
	if input.Address.Set {
		target.Address = ""
		if input.Address.Value != nil {
			target.Address = *input.Address.Value
		}
	}
	if input.PhotoURL.Set {
		target.PhotoURL = ""
		if input.PhotoURL.Value != nil {
			target.PhotoURL = *input.PhotoURL.Value
		}
	}
	if input.CEP.Set {
		target.CEP = ""
		if input.CEP.Value != nil {
			target.CEP = *input.CEP.Value
		}
	}
	if input.Number.Set {
		target.Number = ""
		if input.Number.Value != nil {
			target.Number = *input.Number.Value
		}
	}
	if input.Complement.Set {
		target.Complement = ""
		if input.Complement.Value != nil {
			target.Complement = *input.Complement.Value
		}
	}
	if input.DefaultCondominiumFee.Set {
		target.DefaultCondominiumFee = cloneLocationPatchValue(input.DefaultCondominiumFee.Value)
	}
	if input.HasConcierge.Set {
		if input.HasConcierge.Value == nil {
			return fmt.Errorf("%w: has_concierge cannot be null", ErrInvalidInput)
		}
		target.HasConcierge = *input.HasConcierge.Value
	}
	if input.ConciergeType.Set {
		target.ConciergeType = ""
		if input.ConciergeType.Value != nil {
			target.ConciergeType = *input.ConciergeType.Value
		}
	}
	if input.Notes.Set {
		target.Notes = ""
		if input.Notes.Value != nil {
			target.Notes = *input.Notes.Value
		}
	}
	if input.Latitude.Set {
		target.Latitude = cloneLocationPatchValue(input.Latitude.Value)
	}
	if input.Longitude.Set {
		target.Longitude = cloneLocationPatchValue(input.Longitude.Value)
	}
	return nil
}

func cloneLocationPatchValue[T any](value *T) *T {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

func locationString(item Location, field string) string {
	value, _ := item[field].(string)
	return value
}

func locationBool(item Location, field string) bool {
	value, _ := item[field].(bool)
	return value
}

func locationFloatPointer(item Location, field string) *float64 {
	value, ok := item[field].(float64)
	if !ok {
		return nil
	}
	return &value
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

func (repo Repository) deleteLocation(ctx context.Context, tenantContext tenant.Context, table string, id string, expectedUpdatedAt string) error {
	if !canManageProperties(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	if err := validateRequiredWorkspaceTimestamp(expectedUpdatedAt, "expected_updated_at"); err != nil {
		return err
	}
	locationID, ok := normalizeUUID(id)
	if !ok {
		return ErrPropertyNotFound
	}

	associationSQL := ""
	legacyKind := ""
	switch table {
	case "property_cities":
		legacyKind = "city"
		associationSQL = `
			exists (select 1 from public.properties where organization_id = $1::uuid and city_id = $2::uuid)
			or exists (select 1 from public.property_neighborhoods where organization_id = $1::uuid and city_id = $2::uuid and coalesce(is_active, true))
			or exists (select 1 from public.property_condominiums where organization_id = $1::uuid and city_id = $2::uuid and coalesce(is_active, true))
			or exists (
				select 1
				from public.properties property
				join public.property_cities city
				  on city.organization_id = property.organization_id
				 and city.id = $2::uuid
				where property.organization_id = $1::uuid
				  and property.city_id is null
				  and nullif(btrim(property.cidade), '') is not null
				  and lower(btrim(property.cidade)) = lower(btrim(city.name))
				  and (
					nullif(btrim(coalesce(city.uf, '')), '') is null
					or upper(btrim(coalesce(property.uf, ''))) = upper(btrim(city.uf))
				  )
			)
		`
	case "property_neighborhoods":
		legacyKind = "neighborhood"
		associationSQL = `
			exists (select 1 from public.properties where organization_id = $1::uuid and neighborhood_id = $2::uuid)
			or exists (select 1 from public.property_condominiums where organization_id = $1::uuid and neighborhood_id = $2::uuid and coalesce(is_active, true))
			or exists (
				select 1
				from public.properties property
				join public.property_neighborhoods neighborhood
				  on neighborhood.organization_id = property.organization_id
				 and neighborhood.id = $2::uuid
				left join public.property_cities city
				  on city.organization_id = neighborhood.organization_id
				 and city.id = neighborhood.city_id
				where property.organization_id = $1::uuid
				  and property.neighborhood_id is null
				  and nullif(btrim(property.bairro), '') is not null
				  and lower(btrim(property.bairro)) = lower(btrim(neighborhood.name))
				  and (
					neighborhood.city_id is null
					or property.city_id = neighborhood.city_id
					or (
					  property.city_id is null
					  and lower(btrim(coalesce(property.cidade, ''))) = lower(btrim(coalesce(city.name, '')))
					)
				  )
			)
		`
	case "property_condominiums":
		associationSQL = `exists (select 1 from public.properties where organization_id = $1::uuid and condominium_id = $2::uuid)`
	default:
		return ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var lockedID string
	var currentName string
	var currentUpdatedAt time.Time
	if err := tx.QueryRow(ctx, `
		select id::text, name, updated_at
		from public.`+table+`
		where organization_id = $1::uuid and id = $2::uuid and coalesce(is_active, true)
		for update
	`, tenantContext.OrganizationID, locationID).Scan(&lockedID, &currentName, &currentUpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPropertyNotFound
		}
		return err
	}
	if err := validateCatalogMutationVersion(currentUpdatedAt, expectedUpdatedAt); err != nil {
		return err
	}
	if legacyKind != "" {
		if err := tryLockLegacyLocationName(ctx, tx, tenantContext.OrganizationID, legacyKind, currentName); err != nil {
			return err
		}
	}
	var inUse bool
	if err := tx.QueryRow(ctx, `select (`+associationSQL+`)`, tenantContext.OrganizationID, locationID).Scan(&inUse); err != nil {
		return err
	}
	if inUse {
		return ErrPropertyLocationInUse
	}
	if _, err := tx.Exec(ctx, `
		update public.`+table+`
		set is_active = false, updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, tenantContext.OrganizationID, locationID); err != nil {
		return normalizeWorkspaceDatabaseError(err)
	}
	return tx.Commit(ctx)
}

func (repo Repository) ensureCityScope(ctx context.Context, tx pgx.Tx, organizationID string, cityID string) error {
	var exists bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1 from public.property_cities
			where organization_id = $1::uuid and id = $2::uuid and coalesce(is_active, true)
		)
	`, organizationID, cityID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrInvalidInput
	}
	return nil
}

func (repo Repository) ensureNeighborhoodScope(ctx context.Context, tx pgx.Tx, organizationID string, neighborhoodID string, cityID string) error {
	var exists bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1 from public.property_neighborhoods
			where organization_id = $1::uuid and id = $2::uuid
			  and coalesce(is_active, true)
			  and (
			    nullif($3::text, '') is null
			    or city_id = nullif($3::text, '')::uuid
			  )
		)
	`, organizationID, neighborhoodID, cityID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrInvalidInput
	}
	return nil
}

func parseOptionalLocationUUID(value string) (string, bool, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false, nil
	}
	normalized, ok := normalizeUUID(value)
	if !ok {
		return "", false, ErrInvalidInput
	}
	return normalized, true, nil
}

func isSafeLocationURL(value string) bool {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return false
	}
	scheme := strings.ToLower(parsed.Scheme)
	return scheme == "http" || scheme == "https"
}

func isLocationStateCode(value string) bool {
	if len(value) != 2 {
		return false
	}
	return value[0] >= 'A' && value[0] <= 'Z' && value[1] >= 'A' && value[1] <= 'Z'
}

func validateLocationText(value string, field string, limit int, required bool) (string, error) {
	value = strings.TrimSpace(value)
	if required && value == "" {
		return "", fmt.Errorf("%w: %s is required", ErrInvalidInput, field)
	}
	if len([]rune(value)) > limit {
		return "", fmt.Errorf("%w: %s must have at most %d characters", ErrInvalidInput, field, limit)
	}
	return value, nil
}

func validateCondominiumInput(input *CondominiumInput) error {
	fields := []struct {
		name     string
		value    *string
		limit    int
		required bool
	}{
		{name: "name", value: &input.Name, limit: 120, required: true},
		{name: "address", value: &input.Address, limit: 300},
		{name: "photo_url", value: &input.PhotoURL, limit: 1000},
		{name: "cep", value: &input.CEP, limit: 20},
		{name: "number", value: &input.Number, limit: 40},
		{name: "complement", value: &input.Complement, limit: 160},
		{name: "concierge_type", value: &input.ConciergeType, limit: 80},
		{name: "notes", value: &input.Notes, limit: 1200},
	}
	for _, field := range fields {
		value, err := validateLocationText(*field.value, field.name, field.limit, field.required)
		if err != nil {
			return err
		}
		*field.value = value
	}
	if input.PhotoURL != "" && !isSafeLocationURL(input.PhotoURL) {
		return fmt.Errorf("%w: photo_url is invalid", ErrInvalidInput)
	}
	if input.DefaultCondominiumFee != nil && (*input.DefaultCondominiumFee < 0 || math.IsNaN(*input.DefaultCondominiumFee) || math.IsInf(*input.DefaultCondominiumFee, 0)) {
		return fmt.Errorf("%w: default_condominium_fee is invalid", ErrInvalidInput)
	}
	if input.Latitude != nil && (*input.Latitude < -90 || *input.Latitude > 90 || math.IsNaN(*input.Latitude) || math.IsInf(*input.Latitude, 0)) {
		return fmt.Errorf("%w: latitude is invalid", ErrInvalidInput)
	}
	if input.Longitude != nil && (*input.Longitude < -180 || *input.Longitude > 180 || math.IsNaN(*input.Longitude) || math.IsInf(*input.Longitude, 0)) {
		return fmt.Errorf("%w: longitude is invalid", ErrInvalidInput)
	}
	return nil
}

func scanLocation(row scanner) (Location, error) {
	var location Location
	if err := row.Scan((*jsonTextProperty)(&location)); err != nil {
		return nil, err
	}
	return location, nil
}
