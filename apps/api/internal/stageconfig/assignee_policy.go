package stageconfig

import (
	"context"
	"fmt"
)

// The stage row is locked by callers before this check, serializing creation
// and activation across API replicas without rewriting existing configurations.
func (repo Repository) validateSingleAssigneeAutomation(ctx context.Context, tx automationPolicyQueryer, organizationID, stageID, excludeID string, hasConfigSchema bool) error {
	typeExpression := "coalesce(automation_type, action_type, '')"
	if hasConfigSchema {
		typeExpression = "coalesce(config->>'automation_type', config->>'action_type', '')"
	}
	var excludeArg any
	if excludeID != "" {
		excludeArg = excludeID
	}
	var count int
	if err := tx.QueryRow(ctx, `
		select count(*) from public.stage_automations
		where organization_id = $1::uuid and stage_id = $2::uuid
		  and ($3::uuid is null or id <> $3::uuid)
		  and coalesce(is_active, false) = true
		  and `+typeExpression+` = 'change_assignee_on_enter'
	`, organizationID, stageID, excludeArg).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("%w: desative a outra automação de responsável antes de ativar ou salvar esta", ErrInvalidInput)
	}
	return nil
}
