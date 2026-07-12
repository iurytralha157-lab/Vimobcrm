package gamification

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	gamificationWorkerInterval    = 5 * time.Second
	gamificationWorkerInitialWait = 2 * time.Second
	gamificationWorkerDrainYield  = 10 * time.Millisecond
	gamificationWorkerBatchSize   = 10
	gamificationWorkerLease       = 5 * time.Minute
	gamificationWorkerLeaseSQL    = "5 minutes"
	gamificationJobTimeout        = 15 * time.Second
)

type outboxJob struct {
	ID             string
	OrganizationID string
	SeasonID       string
	UserID         string
	ActionType     string
	Quantity       int
	Source         string
	ReferenceID    string
	IdempotencyKey string
	Metadata       string
	OccurredAt     time.Time
	Attempts       int
	MaxAttempts    int
	WorkerID       string
}

var errGamificationOutboxLeaseLost = errors.New("gamification outbox lease lost")

var gamificationBusinessLocation = time.FixedZone("America/Sao_Paulo", -3*60*60)

type missionAward struct {
	ID          string
	TargetCount int64
	BonusPoints int64
	Period      string
}

// StartWorker runs the canonical outbox consumer. App wiring must call it once
// after Repository construction; concurrent API replicas are safe because jobs
// are claimed with FOR UPDATE SKIP LOCKED and a lease token.
func (repo Repository) StartWorker(ctx context.Context, logger *slog.Logger) {
	if logger == nil {
		logger = slog.Default()
	}

	go func() {
		timer := time.NewTimer(gamificationWorkerInitialWait)
		defer timer.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				processed, err := repo.processOutboxBatch(ctx)
				if err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("gamification outbox worker failed", "error", err)
				}
				if ctx.Err() != nil {
					return
				}
				timer.Reset(gamificationWorkerDelay(processed))
			}
		}
	}()
}

// ProcessOutbox claims one bounded batch and processes each job atomically.
// It is public to support deterministic tests and one-shot maintenance runs.
func (repo Repository) ProcessOutbox(ctx context.Context) error {
	_, err := repo.processOutboxBatch(ctx)
	return err
}

func (repo Repository) processOutboxBatch(ctx context.Context) (int, error) {
	workerID := gamificationWorkerID()
	jobs, err := repo.claimOutboxJobs(ctx, workerID, gamificationWorkerBatchSize)
	if err != nil {
		return 0, err
	}

	var processErrors []error
	for _, job := range jobs {
		jobCtx, cancel := context.WithTimeout(ctx, gamificationJobTimeout)
		err := repo.processOutboxJob(jobCtx, job)
		cancel()
		if err == nil {
			continue
		}

		failCtx, failCancel := context.WithTimeout(context.Background(), 5*time.Second)
		failErr := repo.failOutboxJob(failCtx, job, err)
		failCancel()
		if failErr != nil {
			processErrors = append(processErrors, fmt.Errorf("job %s: %w (mark failure: %v)", job.ID, err, failErr))
			continue
		}
		processErrors = append(processErrors, fmt.Errorf("job %s: %w", job.ID, err))
	}

	return len(jobs), errors.Join(processErrors...)
}

func gamificationWorkerDelay(processed int) time.Duration {
	if processed >= gamificationWorkerBatchSize {
		return gamificationWorkerDrainYield
	}
	return gamificationWorkerInterval
}

