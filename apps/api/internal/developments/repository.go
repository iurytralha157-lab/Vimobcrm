package developments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db *dbpkg.Postgres
}

type scanner interface {
	Scan(dest ...any) error
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

func (repo Repository) List(ctx context.Context, tenantContext tenant.Context, filter ListFilter) (ListResponse, error) {
	if strings.TrimSpace(tenantContext.OrganizationID) == "" {
		return ListResponse{}, tenant.ErrOrganizationAccessDenied
	}

	args := []any{tenantContext.OrganizationID}
	where := []string{"development.organization_id = $1::uuid"}
	if filter.Search != "" {
		args = append(args, "%"+normalizeSearch(filter.Search)+"%")
		where = append(where, fmt.Sprintf(`
			translate(
				lower(concat_ws(' ', development.name, development.code, development.city, development.neighborhood, developer.name)),
				'áàâãäéèêëíìîïóòôõöúùûüç',
				'aaaaaeeeeiiiiooooouuuuc'
			) like $%d
		`, len(args)))
	}
	if filter.Status != "" {
		args = append(args, filter.Status)
		where = append(where, fmt.Sprintf("development.status = $%d", len(args)))
	}
	if filter.DevelopmentType != "" {
		args = append(args, filter.DevelopmentType)
		where = append(where, fmt.Sprintf("development.development_type = $%d", len(args)))
	}
	if filter.CommercialStatus != "" {
		args = append(args, filter.CommercialStatus)
		where = append(where, fmt.Sprintf("development.commercial_status = $%d", len(args)))
	}

	whereSQL := strings.Join(where, " and ")
	var total, inventoryTotal, inventoryAvailable, commercialActive, underConstruction int
	if err := repo.db.Pool().QueryRow(ctx, `
		select
			count(*)::integer,
			coalesce(sum(inventory.total), 0)::integer,
			coalesce(sum(inventory.available), 0)::integer,
			count(*) filter (where development.commercial_status = 'active')::integer,
			count(*) filter (where development.status = 'under_construction')::integer
		from public.property_developments as development
		left join public.property_developers as developer
		  on developer.id = development.developer_id
		 and developer.organization_id = development.organization_id
		left join lateral (
			select
				count(*)::integer as total,
				count(*) filter (where unit.status = 'available')::integer as available
			from public.property_development_units as unit
			where unit.organization_id = development.organization_id
			  and unit.development_id = development.id
		) as inventory on true
		where `+whereSQL, args...).Scan(
		&total,
		&inventoryTotal,
		&inventoryAvailable,
		&commercialActive,
		&underConstruction,
	); err != nil {
		return ListResponse{}, err
	}

	canManageCommercial := canManage(tenantContext)
	listArgs := append(append([]any{}, args...), canManageCommercial, filter.Limit, filter.Offset)
	canManageIndex := len(args) + 1
	limitIndex := len(listArgs) - 1
	offsetIndex := len(listArgs)
	rows, err := repo.db.Pool().Query(ctx, `
		select
			to_jsonb(development)
			|| jsonb_build_object(
				'developer', case
					when developer.id is null then null
					else jsonb_build_object(
						'id', developer.id,
						'name', developer.name,
						'legal_name', developer.legal_name,
						'logo_url', developer.logo_url,
						'status', developer.status
					)
				end,
				'inventory', jsonb_build_object(
					'total', inventory.total,
					'available', inventory.available,
					'negotiation', inventory.negotiation,
					'reserved', inventory.reserved,
					'sold', inventory.sold,
					'blocked', inventory.blocked,
					'unavailable', inventory.unavailable,
					'withdrawn', inventory.withdrawn
				),
				'price_range', jsonb_build_object(
					'minimum', price_range.minimum,
					'maximum', price_range.maximum,
					'currency', selected_price_table.currency
				),
				'floor_plan_count', (
					select count(*)::integer
					from public.property_development_floor_plans as floor_plan
					where floor_plan.organization_id = development.organization_id
					  and floor_plan.development_id = development.id
				)
			)
		from public.property_developments as development
		left join public.property_developers as developer
		  on developer.id = development.developer_id
		 and developer.organization_id = development.organization_id
		left join lateral (
			select
				count(*)::integer as total,
				count(*) filter (where unit.status = 'available')::integer as available,
				count(*) filter (where unit.status = 'negotiation')::integer as negotiation,
				count(*) filter (where unit.status = 'reserved')::integer as reserved,
				count(*) filter (where unit.status = 'sold')::integer as sold,
				count(*) filter (where unit.status = 'blocked')::integer as blocked,
				count(*) filter (where unit.status = 'unavailable')::integer as unavailable,
				count(*) filter (where unit.status = 'withdrawn')::integer as withdrawn
			from public.property_development_units as unit
			where unit.organization_id = development.organization_id
			  and unit.development_id = development.id
		) as inventory on true
		left join lateral (
			select price_table.id, price_table.currency
			from public.property_development_price_tables as price_table
			where price_table.organization_id = development.organization_id
			  and price_table.development_id = development.id
			  and (
				price_table.status = 'active'
				or ($`+fmt.Sprint(canManageIndex)+`::boolean and price_table.status in ('approved', 'draft'))
			  )
			order by
				case price_table.status when 'active' then 0 when 'approved' then 1 else 2 end,
				price_table.version desc
			limit 1
		) as selected_price_table on true
		left join lateral (
			select
				min(unit_price.list_price)::float8 as minimum,
				max(unit_price.list_price)::float8 as maximum
			from public.property_development_unit_prices as unit_price
			join public.property_development_units as unit
			  on unit.id = unit_price.unit_id
			 and unit.organization_id = unit_price.organization_id
			 and unit.development_id = unit_price.development_id
			where unit_price.price_table_id = selected_price_table.id
			  and unit.status = 'available'
			  and unit.published
		) as price_range on true
		where `+whereSQL+`
		order by development.updated_at desc, development.id desc
		limit $`+fmt.Sprint(limitIndex)+` offset $`+fmt.Sprint(offsetIndex), listArgs...)
	if err != nil {
		return ListResponse{}, err
	}
	defer rows.Close()

	items := make([]DevelopmentListItem, 0)
	for rows.Next() {
		item, err := scanJSON[DevelopmentListItem](rows)
		if err != nil {
			return ListResponse{}, err
		}
		normalizeDevelopment(&item.Development)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return ListResponse{}, err
	}

	return ListResponse{
		Data: items,
		Meta: ListMeta{
			Total: total, Limit: filter.Limit, Offset: filter.Offset,
			InventoryTotal: inventoryTotal, InventoryAvailable: inventoryAvailable,
			CommercialActive: commercialActive, UnderConstruction: underConstruction,
			CanManage: canManage(tenantContext),
		},
	}, nil
}

func (repo Repository) GetWorkspace(ctx context.Context, tenantContext tenant.Context, developmentID string) (WorkspaceResponse, error) {
	if strings.TrimSpace(tenantContext.OrganizationID) == "" || !uuidPattern.MatchString(strings.TrimSpace(developmentID)) {
		return WorkspaceResponse{}, ErrNotFound
	}

	canManageCommercial := canManage(tenantContext)
	workspace, err := scanJSON[Workspace](repo.db.Pool().QueryRow(
		ctx,
		workspaceSQL,
		tenantContext.OrganizationID,
		developmentID,
		canManageCommercial,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceResponse{}, ErrNotFound
	}
	if err != nil {
		return WorkspaceResponse{}, err
	}
	normalizeWorkspace(&workspace)
	if !canManageCommercial {
		redactWorkspaceCommercialFields(&workspace)
	}
	workspace.Summary, err = repo.getWorkspaceSummary(ctx, tenantContext.OrganizationID, developmentID, workspace)
	if err != nil {
		return WorkspaceResponse{}, err
	}
	return WorkspaceResponse{
		Data: workspace,
		Meta: WorkspaceMeta{CanManage: canManage(tenantContext)},
	}, nil
}

func (repo Repository) ListUnits(ctx context.Context, tenantContext tenant.Context, developmentID string, filter UnitListFilter) (UnitListResponse, error) {
	if strings.TrimSpace(tenantContext.OrganizationID) == "" || !uuidPattern.MatchString(strings.TrimSpace(developmentID)) {
		return UnitListResponse{}, ErrNotFound
	}
	var developmentExists bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.property_developments
			where organization_id = $1::uuid and id = $2::uuid
		)
	`, tenantContext.OrganizationID, developmentID).Scan(&developmentExists); err != nil {
		return UnitListResponse{}, err
	}
	if !developmentExists {
		return UnitListResponse{}, ErrNotFound
	}

	args := []any{tenantContext.OrganizationID, developmentID}
	where := []string{
		"unit.organization_id = $1::uuid",
		"unit.development_id = $2::uuid",
	}
	if filter.BuildingID != "" {
		args = append(args, filter.BuildingID)
		where = append(where, fmt.Sprintf("unit.building_id = $%d::uuid", len(args)))
	}
	if filter.FloorPlanID != "" {
		args = append(args, filter.FloorPlanID)
		where = append(where, fmt.Sprintf("unit.floor_plan_id = $%d::uuid", len(args)))
	}
	if filter.Status != "" {
		args = append(args, filter.Status)
		where = append(where, fmt.Sprintf("unit.status = $%d", len(args)))
	}
	if filter.Search != "" {
		args = append(args, "%"+filter.Search+"%")
		where = append(where, fmt.Sprintf("concat_ws(' ', unit.unit_number, unit.code, unit.position, unit.orientation) ilike $%d", len(args)))
	}
	whereSQL := strings.Join(where, " and ")
	var total int
	if err := repo.db.Pool().QueryRow(ctx, `
		select count(*)::integer
		from public.property_development_units as unit
		where `+whereSQL, args...).Scan(&total); err != nil {
		return UnitListResponse{}, err
	}

	canManageCommercial := canManage(tenantContext)
	listArgs := append(append([]any{}, args...), canManageCommercial, filter.Limit, filter.Offset)
	canManageIndex := len(args) + 1
	limitIndex := len(listArgs) - 1
	offsetIndex := len(listArgs)
	rows, err := repo.db.Pool().Query(ctx, `
		select
			to_jsonb(unit)
			|| jsonb_build_object(
				'building_name', building.name,
				'floor_plan_name', floor_plan.name,
				'list_price', selected_price.list_price,
				'minimum_price', case when $`+fmt.Sprint(canManageIndex)+`::boolean then selected_price.minimum_price end,
				'price_per_sqm', selected_price.price_per_sqm,
				'currency', selected_price.currency,
				'price_table_id', selected_price.price_table_id,
				'price_table_name', selected_price.price_table_name,
				'price_table_status', selected_price.price_table_status,
				'draft_list_price', draft_price.list_price,
				'draft_minimum_price', draft_price.minimum_price,
				'draft_price_per_sqm', draft_price.price_per_sqm,
				'draft_price_table_id', draft_price.price_table_id,
				'draft_price_table_name', draft_price.price_table_name,
				'draft_price_table_updated_at', draft_price.price_table_updated_at
			)
		from public.property_development_units as unit
		join public.property_development_buildings as building
		  on building.id = unit.building_id
		 and building.organization_id = unit.organization_id
		 and building.development_id = unit.development_id
		left join public.property_development_floor_plans as floor_plan
		  on floor_plan.id = unit.floor_plan_id
		 and floor_plan.organization_id = unit.organization_id
		 and floor_plan.development_id = unit.development_id
		left join lateral (
			select
				unit_price.list_price,
				unit_price.minimum_price,
				unit_price.price_per_sqm,
				price_table.currency,
				price_table.id as price_table_id,
				price_table.name as price_table_name,
				price_table.status as price_table_status
			from public.property_development_unit_prices as unit_price
			join public.property_development_price_tables as price_table
			  on price_table.id = unit_price.price_table_id
			 and price_table.organization_id = unit_price.organization_id
			 and price_table.development_id = unit_price.development_id
			where unit_price.organization_id = unit.organization_id
			  and unit_price.development_id = unit.development_id
			  and unit_price.unit_id = unit.id
			  and (
				price_table.status = 'active'
				or ($`+fmt.Sprint(canManageIndex)+`::boolean and price_table.status in ('approved', 'draft'))
			  )
			order by
				case price_table.status when 'active' then 0 when 'approved' then 1 else 2 end,
				price_table.version desc
			limit 1
		) as selected_price on true
		left join lateral (
			select
				unit_price.list_price,
				unit_price.minimum_price,
				unit_price.price_per_sqm,
				price_table.id as price_table_id,
				price_table.name as price_table_name,
				price_table.updated_at as price_table_updated_at
			from public.property_development_unit_prices as unit_price
			join public.property_development_price_tables as price_table
			  on price_table.id = unit_price.price_table_id
			 and price_table.organization_id = unit_price.organization_id
			 and price_table.development_id = unit_price.development_id
			where unit_price.organization_id = unit.organization_id
			  and unit_price.development_id = unit.development_id
			  and unit_price.unit_id = unit.id
			  and price_table.status = 'draft'
			  and $`+fmt.Sprint(canManageIndex)+`::boolean
			order by price_table.version desc
			limit 1
		) as draft_price on true
		where `+whereSQL+`
		order by building.sort_order, unit.floor_number, unit.unit_number, unit.id
		limit $`+fmt.Sprint(limitIndex)+` offset $`+fmt.Sprint(offsetIndex), listArgs...)
	if err != nil {
		return UnitListResponse{}, err
	}
	defer rows.Close()
	units := make([]Unit, 0)
	for rows.Next() {
		unit, err := scanJSON[Unit](rows)
		if err != nil {
			return UnitListResponse{}, err
		}
		if !canManageCommercial {
			redactUnitCommercialFields(&unit)
		}
		units = append(units, unit)
	}
	if err := rows.Err(); err != nil {
		return UnitListResponse{}, err
	}
	return UnitListResponse{
		Data: units,
		Meta: UnitListMeta{Total: total, Limit: filter.Limit, Offset: filter.Offset},
	}, nil
}

func (repo Repository) Create(ctx context.Context, tenantContext tenant.Context, input CreateDevelopmentInput) (WorkspaceResponse, error) {
	if !canManage(tenantContext) {
		return WorkspaceResponse{}, tenant.ErrOrganizationAccessDenied
	}
	if err := input.Validate(); err != nil {
		return WorkspaceResponse{}, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return WorkspaceResponse{}, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`, tenantContext.OrganizationID, "development:"+strings.ToLower(input.Code)); err != nil {
		return WorkspaceResponse{}, err
	}

	developerID, err := repo.resolveDeveloperTx(ctx, tx, tenantContext, input.DeveloperID, input.DeveloperName)
	if err != nil {
		return WorkspaceResponse{}, normalizeDBError(err)
	}

	var developmentID string
	err = tx.QueryRow(ctx, `
		insert into public.property_developments (
			organization_id, developer_id, code, name, development_type,
			status, commercial_status, construction_progress,
			registration_number, summary, description, address,
			address_number, complement, neighborhood, city, state,
			postal_code, launch_date, construction_started_at,
			expected_delivery_date, main_image_url, published_on_site,
			responsible_user_id, metadata, created_by, updated_by
		) values (
			$1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8,
			$9, $10, $11, $12, $13, $14, $15, $16, $17,
			$18, $19::date, $20::date, $21::date, $22, $23,
			$24::uuid, $25::jsonb, $26::uuid, $26::uuid
		)
		returning id::text
	`,
		tenantContext.OrganizationID, developerID, input.Code, input.Name,
		input.DevelopmentType, input.Status, input.CommercialStatus,
		input.ConstructionProgress, input.RegistrationNumber, input.Summary,
		input.Description, input.Address, input.AddressNumber, input.Complement,
		input.Neighborhood, input.City, input.State, input.PostalCode,
		input.LaunchDate, input.ConstructionStartedAt, input.ExpectedDeliveryDate,
		input.MainImageURL, input.PublishedOnSite, input.ResponsibleUserID,
		jsonValue(input.Metadata), tenantContext.UserID,
	).Scan(&developmentID)
	if err != nil {
		return WorkspaceResponse{}, normalizeDBError(err)
	}

	if _, err := tx.Exec(ctx, `
		insert into public.property_development_phases (
			organization_id, development_id, code, name, sort_order,
			status, metadata, created_by, updated_by
		) values ($1::uuid, $2::uuid, 'FASE-1', 'Fase única', 0, 'planned', '{}'::jsonb, $3::uuid, $3::uuid)
	`, tenantContext.OrganizationID, developmentID, tenantContext.UserID); err != nil {
		return WorkspaceResponse{}, normalizeDBError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return WorkspaceResponse{}, err
	}
	return repo.GetWorkspace(ctx, tenantContext, developmentID)
}

