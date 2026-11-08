package stageconfig

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// validateInactivityMoveRule runs inside the save transaction, after the
// source stage is locked. It locks the destination and serializes move-rule
// writes per organization, so two editors cannot build A→B and B→A together.
func validateInactivityMoveRule(ctx context.Context, tx pgx.Tx, organizationID, stageID, automationID string, input stageInactivityInput) error {
	if input.TargetStageID == stageID {
		return fmt.Errorf("%w: escolha uma coluna diferente desta", ErrInvalidInput)
	}
	var sourcePipelineID, targetPipelineID string
	var targetWon, targetLost bool
	if err := tx.QueryRow(ctx, `select pipeline_id::text from public.stages where organization_id=$1::uuid and id=$2::uuid`, organizationID, stageID).Scan(&sourcePipelineID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	err := tx.QueryRow(ctx, `select pipeline_id::text, coalesce(is_won,false), coalesce(is_lost,false)
 from public.stages where organization_id=$1::uuid and id=$2::uuid and coalesce(is_active,true)=true
 for share`, organizationID, input.TargetStageID).Scan(&targetPipelineID, &targetWon, &targetLost)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("%w: a coluna de destino não existe ou está arquivada", ErrInvalidInput)
	}
	if err != nil {
		return err
	}
	if targetPipelineID != sourcePipelineID {
		return fmt.Errorf("%w: a coluna de destino precisa ser da mesma pipeline", ErrInvalidInput)
	}
	if targetWon || targetLost {
		return fmt.Errorf("%w: a coluna de destino não pode ser de Ganho ou Perdido", ErrInvalidInput)
	}
	if !input.Enabled {
		return nil
	}
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('stage_inactivity_move:' || $1::text, 0))`, organizationID); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `select policy.stage_id::text, policy.target_stage_id::text
 from private.stage_inactivity_policies policy
 join public.stage_automations automation on automation.id=policy.automation_id
  and automation.organization_id=policy.organization_id and coalesce(automation.is_active,true)=true
 where policy.organization_id=$1::uuid and policy.is_enabled=true
   and policy.action_kind='move_stage' and policy.target_stage_id is not null
   and ($2::uuid is null or policy.automation_id<>$2::uuid)`, organizationID, nullableUUID(automationID))
	if err != nil {
		return err
	}
	next := map[string]string{}
	for rows.Next() {
		var from, to string
		if err := rows.Scan(&from, &to); err != nil {
			rows.Close()
			return err
		}
		if from == stageID {
			rows.Close()
			return fmt.Errorf("%w: esta coluna já tem uma regra ativa de mudança de etapa", ErrInvalidInput)
		}
		next[from] = to
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if inactivityMoveCreatesCycle(next, stageID, input.TargetStageID) {
		return fmt.Errorf("%w: essa regra faria o lead voltar para esta coluna e ficar indo e voltando", ErrInvalidInput)
	}
	return nil
}

// inactivityMoveCreatesCycle follows the chain of active move rules from the
// destination. Each column has at most one active move rule, so the chain is
// a path; reaching the source means leads would circulate forever.
func inactivityMoveCreatesCycle(next map[string]string, source, target string) bool {
	seen := map[string]bool{}
	for current := target; current != ""; current = next[current] {
		if current == source {
			return true
		}
		if seen[current] {
			return false
		}
		seen[current] = true
	}
	return false
}

func nullableUUID(value string) any {
	if normalized, ok := normalizeUUID(value); ok {
		return normalized
	}
	return nil
}

// Move and redistribution rules are activated, paused and edited only through
// the inactivity endpoint, which keeps the automation row and policy in sync.
// The generic endpoints would desynchronize them (an active row whose policy
// no longer matches simply never runs), so they refuse these rows.
func rejectGenericInactivityActionChange(ctx context.Context, tx pgx.Tx, organizationID, automationID string) error {
	var isManagedAction bool
	// to_jsonb reads either schema: typed columns or the config document.
	err := tx.QueryRow(ctx, `select coalesce(to_jsonb(automation)->>'automation_type', to_jsonb(automation)->>'action_type',
 to_jsonb(automation)#>>'{config,automation_type}', '') in ($3, $4)
 from public.stage_automations automation where automation.organization_id=$1::uuid and automation.id=$2::uuid`, organizationID, automationID, StageAutomationMoveOnInactivity, stageAutomationRedistributeOnInactivity).Scan(&isManagedAction)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if isManagedAction {
		return fmt.Errorf("%w: altere esta regra pelo editor de inatividade", ErrInvalidInput)
	}
	return nil
}
