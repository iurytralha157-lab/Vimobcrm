package leads

import (
	"context"
	"errors"
	"fmt"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/authorization"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) Create(ctx context.Context, tenantContext tenant.Context, input createInput, importRequests ...*leadImportRequest) (CreateResult, error) {
	if !canCreateLeadInput(tenantContext, input) {
		return CreateResult{}, tenant.ErrOrganizationAccessDenied
	}
	if input.ConversationID != nil && !canBindWhatsAppConversationDuringLeadCreation(tenantContext) {
		return CreateResult{}, tenant.ErrOrganizationAccessDenied
	}
	if !canUseRequestedRoundRobin(tenantContext, input) {
		return CreateResult{}, tenant.ErrOrganizationAccessDenied
	}
	if err := normalizeLeadCreateFinancialInput(&input); err != nil {
		return CreateResult{}, err
	}
	var importRequest *leadImportRequest
	if len(importRequests) > 0 {
		importRequest = importRequests[0]
	}
	if input.ImportRequestKey != nil && importRequest == nil {
		return repo.createImportedLeadIdempotently(ctx, tenantContext, input)
	}
	var err error
	input, err = applyCreateAssignmentPolicy(tenantContext, input)
	if err != nil {
		return CreateResult{}, err
	}
	// A keyed request already owns its connection and receipt lock. Reuse it
	// for every preflight read; acquiring the pool again would deadlock a
	// one-connection pool or concurrent batches that exhaust the pool.
	readQueryer := repo.leadCreationReadQueryer(importRequest)

	resolvedDestination, err := repo.resolveDestination(ctx, readQueryer, tenantContext.OrganizationID, input.PipelineID, input.StageID)
	if err != nil {
		return CreateResult{}, err
	}

	if err := repo.validateAssignedUser(ctx, readQueryer, tenantContext.OrganizationID, input.AssignedUserID); err != nil {
		return CreateResult{}, err
	}
	if err := repo.validateLeadTeam(ctx, readQueryer, tenantContext, input.TeamID); err != nil {
		return CreateResult{}, err
	}
	if err := repo.validateRequestedRoundRobin(ctx, readQueryer, tenantContext.OrganizationID, input.RoundRobinID); err != nil {
		return CreateResult{}, err
	}
	var lastIdentityError error
	for attempt := 0; attempt < leadIntakeMaxAttempts; attempt++ {
		intakeDestination, resolveErr := repo.resolveLeadIntakeDestination(
			ctx,
			readQueryer,
			tenantContext.OrganizationID,
			input,
			resolvedDestination,
		)
		if resolveErr != nil {
			return CreateResult{}, resolveErr
		}
		intakeScopeKey := distribution.IntakeScopeKey(intakeDestination.RoundRobinID)
		legacyIdentity, lookupErr := legacyLeadPhoneUniquenessActive(ctx, readQueryer)
		if lookupErr != nil {
			return CreateResult{}, lookupErr
		}

		var existingLead *existingLeadMatch
		if legacyIdentity {
			existingLead, lookupErr = repo.findExistingLeadByPhoneLegacy(ctx, tenantContext.OrganizationID, input.Phone, readQueryer)
		} else {
			existingLead, lookupErr = repo.findExistingLeadByPhone(ctx, tenantContext.OrganizationID, input.Phone, intakeScopeKey, readQueryer)
		}
		if lookupErr != nil {
			return CreateResult{}, lookupErr
		}

		var result CreateResult
		if existingLead != nil {
			result, err = repo.registerReentry(ctx, tenantContext, input, resolvedDestination, intakeDestination, *existingLead, importRequest)
		} else {
			result, err = repo.createNewLead(ctx, tenantContext, input, resolvedDestination, intakeDestination, importRequest)
		}
		if err == nil {
			return result, nil
		}
		if !errors.Is(err, errLeadIntakeRetry) && !isLeadPhoneUniqueViolation(err) {
			return CreateResult{}, err
		}
		if importRequest != nil {
			return CreateResult{}, err
		}
		lastIdentityError = err
	}

	if lastIdentityError != nil {
		return CreateResult{}, fmt.Errorf("%w: lead intake identity did not stabilize", ErrLeadPhoneConflict)
	}
	return CreateResult{}, ErrLeadPhoneConflict
}

