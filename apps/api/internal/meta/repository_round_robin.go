package meta

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
)

func (repo Repository) resolveRoundRobin(ctx context.Context, tx pgx.Tx, organizationID string, roundRobinID string, includeInactive bool) (resolvedDestination, error) {
	var raw []byte
	err := tx.QueryRow(ctx, `
		select to_jsonb(rr)
		from public.round_robins rr
		where rr.organization_id = $1::uuid
		  and rr.id = $2::uuid
		  and ($3::boolean or coalesce(rr.is_active, true) = true)
		limit 1
		for share of rr
	`, organizationID, roundRobinID, includeInactive).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return resolvedDestination{}, ErrInvalidInput
	}
	if err != nil {
		return resolvedDestination{}, err
	}

	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return resolvedDestination{}, err
	}

	deleted := strings.TrimSpace(textFromAny(item["deleted_at"])) != ""
	destination := resolvedDestination{
		RoundRobinID:           uuidPointer(item["id"]),
		RoundRobinResolved:     true,
		PreservedQueueIdentity: deleted,
	}
	if deleted {
		destination.PipelineID = uuidPointer(item["tombstone_pipeline_id"])
		destination.StageID = uuidPointer(item["tombstone_stage_id"])
		destination.ReentryBehavior = "keep_assignee"
	} else {
		rules := objectMap(item["rules"])
		destination.PipelineID = firstUUID(
			uuidPointer(item["target_pipeline_id"]),
			uuidPointer(item["pipeline_id"]),
		)
		destination.StageID = firstUUID(
			uuidPointer(item["target_stage_id"]),
			uuidPointer(rules["target_stage_id"]),
		)
		destination.ReentryBehavior = normalizeMetaReentryBehavior(firstNonEmptyText(
			textFromAny(item["reentry_behavior"]),
			textFromAny(rules["reentry_behavior"]),
		))
		destination.RedistributionSettings = objectMap(rules["settings"])
	}
	if destination.StageID != nil {
		pipelineID, stageID, err := repo.resolveStage(ctx, tx, organizationID, *destination.StageID)
		if err != nil {
			return resolvedDestination{}, err
		}
		destination.PipelineID = pipelineID
		destination.StageID = stageID
	} else if destination.PipelineID != nil {
		pipelineID, stageID, err := repo.resolvePipeline(ctx, tx, organizationID, *destination.PipelineID)
		if err != nil {
			return resolvedDestination{}, err
		}
		destination.PipelineID = pipelineID
		destination.StageID = stageID
	}
	if destination.PreservedQueueIdentity &&
		(destination.PipelineID == nil || destination.StageID == nil) {
		// Never substitute current form/integration routing for a preserved
		// queue. A new card is hydrated by the tombstone trigger; a reentry
		// retains its existing board position through the nil/coalesce update.
		destination.PipelineID = nil
		destination.StageID = nil
	}

	return destination, nil
}

