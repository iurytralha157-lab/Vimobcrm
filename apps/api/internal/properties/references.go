package properties

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

type propertyReference struct {
	field     string
	table     string
	userScope bool
	active    bool
}

var propertyReferences = []propertyReference{
	{field: "owner_id", table: "property_owners", active: true},
	{field: "city_id", table: "property_cities", active: true},
	{field: "neighborhood_id", table: "property_neighborhoods", active: true},
	{field: "condominium_id", table: "property_condominiums", active: true},
	{field: "property_type_id", table: "property_types"},
	{field: "created_by", userScope: true},
	{field: "responsible_user_id", userScope: true},
	{field: "corretor_id", userScope: true},
}

func (repo Repository) validatePropertyReferences(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	propertyID string,
	input propertyRequest,
) error {
	for _, reference := range propertyReferences {
		referenceID := optionalReferenceID(input[reference.field])
		if referenceID == "" {
			continue
		}

		var exists bool
		var err error
		if reference.userScope {
			err = tx.QueryRow(ctx, `
				select exists (
					select 1
					from public.users app_user
					where app_user.id = $2::uuid
					  and coalesce(app_user.is_active, true)
					  and (
						app_user.organization_id = $1::uuid
						or app_user.role = 'super_admin'
						or exists (
							select 1
							from public.user_roles global_role
							where global_role.user_id = app_user.id
							  and global_role.role = 'super_admin'
						)
						or exists (
							select 1
							from public.organization_members member
							where member.organization_id = $1::uuid
							  and member.user_id = app_user.id
							  and coalesce(member.is_active, false)
						)
					  )
				)
			`, organizationID, referenceID).Scan(&exists)
		} else {
			activeClause := ""
			if reference.active {
				activeClause = " and coalesce(scoped_reference.is_active, true)"
			}
			err = tx.QueryRow(ctx, `
				select exists (
					select 1
					from public.`+reference.table+` scoped_reference
					where scoped_reference.organization_id = $1::uuid
					  and scoped_reference.id = $2::uuid
					  `+activeClause+`
				)
			`, organizationID, referenceID).Scan(&exists)
		}
		if err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("%w: %s does not belong to the organization", ErrInvalidInput, reference.field)
		}
	}

	return repo.validatePropertyLocationHierarchy(ctx, tx, organizationID, propertyID, input)
}

func (repo Repository) validatePropertyLocationHierarchy(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	propertyID string,
	input propertyRequest,
) error {
	locationTouched := false
	for _, field := range []string{"city_id", "neighborhood_id", "condominium_id"} {
		if _, exists := input[field]; exists {
			locationTouched = true
			break
		}
	}
	if !locationTouched {
		return nil
	}

	cityID := ""
	neighborhoodID := ""
	condominiumID := ""
	if propertyID != "" {
		if err := tx.QueryRow(ctx, `
			select
				coalesce(city_id::text, ''),
				coalesce(neighborhood_id::text, ''),
				coalesce(condominium_id::text, '')
			from public.properties
			where organization_id = $1::uuid
			  and id = $2::uuid
		`, organizationID, propertyID).Scan(&cityID, &neighborhoodID, &condominiumID); err != nil {
			return err
		}
	}
	if _, exists := input["city_id"]; exists {
		cityID = optionalReferenceID(input["city_id"])
	}
	if _, exists := input["neighborhood_id"]; exists {
		neighborhoodID = optionalReferenceID(input["neighborhood_id"])
	}
	if _, exists := input["condominium_id"]; exists {
		condominiumID = optionalReferenceID(input["condominium_id"])
	}

	var cityName, cityUF string
	var neighborhoodName string
	if neighborhoodID != "" {
		var neighborhoodCityID string
		if err := tx.QueryRow(ctx, `
			select coalesce(city_id::text, ''), name
			from public.property_neighborhoods
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and coalesce(is_active, true)
		`, organizationID, neighborhoodID).Scan(&neighborhoodCityID, &neighborhoodName); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("%w: neighborhood_id is invalid", ErrInvalidInput)
			}
			return err
		}
		if neighborhoodCityID == "" {
			return fmt.Errorf("%w: neighborhood_id has no active city", ErrInvalidInput)
		}
		if cityID == "" {
			cityID = neighborhoodCityID
			input["city_id"] = cityID
		} else if neighborhoodCityID != cityID {
			return fmt.Errorf("%w: neighborhood_id does not belong to city_id", ErrInvalidInput)
		}
	}

	if condominiumID != "" {
		var condominiumCityID, condominiumNeighborhoodID string
		if err := tx.QueryRow(ctx, `
			select coalesce(city_id::text, ''), coalesce(neighborhood_id::text, '')
			from public.property_condominiums
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and coalesce(is_active, true)
		`, organizationID, condominiumID).Scan(&condominiumCityID, &condominiumNeighborhoodID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("%w: condominium_id is invalid", ErrInvalidInput)
			}
			return err
		}
		if condominiumCityID != "" {
			if cityID == "" {
				cityID = condominiumCityID
				input["city_id"] = cityID
			} else if cityID != condominiumCityID {
				return fmt.Errorf("%w: condominium_id does not belong to city_id", ErrInvalidInput)
			}
		}
		if condominiumNeighborhoodID != "" {
			if neighborhoodID == "" {
				neighborhoodID = condominiumNeighborhoodID
				input["neighborhood_id"] = neighborhoodID
			} else if neighborhoodID != condominiumNeighborhoodID {
				return fmt.Errorf("%w: condominium_id does not belong to neighborhood_id", ErrInvalidInput)
			}
		}
	}

	if cityID != "" {
		if err := tx.QueryRow(ctx, `
			select name, coalesce(uf, '')
			from public.property_cities
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and coalesce(is_active, true)
		`, organizationID, cityID).Scan(&cityName, &cityUF); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("%w: city_id is invalid", ErrInvalidInput)
			}
			return err
		}
		input["cidade"] = cityName
		input["uf"] = cityUF
	}
	if neighborhoodID != "" {
		if neighborhoodName == "" {
			if err := tx.QueryRow(ctx, `
				select name
				from public.property_neighborhoods
				where organization_id = $1::uuid and id = $2::uuid
			`, organizationID, neighborhoodID).Scan(&neighborhoodName); err != nil {
				return err
			}
		}
		input["bairro"] = neighborhoodName
	}

	return nil
}

func optionalReferenceID(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}
