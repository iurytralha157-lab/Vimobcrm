package meta

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
)

func (repo Repository) resolveDestination(ctx context.Context, tx pgx.Tx, integration metaIntegration, formConfig metaFormConfig) (resolvedDestination, error) {
	return repo.resolveDestinationWithRoundRobin(ctx, tx, integration, formConfig, formConfig.RoundRobinID, false)
}

func shouldResolveAutomaticMetaIntake(pendingReentry *pendingMetaLeadReentry, formConfig metaFormConfig) bool {
	return pendingReentry == nil && formConfig.RoundRobinID == nil
}

func (repo Repository) resolveAutomaticMetaIntakeDestination(
	ctx context.Context,
	tx pgx.Tx,
	destination resolvedDestination,
	integration metaIntegration,
	formConfig metaFormConfig,
	change leadgenChange,
	lead leadData,
	details map[string]any,
	source string,
	propertyID *string,
) (resolvedDestination, error) {
	optionalText := func(value string) *string {
		value = strings.TrimSpace(value)
		if value == "" {
			return nil
		}
		return &value
	}
	campaignName := metaText(details, change.Raw, "campaign_name")
	campaignID := metaText(details, change.Raw, "campaign_id")
	intakeDestination, err := distribution.ResolveIntakeDestination(ctx, tx, distribution.IntakeContext{
		OrganizationID:       integration.OrganizationID,
		PipelineID:           destination.PipelineID,
		Source:               source,
		PropertyID:           propertyID,
		InterestPropertyID:   propertyID,
		TagIDs:               tagIDs(formConfig),
		FormID:               optionalText(change.FormID),
		City:                 lead.Cidade,
		UTMCampaign:          optionalText(campaignName),
		LeadMetaCampaignName: optionalText(campaignName),
		MetaCampaignID:       optionalText(campaignID),
	})
	if err != nil {
		return resolvedDestination{}, err
	}
	return applyMetaIntakeDestination(destination, intakeDestination), nil
}

func applyMetaIntakeDestination(destination resolvedDestination, intakeDestination distribution.IntakeDestination) resolvedDestination {
	destination.RoundRobinID = intakeDestination.RoundRobinID
	destination.ReentryBehavior = intakeDestination.ReentryBehavior
	destination.RoundRobinResolved = intakeDestination.Resolved
	destination.TagIDs = append([]string(nil), intakeDestination.TagIDs...)
	return destination
}

func preserveAssigneeForMetaIntake(reentry bool, destination resolvedDestination) bool {
	return distribution.PreserveAssigneeForIntake(reentry, distribution.IntakeDestination{
		RoundRobinID:    destination.RoundRobinID,
		ReentryBehavior: destination.ReentryBehavior,
		Resolved:        destination.RoundRobinResolved,
	})
}

func (repo Repository) resolveDestinationForIntakeIdentity(ctx context.Context, tx pgx.Tx, integration metaIntegration, formConfig metaFormConfig, identity metaLeadIntakeIdentity) (resolvedDestination, error) {
	canonical, err := resolveStoredMetaLeadIntakeIdentity(identity.ScopeKey, identity.OriginRoundRobinID, "", "")
	if err != nil || canonical != identity {
		return resolvedDestination{}, fmt.Errorf("%w: invalid preserved Meta intake identity", ErrInvalidInput)
	}

	if identity.OriginRoundRobinID == "" {
		destination, err := repo.resolveDestinationWithRoundRobin(ctx, tx, integration, formConfig, nil, true)
		destination.RoundRobinResolved = true
		return destination, err
	}

	value := identity.OriginRoundRobinID
	destination, err := repo.resolveDestinationWithRoundRobin(ctx, tx, integration, formConfig, &value, true)
	if errors.Is(err, ErrInvalidInput) {
		// Queue provenance is durable even though queues themselves are
		// hard-deleted. Preserve the historical scope and force keep-assignee;
		// distribution with this missing explicit queue will return
		// no_matching_queue instead of silently selecting a different queue.
		return resolvedDestination{
			RoundRobinID:       &value,
			RoundRobinResolved: true,
			ReentryBehavior:    "keep_assignee",
			TagIDs:             tagIDs(formConfig),
		}, nil
	}
	return destination, err
}