func (repo Repository) selectRoundRobinMember(ctx context.Context, tx pgx.Tx, organizationID string, roundRobinID string) (*string, *string, *string, error) {
	var memberID pgtype.Text
	var userID pgtype.Text
	var teamID pgtype.Text
	err := tx.QueryRow(ctx, `
		with entries as (
			select
				rrm.id,
				rrm.round_robin_id,
				rrm.organization_id,
				rrm.user_id,
				rrm.team_id,
				rrm.membership_generation,
				coalesce(rrm.position, 0) as position,
				rrm.created_at,
				coalesce(entry_logs.total, 0) as entry_total
			from public.round_robin_members rrm
			join public.round_robins rr
			  on rr.id = rrm.round_robin_id
			 and rr.organization_id = rrm.organization_id
			left join lateral (
				select count(*)::bigint as total
				from public.round_robin_logs rrl
				where rrl.organization_id = rrm.organization_id
				  and rrl.round_robin_id = rrm.round_robin_id
				  and (
				    rrl.metadata->>'member_id' = rrm.id::text
				    or (rrm.user_id is not null and rrl.assigned_user_id = rrm.user_id)
				  )
			) entry_logs on true
			where rrm.organization_id = $1::uuid
			  and rrm.round_robin_id = $2::uuid
			  and coalesce(rrm.is_active, true) = true
		),
		candidates as (
			select
				entries.id,
				entries.round_robin_id,
				entries.organization_id,
				entries.user_id,
				entries.team_id,
				entries.membership_generation,
				entries.position,
				entries.created_at,
				entries.entry_total,
				tm.id as team_member_id,
				tm.created_at as team_member_created_at
			from entries
			left join public.teams direct_team
			  on direct_team.id = entries.team_id
			 and direct_team.organization_id = entries.organization_id
			 and coalesce(direct_team.is_active, true) = true
			left join public.team_members tm
			  on tm.organization_id = entries.organization_id
			 and tm.team_id = entries.team_id
			 and tm.user_id = entries.user_id
			 and tm.membership_generation = entries.membership_generation
			 and coalesce(tm.is_active, true) = true
			where entries.user_id is not null
			  and (entries.team_id is null or (direct_team.id is not null and tm.id is not null))

			union all

			select
				entries.id,
				entries.round_robin_id,
				entries.organization_id,
				tm.user_id,
				entries.team_id,
				tm.membership_generation,
				entries.position,
				entries.created_at,
				entries.entry_total,
				tm.id as team_member_id,
				tm.created_at as team_member_created_at
			from entries
			join public.teams t
			  on t.id = entries.team_id
			 and t.organization_id = entries.organization_id
			 and coalesce(t.is_active, true) = true
			join public.team_members tm
			  on tm.organization_id = entries.organization_id
			 and tm.team_id = entries.team_id
			 and coalesce(tm.is_active, true) = true
			where entries.user_id is null
			  and entries.team_id is not null
		)
		select candidates.id::text, candidates.user_id::text, candidates.team_id::text
		from candidates
		join public.organization_members om
		  on om.organization_id = candidates.organization_id
		 and om.user_id = candidates.user_id
		 and coalesce(om.is_active, true) = true
		 and om.deleted_at is null
		 and om.membership_generation = candidates.membership_generation
		join public.users u
		  on u.id = candidates.user_id
		 and coalesce(u.is_active, true) = true
		left join lateral (
			select count(*)::bigint as total
			from public.round_robin_logs rrl
			where rrl.organization_id = candidates.organization_id
			  and rrl.round_robin_id = candidates.round_robin_id
			  and rrl.assigned_user_id = candidates.user_id
		) user_logs on true
		where `+distribution.RoundRobinAvailabilityPredicateSQL+`
		order by candidates.entry_total asc, candidates.position asc, candidates.created_at asc, coalesce(user_logs.total, 0) asc, candidates.team_member_created_at asc nulls last, candidates.user_id asc
		limit 1
	`, organizationID, roundRobinID).Scan(&memberID, &userID, &teamID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil, nil
	}
	if err != nil {
		return nil, nil, nil, err
	}
	return textPointer(memberID), textPointer(userID), textPointer(teamID), nil
}

func (repo Repository) insertRoundRobinLog(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, destination resolvedDestination, change leadgenChange) error {
	_, err := tx.Exec(ctx, `
		insert into public.round_robin_logs (
			organization_id,
			round_robin_id,
			lead_id,
			assigned_user_id,
			reason,
			metadata
		)
		values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'meta_lead_ads', $5::jsonb)
	`, organizationID, nullablePointer(destination.RoundRobinID), leadID, nullablePointer(destination.AssignedUserID), jsonb(map[string]any{
		"leadgen_id": change.LeadgenID,
		"form_id":    change.FormID,
		"page_id":    change.PageID,
		"member_id":  nullablePointer(destination.RoundRobinMemberID),
	}))
	if err != nil {
		return err
	}
	_, _ = tx.Exec(ctx, `
		update public.round_robins
		set current_position = coalesce(current_position, 0) + 1,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, nullablePointer(destination.RoundRobinID))
	return nil
}
