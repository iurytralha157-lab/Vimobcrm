package roundrobin

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type roundRobinState struct {
	ID         string
	PipelineID *string
	Metadata   map[string]any
}

func (repo Repository) getStateForUpdate(ctx context.Context, q queryer, organizationID string, roundRobinID string) (roundRobinState, error) {
	var state roundRobinState
	var pipelineID pgtype.Text
	var metadataRaw string
	err := q.QueryRow(ctx, `
		select
			id::text,
			coalesce(target_pipeline_id, pipeline_id)::text,
			(
			  coalesce(rules, '{}'::jsonb)
			  || jsonb_strip_nulls(jsonb_build_object(
			    'strategy', coalesce(nullif(strategy, ''), rules->>'strategy', 'simple'),
			    'target_stage_id', coalesce(target_stage_id::text, rules->>'target_stage_id'),
			    'settings', coalesce(settings, rules->'settings', '{}'::jsonb),
			    'reentry_behavior', coalesce(nullif(reentry_behavior, ''), rules->>'reentry_behavior', 'redistribute')
			  ))
			)::text
		from public.round_robins
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and deleted_at is null
		for update
	`, organizationID, roundRobinID).Scan(&state.ID, &pipelineID, &metadataRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return roundRobinState{}, ErrRoundRobinNotFound
	}
	if err != nil {
		return roundRobinState{}, err
	}

	if pipelineID.Valid {
		state.PipelineID = &pipelineID.String
	}
	state.Metadata = parseObject(metadataRaw)
	return state, nil
}

// rejectPendingWhatsAppIntake must run only after the caller holds the queue
// row FOR UPDATE. The pre-ACK snapshot trigger takes FOR SHARE on that same row,
// so this check is the causal boundary for every queue/rule mutation.
func (repo Repository) rejectPendingWhatsAppIntake(ctx context.Context, q queryer, organizationID string, roundRobinID string) error {
	var pending bool
	if err := q.QueryRow(ctx, `
		select private.round_robin_has_pending_whatsapp_intake(
		  $1::uuid,
		  $2::uuid
		)
	`, organizationID, roundRobinID).Scan(&pending); err != nil {
		return err
	}
	if pending {
		return ErrPendingWhatsAppIntake
	}
	return nil
}

func (repo Repository) ensureRoundRobin(ctx context.Context, q queryer, organizationID string, roundRobinID string) error {
	var exists bool
	if err := q.QueryRow(ctx, `
		select exists (
			select 1
			from public.round_robins
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and deleted_at is null
		)
	`, organizationID, roundRobinID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrRoundRobinNotFound
	}
	return nil
}

func (repo Repository) validateDestination(ctx context.Context, q queryer, organizationID string, pipelineID *string, stageID *string) error {
	if pipelineID != nil {
		if err := repo.ensurePipeline(ctx, q, organizationID, *pipelineID); err != nil {
			return err
		}
	}
	if stageID != nil {
		var exists bool
		err := q.QueryRow(ctx, `
			select exists (
				select 1
				from public.stages
				where organization_id = $1::uuid
				  and id = $2::uuid
				  and ($3::uuid is null or pipeline_id = $3::uuid)
			)
		`, organizationID, *stageID, nullable(pipelineID)).Scan(&exists)
		if err != nil {
			return err
		}
		if !exists {
			return ErrInvalidReference
		}
	}
	return nil
}

func (repo Repository) validateRedistributionCapacity(ctx context.Context, q queryer, organizationID string, roundRobinID string, settings map[string]any) error {
	if !boolFromObject(settings, "enable_redistribution") {
		return nil
	}

	var eligibleUsers int
	err := q.QueryRow(ctx, `
		with entries as (
			select rrm.organization_id, rrm.user_id, rrm.team_id
			from public.round_robin_members rrm
			where rrm.organization_id = $1::uuid
			  and rrm.round_robin_id = $2::uuid
			  and coalesce(rrm.is_active, true) = true
		), candidates as (
			select organization_id, user_id from entries where user_id is not null
			union
			select e.organization_id, tm.user_id
			from entries e
			join public.teams t
			  on t.id = e.team_id and t.organization_id = e.organization_id and coalesce(t.is_active, true) = true
			join public.team_members tm
			  on tm.team_id = e.team_id and tm.organization_id = e.organization_id and coalesce(tm.is_active, true) = true
			where e.team_id is not null
		)
		select count(distinct c.user_id)::int
		from candidates c
		join public.organization_members om
		  on om.organization_id = c.organization_id and om.user_id = c.user_id and coalesce(om.is_active, true) = true
		join public.users u on u.id = c.user_id and coalesce(u.is_active, true) = true
	`, organizationID, roundRobinID).Scan(&eligibleUsers)
	if err != nil {
		return err
	}
	if eligibleUsers < 2 {
		return fmt.Errorf("%w: automatic redistribution requires at least two active eligible users", ErrInvalidInput)
	}
	return nil
}

func (repo Repository) ensurePipeline(ctx context.Context, q queryer, organizationID string, pipelineID string) error {
	var exists bool
	err := q.QueryRow(ctx, `
		select exists (
			select 1
			from public.pipelines
			where organization_id = $1::uuid
			  and id = $2::uuid
		)
	`, organizationID, pipelineID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}
	return nil
}
