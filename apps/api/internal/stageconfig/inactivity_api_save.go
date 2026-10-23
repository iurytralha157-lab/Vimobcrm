package stageconfig

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// SaveInactivityAutomation writes both representations in one transaction.
// First registration is always disabled: durable fact capture must already be
// committed before a later explicit activation can attest coverage from NOW.
func (repo Repository) SaveInactivityAutomation(ctx context.Context, tenantContext tenant.Context, automationID string, input stageInactivityInput) (StageAutomation, error) {
	if !canManageStageConfig(tenantContext) || !tenantContext.HasModule("automations") {
		return StageAutomation{}, tenant.ErrOrganizationAccessDenied
	}
	if _, valid := normalizeUUID(tenantContext.OrganizationID); !valid {
		return StageAutomation{}, tenant.ErrOrganizationAccessDenied
	}
	create := automationID == ""
	if create && input.Enabled {
		return StageAutomation{}, fmt.Errorf("%w: cadastre a regra desativada antes de ativá-la", ErrInvalidInput)
	}
	if input.Enabled && !repo.inactivityRuntimeEnabled {
		return StageAutomation{}, ErrInactivityRuntimeNotReady
	}
	if !create {
		var valid bool
		automationID, valid = normalizeUUID(automationID)
		if !valid {
			return StageAutomation{}, ErrInvalidInput
		}
	}
	operationCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	if err := repo.VerifyStageInactivityRuntime(operationCtx); err != nil {
		return StageAutomation{}, err
	}
	hasConfig, err := repo.hasStageAutomationConfigSchema(operationCtx)
	if err != nil {
		return StageAutomation{}, err
	}
	tx, err := repo.db.Pool().Begin(operationCtx)
	if err != nil {
		return StageAutomation{}, err
	}
	defer rollbackInactivityTransaction(tx)
	if _, err := tx.Exec(operationCtx, `set local lock_timeout='2s'; set local statement_timeout='2s'`); err != nil {
		return StageAutomation{}, err
	}
	stageID := input.StageID
	if !create {
		err := tx.QueryRow(operationCtx, `select stage_id::text from public.stage_automations
 where organization_id=$1::uuid and id=$2::uuid`, tenantContext.OrganizationID, automationID).Scan(&stageID)
		if errors.Is(err, pgx.ErrNoRows) {
			return StageAutomation{}, ErrNotFound
		}
		if err != nil {
			return StageAutomation{}, err
		}
	}
	if err := lockInactivityWriteScope(operationCtx, tx, tenantContext.OrganizationID, stageID); err != nil {
		return StageAutomation{}, err
	}
	var current *StageInactivityPolicy
	var previousUpdatedAt time.Time
	previousActive := false
	if !create {
		var triggerType string
		err := tx.QueryRow(operationCtx, `select updated_at, coalesce(is_active,true), trigger_type
 from public.stage_automations where organization_id=$1::uuid and id=$2::uuid
 and stage_id=$3::uuid for update`, tenantContext.OrganizationID, automationID, stageID).Scan(&previousUpdatedAt, &previousActive, &triggerType)
		if errors.Is(err, pgx.ErrNoRows) {
			return StageAutomation{}, ErrNotFound
		}
		if err != nil {
			return StageAutomation{}, err
		}
		if !previousUpdatedAt.Equal(input.ExpectedUpdatedAt) {
			return StageAutomation{}, ErrInactivityConfigurationChanged
		}
		if triggerType != "inactivity" {
			return StageAutomation{}, fmt.Errorf("%w: esta automação não é uma regra de inatividade", ErrInvalidInput)
		}
		currentAutomation, err := scanStageAutomation(tx.QueryRow(operationCtx, `select `+stageAutomationSelectFields(hasConfig)+`
 from public.stage_automations where organization_id=$1::uuid and id=$2::uuid and stage_id=$3::uuid`, tenantContext.OrganizationID, automationID, stageID))
		if err != nil {
			return StageAutomation{}, err
		}
		if err := validateInactivityAlertEdit(currentAutomation); err != nil {
			return StageAutomation{}, err
		}
		current, err = readInactivityPolicyForUpdate(operationCtx, tx, tenantContext.OrganizationID, automationID)
		if err != nil {
			return StageAutomation{}, err
		}
		if err := validateInactivityPolicyCAS(current, input.ExpectedPolicyRevision); err != nil {
			return StageAutomation{}, err
		}
		if current != nil && current.StageID != stageID {
			return StageAutomation{}, ErrInactivityConfigurationChanged
		}
		if input.Enabled && (current == nil || current.Clock != InactivityClockLastInteraction) {
			return StageAutomation{}, fmt.Errorf("%w: salve primeiro a configuração desativada e depois ative a regra", ErrInvalidInput)
		}
	}
	if err := lockInactivityWriteModule(operationCtx, tx, tenantContext.OrganizationID); err != nil {
		return StageAutomation{}, err
	}
	var now time.Time
	var epoch string
	if err := tx.QueryRow(operationCtx, `select clock_timestamp(), gen_random_uuid()::text`).Scan(&now, &epoch); err != nil {
		return StageAutomation{}, err
	}
	automation, err := writeInactivityAutomation(operationCtx, tx, tenantContext.OrganizationID, stageID, automationID, input, hasConfig)
	if err != nil {
		return StageAutomation{}, err
	}
	if !create && requireAdvancedStageAutomationRevision(automation, input.ExpectedUpdatedAt) != nil {
		return StageAutomation{}, fmt.Errorf("%w: persisted revision did not advance", ErrInactivityConfigurationChanged)
	}
	updatedAt, err := parseInactivityRevision(automation.UpdatedAt)
	if err != nil {
		return StageAutomation{}, err
	}
	policy := nextInactivityPolicy(current, previousUpdatedAt, previousActive, now, epoch, input)
	policy.AutomationID, policy.OrganizationID, policy.StageID = automation.ID, tenantContext.OrganizationID, stageID
	policy.AutomationUpdatedAt = updatedAt
	if err := policy.Validate(); err != nil {
		return StageAutomation{}, err
	}
	if err := writeInactivityPolicy(operationCtx, tx, policy); err != nil {
		return StageAutomation{}, err
	}
	if err := tx.Commit(operationCtx); err != nil {
		return StageAutomation{}, err
	}
	automation.InactivityRuntimeAvailable = repo.inactivityRuntimeEnabled
	automation.InactivityPolicy = inactivityPolicyView(policy, true, repo.inactivityRuntimeEnabled)
	return automation, nil
}

