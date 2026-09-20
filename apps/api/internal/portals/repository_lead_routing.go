package portals

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
)

type portalDestination struct {
	PipelineID         string
	StageID            string
	AssignedUserID     string
	TeamID             string
	RoundRobinID       string
	RoundRobinResolved bool
	RoundRobinMemberID string
	ReentryBehavior    string
}

func (repo Repository) resolvePortalDestination(ctx context.Context, tx pgx.Tx, integration publicIntegration) (portalDestination, error) {
	destination := portalDestination{
		PipelineID:         integration.DefaultPipelineID,
		StageID:            integration.DefaultStageID,
		AssignedUserID:     integration.DefaultAssignedUserID,
		RoundRobinResolved: integration.DefaultRoundRobinID != "",
	}
	fallbackUsed := false

	if integration.DefaultRoundRobinID != "" {
		var queuePipelineID, queueStageID, reentryBehavior string
		err := tx.QueryRow(ctx, `
			select
			  coalesce(target_pipeline_id::text, ''),
			  coalesce(target_stage_id::text, ''),
			  case
			    when lower(btrim(coalesce(
			      nullif(reentry_behavior, ''),
			      nullif(rules->>'reentry_behavior', ''),
			      'redistribute'
			    ))) = 'keep_assignee' then 'keep_assignee'
			    else 'redistribute'
			  end
			from public.round_robins
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and coalesce(is_active, true)
			for share
		`, integration.OrganizationID, integration.DefaultRoundRobinID).Scan(&queuePipelineID, &queueStageID, &reentryBehavior)
		if errors.Is(err, pgx.ErrNoRows) {
			fallbackUsed = true
			destination.RoundRobinID = ""
		} else if err != nil {
			return portalDestination{}, err
		} else {
			destination.RoundRobinID = integration.DefaultRoundRobinID
			destination.ReentryBehavior = reentryBehavior
			if destination.PipelineID == "" {
				destination.PipelineID = queuePipelineID
			}
			if destination.StageID == "" {
				destination.StageID = queueStageID
			}
		}
	}

	if destination.StageID != "" {
		var pipelineID string
		err := tx.QueryRow(ctx, `
			select pipeline_id::text
			from public.stages
			where organization_id = $1::uuid and id = $2::uuid and coalesce(is_active, true)
		`, integration.OrganizationID, destination.StageID).Scan(&pipelineID)
		if errors.Is(err, pgx.ErrNoRows) {
			fallbackUsed = true
			destination.StageID = ""
		} else if err != nil {
			return portalDestination{}, err
		} else {
			destination.PipelineID = pipelineID
		}
	}
	if destination.PipelineID != "" {
		var pipelineActive bool
		if err := tx.QueryRow(ctx, `
			select exists (
			  select 1 from public.pipelines
			  where organization_id = $1::uuid and id = $2::uuid and coalesce(is_active, true)
			)
		`, integration.OrganizationID, destination.PipelineID).Scan(&pipelineActive); err != nil {
			return portalDestination{}, err
		}
		if !pipelineActive {
			fallbackUsed = true
			destination.PipelineID = ""
			destination.StageID = ""
		}
	}
	if destination.AssignedUserID != "" {
		var assigneeActive bool
		if err := tx.QueryRow(ctx, `
			select exists (
			  select 1
			  from public.organization_members member
			  join public.users user_profile on user_profile.id = member.user_id
			  where member.organization_id = $1::uuid
			    and member.user_id = $2::uuid
			    and coalesce(member.is_active, true)
			    and coalesce(user_profile.is_active, true)
			)
		`, integration.OrganizationID, destination.AssignedUserID).Scan(&assigneeActive); err != nil {
			return portalDestination{}, err
		}
		if !assigneeActive {
			fallbackUsed = true
			destination.AssignedUserID = ""
		}
	}
	if destination.PipelineID == "" {
		err := tx.QueryRow(ctx, `
			select id::text
			from public.pipelines
			where organization_id = $1::uuid and coalesce(is_active, true)
			order by is_default desc, position asc, created_at asc
			limit 1
		`, integration.OrganizationID).Scan(&destination.PipelineID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return portalDestination{}, err
		}
		if errors.Is(err, pgx.ErrNoRows) {
			destination.PipelineID = ""
		}
	}
	if destination.PipelineID != "" && destination.StageID == "" {
		err := tx.QueryRow(ctx, `
			select id::text
			from public.stages
			where organization_id = $1::uuid and pipeline_id = $2::uuid and coalesce(is_active, true)
			order by position asc, created_at asc
			limit 1
		`, integration.OrganizationID, destination.PipelineID).Scan(&destination.StageID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return portalDestination{}, err
		}
		if errors.Is(err, pgx.ErrNoRows) {
			destination.StageID = ""
		}
	}
	if fallbackUsed {
		// Configuration drift must never drop an authenticated provider lead.
		// Record a stable operational signal and continue with the active fallback.
		_, _ = tx.Exec(ctx, `
			update public.portal_integrations
			set last_sync_status = 'lead_destination_fallback',
			    last_error = 'Destino de leads inativo; fallback ativo aplicado.'
			where id = $1::uuid
		`, integration.ID)
	}
	return destination, nil
}

