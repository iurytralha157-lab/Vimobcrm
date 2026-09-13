package properties

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
)

func (repo Repository) attachPropertyDevelopmentLink(
	ctx context.Context,
	organizationID string,
	propertyID string,
	response PropertyWorkspaceResponse,
) (PropertyWorkspaceResponse, error) {
	link, available, err := repo.getPropertyDevelopmentLink(ctx, organizationID, propertyID)
	if err != nil {
		return PropertyWorkspaceResponse{}, err
	}
	response.Data.DevelopmentLink = link
	response.Meta.DevelopmentLinkAvailable = available
	return response, nil
}

func (repo Repository) getPropertyDevelopmentLink(
	ctx context.Context,
	organizationID string,
	propertyID string,
) (*PropertyDevelopmentLink, bool, error) {
	var available bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select
			to_regclass('public.property_developments') is not null
			and to_regclass('public.property_development_phases') is not null
			and to_regclass('public.property_development_buildings') is not null
			and to_regclass('public.property_development_floor_plans') is not null
			and to_regclass('public.property_development_units') is not null
	`).Scan(&available); err != nil {
		return nil, false, err
	}
	if !available {
		return nil, false, nil
	}

	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		select jsonb_build_object(
			'development', jsonb_build_object(
				'id', development.id,
				'code', development.code,
				'name', development.name,
				'status', development.status,
				'commercial_status', development.commercial_status
			),
			'phase', jsonb_build_object(
				'id', phase.id,
				'code', phase.code,
				'name', phase.name,
				'status', phase.status
			),
			'building', jsonb_build_object(
				'id', building.id,
				'code', building.code,
				'name', building.name,
				'status', building.status
			),
			'floor_plan', case
				when floor_plan.id is null then null
				else jsonb_build_object(
					'id', floor_plan.id,
					'code', floor_plan.code,
					'name', floor_plan.name,
					'status', floor_plan.status,
					'property_type', floor_plan.property_type
				)
			end,
			'unit', jsonb_build_object(
				'id', unit.id,
				'code', unit.code,
				'unit_number', unit.unit_number,
				'status', unit.status,
				'updated_at', unit.updated_at
			)
		)
		from public.property_development_units as unit
		join public.property_developments as development
		  on development.organization_id = unit.organization_id
		 and development.id = unit.development_id
		join public.property_development_buildings as building
		  on building.organization_id = unit.organization_id
		 and building.development_id = unit.development_id
		 and building.id = unit.building_id
		join public.property_development_phases as phase
		  on phase.organization_id = building.organization_id
		 and phase.development_id = building.development_id
		 and phase.id = building.phase_id
		left join public.property_development_floor_plans as floor_plan
		  on floor_plan.organization_id = unit.organization_id
		 and floor_plan.development_id = unit.development_id
		 and floor_plan.id = unit.floor_plan_id
		where unit.organization_id = $1::uuid
		  and unit.property_id = $2::uuid
		limit 1
	`, organizationID, propertyID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, true, nil
	}
	if err != nil {
		return nil, true, err
	}

	var link PropertyDevelopmentLink
	if err := json.Unmarshal(raw, &link); err != nil {
		return nil, true, err
	}
	return &link, true, nil
}
