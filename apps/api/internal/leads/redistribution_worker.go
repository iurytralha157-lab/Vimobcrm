package leads

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	leadRedistributionWorkerInterval  = 30 * time.Second
	leadRedistributionBatchLimit      = 50
	leadRedistributionLockKey         = int64(860421704)
	leadRedistributionNoMemberDelay   = 24 * time.Hour
	leadInitialDistributionRetryDelay = 5 * time.Minute
)

type redistributionJob struct {
	ID                          string
	RowVersion                  string
	OrganizationID              string
	LeadID                      string
	RoundRobinID                string
	Source                      string
	EntryEventID                string
	CurrentAssignedUserID       string
	AttemptCount                int
	MaxAttempts                 int
	TimeoutMinutes              int
	WarningMinutes              int
	EnrolledAt                  time.Time
	LeadName                    string
	InitialDistributionPending  bool
	AllowAssignedRedistribution bool
}

type backendDistributionResult struct {
	Success             bool
	AssignedUserID      string
	DistributionEventID string
}

type leadRedistributionExecutor interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

type leadRedistributionQueryExecutor interface {
	leadTeamQueryer
	leadRedistributionExecutor
}

func (repo Repository) StartRedistributionWorker(ctx context.Context, logger *slog.Logger, publishers ...realtime.Publisher) {
	if logger == nil {
		logger = slog.Default()
	}

	// This value receiver is private to the sequential worker closure.
	repo.redistributionCursors = &redistributionBatchCursors{}
	if len(publishers) > 0 {
		repo.queueRuntimePublisher = publishers[0]
	}

	go func() {
		timer := time.NewTimer(5 * time.Second)
		defer timer.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				if err := runRedistributionCycle(ctx, repo.ProcessLeadRedistribution); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("lead redistribution worker failed", "error", err)
				}
				timer.Reset(leadRedistributionWorkerInterval)
			}
		}
	}()
}

func (repo Repository) ProcessLeadRedistribution(ctx context.Context) error {
	// A busy legacy configuration or malformed legacy job must not undo a
	// completed window close/claim reconciliation in managed queues.
	managedErr := repo.processManagedQueueRuntime(ctx)
	legacyErr := repo.processLegacyLeadRedistribution(ctx)
	return errors.Join(managedErr, legacyErr)
}

