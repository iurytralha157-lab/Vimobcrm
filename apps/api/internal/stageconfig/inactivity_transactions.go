package stageconfig

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

func inactivityPhaseBudgetAvailable(ctx context.Context) bool {
	deadline, ok := ctx.Deadline()
	return ctx.Err() == nil && (!ok || time.Until(deadline) >= 10*time.Second)
}

func addInactivityCycleResult(result *StageInactivityCycleResult, committed StageInactivityCycleResult) {
	result.Scanned += committed.Scanned
	result.Enqueued += committed.Enqueued
	result.Notified += committed.Notified
	result.Moved += committed.Moved
	result.Redistributed += committed.Redistributed
	result.Waiting += committed.Waiting
	result.Cancelled += committed.Cancelled
	result.Failed += committed.Failed
	result.Dead += committed.Dead
}

func (repo Repository) deferFailedInactivityScan(ctx context.Context, policy inactivityScanPolicy, now time.Time) error {
	cleanupCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	_, err := repo.db.Pool().Exec(cleanupCtx, `update private.stage_inactivity_policies
 set next_scan_at=$5 where organization_id=$1::uuid and automation_id=$2::uuid
 and activation_epoch=$3::uuid and revision=$4`, policy.OrganizationID, policy.AutomationID, policy.Epoch, policy.Revision, now.Add(2*time.Minute))
	return err
}