func (repo Repository) createNewLead(ctx context.Context, tenantContext tenant.Context, input createInput, resolvedDestination destination, expectedIntakeDestination distribution.IntakeDestination, importRequest *leadImportRequest) (CreateResult, error) {
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
	legacyIdentity, err := legacyLeadPhoneUniquenessActive(ctx, tx)
	if err != nil {
		return CreateResult{}, err
	}
	existingLead, err := repo.findExistingLeadByPhoneForUpdate(ctx, tx, tenantContext.OrganizationID, input.Phone, intakeScopeKey, legacyIdentity)
	if err != nil {
		return CreateResult{}, err
	}
	if existingLead != nil {
		return CreateResult{}, errLeadIntakeRetry
	}

	if err := repo.validateCreatePropertyReferences(ctx, tx, tenantContext, input); err != nil {
		return CreateResult{}, err
	}

	creation, err := prepareLeadCreationOutcome(ctx, tx, tenantContext, input)
	if err != nil {
		return CreateResult{}, err
	}

	if err := lockLeadCreationProperty(ctx, tx, tenantContext, input, creation); err != nil {
		return CreateResult{}, err
	}
	if err := lockNewLeadSecondaryPropertyInterests(ctx, tx, tenantContext.OrganizationID, input.PropertyID, nil, input.InterestPropertyIDs); err != nil {
		return CreateResult{}, err
	}

	leadMetadata := make(LeadMetadata, len(input.Metadata)+1)
	for key, value := range input.Metadata {
		leadMetadata[key] = value
	}
	leadMetadata["distribution_deferred"] = true

	var leadID string
	err = tx.QueryRow(ctx, `
		with inserted as (
			insert into public.leads (
				organization_id,
				pipeline_id,
				stage_id,
				assigned_user_id,
				team_id,
				assigned_at,
				property_id,
				interest_property_id,
				name,
				email,
				phone,
				source,
				message,
				property_code,
				valor_interesse,
				deal_status,
				lost_reason,
				lost_at,
				won_at,
				is_own_resource,
				cargo,
				empresa,
				profissao,
				endereco,
				bairro,
				numero,
				cep,
				cidade,
				uf,
				renda_familiar,
				faixa_valor_imovel,
				created_by,
				stage_entered_at,
				board_order_at,
				feedback,
				metadata,
				intake_scope_key,
				origin_round_robin_id,
				id
			)
			values (
				$1::uuid,
				$2::uuid,
				$3::uuid,
				$4::uuid,
				$5::uuid,
				case when $4::uuid is null then null else now() end,
				$6::uuid,
				$6::uuid,
				$7,
				$8,
				$9,
				$10,
				$11,
				$12,
				$13::numeric,
				$14,
				$15,
				case when $14 = 'lost' then now() else null end,
				case when $14 = 'won' then now() else null end,
				$16,
				$17,
				$18,
				$19,
				$20,
				$21,
				$22,
				$23,
				$24,
				$25,
				$26,
				$27,
				$28::uuid,
				case when $3::uuid is null then null else now() end,
				case when $3::uuid is null then null else now() end,
				$29,
				$30::jsonb,
				$31,
				$32::uuid,
				$33::uuid
			)
			returning id::text, name, phone, source
		),
		audit as (
			insert into public.audit_logs (
				organization_id,
				user_id,
				action,
				entity_type,
				entity_id,
				new_data
			)
			select
				$1::uuid,
				$28::uuid,
				'create',
				'lead',
				inserted.id,
				jsonb_build_object(
					'name', inserted.name,
					'phone', inserted.phone,
					'source', inserted.source
				)
			from inserted
		)
		select id from inserted
	`,
		tenantContext.OrganizationID,
		nullable(resolvedDestination.PipelineID),
		nullable(resolvedDestination.StageID),
		nullable(input.AssignedUserID),
		nullable(input.TeamID),
		nullable(input.PropertyID),
		input.Name,
		nullable(input.Email),
		nullable(input.Phone),
		input.Source,
		nullable(input.Message),
		nullable(input.PropertyCode),
		nullable(input.InterestValue),
		creation.InitialStatus,
		nullable(input.LostReason),
		nullableBool(input.IsOwnResource),
		nullable(input.Cargo),
		nullable(input.Empresa),
		nullable(input.Profissao),
		nullable(input.Endereco),
		nullable(input.Bairro),
		nullable(input.Numero),
		nullable(input.CEP),
		nullable(input.Cidade),
		nullable(input.UF),
		nullable(input.RendaFamiliar),
		nullable(input.FaixaValorImovel),
		tenantContext.UserID,
		nullable(input.Feedback),
		jsonb(leadMetadata),
		intakeScopeKey,
		nullable(input.RoundRobinID),
		creation.LeadID,
	).Scan(&leadID)
	if err != nil {
		return CreateResult{}, err
	}

	if err := repo.insertLeadTags(ctx, tx, tenantContext.OrganizationID, leadID, input.TagIDs); err != nil {
		return CreateResult{}, err
	}

	if err := repo.linkWhatsAppConversations(
		ctx,
		tx,
		tenantContext,
		leadID,
		input.Phone,
		input.ConversationID,
		input.ExpectedPreviousLeadID,
		input.ConfirmHistoryLink,
		futureSessionID,
	); err != nil {
		return CreateResult{}, err
	}

	if err := repo.insertActivity(ctx, tx, tenantContext.OrganizationID, leadID, tenantContext.UserID, "lead_created", fmt.Sprintf(`Lead "%s" foi criado`, input.Name), map[string]any{
		"source": input.Source,
		"origin": "vimob_api",
	}); err != nil {
		return CreateResult{}, err
	}

	initialFeedback := input.Feedback
	if initialFeedback == nil {
		initialFeedback = input.Message
	}
	if err := repo.insertInitialFeedbackActivity(ctx, tx, tenantContext.OrganizationID, leadID, tenantContext.UserID, initialFeedback, "lead_create"); err != nil {
		return CreateResult{}, err
	}

	distributionOutcome := CreateDistributionOutcomeSkipped
	if shouldAutoDistribute(input) {
		distributionResult, err := distribution.Distribute(ctx, tx, newLeadDistributionRequest(tenantContext, input, leadID, intakeDestination))
		if err != nil {
			return CreateResult{}, err
		}
		distributionOutcome = CreateDistributionOutcome(distributionResult.Reason)
	} else if _, err := tx.Exec(ctx, `
		update public.leads
		set metadata = coalesce(metadata, '{}'::jsonb) - 'distribution_deferred'
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and metadata ? 'distribution_deferred'
	`, tenantContext.OrganizationID, leadID); err != nil {
		return CreateResult{}, err
	}

	outcomeTransition, err := repo.finishLeadCreationOutcome(ctx, tx, tenantContext, input, creation)
	if err != nil {
		return CreateResult{}, err
	}

	if input.AssignedUserID != nil {
		if err := repo.insertNotification(ctx, tx, tenantContext.OrganizationID, *input.AssignedUserID, leadID, "Novo lead recebido", fmt.Sprintf("%s foi atribuido a voce", input.Name), "new_lead_received", map[string]any{
			"lead_name":  input.Name,
			"source":     input.Source,
			"dedupe_key": notificationDedupeKey("new_lead_received", leadID, *input.AssignedUserID),
		}); err != nil {
			return CreateResult{}, err
		}
	}

	lead, err := commitLeadImportCreation(ctx, tx, tenantContext, leadID, importRequest, false, distributionOutcome)
	if err != nil {
		return CreateResult{}, err
	}
	if outcomeTransition.Input.DealStatus.Set {
		repo.dispatchDealStatusSideEffects(tenantContext, outcomeTransition.Before, outcomeTransition.Input)
	}
	if authorization.CanViewLead(tenantContext, authorization.LeadResource{AssignedUserID: lead.AssignedUserID, TeamID: lead.TeamID}) {
		repo.hydrateLeadAvatar(ctx, tenantContext.OrganizationID, &lead)
	}

	return CreateResult{Lead: lead, DistributionOutcome: distributionOutcome}, nil
}
