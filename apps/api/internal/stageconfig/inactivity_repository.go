package stageconfig

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	inactivityPolicyBatch = 10
	inactivityLeadBatch   = 100
	inactivityJobBatch    = 10
	inactivityScanDelay   = 30 * time.Second
	inactivityLockKey     = int64(860421726)
)

type StageInactivityCycleResult struct {
	Scanned, Enqueued, Notified, Waiting, Cancelled, Failed, Dead int
}

type inactivityScanPolicy struct {
	StageInactivityPolicy
	AfterLeadID *string
}

type inactivityJob struct {
	ID, OrganizationID, AutomationID, LeadID, Epoch, EpisodeKey string
	Revision                                                    int64
	Attempts                                                    int
}

// ProcessStageInactivityOnce performs only database/in-app work. It does not
// call providers or activate policies. Registration in the API is deliberately
// separate from this candidate so legacy rules cannot start sending alerts.
func (repo Repository) ProcessStageInactivityOnce(ctx context.Context) (result StageInactivityCycleResult, returnErr error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			returnErr = errors.New("stage inactivity cycle panic")
		}
	}()
	cycleCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	if err := repo.VerifyStageInactivityRuntime(cycleCtx); err != nil {
		return result, err
	}
	var now time.Time
	if err := repo.db.Pool().QueryRow(cycleCtx, `select clock_timestamp()`).Scan(&now); err != nil {
		return result, err
	}
	policies, err := loadInactivityScanPolicies(cycleCtx, repo.db.Pool(), now)
	if err != nil {
		return result, err
	}
	scanDeadline := time.Now().Add(15 * time.Second)
	for _, policy := range policies {
		// Reserve the delivery window even when several policies wait on
		// concurrent manager edits. A scan phase includes rollback cleanup.
		if !inactivityPhaseBudgetAvailable(cycleCtx) || time.Until(scanDeadline) < 12*time.Second {
			break
		}
		committed, err := repo.scanInactivityPolicyTransaction(cycleCtx, policy, now)
		addInactivityCycleResult(&result, committed)
		if err != nil && returnErr == nil {
			returnErr = err
		}
		if err != nil {
			// Avoid letting one failing policy remain the first overdue scan on
			// every cycle. This changes scheduling only, never business policy.
			_ = repo.deferFailedInactivityScan(cycleCtx, policy, now)
		}
	}
	jobs, err := loadInactivityJobs(cycleCtx, repo.db.Pool(), now)
	if err != nil {
		return result, err
	}
	for _, job := range jobs {
		if !inactivityPhaseBudgetAvailable(cycleCtx) {
			break
		}
		committed, err := repo.processInactivityJobTransaction(cycleCtx, job, now)
		addInactivityCycleResult(&result, committed)
		if err != nil && returnErr == nil {
			returnErr = err
		}
	}
	return result, returnErr
}

type inactivityQueryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func loadInactivityScanPolicies(ctx context.Context, queryer inactivityQueryer, now time.Time) ([]inactivityScanPolicy, error) {
	rows, err := queryer.Query(ctx, inactivityPoliciesForScanSQL, now, inactivityPolicyBatch)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	policies := []inactivityScanPolicy{}
	for rows.Next() {
		var policy inactivityScanPolicy
		if err := rows.Scan(append(inactivityPolicyDestinations(&policy.StageInactivityPolicy), &policy.AfterLeadID)...); err != nil {
			return nil, err
		}
		if err := policy.Validate(); err != nil {
			return nil, err
		}
		policies = append(policies, policy)
	}
	return policies, rows.Err()
}

func inactivityPolicyDestinations(policy *StageInactivityPolicy) []any {
	return []any{&policy.AutomationID, &policy.OrganizationID, &policy.StageID, &policy.Epoch, &policy.Revision, &policy.Clock, &policy.StartMode, &policy.ActivatedAt, &policy.AutomationUpdatedAt, &policy.Days, &policy.Message, &policy.Enabled, &policy.InteractionCoverageFrom}
}

