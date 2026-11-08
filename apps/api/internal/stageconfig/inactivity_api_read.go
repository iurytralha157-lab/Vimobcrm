package stageconfig

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// WithStageInactivityRuntime ties activation to the explicit server worker gate.
// Existing constructors remain disabled until the caller supplies this option.
func (repo Repository) WithStageInactivityRuntime(enabled bool) Repository {
	repo.inactivityRuntimeEnabled = enabled
	return repo
}

func (repo Repository) InactivityRuntimeAvailable(ctx context.Context) (bool, error) {
	if !repo.inactivityRuntimeEnabled {
		return false, nil
	}
	if err := repo.VerifyStageInactivityRuntime(ctx); errors.Is(err, ErrInactivityRuntimeNotReady) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	return true, nil
}

func (repo Repository) attachInactivityPolicies(ctx context.Context, organizationID string, automations []StageAutomation) error {
	if len(automations) == 0 {
		return nil
	}
	available, err := repo.InactivityRuntimeAvailable(ctx)
	if err != nil {
		return err
	}
	ids, byID := []string{}, map[string]int{}
	for index := range automations {
		automations[index].InactivityRuntimeAvailable = available
		ids = append(ids, automations[index].ID)
		byID[automations[index].ID] = index
	}
	var hasPolicies bool
	// The action columns arrive with a later migration; without them, list the
	// automations without policy details rather than failing the whole sheet.
	if err := repo.db.Pool().QueryRow(ctx, `select exists (select 1 from pg_catalog.pg_attribute attribute
 where attribute.attrelid=to_regclass('private.stage_inactivity_policies')
   and attribute.attname='action_kind' and not attribute.attisdropped)`).Scan(&hasPolicies); err != nil || !hasPolicies {
		return err
	}
	rows, err := repo.db.Pool().Query(ctx, inactivityPolicyViewsSQL, organizationID, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var policy StageInactivityPolicy
		var effective bool
		if err := rows.Scan(append(inactivityPolicyDestinations(&policy), &effective)...); err != nil {
			return err
		}
		if index, ok := byID[policy.AutomationID]; ok {
			automations[index].InactivityPolicy = inactivityPolicyView(policy, effective, available)
		}
	}
	return rows.Err()
}

func readInactivityPolicyForUpdate(ctx context.Context, tx pgx.Tx, organizationID, automationID string) (*StageInactivityPolicy, error) {
	var policy StageInactivityPolicy
	err := tx.QueryRow(ctx, `select `+inactivityPolicyFields+` from private.stage_inactivity_policies policy
 where organization_id=$1::uuid and automation_id=$2::uuid for update`, organizationID, automationID).Scan(inactivityPolicyDestinations(&policy)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &policy, nil
}

const inactivityPolicyViewsSQL = `select ` + inactivityPolicyFields + `,
 coalesce((policy.automation_updated_at=automation.updated_at and automation.is_active=true
  and automation.trigger_type='inactivity' and stage.is_active=true
  and pipeline.is_active=true and coalesce(organization.is_active,true)=true
  and exists (select 1 from public.organization_modules module
    where module.organization_id=policy.organization_id
    and lower(trim(module.module_name))='automations' and module.is_enabled=true)),false)
 from private.stage_inactivity_policies policy
 join public.stage_automations automation on automation.id=policy.automation_id
  and automation.organization_id=policy.organization_id and automation.stage_id=policy.stage_id
 join public.stages stage on stage.id=policy.stage_id and stage.organization_id=policy.organization_id
 join public.pipelines pipeline on pipeline.id=stage.pipeline_id and pipeline.organization_id=policy.organization_id
 join public.organizations organization on organization.id=policy.organization_id
 where policy.organization_id=$1::uuid and policy.automation_id=any($2::uuid[])`
