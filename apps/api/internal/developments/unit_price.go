package developments

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) UpdateUnitPrice(
	ctx context.Context,
	tenantContext tenant.Context,
	developmentID string,
	unitID string,
	input UpdateUnitPriceInput,
) (UpdateUnitPriceResult, error) {
	if !canManage(tenantContext) {
		return UpdateUnitPriceResult{}, tenant.ErrOrganizationAccessDenied
	}
	developmentID = strings.TrimSpace(developmentID)
	unitID = strings.TrimSpace(unitID)
	if !uuidPattern.MatchString(developmentID) || !uuidPattern.MatchString(unitID) {
		return UpdateUnitPriceResult{}, ErrNotFound
	}
	if err := input.Validate(); err != nil {
		return UpdateUnitPriceResult{}, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return UpdateUnitPriceResult{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockDevelopment(ctx, tx, tenantContext.OrganizationID, developmentID); err != nil {
		return UpdateUnitPriceResult{}, err
	}

	var unitExists bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.property_development_units
			where organization_id = $1::uuid
			  and development_id = $2::uuid
			  and id = $3::uuid
		)
	`, tenantContext.OrganizationID, developmentID, unitID).Scan(&unitExists); err != nil {
		return UpdateUnitPriceResult{}, err
	}
	if !unitExists {
		return UpdateUnitPriceResult{}, ErrNotFound
	}

	var currentPriceTableID string
	var currentPriceTableUpdatedAt time.Time
	currentPriceErr := tx.QueryRow(ctx, `
		select price_table.id::text, price_table.updated_at
		from public.property_development_price_tables as price_table
		where price_table.organization_id = $1::uuid
		  and price_table.development_id = $2::uuid
		  and price_table.status in ('draft', 'active')
		order by
			case price_table.status when 'draft' then 0 else 1 end,
			price_table.version desc
		limit 1
		for update of price_table
	`, tenantContext.OrganizationID, developmentID).Scan(
		&currentPriceTableID,
		&currentPriceTableUpdatedAt,
	)
	if currentPriceErr != nil && !errors.Is(currentPriceErr, pgx.ErrNoRows) {
		return UpdateUnitPriceResult{}, currentPriceErr
	}
	if currentPriceErr == nil {
		if input.ExpectedPriceTableID == nil || input.ExpectedPriceTableUpdatedAt == nil {
			return UpdateUnitPriceResult{}, fmt.Errorf("%w: current price table preconditions are required", ErrInvalidInput)
		}
		expectedUpdatedAt, _ := time.Parse(time.RFC3339Nano, *input.ExpectedPriceTableUpdatedAt)
		if currentPriceTableID != *input.ExpectedPriceTableID || !currentPriceTableUpdatedAt.Equal(expectedUpdatedAt) {
			return UpdateUnitPriceResult{}, fmt.Errorf("%w: price table changed", ErrConflict)
		}
	} else if input.ExpectedPriceTableID != nil || input.ExpectedPriceTableUpdatedAt != nil {
		return UpdateUnitPriceResult{}, fmt.Errorf("%w: unit does not have the expected price table", ErrConflict)
	}

	priceTable, err := repo.ensureDraftPriceTableTx(ctx, tx, tenantContext, developmentID, nil)
	if err != nil {
		return UpdateUnitPriceResult{}, normalizeDBError(err)
	}
	var paymentTerms any
	if input.PaymentTerms != nil {
		paymentTerms = jsonValue(input.PaymentTerms)
	}
	if _, err := tx.Exec(ctx, `
		insert into public.property_development_unit_prices (
			organization_id,
			development_id,
			price_table_id,
			unit_id,
			list_price,
			minimum_price,
			price_per_sqm,
			payment_terms,
			metadata,
			created_by,
			updated_by
		)
		select
			unit.organization_id,
			unit.development_id,
			$4::uuid,
			unit.id,
			$5::numeric,
			$6::numeric,
			case
				when coalesce(unit.private_area, floor_plan.private_area) > 0
				  then round($5::numeric / coalesce(unit.private_area, floor_plan.private_area), 2)
			end,
			coalesce($7::jsonb, '{}'::jsonb),
			'{}'::jsonb,
			$8::uuid,
			$8::uuid
		from public.property_development_units as unit
		left join public.property_development_floor_plans as floor_plan
		  on floor_plan.organization_id = unit.organization_id
		 and floor_plan.development_id = unit.development_id
		 and floor_plan.id = unit.floor_plan_id
		where unit.organization_id = $1::uuid
		  and unit.development_id = $2::uuid
		  and unit.id = $3::uuid
		on conflict (price_table_id, unit_id) do update
		set list_price = excluded.list_price,
		    minimum_price = excluded.minimum_price,
		    price_per_sqm = excluded.price_per_sqm,
		    payment_terms = coalesce($7::jsonb, property_development_unit_prices.payment_terms),
		    updated_by = $8::uuid,
		    updated_at = now()
	`, tenantContext.OrganizationID, developmentID, unitID, priceTable.ID,
		input.ListPrice, input.MinimumPrice, paymentTerms, tenantContext.UserID); err != nil {
		return UpdateUnitPriceResult{}, normalizeDBError(err)
	}

	priceTable, err = scanJSON[PriceTable](tx.QueryRow(ctx, `
		update public.property_development_price_tables
		set updated_by = $4::uuid,
		    updated_at = now()
		where organization_id = $1::uuid
		  and development_id = $2::uuid
		  and id = $3::uuid
		  and status = 'draft'
		returning to_jsonb(property_development_price_tables)
	`, tenantContext.OrganizationID, developmentID, priceTable.ID, tenantContext.UserID))
	if err != nil {
		return UpdateUnitPriceResult{}, normalizeDBError(err)
	}
	unit, err := repo.getUnitTx(ctx, tx, tenantContext.OrganizationID, developmentID, unitID)
	if err != nil {
		return UpdateUnitPriceResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return UpdateUnitPriceResult{}, err
	}
	return UpdateUnitPriceResult{Unit: unit, PriceTable: priceTable}, nil
}