func (repo Repository) CreatePhase(ctx context.Context, tenantContext tenant.Context, developmentID string, input CreatePhaseInput) (Phase, error) {
	if !canManage(tenantContext) {
		return Phase{}, tenant.ErrOrganizationAccessDenied
	}
	if !uuidPattern.MatchString(developmentID) {
		return Phase{}, ErrNotFound
	}
	if err := input.Validate(); err != nil {
		return Phase{}, err
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Phase{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockDevelopment(ctx, tx, tenantContext.OrganizationID, developmentID); err != nil {
		return Phase{}, err
	}
	phase, err := scanJSON[Phase](tx.QueryRow(ctx, `
		insert into public.property_development_phases (
			organization_id, development_id, code, name, sort_order, status,
			launch_date, construction_started_at, expected_delivery_date,
			metadata, created_by, updated_by
		) values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::date, $8::date, $9::date, $10::jsonb, $11::uuid, $11::uuid)
		returning to_jsonb(property_development_phases)
	`, tenantContext.OrganizationID, developmentID, input.Code, input.Name,
		input.SortOrder, input.Status, input.LaunchDate,
		input.ConstructionStartedAt, input.ExpectedDeliveryDate,
		jsonValue(input.Metadata), tenantContext.UserID))
	if err != nil {
		return Phase{}, normalizeDBError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Phase{}, err
	}
	return phase, nil
}

func (repo Repository) CreateBuilding(ctx context.Context, tenantContext tenant.Context, developmentID string, input CreateBuildingInput) (Building, error) {
	if !canManage(tenantContext) {
		return Building{}, tenant.ErrOrganizationAccessDenied
	}
	if !uuidPattern.MatchString(developmentID) {
		return Building{}, ErrNotFound
	}
	if err := input.Validate(); err != nil {
		return Building{}, err
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Building{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockDevelopment(ctx, tx, tenantContext.OrganizationID, developmentID); err != nil {
		return Building{}, err
	}
	building, err := scanJSON[Building](tx.QueryRow(ctx, `
		insert into public.property_development_buildings (
			organization_id, development_id, phase_id, code, name,
			building_type, floor_count, sort_order, status, metadata,
			created_by, updated_by
		) values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::uuid, $11::uuid)
		returning to_jsonb(property_development_buildings)
	`, tenantContext.OrganizationID, developmentID, input.PhaseID, input.Code,
		input.Name, input.BuildingType, input.FloorCount, input.SortOrder,
		input.Status, jsonValue(input.Metadata), tenantContext.UserID))
	if err != nil {
		return Building{}, normalizeDBError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Building{}, err
	}
	return building, nil
}

func (repo Repository) CreateFloorPlan(ctx context.Context, tenantContext tenant.Context, developmentID string, input CreateFloorPlanInput) (FloorPlan, error) {
	if !canManage(tenantContext) {
		return FloorPlan{}, tenant.ErrOrganizationAccessDenied
	}
	if !uuidPattern.MatchString(developmentID) {
		return FloorPlan{}, ErrNotFound
	}
	if err := input.Validate(); err != nil {
		return FloorPlan{}, err
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return FloorPlan{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockDevelopment(ctx, tx, tenantContext.OrganizationID, developmentID); err != nil {
		return FloorPlan{}, err
	}
	floorPlan, err := scanJSON[FloorPlan](tx.QueryRow(ctx, `
		insert into public.property_development_floor_plans (
			organization_id, development_id, code, name, status,
			property_type, bedrooms, suites, bathrooms, parking_spaces,
			private_area, total_area, balcony_area, garden_area,
			description, image_url, metadata, created_by, updated_by
		) values (
			$1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10,
			$11, $12, $13, $14, $15, $16, $17::jsonb, $18::uuid, $18::uuid
		)
		returning to_jsonb(property_development_floor_plans)
	`, tenantContext.OrganizationID, developmentID, input.Code, input.Name,
		input.Status, input.PropertyType, input.Bedrooms, input.Suites,
		input.Bathrooms, input.ParkingSpaces, input.PrivateArea, input.TotalArea,
		input.BalconyArea, input.GardenArea, input.Description, input.ImageURL,
		jsonValue(input.Metadata), tenantContext.UserID))
	if err != nil {
		return FloorPlan{}, normalizeDBError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return FloorPlan{}, err
	}
	return floorPlan, nil
}

type BulkCreateUnitsResult struct {
	Units      []Unit      `json:"units"`
	PriceTable *PriceTable `json:"price_table,omitempty"`
}

func (repo Repository) BulkCreateUnits(ctx context.Context, tenantContext tenant.Context, developmentID string, input BulkCreateUnitsInput) (BulkCreateUnitsResult, error) {
	if !canManage(tenantContext) {
		return BulkCreateUnitsResult{}, tenant.ErrOrganizationAccessDenied
	}
	if !uuidPattern.MatchString(developmentID) {
		return BulkCreateUnitsResult{}, ErrNotFound
	}
	if err := input.Validate(); err != nil {
		return BulkCreateUnitsResult{}, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return BulkCreateUnitsResult{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockDevelopment(ctx, tx, tenantContext.OrganizationID, developmentID); err != nil {
		return BulkCreateUnitsResult{}, err
	}

	var buildingCode, buildingType string
	var buildingFloorCount *int
	err = tx.QueryRow(ctx, `
		select code, building_type, floor_count
		from public.property_development_buildings
		where organization_id = $1::uuid
		  and development_id = $2::uuid
		  and id = $3::uuid
		for update
	`, tenantContext.OrganizationID, developmentID, input.BuildingID).Scan(
		&buildingCode,
		&buildingType,
		&buildingFloorCount,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return BulkCreateUnitsResult{}, fmt.Errorf("%w: building was not found", ErrInvalidInput)
	}
	if err != nil {
		return BulkCreateUnitsResult{}, err
	}
	maximumFloor := input.StartFloor + (input.Count-1)/input.UnitsPerFloor
	if (buildingType == "tower" || buildingType == "block") && buildingFloorCount != nil && maximumFloor > *buildingFloorCount {
		return BulkCreateUnitsResult{}, fmt.Errorf(
			"%w: generated floor %d exceeds the building floor_count %d",
			ErrInvalidInput,
			maximumFloor,
			*buildingFloorCount,
		)
	}
	maximumNumber := strconv.Itoa(input.StartNumber + input.Count - 1)
	if input.NumberPadding > len(maximumNumber) {
		maximumNumber = strings.Repeat("0", input.NumberPadding-len(maximumNumber)) + maximumNumber
	}
	maximumUnitNumber := input.Prefix + maximumNumber
	if len([]rune(maximumUnitNumber)) > 80 || len([]rune(buildingCode+"-"+maximumUnitNumber)) > 100 {
		return BulkCreateUnitsResult{}, fmt.Errorf("%w: generated unit code exceeds the supported length", ErrInvalidInput)
	}
	if input.FloorPlanID != nil {
		var exists bool
		if err := tx.QueryRow(ctx, `
			select exists (
				select 1 from public.property_development_floor_plans
				where organization_id = $1::uuid
				  and development_id = $2::uuid
				  and id = $3::uuid
			)
		`, tenantContext.OrganizationID, developmentID, *input.FloorPlanID).Scan(&exists); err != nil {
			return BulkCreateUnitsResult{}, err
		}
		if !exists {
			return BulkCreateUnitsResult{}, fmt.Errorf("%w: floor plan was not found", ErrInvalidInput)
		}
	}

	units, err := scanJSON[[]Unit](tx.QueryRow(ctx, `
		with generated as (
			select
				series.position,
				$4 || case
					when $9::integer > length(($5::integer + series.position)::text)
						then lpad(($5::integer + series.position)::text, $9::integer, '0')
					else ($5::integer + series.position)::text
				end as unit_number,
				$7::integer + (series.position / $8::integer) as floor_number
			from generate_series(0, $6::integer - 1) as series(position)
		), inserted as (
			insert into public.property_development_units (
				organization_id, development_id, building_id, floor_plan_id,
				code, unit_number, floor_number, private_area, total_area,
				status, published, publication_pending, metadata, created_by, updated_by
			)
			select
				$1::uuid,
				$2::uuid,
				$3::uuid,
				$10::uuid,
				$11 || '-' || generated.unit_number,
				generated.unit_number,
				generated.floor_number,
				(select floor_plan.private_area from public.property_development_floor_plans as floor_plan where floor_plan.id = $10::uuid),
				(select floor_plan.total_area from public.property_development_floor_plans as floor_plan where floor_plan.id = $10::uuid),
				'available',
				false,
				true,
				$12::jsonb,
				$13::uuid,
				$13::uuid
			from generated
			returning *
		)
		select coalesce(jsonb_agg(to_jsonb(inserted) order by inserted.floor_number, inserted.unit_number), '[]'::jsonb)
		from inserted
	`, tenantContext.OrganizationID, developmentID, input.BuildingID,
		input.Prefix, input.StartNumber, input.Count, input.StartFloor,
		input.UnitsPerFloor, input.NumberPadding, input.FloorPlanID,
		buildingCode, jsonValue(input.Metadata), tenantContext.UserID))
	if err != nil {
		return BulkCreateUnitsResult{}, normalizeDBError(err)
	}

	result := BulkCreateUnitsResult{Units: units}
	if input.InitialListPrice != nil {
		priceTable, err := repo.ensureDraftPriceTableTx(ctx, tx, tenantContext, developmentID, input.PriceTableName)
		if err != nil {
			return BulkCreateUnitsResult{}, normalizeDBError(err)
		}
		unitIDs := make([]string, 0, len(units))
		for index := range units {
			unitIDs = append(unitIDs, units[index].ID)
			units[index].ListPrice = input.InitialListPrice
			units[index].Currency = &priceTable.Currency
			units[index].PriceTableID = &priceTable.ID
			units[index].PriceTableName = &priceTable.Name
			units[index].PriceTableStatus = &priceTable.Status
		}
		if _, err := tx.Exec(ctx, `
			insert into public.property_development_unit_prices (
				organization_id, development_id, price_table_id, unit_id,
				list_price, price_per_sqm, payment_terms, metadata,
				created_by, updated_by
			)
			select
				$1::uuid,
				$2::uuid,
				$3::uuid,
				unit.id,
				$4::numeric,
				case
					when coalesce(unit.private_area, floor_plan.private_area) > 0
					  then round($4::numeric / coalesce(unit.private_area, floor_plan.private_area), 2)
				end,
				'{}'::jsonb,
				jsonb_build_object('generated_with_inventory', true),
				$6::uuid,
				$6::uuid
			from public.property_development_units as unit
			left join public.property_development_floor_plans as floor_plan
			  on floor_plan.id = unit.floor_plan_id
			 and floor_plan.organization_id = unit.organization_id
			where unit.organization_id = $1::uuid
			  and unit.development_id = $2::uuid
			  and unit.id = any($5::uuid[])
		`, tenantContext.OrganizationID, developmentID, priceTable.ID,
			*input.InitialListPrice, unitIDs, tenantContext.UserID); err != nil {
			return BulkCreateUnitsResult{}, normalizeDBError(err)
		}
		result.Units = units
		result.PriceTable = &priceTable
	}

	if err := tx.Commit(ctx); err != nil {
		return BulkCreateUnitsResult{}, err
	}
	return result, nil
}

func (repo Repository) UpdateUnit(ctx context.Context, tenantContext tenant.Context, developmentID, unitID string, input UpdateUnitInput) (Unit, error) {
	if !canManage(tenantContext) {
		return Unit{}, tenant.ErrOrganizationAccessDenied
	}
	if !uuidPattern.MatchString(developmentID) || !uuidPattern.MatchString(unitID) {
		return Unit{}, ErrNotFound
	}
	if err := input.Validate(); err != nil {
		return Unit{}, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Unit{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockDevelopment(ctx, tx, tenantContext.OrganizationID, developmentID); err != nil {
		return Unit{}, err
	}

	var currentStatus string
	var currentPublished bool
	var currentPublicationPending bool
	var currentUpdatedAt time.Time
	err = tx.QueryRow(ctx, `
		select status, published, publication_pending, updated_at
		from public.property_development_units
		where organization_id = $1::uuid
		  and development_id = $2::uuid
		  and id = $3::uuid
		for update
	`, tenantContext.OrganizationID, developmentID, unitID).Scan(
		&currentStatus,
		&currentPublished,
		&currentPublicationPending,
		&currentUpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Unit{}, ErrNotFound
	}
	if err != nil {
		return Unit{}, err
	}
	if input.ExpectedUpdatedAt != nil {
		expected, _ := parseTimestamp(input.ExpectedUpdatedAt)
		if expected != nil && !currentUpdatedAt.Equal(*expected) {
			return Unit{}, ErrConflict
		}
	}
	if currentStatus == "reserved" && input.Status != nil {
		return Unit{}, fmt.Errorf("%w: active reservations must be released through the reservation workflow", ErrConflict)
	}
	status := currentStatus
	if input.Status != nil {
		status = *input.Status
	}
	published := currentPublished
	publicationPending := currentPublicationPending
	if input.Published != nil {
		published = *input.Published
		publicationPending = false
	}
	if status == "sold" || status == "blocked" || status == "unavailable" || status == "withdrawn" {
		published = false
		publicationPending = false
	}
	if published {
		var hasActivePrice bool
		if err := tx.QueryRow(ctx, `
			select exists (
				select 1
				from public.property_development_unit_prices as unit_price
				join public.property_development_price_tables as price_table
				  on price_table.id = unit_price.price_table_id
				 and price_table.organization_id = unit_price.organization_id
				 and price_table.development_id = unit_price.development_id
				where unit_price.organization_id = $1::uuid
				  and unit_price.development_id = $2::uuid
				  and unit_price.unit_id = $3::uuid
				  and price_table.status = 'active'
			)
		`, tenantContext.OrganizationID, developmentID, unitID).Scan(&hasActivePrice); err != nil {
			return Unit{}, err
		}
		if !hasActivePrice {
			return Unit{}, fmt.Errorf("%w: published units require an active price", ErrConflict)
		}
	}
	if _, err := tx.Exec(ctx, `
		update public.property_development_units
		set status = $4,
		    published = $5,
		    publication_pending = $6,
		    updated_by = $7::uuid,
		    updated_at = now()
		where organization_id = $1::uuid
		  and development_id = $2::uuid
		  and id = $3::uuid
	`, tenantContext.OrganizationID, developmentID, unitID, status, published, publicationPending, tenantContext.UserID); err != nil {
		return Unit{}, normalizeDBError(err)
	}
	unit, err := repo.getUnitTx(ctx, tx, tenantContext.OrganizationID, developmentID, unitID)
	if err != nil {
		return Unit{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Unit{}, err
	}
	return unit, nil
}

func (repo Repository) ActivatePriceTable(ctx context.Context, tenantContext tenant.Context, developmentID, priceTableID string, input ActivatePriceTableInput) (PriceTable, error) {
	if !canManage(tenantContext) {
		return PriceTable{}, tenant.ErrOrganizationAccessDenied
	}
	if !uuidPattern.MatchString(developmentID) || !uuidPattern.MatchString(priceTableID) {
		return PriceTable{}, ErrNotFound
	}
	if err := input.Validate(); err != nil {
		return PriceTable{}, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return PriceTable{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockDevelopment(ctx, tx, tenantContext.OrganizationID, developmentID); err != nil {
		return PriceTable{}, err
	}

	var currentStatus string
	var currentUpdatedAt time.Time
	err = tx.QueryRow(ctx, `
		select status, updated_at
		from public.property_development_price_tables
		where organization_id = $1::uuid
		  and development_id = $2::uuid
		  and id = $3::uuid
		for update
	`, tenantContext.OrganizationID, developmentID, priceTableID).Scan(&currentStatus, &currentUpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return PriceTable{}, ErrNotFound
	}
	if err != nil {
		return PriceTable{}, err
	}
	if currentStatus != "draft" && currentStatus != "approved" {
		return PriceTable{}, fmt.Errorf("%w: only draft or approved tables can be activated", ErrConflict)
	}
	if input.ExpectedUpdatedAt != nil {
		expected, _ := parseTimestamp(input.ExpectedUpdatedAt)
		if expected != nil && !currentUpdatedAt.Equal(*expected) {
			return PriceTable{}, ErrConflict
		}
	}
	var missingMarketablePrices int
	if err := tx.QueryRow(ctx, `
		select count(*)::integer
		from public.property_development_units as unit
		left join public.property_development_unit_prices as unit_price
		  on unit_price.organization_id = unit.organization_id
		 and unit_price.development_id = unit.development_id
		 and unit_price.unit_id = unit.id
		 and unit_price.price_table_id = $3::uuid
		where unit.organization_id = $1::uuid
		  and unit.development_id = $2::uuid
		  and unit.status in ('available', 'negotiation', 'reserved')
		  and unit_price.id is null
	`, tenantContext.OrganizationID, developmentID, priceTableID).Scan(&missingMarketablePrices); err != nil {
		return PriceTable{}, err
	}
	if missingMarketablePrices > 0 {
		return PriceTable{}, fmt.Errorf(
			"%w: price table is missing %d marketable units",
			ErrConflict,
			missingMarketablePrices,
		)
	}

	if _, err := tx.Exec(ctx, `
		update public.property_development_price_tables
		set status = 'expired',
		    valid_until = coalesce(
		      valid_until,
		      greatest(current_date, coalesce(valid_from, current_date))
		    ),
		    updated_by = $4::uuid,
		    updated_at = now()
		where organization_id = $1::uuid
		  and development_id = $2::uuid
		  and status = 'active'
		  and id <> $3::uuid
	`, tenantContext.OrganizationID, developmentID, priceTableID, tenantContext.UserID); err != nil {
		return PriceTable{}, normalizeDBError(err)
	}
	priceTable, err := scanJSON[PriceTable](tx.QueryRow(ctx, `
		update public.property_development_price_tables
		set status = 'active',
		    approved_by = coalesce(approved_by, $4::uuid),
		    approved_at = coalesce(approved_at, now()),
		    valid_from = coalesce(valid_from, current_date),
		    updated_by = $4::uuid,
		    updated_at = now()
		where organization_id = $1::uuid
		  and development_id = $2::uuid
		  and id = $3::uuid
		returning to_jsonb(property_development_price_tables)
	`, tenantContext.OrganizationID, developmentID, priceTableID, tenantContext.UserID))
	if err != nil {
		return PriceTable{}, normalizeDBError(err)
	}
	if _, err := tx.Exec(ctx, `
		update public.property_development_units as unit
		set published = true,
		    publication_pending = false,
		    updated_by = $4::uuid,
		    updated_at = now()
		where unit.organization_id = $1::uuid
		  and unit.development_id = $2::uuid
		  and unit.status in ('available', 'negotiation')
		  and unit.publication_pending
		  and exists (
		    select 1
		    from public.property_development_unit_prices as unit_price
		    where unit_price.organization_id = unit.organization_id
		      and unit_price.development_id = unit.development_id
		      and unit_price.unit_id = unit.id
		      and unit_price.price_table_id = $3::uuid
		  )
	`, tenantContext.OrganizationID, developmentID, priceTableID, tenantContext.UserID); err != nil {
		return PriceTable{}, normalizeDBError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return PriceTable{}, err
	}
	return priceTable, nil
}

func (repo Repository) resolveDeveloperTx(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, developerID, developerName *string) (*string, error) {
	if developerID != nil {
		var id string
		err := tx.QueryRow(ctx, `
			select id::text
			from public.property_developers
			where organization_id = $1::uuid and id = $2::uuid
		`, tenantContext.OrganizationID, *developerID).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: developer was not found", ErrInvalidInput)
		}
		return &id, err
	}
	if developerName == nil {
		return nil, nil
	}
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`, tenantContext.OrganizationID, "developer:"+strings.ToLower(*developerName)); err != nil {
		return nil, err
	}
	var id string
	err := tx.QueryRow(ctx, `
		select id::text
		from public.property_developers
		where organization_id = $1::uuid and lower(btrim(name)) = lower(btrim($2))
		limit 1
	`, tenantContext.OrganizationID, *developerName).Scan(&id)
	if err == nil {
		return &id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	err = tx.QueryRow(ctx, `
		insert into public.property_developers (
			organization_id, name, status, metadata, created_by, updated_by
		) values ($1::uuid, $2, 'active', '{}'::jsonb, $3::uuid, $3::uuid)
		returning id::text
	`, tenantContext.OrganizationID, *developerName, tenantContext.UserID).Scan(&id)
	return &id, err
}

func (repo Repository) ensureDraftPriceTableTx(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, developmentID string, requestedName *string) (PriceTable, error) {
	priceTable, err := scanJSON[PriceTable](tx.QueryRow(ctx, `
		select to_jsonb(price_table)
		from public.property_development_price_tables as price_table
		where price_table.organization_id = $1::uuid
		  and price_table.development_id = $2::uuid
		  and price_table.status = 'draft'
		order by price_table.version desc
		limit 1
		for update
	`, tenantContext.OrganizationID, developmentID))
	if err == nil {
		return priceTable, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return PriceTable{}, err
	}
	name := "Tabela inicial"
	if requestedName != nil {
		name = *requestedName
	}
	created, err := scanJSON[PriceTable](tx.QueryRow(ctx, `
		insert into public.property_development_price_tables (
			organization_id, development_id, name, version, status,
			currency, metadata, created_by, updated_by
		) values (
			$1::uuid,
			$2::uuid,
			$3,
			coalesce((
				select max(existing.version) + 1
				from public.property_development_price_tables as existing
				where existing.organization_id = $1::uuid
				  and existing.development_id = $2::uuid
			), 1),
			'draft',
			coalesce((
				select active_table.currency
				from public.property_development_price_tables as active_table
				where active_table.organization_id = $1::uuid
				  and active_table.development_id = $2::uuid
				  and active_table.status = 'active'
				order by active_table.version desc
				limit 1
			), 'BRL'),
			'{}'::jsonb,
			$4::uuid,
			$4::uuid
		)
		returning to_jsonb(property_development_price_tables)
	`, tenantContext.OrganizationID, developmentID, name, tenantContext.UserID))
	if err != nil {
		return PriceTable{}, err
	}

	// A new commercial version starts as a complete snapshot of the active
	// table. Callers can then change selected units without making the remaining
	// inventory lose its price when the draft is activated.
	if _, err := tx.Exec(ctx, `
		select set_config('vimob.property_development_price_clone', 'true', true)
	`); err != nil {
		return PriceTable{}, err
	}
	if _, err := tx.Exec(ctx, `
		insert into public.property_development_unit_prices (
			organization_id, development_id, price_table_id, unit_id,
			list_price, minimum_price, price_per_sqm, payment_terms,
			metadata, created_by, updated_by
		)
		select
			source.organization_id,
			source.development_id,
			$3::uuid,
			source.unit_id,
			source.list_price,
			source.minimum_price,
			source.price_per_sqm,
			source.payment_terms,
			source.metadata || jsonb_build_object(
				'cloned_from_price_table_id', source.price_table_id
			),
			$4::uuid,
			$4::uuid
		from public.property_development_unit_prices as source
		join public.property_development_price_tables as source_table
		  on source_table.id = source.price_table_id
		 and source_table.organization_id = source.organization_id
		 and source_table.development_id = source.development_id
		where source.organization_id = $1::uuid
		  and source.development_id = $2::uuid
		  and source_table.status = 'active'
	`, tenantContext.OrganizationID, developmentID, created.ID, tenantContext.UserID); err != nil {
		return PriceTable{}, err
	}
	if _, err := tx.Exec(ctx, `
		select set_config('vimob.property_development_price_clone', '', true)
	`); err != nil {
		return PriceTable{}, err
	}
	return created, nil
}

func (repo Repository) getUnitTx(ctx context.Context, tx pgx.Tx, organizationID, developmentID, unitID string) (Unit, error) {
	return scanJSON[Unit](tx.QueryRow(ctx, `
		select
			to_jsonb(unit)
			|| jsonb_build_object(
				'list_price', selected_price.list_price,
				'minimum_price', selected_price.minimum_price,
				'price_per_sqm', selected_price.price_per_sqm,
				'currency', selected_price.currency,
				'price_table_id', selected_price.price_table_id,
				'price_table_name', selected_price.price_table_name,
				'price_table_status', selected_price.price_table_status,
				'draft_list_price', draft_price.list_price,
				'draft_minimum_price', draft_price.minimum_price,
				'draft_price_per_sqm', draft_price.price_per_sqm,
				'draft_price_table_id', draft_price.price_table_id,
				'draft_price_table_name', draft_price.price_table_name,
				'draft_price_table_updated_at', draft_price.price_table_updated_at
			)
		from public.property_development_units as unit
		left join lateral (
			select
				unit_price.list_price,
				unit_price.minimum_price,
				unit_price.price_per_sqm,
				price_table.currency,
				price_table.id as price_table_id,
				price_table.name as price_table_name,
				price_table.status as price_table_status
			from public.property_development_unit_prices as unit_price
			join public.property_development_price_tables as price_table
			  on price_table.id = unit_price.price_table_id
			 and price_table.organization_id = unit_price.organization_id
			 and price_table.development_id = unit_price.development_id
			where unit_price.organization_id = unit.organization_id
			  and unit_price.development_id = unit.development_id
			  and unit_price.unit_id = unit.id
			  and price_table.status in ('active', 'approved', 'draft')
			order by
				case price_table.status when 'active' then 0 when 'approved' then 1 when 'draft' then 2 else 3 end,
				price_table.version desc
			limit 1
		) as selected_price on true
		left join lateral (
			select
				unit_price.list_price,
				unit_price.minimum_price,
				unit_price.price_per_sqm,
				price_table.id as price_table_id,
				price_table.name as price_table_name,
				price_table.updated_at as price_table_updated_at
			from public.property_development_unit_prices as unit_price
			join public.property_development_price_tables as price_table
			  on price_table.id = unit_price.price_table_id
			 and price_table.organization_id = unit_price.organization_id
			 and price_table.development_id = unit_price.development_id
			where unit_price.organization_id = unit.organization_id
			  and unit_price.development_id = unit.development_id
			  and unit_price.unit_id = unit.id
			  and price_table.status = 'draft'
			order by price_table.version desc
			limit 1
		) as draft_price on true
		where unit.organization_id = $1::uuid
		  and unit.development_id = $2::uuid
		  and unit.id = $3::uuid
	`, organizationID, developmentID, unitID))
}

func lockDevelopment(ctx context.Context, tx pgx.Tx, organizationID, developmentID string) error {
	var id string
	err := tx.QueryRow(ctx, `
		select id::text
		from public.property_developments
		where organization_id = $1::uuid and id = $2::uuid
		for update
	`, organizationID, developmentID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func scanJSON[T any](row scanner) (T, error) {
	var result T
	var raw []byte
	if err := row.Scan(&raw); err != nil {
		return result, err
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return result, err
	}
	return result, nil
}

func jsonValue(value any) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func normalizeDBError(err error) error {
	var pgError *pgconn.PgError
	if !errors.As(err, &pgError) {
		return err
	}
	switch pgError.Code {
	case "23505", "40001", "40P01":
		return fmt.Errorf("%w: %s", ErrConflict, pgError.ConstraintName)
	case "23503", "23514", "22P02", "22001", "22003", "22007", "22008":
		return fmt.Errorf("%w: %s", ErrInvalidInput, pgError.Message)
	default:
		return err
	}
}

func canManage(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission(permissions.PropertyManage)
}

func normalizeDevelopment(development *Development) {
	if development.ImageURLs == nil {
		development.ImageURLs = []string{}
	}
	if development.Amenities == nil {
		development.Amenities = []string{}
	}
	if development.Metadata == nil {
		development.Metadata = map[string]any{}
	}
}

func normalizeWorkspace(workspace *Workspace) {
	normalizeDevelopment(&workspace.Development)
	if workspace.Phases == nil {
		workspace.Phases = []Phase{}
	}
	if workspace.Buildings == nil {
		workspace.Buildings = []Building{}
	}
	if workspace.FloorPlans == nil {
		workspace.FloorPlans = []FloorPlan{}
	}
	if workspace.Units == nil {
		workspace.Units = []Unit{}
	}
	if workspace.PriceTables == nil {
		workspace.PriceTables = []PriceTable{}
	}
	if workspace.RecentUnitEvents == nil {
		workspace.RecentUnitEvents = []UnitEvent{}
	}
}

func redactUnitCommercialFields(unit *Unit) {
	if unit == nil {
		return
	}
	// Only active list pricing is part of the reader-facing inventory. An
	// approved/draft price is unpublished commercial work and must not become
	// visible merely because the caller can view properties.
	if unit.PriceTableStatus == nil || *unit.PriceTableStatus != "active" {
		unit.ListPrice = nil
		unit.PricePerSqm = nil
		unit.Currency = nil
		unit.PriceTableID = nil
		unit.PriceTableName = nil
		unit.PriceTableStatus = nil
	}
	unit.MinimumPrice = nil
	unit.DraftListPrice = nil
	unit.DraftMinimumPrice = nil
	unit.DraftPricePerSqm = nil
	unit.DraftPriceTableID = nil
	unit.DraftPriceTableName = nil
	unit.DraftPriceTableUpdatedAt = nil
}

func redactWorkspaceCommercialFields(workspace *Workspace) {
	if workspace == nil {
		return
	}
	for index := range workspace.Units {
		redactUnitCommercialFields(&workspace.Units[index])
	}

	visiblePriceTables := make([]PriceTable, 0, len(workspace.PriceTables))
	for _, priceTable := range workspace.PriceTables {
		if priceTable.Status != "active" {
			continue
		}
		priceTable.Notes = nil
		priceTable.ApprovedBy = nil
		priceTable.ApprovedAt = nil
		priceTable.Metadata = map[string]any{}
		visiblePriceTables = append(visiblePriceTables, priceTable)
	}
	workspace.PriceTables = visiblePriceTables

	for index := range workspace.RecentUnitEvents {
		event := &workspace.RecentUnitEvents[index]
		if event.EventType == "reservation_cancelled" {
			delete(event.Metadata, "reason")
		}
		if event.EventType != "price_changed" {
			continue
		}
		event.BeforeData = nil
		event.AfterData = nil
		event.Metadata = map[string]any{}
	}
}

func (repo Repository) getWorkspaceSummary(ctx context.Context, organizationID, developmentID string, workspace Workspace) (WorkspaceSummary, error) {
	counts := InventoryCounts{}
	priceRange := PriceRange{}
	hasCoverage := false
	err := repo.db.Pool().QueryRow(ctx, `
		with active_table as (
			select id, currency
			from public.property_development_price_tables
			where organization_id = $1::uuid
			  and development_id = $2::uuid
			  and status = 'active'
			limit 1
		)
		select
			count(*)::integer,
			count(*) filter (where unit.status = 'available')::integer,
			count(*) filter (where unit.status = 'negotiation')::integer,
			count(*) filter (where unit.status = 'reserved')::integer,
			count(*) filter (where unit.status = 'sold')::integer,
			count(*) filter (where unit.status = 'blocked')::integer,
			count(*) filter (where unit.status = 'unavailable')::integer,
			count(*) filter (where unit.status = 'withdrawn')::integer,
			(min(unit_price.list_price) filter (
				where unit.status = 'available' and unit.published
			))::float8,
			(max(unit_price.list_price) filter (
				where unit.status = 'available' and unit.published
			))::float8,
			(select currency from active_table),
			count(*) filter (
				where unit.status in ('available', 'negotiation', 'reserved')
				  and unit_price.id is null
			) = 0
		from public.property_development_units as unit
		left join active_table on true
		left join public.property_development_unit_prices as unit_price
		  on unit_price.organization_id = unit.organization_id
		 and unit_price.development_id = unit.development_id
		 and unit_price.unit_id = unit.id
		 and unit_price.price_table_id = active_table.id
		where unit.organization_id = $1::uuid
		  and unit.development_id = $2::uuid
	`, organizationID, developmentID).Scan(
		&counts.Total,
		&counts.Available,
		&counts.Negotiation,
		&counts.Reserved,
		&counts.Sold,
		&counts.Blocked,
		&counts.Unavailable,
		&counts.Withdrawn,
		&priceRange.Minimum,
		&priceRange.Maximum,
		&priceRange.Currency,
		&hasCoverage,
	)
	if err != nil {
		return WorkspaceSummary{}, err
	}
	return buildWorkspaceSummary(workspace, counts, priceRange, hasCoverage), nil
}

func buildWorkspaceSummary(workspace Workspace, counts InventoryCounts, priceRange PriceRange, hasCoverage bool) WorkspaceSummary {
	checks := []ChecklistItem{
		{Code: "identity", Label: "Nome e código comercial", Resolved: workspace.Development.Name != "" && workspace.Development.Code != ""},
		{Code: "location", Label: "Cidade e bairro", Resolved: workspace.Development.City != nil && workspace.Development.Neighborhood != nil},
		{Code: "description", Label: "Resumo ou descrição", Resolved: workspace.Development.Summary != nil || workspace.Development.Description != nil},
		{Code: "media", Label: "Imagem principal ou galeria", Resolved: workspace.Development.MainImageURL != nil || len(workspace.Development.ImageURLs) > 0},
		{Code: "structure", Label: "Fase e torre, bloco ou quadra", Resolved: len(workspace.Phases) > 0 && len(workspace.Buildings) > 0},
		{Code: "floor_plan", Label: "Ao menos uma planta", Resolved: len(workspace.FloorPlans) > 0},
		{Code: "inventory", Label: "Estoque cadastrado e disponível", Resolved: counts.Total > 0 && counts.Available > 0},
		{Code: "commercial", Label: "Tabela comercial ativa e com cobertura", Resolved: hasActivePriceTable(workspace.PriceTables) && hasCoverage},
	}
	resolved := 0
	for _, check := range checks {
		if check.Resolved {
			resolved++
		}
	}
	score := resolved * 100 / len(checks)
	return WorkspaceSummary{
		Phases: len(workspace.Phases), Buildings: len(workspace.Buildings),
		FloorPlans: len(workspace.FloorPlans), Inventory: counts,
		PriceRange:        priceRange,
		CompletenessScore: score, PublicationReady: score == 100, Checklist: checks,
	}
}

func hasActivePriceTable(priceTables []PriceTable) bool {
	for _, priceTable := range priceTables {
		if priceTable.Status == "active" {
			return true
		}
	}
	return false
}

func normalizeSearch(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer(
		"á", "a", "à", "a", "â", "a", "ã", "a", "ä", "a",
		"é", "e", "è", "e", "ê", "e", "ë", "e",
		"í", "i", "ì", "i", "î", "i", "ï", "i",
		"ó", "o", "ò", "o", "ô", "o", "õ", "o", "ö", "o",
		"ú", "u", "ù", "u", "û", "u", "ü", "u", "ç", "c",
	)
	return replacer.Replace(value)
}

const workspaceSQL = `
	select jsonb_build_object(
		'development',
			to_jsonb(development)
			|| jsonb_build_object(
				'developer', case
					when developer.id is null then null
					else jsonb_build_object(
						'id', developer.id,
						'name', developer.name,
						'legal_name', developer.legal_name,
						'logo_url', developer.logo_url,
						'status', developer.status
					)
				end
			),
		'phases', coalesce((
			select jsonb_agg(to_jsonb(phase) order by phase.sort_order, phase.name, phase.id)
			from public.property_development_phases as phase
			where phase.organization_id = development.organization_id
			  and phase.development_id = development.id
		), '[]'::jsonb),
		'buildings', coalesce((
			select jsonb_agg(
				to_jsonb(building)
				|| jsonb_build_object(
					'unit_count', (
						select count(*)::integer
						from public.property_development_units as unit
						where unit.organization_id = building.organization_id
						  and unit.development_id = building.development_id
						  and unit.building_id = building.id
					)
				)
				order by building.sort_order, building.name, building.id
			)
			from public.property_development_buildings as building
			where building.organization_id = development.organization_id
			  and building.development_id = development.id
		), '[]'::jsonb),
		'floor_plans', coalesce((
			select jsonb_agg(
				to_jsonb(floor_plan)
				|| jsonb_build_object(
					'unit_count', (
						select count(*)::integer
						from public.property_development_units as unit
						where unit.organization_id = floor_plan.organization_id
						  and unit.development_id = floor_plan.development_id
						  and unit.floor_plan_id = floor_plan.id
					)
				)
				order by floor_plan.name, floor_plan.id
			)
			from public.property_development_floor_plans as floor_plan
			where floor_plan.organization_id = development.organization_id
			  and floor_plan.development_id = development.id
		), '[]'::jsonb),
		'units', '[]'::jsonb,
		'price_tables', coalesce((
			select jsonb_agg(
				(case
					when $3::boolean then to_jsonb(price_table)
					else (
						to_jsonb(price_table)
						- 'notes'
						- 'approved_by'
						- 'approved_at'
						- 'metadata'
					) || jsonb_build_object('metadata', '{}'::jsonb)
				end)
				|| jsonb_build_object(
					'priced_unit_count', price_stats.priced_unit_count,
					'minimum_list_price', price_stats.minimum_list_price,
					'maximum_list_price', price_stats.maximum_list_price
				)
				order by price_table.version desc, price_table.id
			)
			from public.property_development_price_tables as price_table
			left join lateral (
				select
					count(*)::integer as priced_unit_count,
					min(unit_price.list_price)::float8 as minimum_list_price,
					max(unit_price.list_price)::float8 as maximum_list_price
				from public.property_development_unit_prices as unit_price
				where unit_price.organization_id = price_table.organization_id
				  and unit_price.development_id = price_table.development_id
				  and unit_price.price_table_id = price_table.id
			) as price_stats on true
			where price_table.organization_id = development.organization_id
			  and price_table.development_id = development.id
			  and (
				price_table.status = 'active'
				or (
				  $3::boolean
				  and price_table.id = (
					select candidate.id
					from public.property_development_price_tables as candidate
					where candidate.organization_id = development.organization_id
					  and candidate.development_id = development.id
					  and candidate.status in ('draft', 'approved')
					order by candidate.version desc, candidate.id desc
					limit 1
				  )
				)
			  )
		), '[]'::jsonb),
		'recent_unit_events', coalesce((
			select jsonb_agg(
				case
					when not $3::boolean and event.event_type = 'price_changed' then
						(
							to_jsonb(event)
							- 'before_data'
							- 'after_data'
							- 'metadata'
						) || jsonb_build_object('metadata', '{}'::jsonb)
					when not $3::boolean and event.event_type = 'reservation_cancelled' then
						(to_jsonb(event) - 'metadata')
						|| jsonb_build_object('metadata', event.metadata - 'reason')
					else to_jsonb(event)
				end
				order by event.created_at desc, event.id desc
			)
			from (
				select unit_event.*
				from public.property_development_unit_events as unit_event
				where unit_event.organization_id = development.organization_id
				  and unit_event.development_id = development.id
				order by unit_event.created_at desc, unit_event.id desc
				limit 100
			) as event
		), '[]'::jsonb),
		'summary', '{}'::jsonb
	)
	from public.property_developments as development
	left join public.property_developers as developer
	  on developer.id = development.developer_id
	 and developer.organization_id = development.organization_id
	where development.organization_id = $1::uuid
	  and development.id = $2::uuid
`
