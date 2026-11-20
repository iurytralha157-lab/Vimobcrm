package leads

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/authorization"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) registerReentry(ctx context.Context, tenantContext tenant.Context, input createInput, resolvedDestination destination, expectedIntakeDestination distribution.IntakeDestination, existingLead existingLeadMatch, importRequest *leadImportRequest) (CreateResult, error) {
	if err := repo.authorizeLeadReentry(ctx, repo.leadCreationReadQueryer(importRequest), tenantContext, input, existingLead); err != nil {
		return CreateResult{}, err
	}
	tx, err := repo.beginLeadImportTransaction(ctx, importRequest)
	if err != nil {
		return CreateResult{}, err
	}
	defer tx.Rollback(ctx)
	futureSessionID, err := lockFutureLeadWhatsAppSession(ctx, tx, tenantContext, input)
	if err != nil {
		return CreateResult{}, err
	}

	if err := distribution.LockIntakePipelineDestination(ctx, tx, tenantContext.OrganizationID, resolvedDestination.PipelineID, resolvedDestination.StageID); err != nil {
		return CreateResult{}, err
	}
	intakeDestination, err := repo.resolveLeadIntakeDestination(ctx, tx, tenantContext.OrganizationID, input, resolvedDestination)
	if err != nil {
		return CreateResult{}, err
	}
	if !sameLeadIntakeDestination(expectedIntakeDestination, intakeDestination) {
		return CreateResult{}, errLeadIntakeRetry
	}
	automaticRouting := input.RoundRobinID == nil && shouldAutoDistribute(input)
	input.RoundRobinID = intakeDestination.RoundRobinID
	if automaticRouting {
		input.TagIDs, err = leadIntakeTagIDs(input, intakeDestination.TagIDs)
		if err != nil {
			return CreateResult{}, err
		}
	}
	intakeScopeKey := distribution.IntakeScopeKey(input.RoundRobinID)
	if err := lockLeadIntakeIdentity(ctx, tx, tenantContext.OrganizationID, input.Phone, intakeScopeKey); err != nil {
		return CreateResult{}, err
	}
	// Binding writers and lead deletion share one global row-lock order:
	// conversation first, then every referenced lead. This must also run for
	// the conservative implicit-phone claim; a concurrent explicit linker may
	// already own that unlinked conversation while it waits on this lead.
	// The outer lookup is revalidated below, so any identity race rolls this
	// provisional binding back with the transaction.
	if err := repo.linkWhatsAppConversations(
		ctx,
		tx,
		tenantContext,
		existingLead.ID,
		input.Phone,
		input.ConversationID,
		input.ExpectedPreviousLeadID,
		input.ConfirmHistoryLink,
		futureSessionID,
		func() error { return repo.authorizeLeadReentry(ctx, tx, tenantContext, input, existingLead) },
	); err != nil {
		return CreateResult{}, err
	}
	legacyIdentity, err := legacyLeadPhoneUniquenessActive(ctx, tx)
	if err != nil {
		return CreateResult{}, err
	}
	currentLead, err := repo.findExistingLeadByPhoneForUpdate(ctx, tx, tenantContext.OrganizationID, input.Phone, intakeScopeKey, legacyIdentity)
	if err != nil {
		return CreateResult{}, err
	}
	if currentLead == nil || currentLead.ID != existingLead.ID {
		return CreateResult{}, errLeadIntakeRetry
	}
	existingLead = *currentLead
	if err := repo.authorizeLeadReentry(ctx, tx, tenantContext, input, existingLead); err != nil {
		return CreateResult{}, err
	}

	if err := repo.validateCreatePropertyReferences(ctx, tx, tenantContext, input); err != nil {
		return CreateResult{}, err
	}

	actorName, err := repo.getUserDisplayName(ctx, tx, tenantContext.UserID)
	if err != nil {
		return CreateResult{}, err
	}

	requestedImportData := map[string]any{
		"pipeline_id":     nullable(resolvedDestination.PipelineID),
		"stage_id":        nullable(resolvedDestination.StageID),
		"property_id":     nullable(input.PropertyID),
		"property_code":   nullable(input.PropertyCode),
		"deal_status":     input.DealStatus,
		"lost_reason":     nullable(input.LostReason),
		"valor_interesse": nullable(input.InterestValue),
	}
	// Create defaults describe new contacts. A duplicate must not move an
	// existing deal or bypass its financial/reservation workflow.
	preservedState, snapshotErr := loadImportReentryState(ctx, tx, tenantContext.OrganizationID, existingLead.ID)
	if snapshotErr != nil {
		return CreateResult{}, snapshotErr
	}
	resolvedDestination = destination{
		PipelineID: preservedState.PipelineID,
		StageID:    preservedState.StageID,
		StageName:  preservedState.StageName,
	}
	input.DealStatus = preservedState.DealStatus
	input.LostReason = preservedState.LostReason
	input.PropertyID = preservedState.PropertyID
	input.PropertyCode = preservedState.PropertyCode
	input.InterestValue = preservedState.InterestValue
	err = applyConservativeLeadReentry(ctx, tx, tenantContext.OrganizationID, existingLead.ID, input)
	if err != nil {
		return CreateResult{}, err
	}
	if !input.ImportMode {
		// Preserve the established manual-return ordering without moving stages
		// or reopening the existing commercial outcome.
		if _, err := tx.Exec(ctx, `update public.leads set board_order_at = now()
			where organization_id = $1::uuid and id = $2::uuid`, tenantContext.OrganizationID, existingLead.ID); err != nil {
			return CreateResult{}, err
		}
	}

	entryMetadata := map[string]any{
		"new_data": map[string]any{
			"name":          input.Name,
			"email":         nullable(input.Email),
			"message":       nullable(input.Message),
			"property_code": nullable(input.PropertyCode),
			"deal_status":   input.DealStatus,
		},
		"origin":                "vimob_api",
		"intake_scope_key":      intakeScopeKey,
		"origin_round_robin_id": nullable(input.RoundRobinID),
	}
	if err := repo.insertLeadTags(ctx, tx, tenantContext.OrganizationID, existingLead.ID, input.TagIDs); err != nil {
		return CreateResult{}, err
	}
	entryMetadata["state_preserved"] = true
	entryMetadata["requested_data"] = requestedImportData
	if input.ImportMode {
		entryMetadata["import_state_preserved"] = true
	}
	var entryID string
	err = tx.QueryRow(ctx, `
		insert into public.lead_entry_events (
			organization_id,
			lead_id,
			source,
			provider,
			occurred_at,
			is_countable,
			source_detail,
			entry_type,
			property_id,
			valor_interesse,
			pipeline_id,
			stage_id,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3,
			'manual',
			now(),
			true,
			'vimob_api',
			'reentry',
			$4::uuid,
			$5::numeric,
			$6::uuid,
			$7::uuid,
			$8::jsonb
		)
		returning id::text
	`, tenantContext.OrganizationID, existingLead.ID, input.Source, nullable(input.PropertyID), nullable(input.InterestValue), nullable(resolvedDestination.PipelineID), nullable(resolvedDestination.StageID), jsonb(entryMetadata)).Scan(&entryID)
	if err != nil {
		return CreateResult{}, err
	}

	distributionOutcome := CreateDistributionOutcomeReentryPreserved
	reentryBehavior := "keep_assignee"
	redistributionPending := false
	assignedUserID := existingLead.AssignedUserID
	assignedUserName := existingLead.AssignedUserName
	if input.RoundRobinID != nil && !input.ImportMode && manualReentryAllowsRedistribution(input) {
		reentryBehavior = intakeDestination.ReentryBehavior
		if reentryBehavior == "redistribute" {
			distributionSource := input.Source
			distributionResult, distributeErr := distribution.Distribute(ctx, tx, distribution.Request{
				OrganizationID:     tenantContext.OrganizationID,
				LeadID:             existingLead.ID,
				IdempotencyKey:     distribution.StableKey("manual-reentry", existingLead.ID, entryID),
				RoundRobinID:       input.RoundRobinID,
				RoundRobinResolved: intakeDestination.Resolved,
				PreserveAssignee:   false,
				Source:             &distributionSource,
				OccurredAt:         time.Now().UTC(),
			})
			if distributeErr != nil {
				return CreateResult{}, distributeErr
			}
			distributionOutcome = CreateDistributionOutcome(distributionResult.Reason)
			redistributionPending = distributionResult.Reason == "no_matching_queue" || distributionResult.Reason == "no_available_members"
			var currentAssignedUserID, currentAssignedUserName pgtype.Text
			if err := tx.QueryRow(ctx, `
				select l.assigned_user_id::text, u.name
				from public.leads l
				left join public.users u on u.id = l.assigned_user_id
				where l.organization_id = $1::uuid
				  and l.id = $2::uuid
				for share of l
			`, tenantContext.OrganizationID, existingLead.ID).Scan(&currentAssignedUserID, &currentAssignedUserName); err != nil {
				return CreateResult{}, err
			}
			assignedUserID = textValue(currentAssignedUserID)
			assignedUserName = textValue(currentAssignedUserName)
		}
	}
	if assignedUserName == "" {
		assignedUserName = "sem responsavel"
	}

	reentryContent := fmt.Sprintf("Nova entrada manual registrada por %s. Lead mantido com %s.", actorName, assignedUserName)
	if reentryBehavior == "redistribute" {
		reentryContent = fmt.Sprintf("Nova entrada manual registrada por %s. Lead redistribuido na fila para %s.", actorName, assignedUserName)
	}
	if redistributionPending {
		reentryContent = fmt.Sprintf("Nova entrada manual registrada por %s. Lead mantido com %s; redistribuicao pendente (%s).", actorName, assignedUserName, distributionOutcome)
	}
	if err := repo.insertActivity(ctx, tx, tenantContext.OrganizationID, existingLead.ID, tenantContext.UserID, "lead_reentry", reentryContent, map[string]any{
		"entry_event_id":         entryID,
		"entry_type":             "manual_reentry",
		"source":                 input.Source,
		"actor_id":               tenantContext.UserID,
		"actor_name":             actorName,
		"assigned_user_id":       nullableString(assignedUserID),
		"assigned_user_name":     assignedUserName,
		"kept_assignee":          reentryBehavior != "redistribute" || redistributionPending,
		"reentry_behavior":       reentryBehavior,
		"distribution_outcome":   distributionOutcome,
		"redistribution_pending": redistributionPending,
		"intake_scope_key":       intakeScopeKey,
		"pipeline_id":            nullable(resolvedDestination.PipelineID),
		"stage_id":               nullable(resolvedDestination.StageID),
		"property_id":            nullable(input.PropertyID),
		"property_code":          nullable(input.PropertyCode),
		"deal_status":            input.DealStatus,
	}); err != nil {
		return CreateResult{}, err
	}

	if err := repo.insertInitialFeedbackActivity(ctx, tx, tenantContext.OrganizationID, existingLead.ID, tenantContext.UserID, input.Message, "lead_reentry"); err != nil {
		return CreateResult{}, err
	}

	if assignedUserID != "" {
		if err := repo.insertNotification(ctx, tx, tenantContext.OrganizationID, assignedUserID, existingLead.ID, "Lead retornou", fmt.Sprintf("%s teve uma nova entrada", input.Name), "lead_reentry", map[string]any{
			"lead_name": input.Name,
			"source":    input.Source,
			"entry_at":  time.Now().UTC().Format(time.RFC3339Nano),
		}); err != nil {
			return CreateResult{}, err
		}
	}

	actorNotificationContent := fmt.Sprintf("Lead mantido com %s", assignedUserName)
	if reentryBehavior == "redistribute" {
		actorNotificationContent = fmt.Sprintf("Lead redistribuido na fila para %s", assignedUserName)
	}
	if redistributionPending {
		actorNotificationContent = fmt.Sprintf("Lead mantido com %s; redistribuicao pendente (%s)", assignedUserName, distributionOutcome)
	}
	if err := repo.insertNotification(ctx, tx, tenantContext.OrganizationID, tenantContext.UserID, existingLead.ID, "Lead ja existia", actorNotificationContent, "lead_duplicate_existing", map[string]any{
		"lead_name":     input.Name,
		"assignee_name": assignedUserName,
		"source":        input.Source,
	}); err != nil {
		return CreateResult{}, err
	}

	if err := distribution.ValidatePersistedIntakeDestination(ctx, tx, tenantContext.OrganizationID, existingLead.ID); err != nil {
		return CreateResult{}, err
	}
	lead, err := commitLeadImportCreation(ctx, tx, tenantContext, existingLead.ID, importRequest, true, distributionOutcome)
	if err != nil {
		return CreateResult{}, err
	}
	if authorization.CanViewLead(tenantContext, authorization.LeadResource{AssignedUserID: lead.AssignedUserID, TeamID: lead.TeamID}) {
		repo.hydrateLeadAvatar(ctx, tenantContext.OrganizationID, &lead)
	}

	return CreateResult{
		Lead:                lead,
		Reentry:             true,
		AssignedUserName:    assignedUserName,
		DistributionOutcome: distributionOutcome,
	}, nil
}
