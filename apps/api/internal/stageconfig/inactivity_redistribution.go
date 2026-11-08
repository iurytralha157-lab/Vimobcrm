package stageconfig

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/roundrobin"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type StageInactivityRedistributor func(context.Context, pgx.Tx, StageInactivityRedistributionRequest) (string, error)

type StageInactivityRedistributionRequest struct {
	OrganizationID, ActorID, LeadID, StageID, RoundRobinID, AutomationID, EpisodeKey string
}

var (
	errInactivityQueueUnavailable = errors.New("stage inactivity redistribution is waiting for the queue")
	errInactivitySameAssignee     = errors.New("stage inactivity redistribution selected the same assignee")
)

func (repo Repository) WithStageInactivityRedistributor(redistributor StageInactivityRedistributor) Repository {
	repo.inactivityRedistributor = redistributor
	return repo
}

func validateInactivityRedistributionRule(ctx context.Context, tx pgx.Tx, actor tenant.Context, stageID, automationID string, current *StageInactivityPolicy, input stageInactivityInput) error {
	// An administrator can still pause a rule if its existing queue was removed.
	keepsDisabledQueue := !input.Enabled && current != nil && current.TargetRoundRobinID != nil &&
		*current.TargetRoundRobinID == input.TargetRoundRobinID
	if !keepsDisabledQueue {
		if err := roundrobin.LockActiveQueueForDistribution(ctx, tx, actor, input.TargetRoundRobinID); errors.Is(err, roundrobin.ErrRoundRobinNotFound) {
			return fmt.Errorf("%w: escolha uma fila de distribuição ativa à qual você tenha acesso", ErrInvalidInput)
		} else if err != nil {
			return err
		}
	}
	if !input.Enabled {
		return nil
	}
	var alreadyEnabled bool
	err := tx.QueryRow(ctx, `select exists (select 1 from private.stage_inactivity_policies
 where organization_id=$1::uuid and stage_id=$2::uuid and action_kind='redistribute'
   and is_enabled and automation_id is distinct from $3::uuid)`, actor.OrganizationID, stageID, nullableUUID(automationID)).Scan(&alreadyEnabled)
	if err != nil {
		return err
	}
	if alreadyEnabled {
		return fmt.Errorf("%w: esta coluna já tem uma regra ativa de redistribuição", ErrInvalidInput)
	}
	return nil
}

func (repo Repository) redistributeInactiveLead(ctx context.Context, tx pgx.Tx, job inactivityJob, policy StageInactivityPolicy, now time.Time) (string, error) {
	if repo.inactivityRedistributor == nil {
		return "", errors.New("stage inactivity redistributor is not configured")
	}
	if policy.ActingUserID == nil || policy.TargetRoundRobinID == nil {
		return "", ErrInactivityPolicyIncomplete
	}
	attempt, err := tx.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer rollbackInactivityTransaction(attempt)
	outcome, err := repo.inactivityRedistributor(ctx, attempt, StageInactivityRedistributionRequest{
		OrganizationID: job.OrganizationID, ActorID: *policy.ActingUserID, LeadID: job.LeadID,
		StageID: policy.StageID, RoundRobinID: *policy.TargetRoundRobinID,
		AutomationID: policy.AutomationID, EpisodeKey: job.EpisodeKey,
	})
	if err != nil {
		return "", err
	}
	switch outcome {
	case "queue_unavailable":
		return "", errInactivityQueueUnavailable
	case "same_assignee":
		return "", errInactivitySameAssignee
	case "redistributed":
	default:
		rollbackInactivityTransaction(attempt)
		return finishInactivityJob(ctx, tx, job, now, "cancelled", outcome)
	}
	var destinationStageID string
	if err := attempt.QueryRow(ctx, `select stage_id::text from public.leads where organization_id=$1::uuid and id=$2::uuid`,
		job.OrganizationID, job.LeadID).Scan(&destinationStageID); err != nil {
		return "", err
	}
	if destinationStageID != policy.StageID {
		var returnsToSource bool
		if err := attempt.QueryRow(ctx, inactivityRedistributionCycleSQL, job.OrganizationID, policy.StageID, destinationStageID).Scan(&returnsToSource); err != nil {
			return "", err
		}
		if returnsToSource {
			rollbackInactivityTransaction(attempt)
			return finishInactivityJob(ctx, tx, job, now, "cancelled", "stage_cycle")
		}
	}
	if err := attempt.Commit(ctx); err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `update private.stage_inactivity_jobs set status='redistributed',
 redistributed_at=$3, error_code=null, updated_at=$3
 where organization_id=$1::uuid and id=$2::uuid and status='pending'`, job.OrganizationID, job.ID, now)
	return outcome, err
}

// Distribution destinations can change independently of stage rules. Check
// the graph at execution using the stage the allocator actually selected.
// UNION keeps the recursive search bounded to each reachable column once.
const inactivityRedistributionCycleSQL = `with recursive edges as materialized (
 select policy.stage_id, coalesce(policy.target_stage_id, queue.target_stage_id, first_stage.id) as destination
 from private.stage_inactivity_policies policy
 join public.stage_automations automation on automation.organization_id=policy.organization_id
   and automation.id=policy.automation_id and automation.stage_id=policy.stage_id
   and automation.updated_at=policy.automation_updated_at and automation.is_active=true
 join public.stages source on source.organization_id=policy.organization_id
   and source.id=policy.stage_id and source.is_active=true
 left join public.round_robins queue on policy.action_kind='redistribute' and queue.organization_id=policy.organization_id
   and queue.id=policy.target_round_robin_id and queue.deleted_at is null and coalesce(queue.is_active,true)
 left join lateral (
   select stage.id from public.stages stage
   where queue.target_stage_id is null and queue.target_pipeline_id<>source.pipeline_id
     and stage.organization_id=policy.organization_id and stage.pipeline_id=queue.target_pipeline_id and stage.is_active=true
   order by stage.position, stage.id limit 1
 ) first_stage on true
 where policy.organization_id=$1::uuid and policy.is_enabled
   and policy.action_kind in ('move_stage','redistribute')
 ), reachable(id) as (
   select $3::uuid
   union
   select edge.destination from reachable join edges edge on edge.stage_id=reachable.id
   where edge.destination is not null and edge.destination<>edge.stage_id
 )
 select exists (select 1 from reachable where id=$2::uuid)`