func validateInactivityPolicyCAS(current *StageInactivityPolicy, expectedRevision int64) error {
	if current == nil && expectedRevision == 0 {
		return nil
	}
	if current == nil || current.Revision != expectedRevision {
		return ErrInactivityConfigurationChanged
	}
	return nil
}

func nextInactivityPolicy(current *StageInactivityPolicy, previousUpdatedAt time.Time, previousActive bool, now time.Time, epoch string, input stageInactivityInput) StageInactivityPolicy {
	policy := StageInactivityPolicy{Epoch: epoch, Revision: 1, ActivatedAt: now, InteractionCoverageFrom: &now}
	if current != nil {
		policy.Revision = current.Revision + 1
		// Continuous enabled edits retain identity, so an already-notified
		// episode is not duplicated by message/threshold changes.
		if current.Enabled && previousActive && current.AutomationUpdatedAt.Equal(previousUpdatedAt) && current.Clock == InactivityClockLastInteraction && current.StartMode == InactivityStartAtActivation {
			policy.Epoch = current.Epoch
			policy.ActivatedAt = current.ActivatedAt
			policy.InteractionCoverageFrom = current.InteractionCoverageFrom
		}
	}
	policy.Clock, policy.StartMode = InactivityClockLastInteraction, InactivityStartAtActivation
	policy.Days, policy.Message, policy.Enabled = input.Days, input.Message, input.Enabled
	return policy
}
