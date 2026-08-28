package publications

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var publicationWorkerWake = make(chan struct{}, 1)

func wakePublicationWorker() {
	select {
	case publicationWorkerWake <- struct{}{}:
	default:
	}
}

func (config WorkerConfig) normalized() WorkerConfig {
	if config.Interval <= 0 {
		config.Interval = 2 * time.Second
	}
	if config.BatchSize < 1 {
		config.BatchSize = 25
	}
	if config.BatchSize > 500 {
		config.BatchSize = 500
	}
	if config.Lease <= 0 {
		config.Lease = 2 * time.Minute
	}
	if config.MaxAttempts < 1 {
		config.MaxAttempts = 12
	}
	if config.MaxAttempts > 50 {
		config.MaxAttempts = 50
	}
	return config
}

func (repo Repository) StartWorker(ctx context.Context, logger *slog.Logger) {
	if !repo.config.Worker.Enabled {
		return
	}
	workerID := publicationWorkerID()
	go func() {
		ticker := time.NewTicker(repo.config.Worker.Interval)
		defer ticker.Stop()
		repo.runWorkerBatch(ctx, logger, workerID)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				repo.runWorkerBatch(ctx, logger, workerID)
			case <-publicationWorkerWake:
				repo.runWorkerBatch(ctx, logger, workerID)
			}
		}
	}()
}

func publicationWorkerID() string {
	hostname, _ := os.Hostname()
	hostname = strings.TrimSpace(hostname)
	if hostname == "" {
		hostname = "unknown"
	}
	return fmt.Sprintf("property-publications:%s:%d:%d", hostname, os.Getpid(), time.Now().UnixNano())
}

func (repo Repository) runWorkerBatch(ctx context.Context, logger *slog.Logger, workerID string) {
	jobs, err := repo.claimJobs(ctx, workerID)
	if err != nil {
		logger.Error("property publication worker claim failed", "error", err)
		return
	}
	for _, job := range jobs {
		if err := repo.processJob(ctx, workerID, job); err != nil {
			logger.Error(
				"property publication job failed",
				"job_id", job.ID,
				"publication_id", job.PublicationID,
				"action", job.Action,
				"error", err,
			)
		}
	}
	if len(jobs) == repo.config.Worker.BatchSize {
		wakePublicationWorker()
	}
}

