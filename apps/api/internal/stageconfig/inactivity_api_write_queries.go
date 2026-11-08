package stageconfig

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func lockInactivityWriteScope(ctx context.Context, tx pgx.Tx, organizationID, stageID string) error {
	var pipelineID string
	err := tx.QueryRow(ctx, `select pipeline_id::text from public.stages
 where organization_id=$1::uuid and id=$2::uuid`, organizationID, stageID).Scan(&pipelineID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	for _, lock := range []struct {
		query string
		args  []any
	}{
		{`select id::text from public.organizations where id=$1::uuid and coalesce(is_active,true)=true for share`, []any{organizationID}},
		{`select id::text from public.pipelines where organization_id=$1::uuid and id=$2::uuid and is_active=true for share`, []any{organizationID, pipelineID}},
		{`select id::text from public.stages where organization_id=$1::uuid and id=$2::uuid and pipeline_id=$3::uuid and is_active=true for update`, []any{organizationID, stageID, pipelineID}},
	} {
		var id string
		if err := tx.QueryRow(ctx, lock.query, lock.args...).Scan(&id); errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
	}
	return nil
}

func lockInactivityWriteModule(ctx context.Context, tx pgx.Tx, organizationID string) error {
	rows, err := tx.Query(ctx, `select coalesce(is_enabled,false) from public.organization_modules
 where organization_id=$1::uuid and lower(trim(module_name))='automations' for share`, organizationID)
	if err != nil {
		return err
	}
	defer rows.Close()
	enabled := false
	for rows.Next() {
		var rowEnabled bool
		if err := rows.Scan(&rowEnabled); err != nil {
			return err
		}
		enabled = enabled || rowEnabled
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if !enabled {
		return tenant.ErrOrganizationAccessDenied
	}
	return nil
}

func writeInactivityAutomation(ctx context.Context, tx pgx.Tx, organizationID, stageID, automationID string, input stageInactivityInput, hasConfig bool) (StageAutomation, error) {
	automationType := inactivityAutomationType(input.Action)
	var targetStageID any
	if input.Action == InactivityActionMoveStage {
		targetStageID = input.TargetStageID
	}
	config := map[string]any{
		"automation_type": automationType, "action_type": automationType,
		"trigger_days": input.Days, "alert_message": input.Message, "action_config": map[string]any{},
		"target_stage_id": targetStageID,
	}
	if hasConfig {
		if automationID == "" {
			return scanStageAutomation(tx.QueryRow(ctx, `insert into public.stage_automations
 (organization_id,stage_id,trigger_type,config,is_active)
 values ($1::uuid,$2::uuid,'inactivity',$3::jsonb,$4) returning `+stageAutomationSelectFields(true), organizationID, stageID, jsonb(config), input.Enabled))
		}
		return scanStageAutomation(tx.QueryRow(ctx, `update public.stage_automations
 set config=coalesce(config,'{}'::jsonb)||($3::jsonb-'action_config'),is_active=$4,
 updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
 where organization_id=$1::uuid and id=$2::uuid returning `+stageAutomationSelectFields(true), organizationID, automationID, jsonb(config), input.Enabled))
	}
	if automationID == "" {
		return scanStageAutomation(tx.QueryRow(ctx, `insert into public.stage_automations
 (organization_id,stage_id,trigger_type,action_type,automation_type,action_config,trigger_days,alert_message,is_active,target_stage_id)
 values ($1::uuid,$2::uuid,'inactivity',$6,$6,'{}'::jsonb,$3,$4,$5,$7::uuid)
 returning `+stageAutomationSelectFields(false), organizationID, stageID, input.Days, input.Message, input.Enabled, automationType, targetStageID))
	}
	return scanStageAutomation(tx.QueryRow(ctx, `update public.stage_automations
 set action_type=$6,automation_type=$6,
 trigger_days=$3,alert_message=$4,is_active=$5,target_stage_id=$7::uuid,
 updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
 where organization_id=$1::uuid and id=$2::uuid returning `+stageAutomationSelectFields(false), organizationID, automationID, input.Days, input.Message, input.Enabled, automationType, targetStageID))
}

func writeInactivityPolicy(ctx context.Context, tx pgx.Tx, policy StageInactivityPolicy) error {
	actionKind := policy.ActionKind
	if actionKind == "" {
		actionKind = InactivityActionNotify
	}
	result, err := tx.Exec(ctx, `insert into private.stage_inactivity_policies (
 automation_id,organization_id,stage_id,activation_epoch,revision,clock,start_mode,activated_at,
 automation_updated_at,interaction_coverage_from,duration_days,alert_message,is_enabled,
 action_kind,target_stage_id,acting_user_id,target_round_robin_id)
 values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::uuid,$16::uuid,$17::uuid)
 on conflict (automation_id) do update set activation_epoch=excluded.activation_epoch,
 revision=excluded.revision,clock=excluded.clock,start_mode=excluded.start_mode,activated_at=excluded.activated_at,
 automation_updated_at=excluded.automation_updated_at,interaction_coverage_from=excluded.interaction_coverage_from,
 duration_days=excluded.duration_days,alert_message=excluded.alert_message,is_enabled=excluded.is_enabled,
 action_kind=excluded.action_kind,target_stage_id=excluded.target_stage_id,acting_user_id=excluded.acting_user_id,
 target_round_robin_id=excluded.target_round_robin_id,
 scan_after_lead_id=null,next_scan_at=clock_timestamp(),updated_at=clock_timestamp()
 where stage_inactivity_policies.organization_id=excluded.organization_id
 and stage_inactivity_policies.stage_id=excluded.stage_id
 and stage_inactivity_policies.action_kind=excluded.action_kind`, policy.AutomationID, policy.OrganizationID, policy.StageID,
		policy.Epoch, policy.Revision, policy.Clock, policy.StartMode, policy.ActivatedAt,
		policy.AutomationUpdatedAt, policy.InteractionCoverageFrom, policy.Days, policy.Message, policy.Enabled,
		actionKind, policy.TargetStageID, policy.ActingUserID, policy.TargetRoundRobinID)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrInactivityConfigurationChanged
	}
	return nil
}