func resolveAutomaticPortalIntakeDestination(ctx context.Context, tx pgx.Tx, organizationID string, destination portalDestination, propertyID *string) (portalDestination, error) {
	if destination.RoundRobinResolved {
		return destination, nil
	}
	var pipelineID *string
	if destination.PipelineID != "" {
		pipelineID = &destination.PipelineID
	}
	intakeDestination, err := distribution.ResolveIntakeDestination(ctx, tx, distribution.IntakeContext{
		OrganizationID:     organizationID,
		PipelineID:         pipelineID,
		Source:             "grupo_olx",
		PropertyID:         propertyID,
		InterestPropertyID: propertyID,
	})
	if err != nil {
		return portalDestination{}, err
	}
	return applyPortalIntakeDestination(destination, intakeDestination), nil
}

func applyPortalIntakeDestination(destination portalDestination, intakeDestination distribution.IntakeDestination) portalDestination {
	destination.RoundRobinResolved = intakeDestination.Resolved
	destination.ReentryBehavior = intakeDestination.ReentryBehavior
	if intakeDestination.RoundRobinID != nil {
		destination.RoundRobinID = *intakeDestination.RoundRobinID
	} else {
		destination.RoundRobinID = ""
	}
	return destination
}

func preserveAssigneeForPortalIntake(reentry bool, destination portalDestination) bool {
	var roundRobinID *string
	if destination.RoundRobinID != "" {
		roundRobinID = &destination.RoundRobinID
	}
	return distribution.PreserveAssigneeForIntake(reentry, distribution.IntakeDestination{
		RoundRobinID:    roundRobinID,
		ReentryBehavior: destination.ReentryBehavior,
		Resolved:        destination.RoundRobinResolved,
	})
}

func selectPortalRoundRobinMember(ctx context.Context, tx pgx.Tx, organizationID string, roundRobinID string) (string, string, string, error) {
	var memberID, userID, teamID string
	err := tx.QueryRow(ctx, `
		with entries as (
			select rrm.id, rrm.round_robin_id, rrm.organization_id, rrm.user_id, rrm.team_id,
			       coalesce(rrm.position, 0) as position, rrm.created_at
			from public.round_robin_members rrm
			where rrm.organization_id = $1::uuid
			  and rrm.round_robin_id = $2::uuid
			  and coalesce(rrm.is_active, true)
		), candidates as (
			select entries.id, entries.round_robin_id, entries.organization_id, entries.user_id,
			       entries.team_id, entries.position, entries.created_at,
			       tm.id as team_member_id, tm.created_at as team_member_created_at
			from entries
			left join public.teams direct_team
			  on direct_team.id = entries.team_id
			 and direct_team.organization_id = entries.organization_id
			 and coalesce(direct_team.is_active, true)
			left join public.team_members tm
			  on tm.organization_id = entries.organization_id
			 and tm.team_id = entries.team_id
			 and tm.user_id = entries.user_id
			 and coalesce(tm.is_active, true)
			where entries.user_id is not null
			  and (entries.team_id is null or (direct_team.id is not null and tm.id is not null))
			union all
			select entries.id, entries.round_robin_id, entries.organization_id, tm.user_id,
			       entries.team_id, entries.position, entries.created_at,
			       tm.id, tm.created_at
			from entries
			join public.teams team
			  on team.id = entries.team_id and team.organization_id = entries.organization_id and coalesce(team.is_active, true)
			join public.team_members tm
			  on tm.organization_id = entries.organization_id
			 and tm.team_id = entries.team_id
			 and coalesce(tm.is_active, true)
			where entries.user_id is null and entries.team_id is not null
		)
		select candidates.id::text, candidates.user_id::text, coalesce(candidates.team_id::text, '')
		from candidates
		join public.organization_members om
		  on om.organization_id = candidates.organization_id
		 and om.user_id = candidates.user_id
		 and coalesce(om.is_active, true)
		join public.users user_profile
		  on user_profile.id = candidates.user_id and coalesce(user_profile.is_active, true)
		left join lateral (
			select count(*)::bigint as total
			from public.round_robin_logs log
			where log.organization_id = candidates.organization_id
			  and log.round_robin_id = candidates.round_robin_id
			  and log.assigned_user_id = candidates.user_id
		) user_logs on true
		where `+distribution.RoundRobinAvailabilityPredicateSQL+`
		order by coalesce(user_logs.total, 0) asc, candidates.position asc,
		         candidates.created_at asc, candidates.team_member_created_at asc nulls last,
		         candidates.user_id asc
		limit 1
	`, organizationID, roundRobinID).Scan(&memberID, &userID, &teamID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", "", nil
	}
	return memberID, userID, teamID, err
}

func recordPortalRoundRobinAssignment(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, destination portalDestination, eventKey string) error {
	metadata, _ := json.Marshal(map[string]any{
		"member_id":      destination.RoundRobinMemberID,
		"origin_lead_id": eventKey,
		"source":         "grupo_olx",
	})
	_, err := tx.Exec(ctx, `
		insert into public.round_robin_logs (
			organization_id, round_robin_id, lead_id, assigned_user_id, reason, metadata
		) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'grupo_olx', $5::jsonb)
	`, organizationID, destination.RoundRobinID, leadID, destination.AssignedUserID, string(metadata))
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		update public.round_robins
		set current_position = coalesce(current_position, 0) + 1, updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, destination.RoundRobinID)
	return err
}
