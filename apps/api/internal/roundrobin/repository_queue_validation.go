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
	Revision   int64
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
			revision,
			coalesce(target_pipeline_id, pipeline_id)::text,
			(
			  coalesce(rules, '{}'::jsonb)
			  || jsonb_strip_nulls(jsonb_build_object(
			    'strategy', coalesce(nullif(strategy, ''), rules->>'strategy', 'simple'),
			    'target_stage_id', coalesce(target_stage_id::text, rules->>'target_stage_id'),
			    'reentry_behavior', coalesce(nullif(reentry_behavior, ''), rules->>'reentry_behavior', 'redistribute')
			  ))
			  || jsonb_build_object('settings', coalesce(settings, rules->'settings', '{}'::jsonb))
			)::text
		from public.round_robins
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and deleted_at is null
		for update
	`, organizationID, roundRobinID).Scan(&state.ID, &state.Revision, &pipelineID, &metadataRaw)
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
		var locked pgtype.Text
		err := q.QueryRow(ctx, `
			select exists (
				select 1
				from public.stages
				where organization_id = $1::uuid
				  and id = $2::uuid
				  and ($3::uuid is null or pipeline_id = $3::uuid)
				  and coalesce(is_active, true) = true
			), (
				select id::text from public.stages
				where organization_id = $1::uuid
				  and id = $2::uuid
				  and ($3::uuid is null or pipeline_id = $3::uuid)
				  and coalesce(is_active, true) = true
				for share skip locked
			)
		`, organizationID, *stageID, nullable(pipelineID)).Scan(&exists, &locked)
		if err != nil {
			return err
		}
		if !exists {
			return ErrInvalidReference
		}
		if !locked.Valid {
			return ErrRevisionConflict
		}
	}
	return nil
}

func (repo Repository) validateUpdatedDestination(ctx context.Context, q queryer, organizationID string, current roundRobinState, pipelineID, stageID *string) error {
	// The trusted current pair was loaded under the tenant-scoped queue lock.
	// Retaining it does not grant a new reference, even if a legacy destination
	// is inactive or the client explicitly repeats the same IDs while renaming.
	currentStageID := stringPointerFromMetadata(current.Metadata, "target_stage_id")
	if sameOptionalString(current.PipelineID, pipelineID) && sameOptionalString(currentStageID, stageID) {
		return nil
	}
	return repo.validateDestination(ctx, q, organizationID, pipelineID, stageID)
}

func (repo Repository) validateRedistributionCapacity(ctx context.Context, q queryer, organizationID string, roundRobinID string, settings map[string]any) error {
	if _, managed := settings["operating_schedule"]; managed {
		ready, err := managedQueueSchedulesAvailable(ctx, q)
		if err != nil {
			return err
		}
		if !ready {
			return fmt.Errorf("%w: queue operating schedule requires the managed runtime", ErrInvalidInput)
		}
		// A managed queue with zero/one users remains safe in its private pool;
		// runtime selection, rather than configuration, decides availability.
		return nil
	}
	if !boolFromObject(settings, "enable_redistribution") {
		return nil
	}

	eligibleUsers, err := repo.queueEligibleUserCount(ctx, q, organizationID, roundRobinID)
	if err != nil {
		return err
	}
	if eligibleUsers < 2 {
		return fmt.Errorf("%w: automatic redistribution requires at least two active eligible users", ErrInvalidInput)
	}
	return nil
}

func managedQueueSchedulesAvailable(ctx context.Context, q queryer) (bool, error) {
	var available bool
	err := q.QueryRow(ctx, `select
		pg_catalog.to_regprocedure('private.process_queue_runtime_batch(integer,timestamp with time zone)') is not null
		and pg_catalog.to_regclass('private.queue_runtime_worker_cursors') is not null
		and exists(select 1 from pg_catalog.pg_trigger
		  where tgrelid='public.round_robins'::regclass and tgname='zz_validate_queue_operating_schedule'
		    and tgenabled in ('O','A') and tgfoid=pg_catalog.to_regprocedure('private.validate_queue_operating_schedule_write()'))
		and exists(select 1 from pg_catalog.pg_policy
		  where polrelid='public.leads'::regclass and polname='queue_pool_private_read'
		    and not polpermissive and polcmd='r' and 'authenticated'::regrole::oid=any(polroles))
		and exists(select 1 from pg_catalog.pg_proc
		  where oid=pg_catalog.to_regprocedure('private.can_read_lead_by_id(uuid)')
		    and strpos(prosrc,'private.queue_pool_related_read_access(')>0)
		and not exists(select 1 from pg_catalog.pg_trigger
		  where tgrelid='public.round_robins'::regclass and tgname='queue_managed_admission_hold')`).Scan(&available)
	return available, err
}

func (repo Repository) ensurePipeline(ctx context.Context, q queryer, organizationID string, pipelineID string) error {
	var exists bool
	var locked pgtype.Text
	// Queue writers already own their queue parents. Pipeline writers can own
	// this pipeline before referencing a queue. Never wait in that reverse order:
	// SKIP LOCKED fails the save atomically and SHARE protects activity until commit.
	err := q.QueryRow(ctx, `
		select exists (
			select 1
			from public.pipelines
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and coalesce(is_active, true) = true
		), (
			select id::text from public.pipelines
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and coalesce(is_active, true) = true
			for share skip locked
		)
	`, organizationID, pipelineID).Scan(&exists, &locked)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}
	if !locked.Valid {
		return ErrRevisionConflict
	}
	return nil
}