func (repo Repository) scanInactivityPolicy(ctx context.Context, tx pgx.Tx, policy inactivityScanPolicy, now time.Time, result *StageInactivityCycleResult) error {
	rows, err := tx.Query(ctx, inactivityLeadPageSQL, policy.OrganizationID, policy.StageID, policy.AfterLeadID, inactivityLeadBatch)
	if err != nil {
		return err
	}
	leads := []inactivityLeadState{}
	for rows.Next() {
		var lead inactivityLeadState
		if err := rows.Scan(&lead.OrganizationID, &lead.LeadID, &lead.StageID, &lead.ScopeCycle, &lead.StageEnteredAt, &lead.ScopeStartedAt, &lead.LastActionAt, &lead.LastActionID, &lead.IsOpen); err != nil {
			rows.Close()
			return err
		}
		leads = append(leads, lead)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	batch := &pgx.Batch{}
	for _, lead := range leads {
		episode, applicable, err := evaluateInactivityEpisode(policy.StageInactivityPolicy, lead)
		if err != nil {
			return err
		}
		result.Scanned++
		if !applicable {
			continue
		}
		batch.Queue(inactivityEnqueueSQL, policy.OrganizationID, policy.AutomationID, lead.LeadID, policy.Epoch, policy.Revision, lead.ScopeCycle, episode.Key, episode.Baseline, episode.DueAt)
	}
	if batch.Len() > 0 {
		results := tx.SendBatch(ctx, batch)
		for range batch.Len() {
			tag, batchErr := results.Exec()
			if batchErr != nil {
				_ = results.Close()
				return batchErr
			}
			result.Enqueued += int(tag.RowsAffected())
		}
		if err := results.Close(); err != nil {
			return err
		}
	}
	var nextID *string
	if len(leads) == inactivityLeadBatch {
		nextID = &leads[len(leads)-1].LeadID
	}
	_, err = tx.Exec(ctx, `update private.stage_inactivity_policies set scan_after_lead_id = $3::uuid, next_scan_at = $4 where organization_id = $1::uuid and automation_id = $2::uuid`, policy.OrganizationID, policy.AutomationID, nextID, now.Add(inactivityScanDelay))
	return err
}

func loadInactivityLead(ctx context.Context, tx pgx.Tx, organizationID, leadID string) (inactivityLeadState, *string, error) {
	var state inactivityLeadState
	var assignedUserID *string
	err := tx.QueryRow(ctx, inactivityCurrentLeadSQL, organizationID, leadID).Scan(&state.OrganizationID, &state.LeadID, &state.StageID, &state.ScopeCycle, &state.StageEnteredAt, &state.ScopeStartedAt, &state.LastActionAt, &state.LastActionID, &state.IsOpen, &assignedUserID)
	return state, assignedUserID, err
}

func loadInactivityJobs(ctx context.Context, queryer inactivityQueryer, now time.Time) ([]inactivityJob, error) {
	rows, err := queryer.Query(ctx, inactivityClaimJobsSQL, now, inactivityJobBatch)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	jobs := []inactivityJob{}
	for rows.Next() {
		var job inactivityJob
		if err := rows.Scan(&job.ID, &job.OrganizationID, &job.AutomationID, &job.LeadID, &job.Epoch, &job.Revision, &job.EpisodeKey, &job.Attempts); err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}

func (repo Repository) processInactivityJobSafely(ctx context.Context, tx pgx.Tx, job inactivityJob, now time.Time) (outcome string, returnErr error) {
	defer func() {
		if recover() != nil {
			returnErr = errors.New("stage inactivity job panic")
		}
	}()
	var policy StageInactivityPolicy
	err := tx.QueryRow(ctx, inactivityCurrentPolicySQL, job.OrganizationID, job.AutomationID, job.Epoch, job.Revision).Scan(inactivityPolicyDestinations(&policy)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return finishInactivityJob(ctx, tx, job, now, "cancelled", "policy_changed")
	}
	if err != nil {
		return "", err
	}
	state, assignedUserID, err := loadInactivityLead(ctx, tx, job.OrganizationID, job.LeadID)
	if errors.Is(err, pgx.ErrNoRows) {
		return finishInactivityJob(ctx, tx, job, now, "cancelled", "lead_scope_changed")
	}
	if err != nil {
		return "", err
	}
	episode, applicable, err := evaluateInactivityEpisode(policy, state)
	if err != nil {
		return "", err
	}
	if !applicable || episode.Key != job.EpisodeKey || episode.DueAt.After(now) {
		return finishInactivityJob(ctx, tx, job, now, "cancelled", "episode_changed")
	}
	var userID string
	var generation int64
	if assignedUserID == nil {
		return deferInactivityRecipient(ctx, tx, job, now)
	}
	err = tx.QueryRow(ctx, inactivityRecipientSQL, job.OrganizationID, *assignedUserID).Scan(&userID, &generation)
	if errors.Is(err, pgx.ErrNoRows) {
		return deferInactivityRecipient(ctx, tx, job, now)
	}
	if err != nil {
		return "", err
	}
	metadata, err := json.Marshal(map[string]any{
		"event_key": "stage_inactivity", "dedupe_key": inactivityNotificationDedupeKey(episode.Key, userID, generation),
		"automation_id": policy.AutomationID, "activation_epoch": policy.Epoch, "policy_revision": policy.Revision,
		"clock": policy.Clock, "start_mode": policy.StartMode, "baseline_at": episode.Baseline.UTC().Format(time.RFC3339Nano), "due_at": episode.DueAt.UTC().Format(time.RFC3339Nano),
		"recipient_kind": "assignee", "membership_generation": generation,
	})
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, inactivityNotifySQL, job.OrganizationID, userID, inactivityNotificationTitle(policy.Clock), inactivityNotificationContent(policy.Message, policy.Days, policy.Clock), job.LeadID, string(metadata)); err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `update private.stage_inactivity_jobs set status = 'notified', notified_at = $3, notified_user_id = $4::uuid, notified_membership_generation = $5, error_code = null, updated_at = $3 where organization_id = $1::uuid and id = $2::uuid and status = 'pending'`, job.OrganizationID, job.ID, now, userID, generation)
	return "notified", err
}