func (repo Repository) claimOutboxJobs(ctx context.Context, workerID string, limit int) ([]outboxJob, error) {
	if limit <= 0 || limit > gamificationWorkerBatchSize {
		limit = gamificationWorkerBatchSize
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		update public.gamification_outbox
		set status = 'dead',
		    worker_id = null,
		    locked_at = null,
		    processed_at = now(),
		    last_error = coalesce(last_error, 'lease_expired_after_max_attempts'),
		    updated_at = now()
		where status in ('pending', 'processing')
		  and attempts >= max_attempts
		  and (locked_at is null or locked_at < now() - $1::interval)
	`, gamificationWorkerLeaseSQL); err != nil {
		return nil, err
	}

	rows, err := tx.Query(ctx, `
		with candidates as (
			select id
			from public.gamification_outbox
			where attempts < max_attempts
			  and (
			    (status = 'pending' and available_at <= now())
			    or (
			      status = 'processing'
			      and locked_at < now() - $2::interval
			    )
			  )
			order by available_at asc, created_at asc, id asc
			limit $3
			for update skip locked
		)
		update public.gamification_outbox job
		set status = 'processing',
		    attempts = job.attempts + 1,
		    locked_at = now(),
		    worker_id = $1,
		    last_error = null,
		    updated_at = now()
		from candidates
		where job.id = candidates.id
		returning
			job.id::text,
			job.organization_id::text,
			job.season_id::text,
			job.user_id::text,
			job.action_type,
			job.quantity,
			job.source,
			coalesce(job.reference_id, ''),
			job.idempotency_key,
			job.metadata::text,
			job.occurred_at,
			job.attempts,
			job.max_attempts,
			job.worker_id
	`, workerID, gamificationWorkerLeaseSQL, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	jobs := make([]outboxJob, 0, limit)
	for rows.Next() {
		var job outboxJob
		if err := rows.Scan(
			&job.ID,
			&job.OrganizationID,
			&job.SeasonID,
			&job.UserID,
			&job.ActionType,
			&job.Quantity,
			&job.Source,
			&job.ReferenceID,
			&job.IdempotencyKey,
			&job.Metadata,
			&job.OccurredAt,
			&job.Attempts,
			&job.MaxAttempts,
			&job.WorkerID,
		); err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return jobs, nil
}

func (repo Repository) processOutboxJob(ctx context.Context, job outboxJob) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var status string
	if err := tx.QueryRow(ctx, `
		select status
		from public.gamification_outbox
		where id = $1::uuid
		  and worker_id = $2
		for update
	`, job.ID, job.WorkerID).Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	if status != "processing" {
		return nil
	}

	eligible, reason, err := repo.jobEligibility(ctx, tx, job)
	if err != nil {
		return err
	}
	if !eligible {
		if err := finishOutboxJob(ctx, tx, job, "skipped", "", reason); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}

	rulePoints, ruleActive, err := repo.pointsForAction(ctx, tx, job.OrganizationID, job.ActionType)
	if err != nil {
		return err
	}
	if !ruleActive || rulePoints <= 0 {
		reason := "rule_disabled"
		if ruleActive {
			reason = "rule_zero_points"
		}
		if err := finishOutboxJob(ctx, tx, job, "skipped", "", reason); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}

	totalPoints, err := calculateAwardPoints(rulePoints, job.Quantity)
	if err != nil {
		return err
	}
	metadata := mergeJobMetadata(job.Metadata, map[string]any{
		"count":         job.Quantity,
		"unit_points":   rulePoints,
		"source_module": job.Source,
		"reference_id":  job.ReferenceID,
		"outbox_id":     job.ID,
	})

	var eventID string
	err = tx.QueryRow(ctx, `
		insert into public.gamification_events (
			organization_id,
			season_id,
			user_id,
			event_type,
			points_earned,
			xp_earned,
			quantity,
			source,
			reference_id,
			idempotency_key,
			metadata,
			occurred_at
		)
		values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $5, $6, $7, nullif($8, ''), $9, $10::jsonb, $11::timestamptz)
		on conflict (organization_id, idempotency_key) do nothing
		returning id::text
	`, job.OrganizationID, job.SeasonID, job.UserID, job.ActionType, totalPoints, job.Quantity, job.Source, job.ReferenceID, job.IdempotencyKey, metadata, job.OccurredAt).Scan(&eventID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `
			select id::text
			from public.gamification_events
			where organization_id = $1::uuid
			  and idempotency_key = $2
		`, job.OrganizationID, job.IdempotencyKey).Scan(&eventID)
		if err != nil {
			return err
		}
		if err := markManualEntryAwarded(ctx, tx, job); err != nil {
			return err
		}
		if err := finishOutboxJob(ctx, tx, job, "completed", eventID, "already_awarded"); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if err != nil {
		return err
	}

	awardTime := job.OccurredAt.UTC()
	if job.OccurredAt.IsZero() {
		awardTime = time.Now().UTC()
	}
	if err := awardUserStats(ctx, tx, job.OrganizationID, job.SeasonID, job.UserID, totalPoints, awardTime); err != nil {
		return err
	}
	if err := repo.applyMissions(ctx, tx, job, awardTime); err != nil {
		return err
	}
	if err := markManualEntryAwarded(ctx, tx, job); err != nil {
		return err
	}
	if err := finishOutboxJob(ctx, tx, job, "completed", eventID, ""); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func markManualEntryAwarded(ctx context.Context, tx pgx.Tx, job outboxJob) error {
	if job.Source != "manual_entry" {
		return nil
	}
	_, err := tx.Exec(ctx, `
		update public.gamification_manual_entries
		set awarded_at = coalesce(awarded_at, now()),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = nullif($2, '')::uuid
		  and outbox_id = $3::uuid
		  and status = 'approved'
	`, job.OrganizationID, job.ReferenceID, job.ID)
	return err
}

func (repo Repository) jobEligibility(ctx context.Context, tx pgx.Tx, job outboxJob) (bool, string, error) {
	actionType := normalizeActionType(job.ActionType)
	if actionType == "" {
		return false, "unknown_action", nil
	}

	var moduleEnabled, activeMember, participates, seasonExists bool
	err := tx.QueryRow(ctx, `
		select
			exists (
				select 1
				from public.organization_modules module_access
				where module_access.organization_id = $1::uuid
				  and module_access.module_name = 'gamification'
				  and module_access.is_enabled = true
			),
			exists (
				select 1
				from public.organization_members membership
				join public.users users on users.id = membership.user_id
				where membership.organization_id = $1::uuid
				  and membership.user_id = $2::uuid
				  and membership.is_active = true
				  and users.is_active = true
			),
			coalesce((
				select participant.participates
				from public.gamification_participants participant
				where participant.organization_id = $1::uuid
				  and participant.user_id = $2::uuid
			), true),
			exists (
				select 1
				from public.gamification_seasons season
				where season.organization_id = $1::uuid
				  and season.id = $3::uuid
			)
	`, job.OrganizationID, job.UserID, job.SeasonID).Scan(&moduleEnabled, &activeMember, &participates, &seasonExists)
	if err != nil {
		return false, "", err
	}
	eligible, reason := evaluateEligibility(moduleEnabled, activeMember, participates, seasonExists)
	return eligible, reason, nil
}

func (repo Repository) pointsForAction(ctx context.Context, tx pgx.Tx, organizationID string, actionType string) (int64, bool, error) {
	var points int64
	var active bool
	err := tx.QueryRow(ctx, `
		select points::bigint, is_active
		from public.gamification_rules
		where organization_id = $1::uuid
		  and action_type = $2
		for share
	`, organizationID, actionType).Scan(&points, &active)
	if errors.Is(err, pgx.ErrNoRows) {
		points, active = resolveRulePoints(false, false, 0, defaultRulePoints(actionType))
		return points, active, nil
	}
	if err != nil {
		return 0, false, err
	}
	points, active = resolveRulePoints(true, active, points, defaultRulePoints(actionType))
	return points, active, nil
}

func awardUserStats(ctx context.Context, tx pgx.Tx, organizationID string, seasonID string, userID string, points int64, awardedAt time.Time) error {
	// Serialize only this organization/user inside the worker. Without this
	// narrow lock, two concurrent days can each compute a streak snapshot that
	// cannot see the other's uncommitted activity-day row, and the stale writer
	// may win last.
	if _, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(
			hashtextextended('gamification:user:' || $1 || ':' || $2, 0)
		)
	`, organizationID, userID); err != nil {
		return err
	}

	activityDate := awardedAt.In(gamificationBusinessLocation).Format("2006-01-02")
	if _, err := tx.Exec(ctx, `
		insert into private.gamification_activity_days (
			organization_id,
			season_id,
			user_id,
			activity_date
		)
		values ($1::uuid, $2::uuid, $3::uuid, $4::date)
		on conflict (organization_id, season_id, user_id, activity_date) do nothing
	`, organizationID, seasonID, userID, activityDate); err != nil {
		return err
	}

	rows, err := tx.Query(ctx, `
		select activity_date::text
		from private.gamification_activity_days
		where organization_id = $1::uuid
		  and season_id = $2::uuid
		  and user_id = $3::uuid
		order by activity_date desc
	`, organizationID, seasonID, userID)
	if err != nil {
		return err
	}
	activityDates := []string{}
	for rows.Next() {
		var date string
		if err := rows.Scan(&date); err != nil {
			rows.Close()
			return err
		}
		activityDates = append(activityDates, date)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	streakDays := currentStreakFromDates(activityDates, time.Now().UTC())

	rank := rankForPoints(points)
	_, err = tx.Exec(ctx, `
		insert into public.user_gamification_stats (
			organization_id,
			season_id,
			user_id,
			total_points,
			points,
			xp,
			xp_total,
			xp_current_level,
			xp_next_level,
			current_level,
			current_rank,
			rank_tier,
			streak_days,
			last_activity_at
		)
		values (
			$1::uuid, $2::uuid, $3::uuid,
			$4::bigint, $4::bigint, $4::bigint, $4::bigint,
			$4::bigint % 1000, 1000, greatest(1, ($4::bigint / 1000) + 1),
			$5, $5, $7, $6::timestamptz
		)
		on conflict (organization_id, season_id, user_id)
		do update set
			total_points = public.user_gamification_stats.total_points + excluded.total_points,
			points = public.user_gamification_stats.points + excluded.points,
			xp = public.user_gamification_stats.xp + excluded.xp,
			xp_total = public.user_gamification_stats.xp_total + excluded.xp_total,
			xp_current_level = (public.user_gamification_stats.xp_total + excluded.xp_total) % 1000,
			xp_next_level = 1000,
			current_level = greatest(1, ((public.user_gamification_stats.xp_total + excluded.xp_total) / 1000) + 1),
			current_rank = case
				when public.user_gamification_stats.total_points + excluded.total_points >= 15000 then 'Diamante'
				when public.user_gamification_stats.total_points + excluded.total_points >= 5000 then 'Ouro'
				when public.user_gamification_stats.total_points + excluded.total_points >= 1000 then 'Prata'
				else 'Bronze'
			end,
			rank_tier = case
				when public.user_gamification_stats.total_points + excluded.total_points >= 15000 then 'Diamante'
				when public.user_gamification_stats.total_points + excluded.total_points >= 5000 then 'Ouro'
				when public.user_gamification_stats.total_points + excluded.total_points >= 1000 then 'Prata'
				else 'Bronze'
			end,
			streak_days = excluded.streak_days,
			last_activity_at = greatest(public.user_gamification_stats.last_activity_at, excluded.last_activity_at),
			updated_at = now()
	`, organizationID, seasonID, userID, points, rank, awardedAt, streakDays)
	return err
}