func (repo Repository) processRedistributionWarning(ctx context.Context, tx pgx.Tx, job redistributionJob, attemptedVersion *string) error {
	if err := lockRedistributionConfigurationDomain(ctx, tx, job.OrganizationID); err != nil {
		return err
	}
	queueLocked, err := lockRedistributionQueueBeforeLead(ctx, tx, job)
	if err != nil {
		return err
	}
	if !queueLocked {
		return nil
	}

	current, err := repo.getRedistributionLeadSnapshotForUpdate(ctx, tx, job.OrganizationID, job.LeadID)
	if err != nil {
		if errors.Is(err, errRedistributionLeadBusy) {
			return nil
		}
		if errors.Is(err, ErrLeadNotFound) {
			if stopErr := repo.stopRedistributionJob(ctx, tx, job.ID, "lead_not_found"); stopErr != nil {
				return stopErr
			}
			return nil
		}
		return err
	}

	lockedJob, locked, err := repo.lockWarningRedistributionJob(ctx, tx, job)
	if err != nil {
		return err
	}
	if !locked || lockedJob.RoundRobinID != job.RoundRobinID {
		return nil
	}
	job = lockedJob
	*attemptedVersion = job.RowVersion
	if !redistributionJobShouldReceiveWarning(job) {
		return nil
	}

	reason, err := repo.redistributionStopReason(ctx, tx, job, current)
	if err != nil {
		return err
	}
	if reason != "" {
		if err := repo.stopRedistributionJob(ctx, tx, job.ID, reason); err != nil {
			return err
		}
		return nil
	}

	policyRefresh, err := repo.reconcileLockedRedistributionPolicy(ctx, tx, job)
	if err != nil {
		return err
	}
	if !policyRefresh.Usable {
		return nil
	}
	if policyRefresh.Changed {
		refreshedJob, eligible, err := repo.lockWarningRedistributionJob(ctx, tx, job)
		if err != nil {
			return err
		}
		if !eligible || refreshedJob.RoundRobinID != job.RoundRobinID {
			return nil
		}
		job = refreshedJob
	}

	_, canRedistribute, err := repo.selectOrDeferRedistribution(ctx, tx, job, current)
	if err != nil {
		return err
	}
	if !canRedistribute {
		return nil
	}

	if err := repo.insertNotification(ctx, tx, job.OrganizationID, job.CurrentAssignedUserID, job.LeadID, "Lead quase redistribuido", fmt.Sprintf("%s sera redistribuido em %d minuto(s) se nao houver atendimento.", job.LeadName, job.WarningMinutes), "lead_redistribution_warning", map[string]any{
		"lead_name":       job.LeadName,
		"timeout_minutes": job.TimeoutMinutes,
		"warning_minutes": job.WarningMinutes,
		"round_robin_id":  job.RoundRobinID,
		"job_id":          job.ID,
		"attempt_count":   job.AttemptCount,
		"dedupe_key":      redistributionWarningDedupeKey(job),
	}); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		update public.lead_redistribution_jobs
		set status = 'warning_sent',
		    warning_retry_at = null,
		    warning_sent_at = now(),
		    metadata = metadata - 'waiting_for_available_member' - 'next_candidate_check_at',
		    updated_at = now()
		where id = $1::uuid
	`, job.ID); err != nil {
		return err
	}
	return nil
}

func redistributionJobShouldReceiveWarning(job redistributionJob) bool {
	return !job.InitialDistributionPending && job.TimeoutMinutes > 5 && job.WarningMinutes > 0 && job.WarningMinutes < job.TimeoutMinutes
}

func (repo Repository) processManagedWhatsAppInitialDistribution(
	ctx context.Context,
	store leadRedistributionQueryExecutor,
	job redistributionJob,
	current leadSnapshot,
) error {
	if current.AssignedUserID != "" && (!job.AllowAssignedRedistribution || current.AssignedUserID != job.CurrentAssignedUserID) {
		return repo.stopRedistributionJob(ctx, store, job.ID, "assignee_changed")
	}
	if current.DealStatus != "" && current.DealStatus != "open" {
		return repo.stopRedistributionJob(ctx, store, job.ID, "deal_closed")
	}
	if job.AllowAssignedRedistribution {
		hasHumanAction, err := repo.redistributionHasHumanActivity(ctx, store, job)
		if err != nil {
			return err
		}
		if hasHumanAction {
			return repo.stopRedistributionJob(ctx, store, job.ID, "human_action")
		}
	}
	queueActive, queueActiveErr := repo.managedWhatsAppDistributionQueueActive(
		ctx,
		store,
		job.OrganizationID,
		job.RoundRobinID,
	)
	if queueActiveErr != nil {
		return queueActiveErr
	}
	if !queueActive {
		return repo.stopRedistributionJob(ctx, store, job.ID, "round_robin_inactive")
	}

	excludedUserID := ""
	if job.AllowAssignedRedistribution {
		excludedUserID = job.CurrentAssignedUserID
	}

	selection, _, err := repo.selectRoundRobinMemberForRedistribution(
		ctx,
		store,
		job.OrganizationID,
		job.LeadID,
		job.RoundRobinID,
		excludedUserID,
		"",
	)
	if err != nil {
		return err
	}
	if selection.UserID == "" {
		retryAt, retryErr := repo.nextManagedWhatsAppInitialDistributionAttempt(ctx, store, job)
		if retryErr != nil {
			return retryErr
		}
		return repo.reopenManagedWhatsAppInitialDistribution(
			ctx,
			store,
			job.ID,
			retryAt,
			job.AttemptCount+1,
			[]byte(`{"success":false,"reason":"no_available_members"}`),
		)
	}

	attemptedAt := time.Now().UTC()
	if err := repo.stopRedistributionJob(ctx, store, job.ID, "initial_distribution_completed"); err != nil {
		return err
	}

	distributionSource := normalizeInitialDistributionSource(job.Source)
	var rawResult []byte
	err = store.QueryRow(ctx, `
		select public.distribute_lead_from_backend(
			$1::uuid,
			$2::uuid,
			$3::text,
			$4::uuid,
			$5::boolean,
			$6::text,
			$7::timestamptz
		)
	`,
		job.OrganizationID,
		job.LeadID,
		initialDistributionIdempotencyKey(distributionSource, job.ID, job.AttemptCount+1),
		job.RoundRobinID,
		false,
		distributionSource,
		attemptedAt,
	).Scan(&rawResult)
	if err != nil {
		return err
	}

	distributionResult, err := parseBackendDistributionResult(rawResult)
	if err != nil {
		return err
	}
	if distributionResult.Success && (!job.AllowAssignedRedistribution ||
		(distributionResult.AssignedUserID != "" && !strings.EqualFold(distributionResult.AssignedUserID, job.CurrentAssignedUserID))) {
		if err := repo.enqueueManagedWhatsAppDistributionAutoReply(
			ctx,
			store,
			job,
			distributionResult.AssignedUserID,
			distributionResult.DistributionEventID,
		); err != nil {
			return err
		}
		return nil
	}

	// The canonical distributor can create its own active retry job even when it
	// reports no assignment. Consolidate onto that job before reopening this
	// special one so the one-active-job index is respected and a retry owner is
	// never silently lost.
	activeJobID, activeJobExists, activeJobErr := repo.otherActiveRedistributionJob(
		ctx,
		store,
		job.OrganizationID,
		job.LeadID,
		job.ID,
	)
	if activeJobErr != nil {
		return activeJobErr
	}
	if activeJobExists {
		accelerated, accelerateErr := repo.accelerateRedistributionJob(
			ctx,
			store,
			job.OrganizationID,
			job.LeadID,
			activeJobID,
		)
		if accelerateErr != nil {
			return accelerateErr
		}
		if accelerated {
			return nil
		}
	}
	retryAt, err := repo.nextManagedWhatsAppInitialDistributionAttempt(ctx, store, job)
	if err != nil {
		return err
	}
	return repo.reopenManagedWhatsAppInitialDistribution(ctx, store, job.ID, retryAt, job.AttemptCount+1, rawResult)
}

func (repo Repository) managedWhatsAppDistributionQueueActive(
	ctx context.Context,
	queryer leadTeamQueryer,
	organizationID string,
	roundRobinID string,
) (bool, error) {
	var active bool
	err := queryer.QueryRow(ctx, `
		select true
		from public.round_robins queue
		where queue.organization_id = $1::uuid
		  and queue.id = $2::uuid
		  and coalesce(queue.is_active, true) = true
		for share
	`, organizationID, roundRobinID).Scan(&active)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return active, err
}

func (repo Repository) otherActiveRedistributionJob(
	ctx context.Context,
	queryer leadTeamQueryer,
	organizationID string,
	leadID string,
	excludedJobID string,
) (string, bool, error) {
	var activeJobID string
	err := queryer.QueryRow(ctx, `
		select job.id::text
		from public.lead_redistribution_jobs job
		where job.organization_id = $1::uuid
		  and job.lead_id = $2::uuid
		  and job.id <> $3::uuid
		  and job.status in ('pending', 'warning_sent')
		order by job.created_at, job.id
		limit 1
		for update
	`, organizationID, leadID, excludedJobID).Scan(&activeJobID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return activeJobID, true, nil
}

func (repo Repository) accelerateRedistributionJob(
	ctx context.Context,
	executor leadRedistributionExecutor,
	organizationID string,
	leadID string,
	jobID string,
) (bool, error) {
	tag, err := executor.Exec(ctx, `
		update public.lead_redistribution_jobs
		set status = 'pending',
		    warning_retry_at = null, redistribution_retry_at = null,
		    due_at = now(),
		    warning_due_at = null,
		    warning_sent_at = null,
		    stopped_at = null,
		    stopped_reason = null,
		    metadata = coalesce(metadata, '{}'::jsonb)
		      - 'waiting_for_available_member'
		      - 'next_candidate_check_at',
		    updated_at = now()
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
		  and id = $3::uuid
		  and status in ('pending', 'warning_sent')
	`, organizationID, leadID, jobID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (repo Repository) nextManagedWhatsAppInitialDistributionAttempt(
	ctx context.Context,
	queryer leadTeamQueryer,
	job redistributionJob,
) (time.Time, error) {
	excludedUserID := ""
	if job.AllowAssignedRedistribution {
		excludedUserID = job.CurrentAssignedUserID
	}
	nextAvailableAt, hasAlternative, err := repo.nextRoundRobinMemberAvailability(
		ctx,
		queryer,
		job.OrganizationID,
		job.RoundRobinID,
		excludedUserID,
		"",
		leadInitialDistributionRetryDelay,
	)
	if err != nil {
		return time.Time{}, err
	}
	if hasAlternative {
		return nextAvailableAt, nil
	}
	return time.Now().UTC().Add(leadInitialDistributionRetryDelay), nil
}

func parseBackendDistributionSuccess(raw []byte) (bool, error) {
	result, err := parseBackendDistributionResult(raw)
	if err != nil {
		return false, err
	}
	return result.Success, nil
}

func parseBackendDistributionResult(raw []byte) (backendDistributionResult, error) {
	payload, err := decodeJSONObject(raw)
	if err != nil {
		return backendDistributionResult{}, fmt.Errorf("decode backend distribution result: %w", err)
	}
	rawSuccess, ok := payload["success"]
	if !ok {
		return backendDistributionResult{}, nil
	}
	success, valid := parseFlexibleJSONBoolean(rawSuccess)
	if !valid {
		return backendDistributionResult{}, fmt.Errorf("decode backend distribution result: success must be boolean")
	}

	result := backendDistributionResult{Success: success}
	if rawAssignedUserID, exists := payload["assigned_user_id"]; exists && !bytes.Equal(bytes.TrimSpace(rawAssignedUserID), []byte("null")) {
		if err := json.Unmarshal(rawAssignedUserID, &result.AssignedUserID); err == nil {
			result.AssignedUserID = strings.TrimSpace(result.AssignedUserID)
		}
	}
	if rawDistributionEventID, exists := payload["distribution_event_id"]; exists && !bytes.Equal(bytes.TrimSpace(rawDistributionEventID), []byte("null")) {
		if err := json.Unmarshal(rawDistributionEventID, &result.DistributionEventID); err == nil {
			result.DistributionEventID = strings.TrimSpace(result.DistributionEventID)
		}
	}
	return result, nil
}

func decodeJSONObject(raw []byte) (map[string]json.RawMessage, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, errors.New("empty JSON object")
	}

	decoder := json.NewDecoder(bytes.NewReader(raw))
	var payload map[string]json.RawMessage
	if err := decoder.Decode(&payload); err != nil {
		return nil, err
	}
	if payload == nil {
		return nil, errors.New("expected JSON object")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err == nil {
		return nil, errors.New("unexpected trailing JSON value")
	} else if !errors.Is(err, io.EOF) {
		return nil, err
	}
	return payload, nil
}

func parseFlexibleJSONBoolean(raw json.RawMessage) (bool, bool) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return false, false
	}

	var value bool
	if err := json.Unmarshal(trimmed, &value); err == nil {
		return value, true
	}
	var intValue int
	if err := json.Unmarshal(trimmed, &intValue); err == nil {
		switch intValue {
		case 1:
			return true, true
		case 0:
			return false, true
		}
	}

	var textValue string
	if err := json.Unmarshal(trimmed, &textValue); err != nil {
		return false, false
	}
	switch strings.ToLower(strings.TrimSpace(textValue)) {
	case "true", "1", "yes":
		return true, true
	case "false", "0", "no":
		return false, true
	default:
		return false, false
	}
}

func redistributionWarningDedupeKey(job redistributionJob) string {
	return notificationDedupeKey(
		"lead_redistribution_warning",
		job.ID,
		job.CurrentAssignedUserID,
		"cycle_"+job.EnrolledAt.UTC().Format(time.RFC3339Nano),
		fmt.Sprintf("attempt_%d", job.AttemptCount),
		fmt.Sprintf("policy_%d_%d", job.TimeoutMinutes, job.WarningMinutes),
	)
}

func (repo Repository) processDueRedistribution(ctx context.Context, tx pgx.Tx, job redistributionJob, attemptedVersion *string) error {
	if err := lockRedistributionConfigurationDomain(ctx, tx, job.OrganizationID); err != nil {
		return err
	}
	queueLocked, err := lockRedistributionQueueBeforeLead(ctx, tx, job)
	if err != nil {
		return err
	}
	if !queueLocked {
		return nil
	}
	current, err := repo.getRedistributionLeadSnapshotForUpdate(ctx, tx, job.OrganizationID, job.LeadID)
	if err != nil {
		if errors.Is(err, errRedistributionLeadBusy) {
			return nil
		}
		if errors.Is(err, ErrLeadNotFound) {
			if stopErr := repo.stopRedistributionJob(ctx, tx, job.ID, "lead_not_found"); stopErr != nil {
				return stopErr
			}
			return nil
		}
		return err
	}

	lockedJob, locked, err := repo.lockDueRedistributionJob(ctx, tx, job)
	if err != nil {
		return err
	}
	if !locked || lockedJob.RoundRobinID != job.RoundRobinID {
		return nil
	}
	job = lockedJob
	*attemptedVersion = job.RowVersion
	if job.InitialDistributionPending {
		if err := repo.processManagedWhatsAppInitialDistribution(ctx, tx, job, current); err != nil {
			return err
		}
		return nil
	}

	reason, err := repo.redistributionStopReason(ctx, tx, job, current)
	if err != nil {
		return err
	}
	if reason != "" {
		if err := repo.stopRedistributionJob(ctx, tx, job.ID, reason); err != nil {
			return err
		}
		return nil
	}

	policyRefresh, err := repo.reconcileLockedRedistributionPolicy(ctx, tx, job)
	if err != nil {
		return err
	}
	if !policyRefresh.Usable {
		return nil
	}
	if policyRefresh.Changed {
		refreshedJob, eligible, err := repo.lockDueRedistributionJob(ctx, tx, job)
		if err != nil {
			return err
		}
		if !eligible || refreshedJob.RoundRobinID != job.RoundRobinID {
			return nil
		}
		job = refreshedJob
	}

	selection, canRedistribute, err := repo.selectOrDeferRedistribution(ctx, tx, job, current)
	if err != nil {
		return err
	}
	if !canRedistribute {
		return nil
	}

	previousUserID := current.AssignedUserID
	systemTenant := tenant.Context{OrganizationID: job.OrganizationID}
	if err := repo.validateRoundRobinAssigneeTeam(ctx, tx, job.OrganizationID, current.TeamID, &selection.UserID); err != nil {
		return err
	}
	reason, err = repo.redistributionStopReason(ctx, tx, job, current)
	if err != nil {
		return err
	}
	if reason != "" {
		if err := repo.stopRedistributionJob(ctx, tx, job.ID, reason); err != nil {
			return err
		}
		return nil
	}
	if err := repo.transferLeadAssignee(ctx, tx, systemTenant, current, &selection.UserID, "auto_redistribution"); err != nil {
		return err
	}

	if err := repo.insertAutoRedistributionLog(ctx, tx, job, selection, previousUserID); err != nil {
		return err
	}

	nextAttemptCount := job.AttemptCount + 1
	finalStatus := "pending"
	if job.MaxAttempts > 0 && nextAttemptCount >= job.MaxAttempts {
		finalStatus = "max_attempts_reached"
	}

	if err := repo.updateRedistributionJobAfterTransfer(ctx, tx, job, selection.UserID, nextAttemptCount, finalStatus); err != nil {
		return err
	}

	if err := repo.insertNotification(ctx, tx, job.OrganizationID, selection.UserID, job.LeadID, "Lead redistribuido para voce", fmt.Sprintf("%s estava parado ha %d minuto(s) e foi redistribuido.", job.LeadName, job.TimeoutMinutes), "lead_redistributed_received", map[string]any{
		"lead_name":       job.LeadName,
		"previous_user":   previousUserID,
		"timeout_minutes": job.TimeoutMinutes,
		"round_robin_id":  job.RoundRobinID,
		"job_id":          job.ID,
		"attempt_count":   nextAttemptCount,
		"dedupe_key":      notificationDedupeKey("lead_redistributed_received", job.ID, selection.UserID, fmt.Sprint(nextAttemptCount)),
	}); err != nil {
		return err
	}
	if err := repo.insertNotification(ctx, tx, job.OrganizationID, previousUserID, job.LeadID, "Lead redistribuido", fmt.Sprintf("%s foi redistribuido apos %d minuto(s) sem atendimento.", job.LeadName, job.TimeoutMinutes), "lead_redistributed_away", map[string]any{
		"lead_name":       job.LeadName,
		"new_user":        selection.UserID,
		"timeout_minutes": job.TimeoutMinutes,
		"round_robin_id":  job.RoundRobinID,
		"job_id":          job.ID,
		"attempt_count":   nextAttemptCount,
		"dedupe_key":      notificationDedupeKey("lead_redistributed_away", job.ID, previousUserID, fmt.Sprint(nextAttemptCount)),
	}); err != nil {
		return err
	}

	if err := repo.insertActivity(ctx, tx, job.OrganizationID, job.LeadID, "", "lead_auto_redistributed", fmt.Sprintf(`Lead "%s" redistribuido automaticamente`, job.LeadName), map[string]any{
		"from_user_id":    previousUserID,
		"to_user_id":      selection.UserID,
		"round_robin_id":  job.RoundRobinID,
		"timeout_minutes": job.TimeoutMinutes,
		"attempt_count":   nextAttemptCount,
		"max_attempts":    job.MaxAttempts,
	}); err != nil {
		return err
	}
	return nil
}

func (repo Repository) selectOrDeferRedistribution(
	ctx context.Context,
	tx pgx.Tx,
	job redistributionJob,
	current leadSnapshot,
) (roundRobinSelection, bool, error) {
	selection, _, err := repo.selectRoundRobinMemberForRedistribution(
		ctx,
		tx,
		job.OrganizationID,
		job.LeadID,
		job.RoundRobinID,
		current.AssignedUserID,
		current.TeamID,
	)
	if err != nil {
		return roundRobinSelection{}, false, err
	}
	if selection.UserID != "" {
		return selection, true, nil
	}

	nextAvailableAt, hasAlternative, err := repo.nextRoundRobinMemberAvailability(
		ctx,
		tx,
		job.OrganizationID,
		job.RoundRobinID,
		current.AssignedUserID,
		current.TeamID,
		leadRedistributionNoMemberDelay,
	)
	if err != nil {
		return roundRobinSelection{}, false, err
	}
	if hasAlternative {
		if err := repo.deferRedistributionJobUntilAvailability(
			ctx,
			tx,
			job.ID,
			nextAvailableAt,
			job.TimeoutMinutes,
			job.WarningMinutes,
		); err != nil {
			return roundRobinSelection{}, false, err
		}
		return roundRobinSelection{}, false, nil
	}

	if err := repo.finishRedistributionJob(ctx, tx, job.ID, "no_next_member", "no_next_member"); err != nil {
		return roundRobinSelection{}, false, err
	}
	return roundRobinSelection{}, false, nil
}

func (repo Repository) listWarningRedistributionJobs(ctx context.Context, tx pgx.Tx) ([]redistributionJob, error) {
	cursor := repo.redistributionBatchCursor(redistributionWarningPage)
	rows, err := tx.Query(ctx, `
		select
			j.id::text,
			j.organization_id::text,
			j.lead_id::text,
			j.round_robin_id::text,
			coalesce(j.current_assigned_user_id::text, ''),
			j.attempt_count,
			j.max_attempts,
			j.timeout_minutes,
			j.warning_minutes,
			j.enrolled_at,
			coalesce(nullif(l.name, ''), 'Lead'),
			coalesce(j.metadata, '{}'::jsonb)::text, j.xmin::text
		from public.lead_redistribution_jobs j
		join public.leads l
		  on l.organization_id = j.organization_id
		 and l.id = j.lead_id
		left join public.round_robins q on q.organization_id = j.organization_id and q.id = j.round_robin_id
		where j.status = 'pending'
		  and not (coalesce(q.settings, '{}'::jsonb) ? 'operating_schedule')
		  and j.timeout_minutes > 5 and j.warning_minutes > 0 and j.warning_minutes < j.timeout_minutes
		  and j.warning_due_at is not null
		  and j.warning_due_at <= now()
		  and j.due_at > now()
		  and j.warning_sent_at is null
		  and (j.warning_retry_at is null or j.warning_retry_at <= now())
		  and lower(coalesce(j.metadata->>'initial_distribution_pending', 'false')) not in ('true', '1', 'yes')
		order by greatest(j.warning_due_at, coalesce(j.warning_retry_at, '-infinity'::timestamptz)) asc, j.id
		limit $1 offset $2
		for update of j skip locked
	`, leadRedistributionBatchLimit, redistributionBatchOffset(cursor))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	jobs, err := scanRedistributionJobs(rows)
	if err != nil {
		return nil, err
	}
	advanceRedistributionBatchCursor(cursor, len(jobs))
	return jobs, nil
}

func (repo Repository) listDueRedistributionJobs(ctx context.Context, tx pgx.Tx) ([]redistributionJob, error) {
	cursor := repo.redistributionBatchCursor(redistributionDuePage)
	rows, err := tx.Query(ctx, `
		select
			j.id::text,
			j.organization_id::text,
			j.lead_id::text,
			j.round_robin_id::text,
			coalesce(j.current_assigned_user_id::text, ''),
			j.attempt_count,
			j.max_attempts,
			j.timeout_minutes,
			j.warning_minutes,
			j.enrolled_at,
			coalesce(nullif(l.name, ''), 'Lead'),
			coalesce(j.metadata, '{}'::jsonb)::text, j.xmin::text
		from public.lead_redistribution_jobs j
		join public.leads l
		  on l.organization_id = j.organization_id
		 and l.id = j.lead_id
		left join public.round_robins q on q.organization_id = j.organization_id and q.id = j.round_robin_id
		where j.status in ('pending', 'warning_sent')
		  and not (coalesce(q.settings, '{}'::jsonb) ? 'operating_schedule')
		  and j.due_at <= now()
		  and (j.redistribution_retry_at is null or j.redistribution_retry_at <= now())
		order by greatest(j.due_at, coalesce(j.redistribution_retry_at, '-infinity'::timestamptz)) asc, j.id
		limit $1 offset $2
		for update of j skip locked
	`, leadRedistributionBatchLimit, redistributionBatchOffset(cursor))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	jobs, err := scanRedistributionJobs(rows)
	if err != nil {
		return nil, err
	}
	advanceRedistributionBatchCursor(cursor, len(jobs))
	return jobs, nil
}

func scanRedistributionJobs(rows pgx.Rows) ([]redistributionJob, error) {
	jobs := []redistributionJob{}
	for rows.Next() {
		job, err := scanRedistributionJob(rows)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}

func redistributionJobMetadataFromJSON(raw []byte) (bool, bool, string, string) {
	payload, err := decodeJSONObject(raw)
	if err != nil {
		return false, false, "", "whatsapp"
	}
	initialPending, initialPendingValid := parseFlexibleJSONBoolean(payload["initial_distribution_pending"])
	allowAssigned, allowAssignedValid := parseFlexibleJSONBoolean(payload["allow_assigned_redistribution"])
	if !initialPendingValid {
		initialPending = false
	}
	if !allowAssignedValid {
		allowAssigned = false
	}

	entryEventID := ""
	if rawEntryEventID, exists := payload["entry_event_id"]; exists {
		var value string
		if json.Unmarshal(rawEntryEventID, &value) == nil {
			if normalized, ok := normalizeUUID(value); ok {
				entryEventID = normalized
			}
		}
	}

	source := "whatsapp"
	if rawSource, exists := payload["source"]; exists {
		var value string
		if json.Unmarshal(rawSource, &value) != nil || strings.TrimSpace(value) == "" {
			source = "unknown"
		} else {
			source = normalizeInitialDistributionSource(value)
		}
	}
	return initialPending, allowAssigned, entryEventID, source
}

func normalizeInitialDistributionSource(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "meta", "meta_lead_ads":
		return "meta"
	case "", "managed_whatsapp", "whatsapp":
		return "whatsapp"
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func initialDistributionIdempotencyKey(source string, jobID string, attempt int) string {
	prefix := "initial-distribution-pending"
	switch normalizeInitialDistributionSource(source) {
	case "meta":
		prefix = "meta-pending"
	case "whatsapp":
		prefix = "managed-whatsapp-pending"
	}
	return fmt.Sprintf("%s:%s:attempt_%d", prefix, jobID, attempt)
}

func (repo Repository) enqueueManagedWhatsAppDistributionAutoReply(
	ctx context.Context,
	store leadRedistributionQueryExecutor,
	job redistributionJob,
	assignedUserID string,
	distributionEventID string,
) error {
	if job.AllowAssignedRedistribution {
		return nil
	}
	if normalizeInitialDistributionSource(job.Source) != "whatsapp" {
		return nil
	}
	entryEventID, ok := normalizeUUID(job.EntryEventID)
	if !ok {
		return nil
	}
	assignedUserID, ok = normalizeUUID(assignedUserID)
	if !ok {
		return nil
	}
	distributionEventID = strings.TrimSpace(distributionEventID)
	if distributionEventID == "" {
		return nil
	}

	const savepointName = "managed_whatsapp_distribution_auto_reply"
	if _, err := store.Exec(ctx, "savepoint "+savepointName); err != nil {
		// The acknowledgement is optional. If it cannot be isolated safely, skip
		// it and leave the canonical lead distribution as the source of truth.
		return nil
	}

	var rawResult []byte
	if err := store.QueryRow(ctx, `
		select public.enqueue_managed_whatsapp_distribution_auto_reply(
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::text
		)
	`, job.OrganizationID, entryEventID, assignedUserID, distributionEventID).Scan(&rawResult); err != nil {
		return rollbackManagedWhatsAppAutoReplySavepoint(ctx, store, savepointName)
	}
	if _, err := decodeJSONObject(rawResult); err != nil {
		return rollbackManagedWhatsAppAutoReplySavepoint(ctx, store, savepointName)
	}
	if _, err := store.Exec(ctx, "release savepoint "+savepointName); err != nil {
		return fmt.Errorf("release managed WhatsApp auto reply savepoint: %w", err)
	}
	return nil
}

func rollbackManagedWhatsAppAutoReplySavepoint(
	ctx context.Context,
	store leadRedistributionQueryExecutor,
	savepointName string,
) error {
	_, rollbackErr := store.Exec(ctx, "rollback to savepoint "+savepointName)
	_, releaseErr := store.Exec(ctx, "release savepoint "+savepointName)
	if rollbackErr != nil {
		return fmt.Errorf("rollback managed WhatsApp auto reply savepoint: %w", rollbackErr)
	}
	if releaseErr != nil {
		return fmt.Errorf("release managed WhatsApp auto reply savepoint after rollback: %w", releaseErr)
	}
	return nil
}

func (repo Repository) redistributionStopReason(ctx context.Context, tx pgx.Tx, job redistributionJob, current leadSnapshot) (string, error) {
	if job.CurrentAssignedUserID == "" {
		return "unassigned", nil
	}
	if current.AssignedUserID != job.CurrentAssignedUserID {
		return "assignee_changed", nil
	}
	if current.DealStatus != "" && current.DealStatus != "open" {
		return "deal_closed", nil
	}
	if reason, err := repo.redistributionQueueStopReason(ctx, tx, job); err != nil || reason != "" {
		return reason, err
	}

	hasHumanAction, err := repo.redistributionHasHumanActivity(ctx, tx, job)
	if err != nil {
		return "", err
	}
	if hasHumanAction {
		return "human_action", nil
	}

	return "", nil
}

func (repo Repository) redistributionHasHumanActivity(ctx context.Context, queryer leadTeamQueryer, job redistributionJob) (bool, error) {
	var hasHumanAction bool
	err := queryer.QueryRow(ctx, `
		with target_lead as (
			select
				l.id,
				l.organization_id,
				l.first_response_at,
				l.first_response_is_automation
			from public.leads l
			where l.organization_id = $1::uuid and l.id = $2::uuid
			limit 1
		)
		select exists (
			select 1
			from public.lead_action_facts f
			join target_lead l
			  on l.organization_id = f.organization_id
			 and l.id = f.lead_id
			where f.occurred_at >= $3::timestamptz
			  and f.is_automated = false
			  and f.is_inbound = false
			  and not (
			    lower(coalesce(f.source_type, '')) = 'activity'
			    and exists (
			      select 1
			      from public.activities system_activity
			      join public.round_robin_logs system_distribution
			        on system_distribution.organization_id = system_activity.organization_id
			       and system_distribution.lead_id = system_activity.lead_id
			       and system_distribution.round_robin_id = nullif($4, '')::uuid
			       and system_distribution.assigned_user_id = nullif($5, '')::uuid
			       and system_distribution.created_at between system_activity.created_at - interval '1 second' and system_activity.created_at + interval '1 second'
			      where system_activity.organization_id = f.organization_id
			        and system_activity.lead_id = f.lead_id
			        and system_activity.id::text = f.source_id
			        and lower(coalesce(system_activity.type, '')) in ('assignee_changed', 'stage_change')
			    )
			  )
			  and (
			    f.actor_user_id is not null
			    or lower(coalesce(f.action_type, '')) = 'whatsapp_outbound'
			  )
		) or exists (
			select 1
			from target_lead l
			where l.first_response_at is not null
			  and l.first_response_at >= $3::timestamptz
			  and coalesce(l.first_response_is_automation, false) = false
		) or exists (
			select 1
			from public.activities a
			join target_lead l
			  on l.organization_id = a.organization_id
			 and l.id = a.lead_id
			where a.created_at >= $3::timestamptz
			  and a.user_id is not null
			  and not (
			    lower(coalesce(a.type, '')) in ('assignee_changed', 'stage_change')
			    and exists (
			      select 1
			      from public.round_robin_logs system_distribution
			      where system_distribution.organization_id = a.organization_id
			        and system_distribution.lead_id = a.lead_id
			        and system_distribution.round_robin_id = nullif($4, '')::uuid
			        and system_distribution.assigned_user_id = nullif($5, '')::uuid
			        and system_distribution.created_at between a.created_at - interval '1 second' and a.created_at + interval '1 second'
			    )
			  )
			  and not (
			    lower(coalesce(a.metadata->>'is_automation', a.metadata->>'is_automated', a.metadata->>'automated', 'false')) in ('true', '1', 'yes')
			    or lower(btrim(coalesce(a.metadata->>'origin', ''))) in ('ai', 'openai', 'automation', 'bot', 'ai_autoreply', 'ai_followup')
			    or lower(btrim(coalesce(a.metadata->>'origin', ''))) ~ '^(ai|automation)[_.]'
			    or lower(coalesce(a.metadata->>'sender_type', '')) in ('ai', 'automation', 'bot')
			  )
		) or exists (
			select 1
			from public.lead_timeline_events lte
			join target_lead l
			  on l.organization_id = lte.organization_id
			 and l.id = lte.lead_id
			where lte.created_at >= $3::timestamptz
			  and coalesce(lte.actor_user_id, lte.user_id) is not null
			  and not (
			    lower(coalesce(lte.event_type, '')) = 'lead_assigned'
			    and (
			      nullif(btrim(coalesce(lte.metadata->>'distribution_type', '')), '') is not null
			      or nullif(btrim(coalesce(lte.metadata->>'distribution_queue_id', '')), '') is not null
			      or nullif(btrim(coalesce(lte.metadata->>'distribution_event_id', '')), '') is not null
			      or lower(btrim(coalesce(lte.metadata->>'reason', ''))) in ('no_available_members', 'no_matching_queue')
			    )
			  )
			  and not (
			    lower(coalesce(lte.metadata->>'is_automation', lte.metadata->>'is_automated', lte.metadata->>'automated', 'false')) in ('true', '1', 'yes')
			    or lower(btrim(coalesce(lte.metadata->>'origin', ''))) in ('ai', 'openai', 'automation', 'bot', 'ai_autoreply', 'ai_followup')
			    or lower(btrim(coalesce(lte.metadata->>'origin', ''))) ~ '^(ai|automation)[_.]'
			    or lower(coalesce(lte.metadata->>'sender_type', '')) in ('ai', 'automation', 'bot')
			  )
		) or exists (
			select 1
			from public.whatsapp_messages wm
			join target_lead l
			  on l.organization_id = wm.organization_id
			 and l.id = wm.lead_id
			where coalesce(wm.sent_at, wm.received_at, wm.created_at) >= $3::timestamptz
			  and (coalesce(wm.from_me, false) = true or lower(coalesce(wm.direction, '')) = 'outbound')
			  and not (
			    lower(coalesce(wm.metadata->>'is_automation', wm.metadata->>'is_automated', wm.metadata->>'automated', 'false')) in ('true', '1', 'yes')
			    or lower(btrim(coalesce(wm.metadata->>'origin', ''))) in ('ai', 'openai', 'automation', 'bot', 'ai_autoreply', 'ai_followup')
			    or lower(btrim(coalesce(wm.metadata->>'origin', ''))) ~ '^(ai|automation)[_.]'
			    or lower(coalesce(wm.metadata->>'sender_type', '')) in ('ai', 'automation', 'bot')
			    or lower(coalesce(wm.client_message_id, '')) like 'ai-%'
			  )
		) or exists (
			select 1
			from public.lead_tasks lt
			join target_lead l
			  on l.organization_id = lt.organization_id
			 and l.id = lt.lead_id
			where (
				lt.created_by is not null
				and lt.created_at >= $3::timestamptz
			) or (
				lt.done_by is not null
				and coalesce(lt.completed_at, lt.done_at) >= $3::timestamptz
			)
		) or exists (
			select 1
			from public.schedule_events se
			join target_lead l
			  on l.organization_id = se.organization_id
			 and l.id = se.lead_id
			where se.status not in ('cancelled', 'canceled')
			  and (
			    se.created_at >= $3::timestamptz
			    or se.completed_at >= $3::timestamptz
			  )
		) or exists (
			select 1
			from public.audit_logs al
			join target_lead l
			  on l.organization_id = al.organization_id
			 and l.id::text = al.entity_id
			where al.entity_type = 'lead'
			  and al.user_id is not null
			  and al.created_at >= $3::timestamptz
			  and not (
			    lower(coalesce(al.source, '')) = 'database_trigger'
			    and exists (
			      select 1
			      from public.round_robin_logs system_distribution
			      where system_distribution.organization_id = al.organization_id
			        and system_distribution.lead_id::text = al.entity_id
			        and system_distribution.round_robin_id = nullif($4, '')::uuid
			        and system_distribution.assigned_user_id = nullif($5, '')::uuid
			        and system_distribution.created_at between al.created_at - interval '1 second' and al.created_at + interval '1 second'
			    )
			  )
		)
	`, job.OrganizationID, job.LeadID, job.EnrolledAt, job.RoundRobinID, job.CurrentAssignedUserID).Scan(&hasHumanAction)
	if err != nil {
		return false, err
	}
	return hasHumanAction, nil
}

func (repo Repository) nextRoundRobinMemberAvailability(
	ctx context.Context,
	queryer leadTeamQueryer,
	organizationID string,
	roundRobinID string,
	excludedUserID string,
	requiredTeamID string,
	fallbackDelay time.Duration,
) (time.Time, bool, error) {
	var hasAlternative bool
	var nextAvailability pgtype.Timestamptz

	err := queryer.QueryRow(ctx, `
		with entries as (
			select
				rrm.id,
				rrm.round_robin_id,
				rrm.organization_id,
				rrm.user_id,
				rrm.team_id,
				rrm.membership_generation,
				rrm.created_at,
				lower(coalesce(rr.settings->>'ignore_availability', 'false')) in ('true', '1', 'yes') as ignore_availability,
				case
				  when exists (
				    select 1 from pg_catalog.pg_timezone_names
				    where name = timezone_config.configured_timezone
				  ) then timezone_config.configured_timezone
				  else 'America/Sao_Paulo'
				end as timezone
			from public.round_robin_members rrm
			join public.round_robins rr
			  on rr.id = rrm.round_robin_id
			 and rr.organization_id = rrm.organization_id
			left join public.organization_attention_settings attention_settings
			  on attention_settings.organization_id = rrm.organization_id
			left join lateral (
				select coalesce(
					nullif(btrim(rr.settings->>'timezone'), ''),
					nullif(btrim(attention_settings.timezone), '')
				) as configured_timezone
			) timezone_config on true
			where rrm.organization_id = $1::uuid
			  and rrm.round_robin_id = $2::uuid
			  and coalesce(rrm.is_active, true) = true
			  and coalesce(rr.is_active, true) = true
		),
		candidates as (
			select
				entries.organization_id,
				entries.user_id,
				entries.membership_generation,
				entries.ignore_availability,
				entries.timezone,
				tm.id as team_member_id
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
				entries.organization_id,
				tm.user_id,
				tm.membership_generation,
				entries.ignore_availability,
				entries.timezone,
				tm.id as team_member_id
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
		),
		eligible as (
			select distinct
				candidates.organization_id,
				candidates.user_id,
				candidates.membership_generation,
				candidates.ignore_availability,
				candidates.timezone,
				candidates.team_member_id
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
			where (nullif($3, '')::uuid is null or candidates.user_id <> nullif($3, '')::uuid)
			  and (
			    nullif($4, '')::uuid is null
			    or exists (
			      select 1
			      from public.team_members required_member
			      where required_member.organization_id = candidates.organization_id
			        and required_member.team_id = nullif($4, '')::uuid
			        and required_member.user_id = candidates.user_id
			        and required_member.membership_generation = om.membership_generation
			        and coalesce(required_member.is_active, true) = true
			    )
			  )
		),
		availability_members as (
			select distinct
				eligible.organization_id,
				eligible.user_id,
				eligible.ignore_availability,
				availability_member.id as team_member_id
			from eligible
			join public.team_members availability_member
			  on availability_member.id = eligible.team_member_id
			 and availability_member.organization_id = eligible.organization_id
			 and availability_member.user_id = eligible.user_id
			 and availability_member.membership_generation = eligible.membership_generation
			 and coalesce(availability_member.is_active, true) = true
			join public.teams availability_team
			  on availability_team.id = availability_member.team_id
			 and availability_team.organization_id = availability_member.organization_id
			 and coalesce(availability_team.is_active, true) = true
			where eligible.team_member_id is not null
		),
		clock as (
			select
				eligible.timezone,
				now() at time zone eligible.timezone as local_now
			from eligible
			limit 1
		),
		next_windows as (
			select
				(
					(
						(clock.local_now::date + offsets.day_offset)::date
						+ case
						    when coalesce(ma.is_all_day, false) then time '00:00'
						    else ma.start_time
						  end
					) at time zone clock.timezone
				) as starts_at
			from availability_members eligible
			join public.member_availability ma
			  on ma.organization_id = eligible.organization_id
			 and ma.team_member_id = eligible.team_member_id
			 and coalesce(ma.is_active, true) = true
			cross join clock
			cross join generate_series(0, 7) as offsets(day_offset)
			where eligible.ignore_availability = false
			  and extract(dow from (clock.local_now::date + offsets.day_offset)::date)::int = ma.day_of_week
			  and (coalesce(ma.is_all_day, false) = true or ma.start_time is not null)
		)
		select
			exists (select 1 from eligible),
			(
				select min(next_windows.starts_at)
				from next_windows
				where next_windows.starts_at > now()
			)
	`, organizationID, roundRobinID, excludedUserID, requiredTeamID).Scan(&hasAlternative, &nextAvailability)
	if err != nil {
		return time.Time{}, false, err
	}

	if !hasAlternative {
		return time.Time{}, false, nil
	}

	now := time.Now().UTC()
	if nextAvailability.Valid && nextAvailability.Time.After(now) {
		return nextAvailability.Time, true, nil
	}
	return now.Add(fallbackDelay), true, nil
}

func (repo Repository) insertAutoRedistributionLog(ctx context.Context, tx pgx.Tx, job redistributionJob, selection roundRobinSelection, previousUserID string) error {
	_, err := tx.Exec(ctx, `
		insert into public.round_robin_logs (
			organization_id,
			round_robin_id,
			lead_id,
			assigned_user_id,
			reason,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			'auto_redistribution',
			$5::jsonb
		)
	`, job.OrganizationID, job.RoundRobinID, job.LeadID, selection.UserID, jsonb(map[string]any{
		"job_id":           job.ID,
		"previous_user_id": previousUserID,
		"member_id":        selection.MemberID,
		"attempt_count":    job.AttemptCount + 1,
		"timeout_minutes":  job.TimeoutMinutes,
	}))
	if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		update public.leads
		set redistribution_count = coalesce(redistribution_count, 0) + 1,
		    updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, job.OrganizationID, job.LeadID); err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
		update public.round_robins
		set current_position = coalesce(current_position, 0) + 1,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, job.OrganizationID, job.RoundRobinID)
	return err
}

func (repo Repository) updateRedistributionJobAfterTransfer(ctx context.Context, tx pgx.Tx, job redistributionJob, nextUserID string, attemptCount int, status string) error {
	if status == "max_attempts_reached" {
		_, err := tx.Exec(ctx, `
			update public.lead_redistribution_jobs
			set current_assigned_user_id = $2::uuid,
		    warning_retry_at = null, redistribution_retry_at = null,
			    attempt_count = $3,
			    status = 'max_attempts_reached',
			    last_redistributed_at = now(),
			    stopped_at = now(),
			    stopped_reason = 'max_attempts_reached',
			    warning_sent_at = null,
			    metadata = metadata - 'waiting_for_available_member' - 'next_candidate_check_at',
			    updated_at = now()
			where id = $1::uuid
		`, job.ID, nextUserID, attemptCount)
		return err
	}

	_, err := tx.Exec(ctx, `
		update public.lead_redistribution_jobs
		set current_assigned_user_id = $2::uuid,
		    warning_retry_at = null, redistribution_retry_at = null,
		    attempt_count = $3,
		    status = 'pending',
		    due_at = now() + ($4::integer * interval '1 minute'),
		    warning_due_at = case
			      when $4::integer > 5 and $5::integer > 0 and $5::integer < $4::integer
		        then now() + (($4::integer - $5::integer) * interval '1 minute')
		      else null
		    end,
		    warning_sent_at = null,
		    last_redistributed_at = now(),
		    metadata = metadata - 'waiting_for_available_member' - 'next_candidate_check_at',
		    updated_at = now()
		where id = $1::uuid
	`, job.ID, nextUserID, attemptCount, job.TimeoutMinutes, job.WarningMinutes)
	return err
}

func (repo Repository) deferRedistributionJobUntilAvailability(
	ctx context.Context,
	executor leadRedistributionExecutor,
	jobID string,
	nextAvailableAt time.Time,
	timeoutMinutes int,
	warningMinutes int,
) error {
	_, err := executor.Exec(ctx, `
		update public.lead_redistribution_jobs
		set status = 'pending',
		    warning_retry_at = null, redistribution_retry_at = null,
		    due_at = $2::timestamptz + ($3::integer * interval '1 minute'),
		    warning_due_at = case
		      when $3::integer > 5 and $4::integer > 0 and $4::integer < $3::integer
		        then $2::timestamptz + (($3::integer - $4::integer) * interval '1 minute')
		      else null
		    end,
		    warning_sent_at = null,
		    metadata = metadata || jsonb_build_object(
		      'waiting_for_available_member', true,
		      'next_candidate_check_at', $2::timestamptz
		    ),
		    updated_at = now()
		where id = $1::uuid
		  and status in ('pending', 'warning_sent')
	`, jobID, nextAvailableAt, timeoutMinutes, warningMinutes)
	return err
}

func (repo Repository) reopenManagedWhatsAppInitialDistribution(
	ctx context.Context,
	executor leadRedistributionExecutor,
	jobID string,
	retryAt time.Time,
	attemptCount int,
	resultJSON []byte,
) error {
	tag, err := executor.Exec(ctx, `
		update public.lead_redistribution_jobs
		set status = 'pending',
		    warning_retry_at = null, redistribution_retry_at = null,
		    due_at = $2::timestamptz,
		    attempt_count = $3,
		    warning_due_at = null,
		    warning_sent_at = null,
		    stopped_at = null,
		    stopped_reason = null,
		    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
		      'initial_distribution_pending', true,
		      'initial_distribution_last_attempt_at', now(),
		      'initial_distribution_last_result', $4::jsonb
		    ),
		    updated_at = now()
		where id = $1::uuid
		  and status in ('pending', 'warning_sent', 'stopped')
	`, jobID, retryAt, attemptCount, string(resultJSON))
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("managed WhatsApp initial distribution job could not be reopened")
	}
	return nil
}

func (repo Repository) stopRedistributionJob(ctx context.Context, executor leadRedistributionExecutor, jobID string, reason string) error {
	return repo.finishRedistributionJob(ctx, executor, jobID, "stopped", reason)
}

func (repo Repository) finishRedistributionJob(ctx context.Context, executor leadRedistributionExecutor, jobID string, status string, reason string) error {
	_, err := executor.Exec(ctx, `
		update public.lead_redistribution_jobs
		set status = $2,
		    warning_retry_at = null, redistribution_retry_at = null,
		    stopped_reason = $3,
		    stopped_at = now(),
		    updated_at = now()
		where id = $1::uuid
	`, jobID, status, reason)
	return err
}