func finishInactivityJob(ctx context.Context, tx pgx.Tx, job inactivityJob, now time.Time, status, code string) (string, error) {
	_, err := tx.Exec(ctx, inactivityFinishSQL, job.OrganizationID, job.ID, status, code, now)
	return status, err
}

func deferInactivityRecipient(ctx context.Context, tx pgx.Tx, job inactivityJob, now time.Time) (string, error) {
	_, err := tx.Exec(ctx, `update private.stage_inactivity_jobs set next_attempt_at = $3, error_code = 'recipient_unavailable', updated_at = $4 where organization_id = $1::uuid and id = $2::uuid and status = 'pending'`, job.OrganizationID, job.ID, now.Add(2*time.Minute), now)
	return "waiting", err
}

func markInactivityFailure(ctx context.Context, tx pgx.Tx, job inactivityJob, now time.Time, cause error) error {
	status, next := inactivityRetry(job.Attempts+1, now)
	code := "database_error"
	if errors.Is(cause, ErrInactivityPolicyIncomplete) {
		code = "invalid_policy"
	}
	_, err := tx.Exec(ctx, `update private.stage_inactivity_jobs set status = $3, attempts = attempts + 1, next_attempt_at = $4, error_code = $5, updated_at = $6 where organization_id = $1::uuid and id = $2::uuid and status = 'pending'`, job.OrganizationID, job.ID, status, next, code, now)
	if err != nil {
		return fmt.Errorf("persist stage inactivity retry: %w", err)
	}
	return nil
}

func rollbackInactivityTransaction(tx pgx.Tx) {
	cleanupCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = tx.Rollback(cleanupCtx)
}
