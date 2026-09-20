package roundrobin

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func setAuditActor(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context) error {
	userID := strings.TrimSpace(tenantContext.UserID)
	if userID == "" {
		return nil
	}
	_, err := tx.Exec(ctx, `select set_config('app.current_user_id', $1, true)`, userID)
	return err
}

func (repo Repository) Create(ctx context.Context, tenantContext tenant.Context, input createInput) (RoundRobin, error) {
	if !canManageRoundRobinScope(tenantContext) {
		return RoundRobin{}, tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return RoundRobin{}, err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return RoundRobin{}, err
	}

	if err := repo.validateDestination(ctx, tx, tenantContext.OrganizationID, input.TargetPipelineID, input.TargetStageID); err != nil {
		return RoundRobin{}, err
	}
	if err := repo.validateAutoTagIDs(ctx, tx, tenantContext.OrganizationID, queueAutoTagIDs(input.Settings)); err != nil {
		return RoundRobin{}, err
	}
	if err := ensureRoundRobinInputInScope(tenantContext, input.TargetPipelineID, input.Members, true, true); err != nil {
		return RoundRobin{}, err
	}
	if err := repo.checkConditionConflicts(ctx, tx, tenantContext.OrganizationID, nil, input.Rules); err != nil {
		return RoundRobin{}, err
	}

	metadata := buildMetadata(input.Strategy, input.TargetStageID, input.Settings, input.ReentryBehavior)
	var roundRobinID string
	err = tx.QueryRow(ctx, `
		insert into public.round_robins (
			organization_id,
			name,
			pipeline_id,
			target_pipeline_id,
			target_stage_id,
			strategy,
			settings,
			reentry_behavior,
			is_active,
			current_position,
			rules,
			created_by
		)
		values (
			$1::uuid,
			$2,
			$3::uuid,
			$3::uuid,
			$4::uuid,
			$5,
			$6::jsonb,
			$7,
			$8,
			0,
			$9::jsonb,
			$10::uuid
		)
		returning id::text
	`, tenantContext.OrganizationID, input.Name, nullable(input.TargetPipelineID), nullable(input.TargetStageID), input.Strategy,
		jsonb(input.Settings), input.ReentryBehavior, input.IsActive, jsonb(metadata), tenantContext.UserID).Scan(&roundRobinID)
	if err != nil {
		return RoundRobin{}, err
	}

	if err := repo.insertRules(ctx, tx, tenantContext.OrganizationID, roundRobinID, input.Rules); err != nil {
		return RoundRobin{}, err
	}
	if _, err := repo.insertMembers(
		ctx,
		tx,
		tenantContext,
		roundRobinID,
		input.Members,
		boolFromObject(input.Settings, "ignore_availability"),
	); err != nil {
		return RoundRobin{}, err
	}
	if err := repo.validateWhatsAppMessageDistribution(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return RoundRobin{}, err
	}
	if err := repo.syncMetaFormConfigLinks(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return RoundRobin{}, err
	}
	if err := repo.syncWhatsAppInboundRules(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return RoundRobin{}, err
	}
	if err := repo.validateRedistributionCapacity(ctx, tx, tenantContext.OrganizationID, roundRobinID, input.Settings); err != nil {
		return RoundRobin{}, err
	}

	item, err := repo.getWithQueryer(ctx, tx, tenantContext, roundRobinID)
	if err != nil {
		return RoundRobin{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return RoundRobin{}, err
	}

	return item, nil
}

func (repo Repository) Update(ctx context.Context, tenantContext tenant.Context, roundRobinID string, input updateInput) (RoundRobin, error) {
	if !canManageRoundRobinScope(tenantContext) {
		return RoundRobin{}, tenant.ErrOrganizationAccessDenied
	}

	roundRobinID, ok := normalizeUUID(roundRobinID)
	if !ok {
		return RoundRobin{}, ErrRoundRobinNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return RoundRobin{}, err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return RoundRobin{}, err
	}

	if err := repo.ensureRoundRobinMutable(ctx, tx, tenantContext, roundRobinID); err != nil {
		return RoundRobin{}, err
	}

	current, err := repo.getStateForUpdate(ctx, tx, tenantContext.OrganizationID, roundRobinID)
	if err != nil {
		return RoundRobin{}, err
	}
	if err := repo.rejectPendingWhatsAppIntake(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return RoundRobin{}, err
	}
	if input.Settings.Set {
		currentSettings := objectFromObject(current.Metadata, "settings")
		// Revalidate only additions so a deleted or legacy tag can always be removed
		// from an existing queue without making the whole update impossible.
		newTagIDs := addedQueueAutoTagIDs(currentSettings, input.Settings.Value)
		if err := repo.validateAutoTagIDs(ctx, tx, tenantContext.OrganizationID, newTagIDs); err != nil {
			return RoundRobin{}, err
		}
	}

	metadata := cloneObject(current.Metadata)
	pipelineID := current.PipelineID

	if input.Strategy.Set {
		value := "simple"
		if input.Strategy.Value != nil {
			value = normalizeStrategy(*input.Strategy.Value)
		}
		metadata["strategy"] = value
	}
	if input.TargetPipelineID.Set {
		pipelineID = nil
		if input.TargetPipelineID.Value != nil && *input.TargetPipelineID.Value != "" {
			value := *input.TargetPipelineID.Value
			pipelineID = &value
		}
	}
	if input.TargetStageID.Set {
		if input.TargetStageID.Value == nil || *input.TargetStageID.Value == "" {
			delete(metadata, "target_stage_id")
		} else {
			metadata["target_stage_id"] = *input.TargetStageID.Value
		}
	}
	if input.Settings.Set {
		metadata["settings"] = normalizeObject(input.Settings.Value)
	}
	if input.ReentryBehavior.Set {
		value := "redistribute"
		if input.ReentryBehavior.Value != nil {
			value = normalizeReentryBehavior(*input.ReentryBehavior.Value)
		}
		metadata["reentry_behavior"] = value
	}

	targetStageID := stringPointerFromMetadata(metadata, "target_stage_id")
	if err := repo.validateDestination(ctx, tx, tenantContext.OrganizationID, pipelineID, targetStageID); err != nil {
		return RoundRobin{}, err
	}
	if err := ensureRoundRobinInputInScope(tenantContext, pipelineID, input.Members, input.MembersSet, true); err != nil {
		return RoundRobin{}, err
	}
	setClauses := []string{"updated_at = now()"}
	args := []any{tenantContext.OrganizationID, roundRobinID}

	addSet := func(clause string, value any) {
		args = append(args, value)
		setClauses = append(setClauses, fmt.Sprintf(clause, len(args)))
	}

	if input.Name.Set {
		addSet("name = $%d", valueOrNil(input.Name.Value))
	}
	if input.IsActive.Set {
		addSet("is_active = coalesce($%d::boolean, false)", valueOrNil(input.IsActive.Value))
	}
	if input.TargetPipelineID.Set {
		args = append(args, nullable(pipelineID))
		position := len(args)
		setClauses = append(setClauses, fmt.Sprintf("pipeline_id = $%d::uuid, target_pipeline_id = $%d::uuid", position, position))
	}
	if input.Strategy.Set {
		addSet("strategy = $%d", stringFromObject(metadata, "strategy", "simple"))
	}
	if input.TargetStageID.Set {
		addSet("target_stage_id = $%d::uuid", nullable(targetStageID))
	}
	if input.Settings.Set {
		addSet("settings = $%d::jsonb", jsonb(objectFromObject(metadata, "settings")))
	}
	if input.ReentryBehavior.Set {
		addSet("reentry_behavior = $%d", stringFromObject(metadata, "reentry_behavior", "redistribute"))
	}
	if input.Strategy.Set || input.TargetStageID.Set || input.Settings.Set || input.ReentryBehavior.Set {
		addSet("rules = $%d::jsonb", jsonb(metadata))
	}

	commandTag, err := tx.Exec(ctx, `
		update public.round_robins
		set `+strings.Join(setClauses, ", ")+`
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, args...)
	if err != nil {
		return RoundRobin{}, err
	}
	if commandTag.RowsAffected() == 0 {
		return RoundRobin{}, ErrRoundRobinNotFound
	}

	rulesChanged := false
	if input.RulesSet {
		rulesChanged, err = repo.reconcileRules(ctx, tx, tenantContext.OrganizationID, roundRobinID, input.Rules)
		if err != nil {
			return RoundRobin{}, err
		}
	}

	if input.MembersSet {
		if _, err := repo.reconcileMembers(
			ctx,
			tx,
			tenantContext,
			roundRobinID,
			input.Members,
			boolFromObject(objectFromObject(metadata, "settings"), "ignore_availability"),
		); err != nil {
			return RoundRobin{}, err
		}
	}
	if err := repo.validateWhatsAppMessageDistribution(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return RoundRobin{}, err
	}
	if rulesChanged {
		if err := repo.syncMetaFormConfigLinks(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
			return RoundRobin{}, err
		}
	}
	if err := repo.syncWhatsAppInboundRules(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return RoundRobin{}, err
	}
	if err := repo.validateRedistributionCapacity(ctx, tx, tenantContext.OrganizationID, roundRobinID, objectFromObject(metadata, "settings")); err != nil {
		return RoundRobin{}, err
	}

	item, err := repo.getWithQueryer(ctx, tx, tenantContext, roundRobinID)
	if err != nil {
		return RoundRobin{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return RoundRobin{}, err
	}

	return item, nil
}

func (repo Repository) Delete(ctx context.Context, tenantContext tenant.Context, roundRobinID string) error {
	if !canManageRoundRobins(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	roundRobinID, ok := normalizeUUID(roundRobinID)
	if !ok {
		return ErrRoundRobinNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return err
	}

	if _, err := repo.getStateForUpdate(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return err
	}
	if err := repo.rejectPendingWhatsAppIntake(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return err
	}
	if err := repo.deleteWhatsAppInboundRulesForRoundRobin(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return err
	}

	// A queue UUID is part of the immutable lead intake identity and may also
	// be held by an already-acknowledged WhatsApp routing snapshot. Reproduce
	// the operational effects of the former FK-backed hard delete, but retain
	// an inactive tombstone so delayed processing can still resolve queue:<id>.
	for _, query := range []string{
		`update public.pipelines set default_round_robin_id = null, updated_at = now() where organization_id = $1::uuid and default_round_robin_id = $2::uuid`,
		`update public.portal_integrations set default_round_robin_id = null, updated_at = now() where organization_id = $1::uuid and default_round_robin_id = $2::uuid`,
		`update public.meta_form_configs set round_robin_id = null, updated_at = now() where organization_id = $1::uuid and round_robin_id = $2::uuid`,
		`update public.whatsapp_inbound_rules set target_round_robin_id = null, updated_at = now() where organization_id = $1::uuid and target_round_robin_id = $2::uuid`,
		`delete from public.lead_redistribution_jobs where organization_id = $1::uuid and round_robin_id = $2::uuid`,
		`delete from public.round_robin_members where organization_id = $1::uuid and round_robin_id = $2::uuid`,
		`delete from public.round_robin_rules where organization_id = $1::uuid and round_robin_id = $2::uuid`,
	} {
		if _, err := tx.Exec(ctx, query, tenantContext.OrganizationID, roundRobinID); err != nil {
			return err
		}
	}

	commandTag, err := tx.Exec(ctx, `
		update public.round_robins
		set is_active = false,
		    deleted_at = clock_timestamp(),
		    pipeline_id = null,
		    target_pipeline_id = null,
		    target_stage_id = null,
		    ai_agent_id = null,
		    created_by = null,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and deleted_at is null
	`, tenantContext.OrganizationID, roundRobinID)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() != 1 {
		return ErrRoundRobinNotFound
	}

	return tx.Commit(ctx)
}
