package settings

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/jsonvalue"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func stageManagedPlanChange(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	currentPlanID string,
	targetPlanID string,
	providerSubscriptionID string,
	billingPeriodMonths int,
	amount float64,
	cycle string,
	description string,
	pendingPlanID string,
) (string, bool, bool, error) {
	var existingID, existingTargetPlanID, existingProviderID, existingStatus string
	var existingPeriod int
	var existingAmount float64
	err := tx.QueryRow(ctx, `
		select
			change.id::text,
			change.target_plan_id::text,
			change.provider_subscription_id,
			change.billing_period_months,
			change.amount::double precision,
			change.status
		from private.billing_plan_changes change
		where change.organization_id = $1::uuid
		  and change.status in ('provider_updating', 'scheduled')
		order by change.created_at desc, change.id desc
		limit 1
		for update
	`, tenantContext.OrganizationID).Scan(
		&existingID,
		&existingTargetPlanID,
		&existingProviderID,
		&existingPeriod,
		&existingAmount,
		&existingStatus,
	)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", false, false, err
	}
	if err == nil {
		sameRequest := sameManagedPlanChange(
			existingTargetPlanID,
			existingProviderID,
			existingPeriod,
			existingAmount,
			targetPlanID,
			providerSubscriptionID,
			billingPeriodMonths,
			amount,
		)
		if !sameRequest {
			return "", false, false, ErrPlanChangeInProgress
		}
		alreadyScheduled := strings.EqualFold(existingStatus, "scheduled")
		return existingID, alreadyScheduled, !alreadyScheduled, nil
	}

	if strings.TrimSpace(pendingPlanID) != "" && !strings.EqualFold(pendingPlanID, targetPlanID) {
		return "", false, false, ErrPlanChangeInProgress
	}

	var changeID string
	err = tx.QueryRow(ctx, `
		insert into private.billing_plan_changes (
			organization_id,
			from_plan_id,
			target_plan_id,
			requested_by,
			provider_subscription_id,
			billing_period_months,
			amount,
			provider_cycle,
			description,
			status,
			provider_request_started_at
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			nullif($4, '')::uuid,
			$5,
			$6,
			$7::numeric,
			$8,
			$9,
			'provider_updating',
			now()
		)
		returning id::text
	`,
		tenantContext.OrganizationID,
		currentPlanID,
		targetPlanID,
		tenantContext.UserID,
		providerSubscriptionID,
		billingPeriodMonths,
		amount,
		cycle,
		description,
	).Scan(&changeID)
	if err != nil {
		if isUniqueViolation(err) {
			return "", false, false, ErrPlanChangeInProgress
		}
		return "", false, false, err
	}

	if _, err := tx.Exec(ctx, `
		update public.organizations
		set pending_plan_id = $2::uuid,
		    updated_at = now()
		where id = $1::uuid
	`, tenantContext.OrganizationID, targetPlanID); err != nil {
		return "", false, false, err
	}

	return changeID, false, false, nil
}

func sameManagedPlanChange(
	existingTargetPlanID string,
	existingProviderID string,
	existingPeriod int,
	existingAmount float64,
	targetPlanID string,
	providerSubscriptionID string,
	billingPeriodMonths int,
	amount float64,
) bool {
	return strings.EqualFold(existingTargetPlanID, targetPlanID) &&
		strings.EqualFold(existingProviderID, providerSubscriptionID) &&
		existingPeriod == billingPeriodMonths &&
		math.Abs(existingAmount-amount) < 0.005
}

func (repo Repository) markManagedPlanChangeAmbiguous(ctx context.Context, changeID string) error {
	_, err := repo.db.Pool().Exec(ctx, `
		update private.billing_plan_changes
		set
			last_error = 'provider response ambiguous; retry will read provider state first',
			updated_at = now()
		where id = $1::uuid
		  and status = 'provider_updating'
	`, changeID)
	return err
}

func (repo Repository) confirmManagedPlanChange(
	ctx context.Context,
	changeID string,
	providerResponse json.RawMessage,
	effectiveOn string,
) error {
	tag, err := repo.db.Pool().Exec(ctx, `
		update private.billing_plan_changes
		set
			status = 'scheduled',
			provider_response = $2::jsonb,
			provider_updated_at = now(),
			effective_on = $3::date,
			last_error = null,
			updated_at = now()
		where id = $1::uuid
		  and status = 'provider_updating'
	`, changeID, providerResponse, effectiveOn)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var status string
		if readErr := repo.db.Pool().QueryRow(ctx, `
			select status
			from private.billing_plan_changes
			where id = $1::uuid
		`, changeID).Scan(&status); readErr == nil && strings.EqualFold(status, "scheduled") {
			return nil
		}
		return ErrAsaasAmbiguous
	}
	return nil
}

func (repo Repository) failManagedPlanChange(
	ctx context.Context,
	organizationID string,
	changeID string,
	targetPlanID string,
) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		update private.billing_plan_changes
		set
			status = 'failed',
			failed_at = now(),
			last_error = 'provider rejected subscription update',
			updated_at = now()
		where id = $1::uuid
		  and status = 'provider_updating'
	`, changeID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		update public.organizations organization_row
		set pending_plan_id = null,
		    updated_at = now()
		where organization_row.id = $1::uuid
		  and organization_row.pending_plan_id = $2::uuid
		  and not exists (
			select 1
			from private.billing_plan_changes active_change
			where active_change.organization_id = organization_row.id
			  and active_change.status in ('provider_updating', 'scheduled')
		  )
	`, organizationID, targetPlanID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (repo Repository) getActiveBillingPlanChange(ctx context.Context, organizationID string) (map[string]any, error) {
	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		select jsonb_build_object(
			'id', change.id::text,
			'from_plan_id', change.from_plan_id::text,
			'target_plan_id', change.target_plan_id::text,
			'status', change.status,
			'billing_period_months', change.billing_period_months,
			'amount', change.amount,
			'effective_on', change.effective_on,
			'requested_at', change.created_at,
			'provider_updated_at', change.provider_updated_at
		)
		from private.billing_plan_changes change
		where change.organization_id = $1::uuid
		  and change.status in ('provider_updating', 'scheduled')
		order by change.created_at desc, change.id desc
		limit 1
	`, organizationID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) || isUndefinedTableError(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return jsonvalue.DecodeObject(raw)
}

func decodeNullableJSONObject(raw []byte) (map[string]any, error) {
	if strings.TrimSpace(string(raw)) == "null" || len(raw) == 0 {
		return nil, nil
	}
	return jsonvalue.DecodeObject(raw)
}
