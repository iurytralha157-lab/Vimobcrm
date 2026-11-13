package leads

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func acceptAutomationCommandEffect(ctx context.Context, tx pgx.Tx, input automationStageCommand, binding automationStageBinding, action string) (string, *automationStageResponse, error) {
	var effectID string
	err := tx.QueryRow(ctx, `insert into public.automation_effect_dispatches(organization_id,execution_id,node_key,effect_key,effect_type,status,request)
 values($1::uuid,$2::uuid,$3,$4,$5,'sending',$6::jsonb) on conflict(effect_key) do nothing returning id::text`, input.OrganizationID, input.ExecutionID, input.NodeKey, input.EffectKey, action, jsonb(binding)).Scan(&effectID)
	if err == nil {
		return effectID, nil, nil
	}
	if err != pgx.ErrNoRows {
		return "", nil, err
	}
	cached, err := lookupAutomationCommandEffect(ctx, tx, input, binding, action)
	if err != nil {
		return "", nil, err
	}
	if cached == nil {
		return "", nil, commandError("automation_effect_conflict", 409)
	}
	return cached.EffectID, cached, nil
}

func lookupAutomationCommandEffect(ctx context.Context, tx pgx.Tx, input automationStageCommand, binding automationStageBinding, action string) (*automationStageResponse, error) {
	var effectID string
	var status string
	var matches bool
	var response []byte
	err := tx.QueryRow(ctx, `select id::text,status,response,
 organization_id=$2::uuid and execution_id=$3::uuid and node_key=$4 and effect_type=$5 and request=$6::jsonb
 from public.automation_effect_dispatches where effect_key=$1 for update`, input.EffectKey, input.OrganizationID, input.ExecutionID, input.NodeKey, action, jsonb(binding)).Scan(&effectID, &status, &response, &matches)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !matches || status != "succeeded" {
		return nil, commandError("automation_effect_conflict", 409)
	}
	return &automationStageResponse{true, "succeeded", effectID, json.RawMessage(response)}, nil
}

func completeAutomationStageEffect(ctx context.Context, tx pgx.Tx, input automationStageCommand, effectID, response string, actor tenant.Context, result moveStageResult) error {
	if err := completeAutomationCommandEffect(ctx, tx, input, effectID, response); err != nil {
		return err
	}
	if !result.StageChanged {
		return nil
	}
	// Durable feed append belongs to the same transaction, so a process failure
	// after COMMIT cannot lose the UI refresh or publish it again on retry.
	_, err := tx.Exec(ctx, `insert into private.realtime_events(organization_id,user_id,event_type,data,created_at)
 values($1::uuid,$2::uuid,'lead.stage_moved',$3::jsonb,now())`, input.OrganizationID, actor.UserID, jsonb(map[string]any{
		"leadId": result.Lead.ID, "pipelineId": result.Lead.PipelineID, "stageId": result.Lead.StageID, "origin": "automation", "executionId": input.ExecutionID,
	}))
	return err
}

func completeAutomationCommandEffect(ctx context.Context, tx pgx.Tx, input automationStageCommand, effectID, response string) error {
	command, err := tx.Exec(ctx, `update public.automation_effect_dispatches set status='succeeded',response=$5::jsonb,completed_at=now(),error_message=null
 where id=$1::uuid and organization_id=$2::uuid and execution_id=$3::uuid and effect_key=$4 and status='sending'`, effectID, input.OrganizationID, input.ExecutionID, input.EffectKey, response)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return commandError("automation_effect_conflict", 409)
	}
	return nil
}