func (repo Repository) claimJobs(ctx context.Context, workerID string) ([]pendingJob, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select claimed.id::text,
		       claimed.publication_id::text,
		       claimed.version_id::text,
		       claimed.organization_id::text,
		       claimed.property_id::text,
		       claimed.channel,
		       claimed.channel_account_key,
		       claimed.action,
		       claimed.status,
		       claimed.request_hash,
		       claimed.attempts,
		       claimed.max_attempts,
		       claimed.lease_token::text,
		       claimed.requested_by::text,
		       publication.desired_state,
		       publication.observed_state,
		       publication.current_version,
		       publication.published_version,
		       version.version,
		       version.source_property_updated_at,
		       version.payload_hash,
		       version.payload
		from private.claim_property_channel_publication_jobs(
		  $1,
		  $2,
		  make_interval(secs => $3::double precision)
		) as claimed
		join public.property_channel_publications as publication
		  on publication.id = claimed.publication_id
		 and publication.organization_id = claimed.organization_id
		left join public.property_channel_publication_versions as version
		  on version.id = claimed.version_id
		 and version.organization_id = claimed.organization_id
		order by claimed.created_at, claimed.id
	`, workerID, repo.config.Worker.BatchSize, repo.config.Worker.Lease.Seconds())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	jobs := make([]pendingJob, 0, repo.config.Worker.BatchSize)
	for rows.Next() {
		var job pendingJob
		var versionID, requestedBy, payloadHash pgtype.Text
		var publishedVersion, version pgtype.Int4
		var sourceUpdatedAt pgtype.Timestamptz
		var payload []byte
		if err := rows.Scan(
			&job.ID,
			&job.PublicationID,
			&versionID,
			&job.OrganizationID,
			&job.PropertyID,
			&job.Channel,
			&job.ChannelAccountKey,
			&job.Action,
			&job.Status,
			&job.RequestHash,
			&job.Attempts,
			&job.MaxAttempts,
			&job.LeaseToken,
			&requestedBy,
			&job.DesiredState,
			&job.ObservedState,
			&job.CurrentVersion,
			&publishedVersion,
			&version,
			&sourceUpdatedAt,
			&payloadHash,
			&payload,
		); err != nil {
			return nil, err
		}
		job.VersionID = pgTextPointer(versionID)
		job.RequestedBy = pgTextPointer(requestedBy)
		job.PublishedVersion = pgInt4Pointer(publishedVersion)
		job.Version = pgInt4Pointer(version)
		job.SourcePropertyUpdatedAt = timestamptzPointer(sourceUpdatedAt)
		job.PayloadHash = pgTextPointer(payloadHash)
		if len(payload) > 0 {
			if err := json.Unmarshal(payload, &job.Payload); err != nil {
				return nil, err
			}
		}
		jobs = append(jobs, job)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := repo.reconcileExhaustedJobs(ctx); err != nil {
		return nil, err
	}
	return jobs, nil
}

func (repo Repository) reconcileExhaustedJobs(ctx context.Context) error {
	_, err := repo.db.Pool().Exec(ctx, `
		with latest as (
		  select distinct on (job.organization_id, job.publication_id)
		         job.organization_id,
		         job.publication_id,
		         job.id,
		         job.action,
		         version.version,
		         job.status,
		         job.last_error_code,
		         job.last_error_message,
		         job.completed_at
		  from public.property_channel_publication_jobs as job
		  left join public.property_channel_publication_versions version on version.id = job.version_id
		  order by job.organization_id, job.publication_id, job.created_at desc, job.id desc
		), exhausted as (
		  select * from latest where status = 'dead'
		)
		update public.property_channel_publications as publication
		set observed_state = case
		      when publication.desired_state = 'published' and publication.published_version is not null then 'published'
		      else 'error'
		    end,
		    last_error_code = exhausted.last_error_code,
		    last_error_message = exhausted.last_error_message,
		    last_attempt_at = coalesce(exhausted.completed_at, now()),
		    updated_at = now()
		from exhausted
		where exhausted.publication_id = publication.id
		  and exhausted.organization_id = publication.organization_id
		  and publication.observed_state in ('queued', 'publishing', 'unpublishing')
		  and (
		    (exhausted.action in ('publish', 'update', 'revalidate') and publication.desired_state = 'published' and publication.current_version = exhausted.version)
		    or (exhausted.action = 'unpublish' and publication.desired_state = 'unpublished' and (exhausted.version is null or publication.current_version = exhausted.version))
		  )
	`)
	return err
}

func (repo Repository) processJob(ctx context.Context, workerID string, job pendingJob) error {
	if _, err := publicationScopeForJob(job); err != nil {
		return repo.failJob(ctx, workerID, job, "unsupported_channel", "Unsupported publication channel.", true)
	}
	switch job.Action {
	case ActionPublish, ActionUpdate, ActionRevalidate:
		return repo.processPublishJob(ctx, workerID, job)
	case ActionUnpublish:
		return repo.processUnpublishJob(ctx, workerID, job)
	default:
		return repo.failJob(ctx, workerID, job, "unsupported_action", "Unsupported publication action.", true)
	}
}

func (repo Repository) processPublishJob(ctx context.Context, workerID string, job pendingJob) error {
	if job.Version == nil || job.VersionID == nil || job.PayloadHash == nil || job.SourcePropertyUpdatedAt == nil {
		return repo.failJob(ctx, workerID, job, "version_missing", "Publication version is missing.", true)
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if ok, err := jobFenceValid(ctx, tx, job, workerID); err != nil || !ok {
		if err != nil {
			return err
		}
		return nil
	}

	workerTenant := tenant.Context{
		OrganizationID: job.OrganizationID,
		UserID:         workerActor(job),
		IsSuperAdmin:   true,
		EnabledModules: []string{"properties", "site", "portals"},
	}
	scope, err := publicationScopeForJob(job)
	if err != nil {
		return repo.finishRolledBackFailure(ctx, tx, workerID, job, "unsupported_channel", "Unsupported publication channel.", true, err)
	}
	source, err := repo.loadPublicationSource(ctx, tx, workerTenant, job.PropertyID, true)
	if err != nil {
		return repo.finishRolledBackFailure(
			ctx, tx, workerID, job,
			"source_unavailable", "Property source could not be loaded.",
			publicationWorkerLoadFailurePermanent(err), err,
		)
	}
	if scope.Channel == GrupoOLXChannel && source.GrupoOLXIntegrationID != scope.AccountKey {
		return repo.finishRolledBackFailure(ctx, tx, workerID, job, "channel_account_unavailable", "The Grupo OLX integration account changed or is unavailable.", true, ErrGrupoOLXUnavailable)
	}
	if availableErr := ensurePublicationAvailable(scope, source, workerTenant); availableErr != nil {
		return repo.finishRolledBackFailure(ctx, tx, workerID, job, "channel_unavailable", "The publication channel is unavailable for this organization.", true, availableErr)
	}
	publication, err := repo.getPublication(ctx, tx, job.OrganizationID, job.PropertyID, scope, true)
	if err != nil {
		return repo.finishRolledBackFailure(
			ctx, tx, workerID, job,
			"publication_missing", "Publication no longer exists.",
			publicationWorkerLoadFailurePermanent(err), err,
		)
	}
	if publication.DesiredState != DesiredPublished || publication.CurrentVersion != *job.Version {
		return supersedeClaim(ctx, tx, workerID, job, "superseded", "A newer publication request replaced this job.")
	}
	checks, _, readinessState := evaluatePublicationReadiness(scope, source)
	if readinessState != ReadinessReady {
		return repo.finishRolledBackFailure(ctx, tx, workerID, job, "readiness_blocked", firstCheckMessage(checks), true, ErrPublicationNotReady)
	}
	currentSnapshot := buildPublicationSnapshot(scope, source, repo.config.PublicBaseURL, publication.ID, *job.Version)
	currentHash, err := publicationSnapshotHash(currentSnapshot)
	if err != nil {
		return err
	}
	if !source.UpdatedAt.Equal(*job.SourcePropertyUpdatedAt) || currentHash != *job.PayloadHash {
		return supersedeChangedSnapshot(ctx, tx, workerID, job, publication.ID, checks)
	}

	publicURL := source.GrupoOLXPublicURL
	if scope.Channel == SiteChannel {
		publisher := sitePublisher{}
		publicURL, err = publisher.Publish(source)
		if err != nil {
			return repo.finishRolledBackFailure(ctx, tx, workerID, job, "site_unavailable", err.Error(), true, err)
		}
	}

	publishedVersion := *job.Version
	if scope.Channel == SiteChannel {
		if _, err := tx.Exec(ctx, `
			update public.properties
			set published_on_site = true
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and published_on_site is distinct from true
		`, job.OrganizationID, job.PropertyID); err != nil {
			return err
		}
	}

	completed, err := completeClaim(ctx, tx, workerID, job)
	if err != nil {
		return err
	}
	if !completed {
		return nil
	}
	validationErrors, err := json.Marshal(unresolvedChecks(checks))
	if err != nil {
		return err
	}
	command, err := tx.Exec(ctx, `
		update public.property_channel_publications
		set desired_state = 'published',
		    observed_state = 'published',
		    readiness_state = 'ready',
		    current_version = $3,
		    published_version = $3,
		    validation_errors = $4::jsonb,
		    public_url = $5,
		    last_error_code = null,
		    last_error_message = null,
		    last_attempt_at = now(),
		    last_succeeded_at = now(),
		    published_at = now(),
		    unpublished_at = null,
		    updated_by = $6::uuid,
		    updated_at = now()
		where id = $1::uuid
		  and organization_id = $2::uuid
		  and desired_state = 'published'
		  and current_version = $7
	`, publication.ID, job.OrganizationID, publishedVersion, string(validationErrors), nullableText(publicURL), nullableString(job.RequestedBy), *job.Version)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return ErrPublicationConflict
	}
	return tx.Commit(ctx)
}

func (repo Repository) processUnpublishJob(ctx context.Context, workerID string, job pendingJob) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if ok, err := jobFenceValid(ctx, tx, job, workerID); err != nil || !ok {
		if err != nil {
			return err
		}
		return nil
	}
	if _, err := tx.Exec(ctx, `
		select 1
		from public.properties
		where organization_id = $1::uuid and id = $2::uuid
		for update
	`, job.OrganizationID, job.PropertyID); err != nil {
		return err
	}
	scope, err := publicationScopeForJob(job)
	if err != nil {
		return repo.finishRolledBackFailure(ctx, tx, workerID, job, "unsupported_channel", "Unsupported publication channel.", true, err)
	}
	publication, err := repo.getPublication(ctx, tx, job.OrganizationID, job.PropertyID, scope, true)
	if err != nil {
		return repo.finishRolledBackFailure(
			ctx, tx, workerID, job,
			"publication_missing", "Publication no longer exists.",
			publicationWorkerLoadFailurePermanent(err), err,
		)
	}
	if publication.DesiredState != DesiredUnpublished {
		return supersedeClaim(ctx, tx, workerID, job, "superseded", "A newer publication request replaced this withdrawal.")
	}
	if scope.Channel == SiteChannel {
		if err := (sitePublisher{}).Unpublish(); err != nil {
			return repo.finishRolledBackFailure(ctx, tx, workerID, job, "site_unpublish_failed", err.Error(), false, err)
		}
	}
	completed, err := completeClaim(ctx, tx, workerID, job)
	if err != nil || !completed {
		return err
	}
	command, err := tx.Exec(ctx, `
		update public.property_channel_publications
		set desired_state = 'unpublished',
		    observed_state = 'unpublished',
		    published_version = null,
		    public_url = null,
		    last_error_code = null,
		    last_error_message = null,
		    last_attempt_at = now(),
		    last_succeeded_at = now(),
		    unpublished_at = now(),
		    updated_by = $3::uuid,
		    updated_at = now()
		where id = $1::uuid
		  and organization_id = $2::uuid
		  and desired_state = 'unpublished'
	`, publication.ID, job.OrganizationID, nullableString(job.RequestedBy))
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return ErrPublicationConflict
	}
	if scope.Channel == SiteChannel {
		if _, err := tx.Exec(ctx, `
			update public.properties
			set published_on_site = false
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and published_on_site is distinct from false
		`, job.OrganizationID, job.PropertyID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// Only absence sentinels are deterministic load failures. Transport, pool,
// timeout and arbitrary database errors must consume the normal retry budget
// instead of dead-lettering a publication on their first occurrence.
func publicationWorkerLoadFailurePermanent(err error) bool {
	return errors.Is(err, ErrPropertyNotFound) || errors.Is(err, ErrPublicationNotFound)
}

func (repo Repository) finishRolledBackFailure(
	ctx context.Context,
	tx pgx.Tx,
	workerID string,
	job pendingJob,
	code string,
	message string,
	permanent bool,
	cause error,
) error {
	if rollbackErr := tx.Rollback(ctx); rollbackErr != nil && !errors.Is(rollbackErr, pgx.ErrTxClosed) {
		return errors.Join(cause, rollbackErr)
	}
	if failErr := repo.failJob(ctx, workerID, job, code, message, permanent); failErr != nil {
		return errors.Join(cause, failErr)
	}
	return cause
}

func (repo Repository) failJob(ctx context.Context, workerID string, job pendingJob, code string, message string, permanent bool) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	retryAt := time.Now().UTC().Add(publicationRetryDelay(job.Attempts))
	var failed bool
	err = tx.QueryRow(ctx, `
		select private.fail_property_channel_publication_job(
		  $1::uuid, $2, $3::uuid, $4, $5, $6, $7
		)
	`, job.ID, workerID, job.LeaseToken, code, message, retryAt, permanent).Scan(&failed)
	if err != nil {
		return err
	}
	if !failed {
		return nil
	}
	checksJSON := `[]`
	readinessState := ReadinessUnknown
	workerTenant := tenant.Context{
		OrganizationID: job.OrganizationID,
		UserID:         workerActor(job),
		IsSuperAdmin:   true,
		EnabledModules: []string{"properties", "site", "portals"},
	}
	if source, sourceErr := repo.loadPublicationSource(ctx, tx, workerTenant, job.PropertyID, false); sourceErr == nil {
		if scope, scopeErr := publicationScopeForJob(job); scopeErr == nil {
			checks, _, state := evaluatePublicationReadiness(scope, source)
			if encoded, encodeErr := json.Marshal(unresolvedChecks(checks)); encodeErr == nil {
				checksJSON = string(encoded)
			}
			readinessState = state
		}
	}
	_, err = tx.Exec(ctx, `
		update public.property_channel_publications
		set observed_state = case
		      when desired_state = 'published' and published_version is not null then 'published'
		      else 'error'
		    end,
		    readiness_state = $3,
		    validation_errors = $4::jsonb,
		    last_error_code = left($5, 160),
		    last_error_message = left($6, 4000),
		    last_attempt_at = now(),
		    updated_at = now()
		where id = $1::uuid
		  and organization_id = $2::uuid
		  and (
		    ($8 in ('publish', 'update', 'revalidate') and desired_state = 'published' and current_version = $9)
		    or ($8 = 'unpublish' and desired_state = 'unpublished' and ($9::bigint is null or current_version = $9))
		  )
		  and exists (
		    select 1
		    from public.property_channel_publication_jobs failed_job
		    where failed_job.id = $7::uuid
		      and failed_job.publication_id = property_channel_publications.id
		      and failed_job.action = $8
		      and failed_job.version_id is not distinct from nullif($10, '')::uuid
		      and failed_job.id = (
		        select latest_job.id
		        from public.property_channel_publication_jobs latest_job
		        where latest_job.publication_id = property_channel_publications.id
		          and latest_job.organization_id = property_channel_publications.organization_id
		        order by latest_job.created_at desc, latest_job.id desc
		        limit 1
		      )
		  )
	`, job.PublicationID, job.OrganizationID, readinessState, checksJSON, code, message, job.ID,
		job.Action, job.Version, nullableString(job.VersionID))
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func publicationRetryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	seconds := 5 * math.Pow(2, float64(min(attempt, 9)))
	if seconds > 3600 {
		seconds = 3600
	}
	return time.Duration(seconds) * time.Second
}

func jobFenceValid(ctx context.Context, tx pgx.Tx, job pendingJob, workerID string) (bool, error) {
	var valid bool
	err := tx.QueryRow(ctx, `
		select exists (
		  select 1
		  from public.property_channel_publication_jobs
		  where id = $1::uuid
		    and status = 'processing'
		    and locked_by = $2
		    and lease_token = $3::uuid
		  for update
		)
	`, job.ID, workerID, job.LeaseToken).Scan(&valid)
	return valid, err
}

func completeClaim(ctx context.Context, tx pgx.Tx, workerID string, job pendingJob) (bool, error) {
	var completed bool
	err := tx.QueryRow(ctx, `
		select private.complete_property_channel_publication_job(
		  $1::uuid, $2, $3::uuid, now()
		)
	`, job.ID, workerID, job.LeaseToken).Scan(&completed)
	return completed, err
}

func supersedeClaim(ctx context.Context, tx pgx.Tx, workerID string, job pendingJob, code string, message string) error {
	command, err := tx.Exec(ctx, `
		update public.property_channel_publication_jobs
		set status = 'superseded',
		    locked_at = null,
		    locked_by = null,
		    lease_token = null,
		    last_error_code = $4,
		    last_error_message = $5,
		    completed_at = now(),
		    dead_lettered_at = null,
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
		  and lease_token = $3::uuid
	`, job.ID, workerID, job.LeaseToken, code, message)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return nil
	}
	return tx.Commit(ctx)
}

func supersedeChangedSnapshot(
	ctx context.Context,
	tx pgx.Tx,
	workerID string,
	job pendingJob,
	publicationID string,
	checks []Check,
) error {
	validationErrors, err := json.Marshal(unresolvedChecks(checks))
	if err != nil {
		return err
	}
	command, err := tx.Exec(ctx, `
		update public.property_channel_publication_jobs
		set status = 'superseded',
		    locked_at = null,
		    locked_by = null,
		    lease_token = null,
		    last_error_code = 'snapshot_changed',
		    last_error_message = 'Property data changed after this version was queued.',
		    completed_at = now(),
		    dead_lettered_at = null,
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
		  and lease_token = $3::uuid
	`, job.ID, workerID, job.LeaseToken)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return nil
	}
	_, err = tx.Exec(ctx, `
		update public.property_channel_publications
		set observed_state = case when published_version is not null then 'published' else 'error' end,
		    readiness_state = $3,
		    validation_errors = $4::jsonb,
		    last_error_code = 'snapshot_changed',
		    last_error_message = 'Property data changed after this version was queued. Retry to publish a fresh version.',
		    last_attempt_at = now(),
		    updated_at = now()
		where id = $1::uuid
		  and organization_id = $2::uuid
		  and desired_state = 'published'
		  and current_version = $5
	`, publicationID, job.OrganizationID, readinessFromChecks(checks), string(validationErrors), *job.Version)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func readinessFromChecks(checks []Check) string {
	for _, check := range checks {
		if check.Severity == "error" && !check.Resolved {
			return ReadinessBlocked
		}
	}
	return ReadinessReady
}

func publicationScopeForJob(job pendingJob) (publicationScope, error) {
	accountKey := strings.TrimSpace(job.ChannelAccountKey)
	switch strings.TrimSpace(job.Channel) {
	case SiteChannel:
		if accountKey != DefaultChannelAccount {
			return publicationScope{}, ErrInvalidInput
		}
		return sitePublicationScope(), nil
	case GrupoOLXChannel:
		if _, ok := normalizeUUID(accountKey); !ok {
			return publicationScope{}, ErrInvalidInput
		}
		return grupoOLXPublicationScope(accountKey), nil
	default:
		return publicationScope{}, ErrInvalidInput
	}
}

func workerActor(job pendingJob) string {
	if job.RequestedBy != nil {
		if value, ok := normalizeUUID(*job.RequestedBy); ok {
			return value
		}
	}
	return job.OrganizationID
}

func pgTextPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	result := value.String
	return &result
}

func pgInt4Pointer(value pgtype.Int4) *int64 {
	if !value.Valid {
		return nil
	}
	result := int64(value.Int32)
	return &result
}

func nullableText(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}