func (repo Repository) applyMissions(ctx context.Context, tx pgx.Tx, job outboxJob, awardedAt time.Time) error {
	rows, err := tx.Query(ctx, `
		select
			mission.id::text,
			mission.target_count::bigint,
			mission.bonus_points::bigint,
			coalesce(mission.period, 'season')
		from public.gamification_missions mission
		where mission.organization_id = $1::uuid
		  and mission.is_active = true
		  and mission.action_type = $2
		  and (
		    mission.target_scope = 'organization'
		    or mission.target_user_id = $3::uuid
		  )
		order by mission.id
		for share
	`, job.OrganizationID, job.ActionType, job.UserID)
	if err != nil {
		return err
	}
	defer rows.Close()

	missions := []missionAward{}
	for rows.Next() {
		var mission missionAward
		if err := rows.Scan(&mission.ID, &mission.TargetCount, &mission.BonusPoints, &mission.Period); err != nil {
			return err
		}
		missions = append(missions, mission)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	rows.Close()

	for _, mission := range missions {
		periodKey := missionPeriodKey(mission.Period, awardedAt, job.SeasonID)
		var progressID string
		if err := tx.QueryRow(ctx, `
			insert into public.gamification_mission_progress (
				organization_id,
				mission_id,
				season_id,
				user_id,
				period_key,
				current_progress
			)
			values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 0)
			on conflict (organization_id, mission_id, season_id, user_id, period_key)
			do update set period_key = excluded.period_key
			returning id::text
		`, job.OrganizationID, mission.ID, job.SeasonID, job.UserID, periodKey).Scan(&progressID); err != nil {
			return err
		}

		var currentProgress int64
		var completed bool
		var bonusEventID string
		if err := tx.QueryRow(ctx, `
			select current_progress, completed_at is not null, coalesce(bonus_event_id::text, '')
			from public.gamification_mission_progress
			where id = $1::uuid
			for update
		`, progressID).Scan(&currentProgress, &completed, &bonusEventID); err != nil {
			return err
		}

		nextProgress, shouldAwardBonus := advanceMissionProgress(
			currentProgress,
			mission.TargetCount,
			int64(job.Quantity),
			completed || bonusEventID != "",
		)
		if _, err := tx.Exec(ctx, `
			update public.gamification_mission_progress
			set current_progress = $2::bigint,
			    completed_at = case
			      when $2::bigint >= $3::bigint then coalesce(completed_at, $4::timestamptz)
			      else completed_at
			    end,
			    updated_at = now()
			where id = $1::uuid
		`, progressID, nextProgress, mission.TargetCount, awardedAt); err != nil {
			return err
		}

		if !shouldAwardBonus || mission.BonusPoints <= 0 {
			continue
		}
		bonusReference := strings.Join([]string{mission.ID, job.SeasonID, job.UserID, periodKey}, ":")
		bonusKey := strings.Join([]string{"v1", job.OrganizationID, "mission_bonus", bonusReference}, "|")
		var awardedBonusEventID string
		err := tx.QueryRow(ctx, `
			insert into public.gamification_events (
				organization_id,
				season_id,
				user_id,
				event_type,
				points_earned,
				xp_earned,
				quantity,
				source,
				reference_id,
				idempotency_key,
				metadata,
				occurred_at
			)
			values (
				$1::uuid, $2::uuid, $3::uuid, 'mission_bonus',
				$4::bigint, $4::bigint, 1, 'mission', $5, $6,
				jsonb_build_object('mission_id', $5, 'period_key', $7, 'source_event_id', $8),
				$9::timestamptz
			)
			on conflict (organization_id, idempotency_key) do nothing
			returning id::text
		`, job.OrganizationID, job.SeasonID, job.UserID, mission.BonusPoints, mission.ID, bonusKey, periodKey, job.ID, awardedAt).Scan(&awardedBonusEventID)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		if err := awardUserStats(ctx, tx, job.OrganizationID, job.SeasonID, job.UserID, mission.BonusPoints, awardedAt); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			update public.gamification_mission_progress
			set bonus_event_id = $2::uuid,
			    updated_at = now()
			where id = $1::uuid
			  and bonus_event_id is null
		`, progressID, awardedBonusEventID); err != nil {
			return err
		}
	}
	return nil
}

func finishOutboxJob(ctx context.Context, tx pgx.Tx, job outboxJob, status string, eventID string, reason string) error {
	tag, err := tx.Exec(ctx, `
		update public.gamification_outbox
		set status = $3,
		    processed_event_id = nullif($4, '')::uuid,
		    processed_at = now(),
		    worker_id = null,
		    locked_at = null,
		    last_error = nullif($5, ''),
		    updated_at = now()
		where id = $1::uuid
		  and worker_id = $2
		  and status = 'processing'
	`, job.ID, job.WorkerID, status, eventID, reason)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errGamificationOutboxLeaseLost
	}
	return nil
}

func (repo Repository) failOutboxJob(ctx context.Context, job outboxJob, processErr error) error {
	status := "pending"
	if job.Attempts >= job.MaxAttempts {
		status = "dead"
	}
	availableAt := time.Now().UTC().Add(gamificationRetryDelay(job.Attempts))
	errorText := truncateGamificationError(processErr)
	tag, err := repo.db.Pool().Exec(ctx, `
		update public.gamification_outbox
		set status = $3,
		    available_at = $4::timestamptz,
		    worker_id = null,
		    locked_at = null,
		    processed_at = case when $3 = 'dead' then now() else null end,
		    last_error = $5,
		    updated_at = now()
		where id = $1::uuid
		  and worker_id = $2
		  and status = 'processing'
	`, job.ID, job.WorkerID, status, availableAt, errorText)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errGamificationOutboxLeaseLost
	}
	return nil
}

func missionPeriodKey(period string, at time.Time, seasonID string) string {
	at = at.In(gamificationBusinessLocation)
	switch strings.ToLower(strings.TrimSpace(period)) {
	case "daily":
		return at.Format("2006-01-02")
	case "weekly":
		year, week := at.ISOWeek()
		return fmt.Sprintf("%04d-W%02d", year, week)
	case "monthly":
		return at.Format("2006-01")
	default:
		return "season:" + seasonID
	}
}

func advanceMissionProgress(current int64, target int64, increment int64, bonusAlreadyAwarded bool) (int64, bool) {
	if target <= 0 {
		return current, false
	}
	if increment < 0 {
		increment = 0
	}
	next := current + increment
	if next > target {
		next = target
	}
	return next, !bonusAlreadyAwarded && current < target && next >= target
}

func resolveRulePoints(found bool, active bool, configured int64, fallback int64) (int64, bool) {
	if found {
		if !active || configured <= 0 {
			return 0, active
		}
		return configured, true
	}
	if fallback <= 0 {
		return 0, false
	}
	return fallback, true
}

func evaluateEligibility(moduleEnabled bool, activeMember bool, participates bool, seasonExists bool) (bool, string) {
	switch {
	case !moduleEnabled:
		return false, "module_disabled"
	case !activeMember:
		return false, "inactive_or_cross_tenant_user"
	case !participates:
		return false, "participant_disabled"
	case !seasonExists:
		return false, "season_not_found"
	default:
		return true, ""
	}
}

func calculateAwardPoints(unitPoints int64, quantity int) (int64, error) {
	if unitPoints < 0 || unitPoints > 100_000 || quantity < 1 || quantity > 100 {
		return 0, ErrInvalidInput
	}
	return unitPoints * int64(quantity), nil
}

// currentStreakFromDates receives unique activity dates ordered newest first.
// It derives the live streak from the ledger calendar, so a delayed event can
// fill an older gap without resetting or double-incrementing the current run.
func currentStreakFromDates(values []string, now time.Time) int {
	if len(values) == 0 {
		return 0
	}
	todayLocal := now.In(gamificationBusinessLocation)
	today := time.Date(todayLocal.Year(), todayLocal.Month(), todayLocal.Day(), 0, 0, 0, 0, gamificationBusinessLocation)
	latest, err := time.ParseInLocation("2006-01-02", values[0], gamificationBusinessLocation)
	if err != nil || latest.Before(today.AddDate(0, 0, -1)) {
		return 0
	}

	expected := latest
	streak := 0
	for _, value := range values {
		activityDate, parseErr := time.ParseInLocation("2006-01-02", value, gamificationBusinessLocation)
		if parseErr != nil {
			continue
		}
		if activityDate.After(expected) {
			continue
		}
		if !activityDate.Equal(expected) {
			break
		}
		streak++
		expected = expected.AddDate(0, 0, -1)
	}
	return streak
}

func rankForPoints(points int64) string {
	switch {
	case points >= 15_000:
		return "Diamante"
	case points >= 5_000:
		return "Ouro"
	case points >= 1_000:
		return "Prata"
	default:
		return "Bronze"
	}
}

func gamificationRetryDelay(attempt int) time.Duration {
	switch {
	case attempt <= 1:
		return time.Minute
	case attempt == 2:
		return 5 * time.Minute
	case attempt == 3:
		return 15 * time.Minute
	default:
		return time.Hour
	}
}

func mergeJobMetadata(raw string, additions map[string]any) string {
	payload := map[string]any{}
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &payload)
	}
	for key, value := range additions {
		payload[key] = value
	}
	return jsonb(payload)
}

func truncateGamificationError(err error) string {
	if err == nil {
		return ""
	}
	value := strings.TrimSpace(err.Error())
	if len(value) > 1000 {
		return value[:1000]
	}
	return value
}

func gamificationWorkerID() string {
	hostname, _ := os.Hostname()
	return fmt.Sprintf("%s:%d:%d", hostname, os.Getpid(), time.Now().UTC().UnixNano())
}