func (repo Repository) scanInactivityPolicyTransaction(ctx context.Context, candidate inactivityScanPolicy, now time.Time) (result StageInactivityCycleResult, returnErr error) {
	defer inactivityPhaseRecovery(&result, &returnErr)
	phaseCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	tx, err := repo.db.Pool().Begin(phaseCtx)
	if err != nil {
		return result, err
	}
	defer rollbackInactivityTransaction(tx)
	if _, err := tx.Exec(phaseCtx, `set local lock_timeout = '2s'; set local statement_timeout = '2s'`); err != nil {
		return result, err
	}
	var locked bool
	if err := tx.QueryRow(phaseCtx, `select pg_try_advisory_xact_lock($1)`, inactivityLockKey).Scan(&locked); err != nil || !locked {
		return result, err
	}
	if exists, err := lockInactivityParents(phaseCtx, tx, candidate.OrganizationID, candidate.AutomationID); err != nil || !exists {
		return result, err
	}
	var policy inactivityScanPolicy
	err = tx.QueryRow(phaseCtx, inactivityScanPolicyClaimSQL, candidate.OrganizationID, candidate.AutomationID, now).Scan(append(inactivityPolicyDestinations(&policy.StageInactivityPolicy), &policy.AfterLeadID)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	if err := policy.Validate(); err != nil {
		return result, err
	}
	if err := repo.scanInactivityPolicy(phaseCtx, tx, policy, now, &result); err != nil {
		return result, err
	}
	if err := tx.Commit(phaseCtx); err != nil {
		return result, err
	}
	return result, nil
}

func (repo Repository) processInactivityJobTransaction(ctx context.Context, candidate inactivityJob, now time.Time) (result StageInactivityCycleResult, returnErr error) {
	defer inactivityPhaseRecovery(&result, &returnErr)
	phaseCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	tx, err := repo.db.Pool().Begin(phaseCtx)
	if err != nil {
		return result, err
	}
	defer rollbackInactivityTransaction(tx)
	if _, err := tx.Exec(phaseCtx, `set local lock_timeout = '2s'; set local statement_timeout = '2s'`); err != nil {
		return result, err
	}
	parentsExist, err := lockInactivityParents(phaseCtx, tx, candidate.OrganizationID, candidate.AutomationID)
	if err != nil {
		return result, err
	}
	// DeleteLead locks its lead before ON DELETE CASCADE touches jobs. Match
	// that order and skip a busy/deleting lead before owning any child job.
	var lockedLeadID string
	err = tx.QueryRow(phaseCtx, `select id::text from public.leads
 where organization_id=$1::uuid and id=$2::uuid for update skip locked`, candidate.OrganizationID, candidate.LeadID).Scan(&lockedLeadID)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	var job inactivityJob
	err = tx.QueryRow(phaseCtx, inactivityClaimJobSQL, candidate.OrganizationID, candidate.ID, now, candidate.LeadID).Scan(&job.ID, &job.OrganizationID, &job.AutomationID, &job.LeadID, &job.Epoch, &job.Revision, &job.EpisodeKey, &job.Attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	if !parentsExist {
		if _, err := finishInactivityJob(phaseCtx, tx, job, now, "cancelled", "policy_changed"); err != nil {
			return result, err
		}
		result.Cancelled = 1
	} else {
		savepoint, err := tx.Begin(phaseCtx)
		if err != nil {
			return result, err
		}
		outcome, processErr := repo.processInactivityJobSafely(phaseCtx, savepoint, job, now)
		if processErr != nil {
			rollbackInactivityTransaction(savepoint)
			if err := markInactivityFailure(phaseCtx, tx, job, now, processErr); err != nil {
				return result, err
			}
			result.Failed = 1
			if job.Attempts+1 >= inactivityMaximumAttempts {
				result.Dead = 1
			}
		} else {
			if err := savepoint.Commit(phaseCtx); err != nil {
				return result, err
			}
			switch outcome {
			case "notified":
				result.Notified = 1
			case "moved":
				result.Moved = 1
			case "redistributed":
				result.Redistributed = 1
			case "waiting":
				result.Waiting = 1
			case "cancelled":
				result.Cancelled = 1
			}
		}
	}
	if err := tx.Commit(phaseCtx); err != nil {
		return result, err
	}
	return result, nil
}

func inactivityPhaseRecovery(result *StageInactivityCycleResult, returnErr *error) {
	if recover() != nil {
		*returnErr = errors.New("stage inactivity phase panic")
	}
	if *returnErr != nil {
		*result = StageInactivityCycleResult{}
	}
}

// All candidate paths acquire parents, then the lead, then its child job. A future
// policy writer must use this same hierarchy (stage -> automation -> policy).
// No scan locks survive into a notification transaction.
func lockInactivityParents(ctx context.Context, tx pgx.Tx, organizationID, automationID string) (bool, error) {
	var stageID, pipelineID string
	err := tx.QueryRow(ctx, `select policy.stage_id::text, stage.pipeline_id::text
 from private.stage_inactivity_policies policy join public.stages stage
 on stage.id=policy.stage_id and stage.organization_id=policy.organization_id
 where policy.organization_id=$1::uuid and policy.automation_id=$2::uuid`, organizationID, automationID).Scan(&stageID, &pipelineID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	for _, lock := range []struct {
		query string
		args  []any
	}{
		{`select id::text from public.organizations where id=$1::uuid for share`, []any{organizationID}},
		{`select id::text from public.pipelines where organization_id=$1::uuid and id=$2::uuid for share`, []any{organizationID, pipelineID}},
		{`select id::text from public.stages where organization_id=$1::uuid and id=$2::uuid and pipeline_id=$3::uuid for share`, []any{organizationID, stageID, pipelineID}},
		{`select id::text from public.stage_automations where organization_id=$1::uuid and id=$2::uuid and stage_id=$3::uuid for share`, []any{organizationID, automationID, stageID}},
		{`select automation_id::text from private.stage_inactivity_policies where organization_id=$1::uuid and automation_id=$2::uuid and stage_id=$3::uuid for share`, []any{organizationID, automationID, stageID}},
	} {
		var lockedID string
		if err := tx.QueryRow(ctx, lock.query, lock.args...).Scan(&lockedID); errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		} else if err != nil {
			return false, err
		}
	}
	rows, err := tx.Query(ctx, `select 1 from public.organization_modules where organization_id=$1::uuid and lower(trim(module_name))='automations' for share`, organizationID)
	if err != nil {
		return false, err
	}
	for rows.Next() {
		// Drain all matching canonical/legacy casing rows under the same lock.
	}
	err = rows.Err()
	rows.Close()
	return true, err
}