func (repo Repository) resolveDestinationWithRoundRobin(ctx context.Context, tx pgx.Tx, integration metaIntegration, formConfig metaFormConfig, roundRobinID *string, includeInactiveRoundRobin bool) (resolvedDestination, error) {
	assignedUserID := firstUUID(formConfig.AssignedUserID, integration.AssignedUserID)
	destination := resolvedDestination{AssignedUserID: assignedUserID, TagIDs: tagIDs(formConfig)}

	if roundRobinID != nil {
		roundRobin, err := repo.resolveRoundRobin(ctx, tx, formConfig.OrganizationID, *roundRobinID, includeInactiveRoundRobin)
		if err != nil {
			return resolvedDestination{}, err
		}
		destination.RoundRobinID = roundRobin.RoundRobinID
		destination.RoundRobinResolved = roundRobin.RoundRobinResolved
		if roundRobin.PreservedQueueIdentity {
			// A delayed provider event owns the historical queue identity, not
			// today's form/integration defaults. The frozen destination (when it
			// is still active) is authoritative; nil keeps an existing card in
			// place and lets the lead INSERT trigger choose its audited fallback.
			roundRobin.TagIDs = nil
			return roundRobin, nil
		}
		destination.RoundRobinMemberID = roundRobin.RoundRobinMemberID
		destination.ReentryBehavior = roundRobin.ReentryBehavior
		destination.RedistributionSettings = roundRobin.RedistributionSettings
		if roundRobin.AssignedUserID != nil {
			destination.AssignedUserID = roundRobin.AssignedUserID
		}
		if roundRobin.PipelineID != nil || roundRobin.StageID != nil {
			destination.PipelineID = roundRobin.PipelineID
			destination.StageID = roundRobin.StageID
		}
	}

	if formConfig.StageID != nil {
		pipelineID, stageID, err := repo.resolveStage(ctx, tx, formConfig.OrganizationID, *formConfig.StageID)
		if err != nil {
			return resolvedDestination{}, err
		}
		if stageID != nil {
			destination.PipelineID = pipelineID
			destination.StageID = stageID
			return destination, nil
		}
	}

	if destination.RoundRobinID != nil && (destination.PipelineID != nil || destination.StageID != nil) {
		return destination, nil
	}

	if formConfig.PipelineID != nil {
		pipelineID, stageID, err := repo.resolvePipeline(ctx, tx, formConfig.OrganizationID, *formConfig.PipelineID)
		if err != nil {
			return resolvedDestination{}, err
		}
		if pipelineID != nil {
			destination.PipelineID = pipelineID
			destination.StageID = stageID
			return destination, nil
		}
	}

	if integration.StageID != nil {
		pipelineID, stageID, err := repo.resolveStage(ctx, tx, integration.OrganizationID, *integration.StageID)
		if err != nil {
			return resolvedDestination{}, err
		}
		if stageID != nil {
			destination.PipelineID = pipelineID
			destination.StageID = stageID
			return destination, nil
		}
	}

	if integration.PipelineID != nil {
		pipelineID, stageID, err := repo.resolvePipeline(ctx, tx, integration.OrganizationID, *integration.PipelineID)
		if err != nil {
			return resolvedDestination{}, err
		}
		if pipelineID != nil {
			destination.PipelineID = pipelineID
			destination.StageID = stageID
			return destination, nil
		}
	}

	pipelineID, stageID, err := repo.defaultDestination(ctx, tx, integration.OrganizationID)
	if err != nil {
		return resolvedDestination{}, err
	}
	destination.PipelineID = pipelineID
	destination.StageID = stageID
	return destination, nil
}

func (repo Repository) resolveStage(ctx context.Context, tx pgx.Tx, organizationID string, stageID string) (*string, *string, error) {
	var resolvedStageID string
	var pipelineID string
	err := tx.QueryRow(ctx, `
		select s.pipeline_id::text, s.id::text
		from public.stages s
		where s.organization_id = $1::uuid
		  and s.id = $2::uuid
		  and coalesce(s.is_active, true) = true
		limit 1
	`, organizationID, stageID).Scan(&pipelineID, &resolvedStageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return &pipelineID, &resolvedStageID, nil
}

func (repo Repository) resolvePipeline(ctx context.Context, tx pgx.Tx, organizationID string, pipelineID string) (*string, *string, error) {
	var resolvedPipelineID string
	var stageID pgtype.Text
	err := tx.QueryRow(ctx, `
		select p.id::text, (
			select s.id::text
			from public.stages s
			where s.organization_id = p.organization_id
			  and s.pipeline_id = p.id
			  and coalesce(s.is_active, true) = true
			order by s.position asc nulls last, s.created_at asc
			limit 1
		)
		from public.pipelines p
		where p.organization_id = $1::uuid
		  and p.id = $2::uuid
		  and coalesce(p.is_active, true) = true
		limit 1
	`, organizationID, pipelineID).Scan(&resolvedPipelineID, &stageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return &resolvedPipelineID, textPointer(stageID), nil
}

func (repo Repository) defaultDestination(ctx context.Context, tx pgx.Tx, organizationID string) (*string, *string, error) {
	var pipelineID pgtype.Text
	var stageID pgtype.Text
	err := tx.QueryRow(ctx, `
		select p.id::text, (
			select s.id::text
			from public.stages s
			where s.organization_id = p.organization_id
			  and s.pipeline_id = p.id
			  and coalesce(s.is_active, true) = true
			order by s.position asc nulls last, s.created_at asc
			limit 1
		)
		from public.pipelines p
		where p.organization_id = $1::uuid
		  and coalesce(p.is_active, true) = true
		order by coalesce(p.is_default, false) desc, p.position asc nulls last, p.created_at asc
		limit 1
	`, organizationID).Scan(&pipelineID, &stageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return textPointer(pipelineID), textPointer(stageID), nil
}
