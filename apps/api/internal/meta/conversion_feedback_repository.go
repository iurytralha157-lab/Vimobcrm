package meta

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	conversionFeedbackDefaultInterval       = 5 * time.Second
	conversionFeedbackDefaultBatch          = 25
	conversionFeedbackDefaultLease          = 2 * time.Minute
	conversionFeedbackDefaultRequestTimeout = 15 * time.Second
	conversionFeedbackMaximumAge            = 7 * 24 * time.Hour
	conversionFeedbackMaximumBatch          = 100
)

var conversionFeedbackWorkerID = newConversionFeedbackWorkerID()

type conversionFeedbackWorkerSettings struct {
	Enabled        bool
	Interval       time.Duration
	Batch          int
	Lease          time.Duration
	RequestTimeout time.Duration
}

type conversionFeedbackEligibilityError struct {
	Code              string
	Message           string
	IntegrationStatus string
}

func (err *conversionFeedbackEligibilityError) Error() string {
	if err == nil || strings.TrimSpace(err.Message) == "" {
		return "Meta conversion feedback is no longer eligible"
	}
	return err.Message
}

func (config Config) normalizedConversionFeedbackWorkerSettings() conversionFeedbackWorkerSettings {
	settings := conversionFeedbackWorkerSettings{
		Enabled:        config.ConversionFeedbackWorkerEnabled,
		Interval:       config.ConversionFeedbackWorkerInterval,
		Batch:          config.ConversionFeedbackWorkerBatch,
		Lease:          config.ConversionFeedbackWorkerLease,
		RequestTimeout: config.ConversionFeedbackRequestTimeout,
	}
	if settings.Interval < time.Second || settings.Interval > time.Hour {
		settings.Interval = conversionFeedbackDefaultInterval
	}
	if settings.Batch < 1 || settings.Batch > conversionFeedbackMaximumBatch {
		settings.Batch = conversionFeedbackDefaultBatch
	}
	if settings.Lease < 30*time.Second || settings.Lease > 30*time.Minute {
		settings.Lease = conversionFeedbackDefaultLease
	}
	if settings.RequestTimeout < time.Second || settings.RequestTimeout > time.Minute {
		settings.RequestTimeout = conversionFeedbackDefaultRequestTimeout
	}
	if settings.Lease <= settings.RequestTimeout {
		settings.Lease = settings.RequestTimeout + 30*time.Second
	}
	return settings
}

func (repo Repository) ProcessConversionFeedback(ctx context.Context, batch int, lease time.Duration) error {
	settings := repo.config.normalizedConversionFeedbackWorkerSettings()
	if batch > 0 {
		settings.Batch = batch
	}
	if lease > 0 {
		settings.Lease = lease
	}
	settings = normalizeConversionFeedbackSettings(settings)

	// Claim immediately before each send. Claiming the whole batch would start
	// every lease at once while requests are processed sequentially, allowing a
	// second replica to reclaim jobs still waiting near the end of the batch.
	for processed := 0; processed < settings.Batch; processed++ {
		jobs, err := repo.claimConversionFeedbackJobs(ctx, 1, settings.Lease)
		if err != nil {
			return err
		}
		if len(jobs) == 0 {
			return nil
		}
		job := jobs[0]
		delivery, loadErr := repo.loadConversionFeedbackDelivery(ctx, job)
		if errors.Is(loadErr, pgx.ErrNoRows) {
			continue
		}
		if loadErr != nil {
			var eligibilityErr *conversionFeedbackEligibilityError
			if errors.As(loadErr, &eligibilityErr) {
				if failErr := repo.failConversionFeedbackJob(ctx, job, loadErr); failErr != nil {
					return failErr
				}
				continue
			}
			return loadErr
		}

		requestCtx, cancel := context.WithTimeout(ctx, settings.RequestTimeout)
		result, sendErr := repo.sendConversionFeedbackEvent(requestCtx, delivery)
		cancel()
		if sendErr != nil {
			if failErr := repo.failConversionFeedbackJob(ctx, job, sendErr); failErr != nil {
				return failErr
			}
			continue
		}
		if err := repo.completeConversionFeedbackJob(ctx, job, result); err != nil {
			return err
		}
	}

	return nil
}

func normalizeConversionFeedbackSettings(settings conversionFeedbackWorkerSettings) conversionFeedbackWorkerSettings {
	if settings.Batch < 1 || settings.Batch > conversionFeedbackMaximumBatch {
		settings.Batch = conversionFeedbackDefaultBatch
	}
	if settings.Lease < 30*time.Second || settings.Lease > 30*time.Minute {
		settings.Lease = conversionFeedbackDefaultLease
	}
	if settings.RequestTimeout < time.Second || settings.RequestTimeout > time.Minute {
		settings.RequestTimeout = conversionFeedbackDefaultRequestTimeout
	}
	if settings.Lease <= settings.RequestTimeout {
		settings.Lease = settings.RequestTimeout + 30*time.Second
	}
	return settings
}

func (repo Repository) claimConversionFeedbackJobs(ctx context.Context, batch int, lease time.Duration) ([]conversionFeedbackJob, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	leaseSeconds := int64(lease / time.Second)
	if leaseSeconds < 1 {
		leaseSeconds = int64(conversionFeedbackDefaultLease / time.Second)
	}

	if _, err := tx.Exec(ctx, `
		with terminal as (
			update public.meta_crm_event_outbox as outbox
			set status = 'dead',
			    locked_at = null,
			    locked_by = null,
			    dead_lettered_at = coalesce(outbox.dead_lettered_at, now()),
			    last_error_code = case
			      when outbox.event_time < now() - interval '7 days' then 'event_expired'
			      else 'retry_exhausted'
			    end,
			    last_error_message = case
			      when outbox.event_time < now() - interval '7 days'
			        then 'CRM event exceeded Meta seven-day delivery window'
			      else 'CRM event exhausted its delivery attempts'
			    end,
			    updated_at = now()
			where (
			    outbox.status in ('pending', 'retry')
			    or (
			      outbox.status = 'processing'
			      and (outbox.locked_at is null or outbox.locked_at < now() - ($1::bigint * interval '1 second'))
			    )
			  )
			  and (
			    outbox.attempts >= outbox.max_attempts
			    or outbox.event_time < now() - interval '7 days'
			  )
			returning outbox.organization_id, outbox.integration_id, outbox.dataset_id,
			          outbox.last_error_code, outbox.last_error_message
		)
		update public.meta_integrations as integration
		set conversion_feedback_last_validated_at = now(),
		    conversion_feedback_last_error = left(terminal.last_error_message, 2000),
		    updated_at = now()
		from terminal
		where integration.id = terminal.integration_id
		  and integration.organization_id = terminal.organization_id
		  and integration.crm_dataset_id = terminal.dataset_id
	`, leaseSeconds); err != nil {
		return nil, err
	}

	// A later funnel event is useful to Meta only after every earlier event for
	// the same tenant, integration, Dataset and lead entry has been accepted.
	// Reject an impossible timeline and cascade terminal predecessor failures
	// without waiting on rows leased by another worker; a skipped row is
	// reconsidered on the next short cycle.
	if _, err := tx.Exec(ctx, `
		with blocked_candidates as (
			select
			  successor.id,
			  case
			    when blockage.invalid_timeline then 'invalid_funnel_timeline'
			    else 'predecessor_dead'
			  end as error_code,
			  case
			    when blockage.invalid_timeline
			      then 'Earlier CRM funnel event has a later event time'
			    else 'Earlier CRM funnel event is dead; later event cannot be delivered in order'
			  end as error_message
			from public.meta_crm_event_outbox as successor
			cross join lateral (
			  select
			    coalesce(bool_or(predecessor.event_time > successor.event_time), false)
			      as invalid_timeline,
			    coalesce(bool_or(predecessor.status = 'dead'), false)
			      as predecessor_dead
			  from public.meta_crm_event_outbox as predecessor
			  where predecessor.organization_id = successor.organization_id
			    and predecessor.lead_entry_event_id = successor.lead_entry_event_id
			    and predecessor.integration_id is not distinct from successor.integration_id
			    and predecessor.dataset_id = successor.dataset_id
			    and predecessor.event_sequence < successor.event_sequence
			) as blockage
			where (
			    successor.status in ('pending', 'retry')
			    or (
			      successor.status = 'processing'
			      and (
			        successor.locked_at is null
			        or successor.locked_at < now() - ($1::bigint * interval '1 second')
			      )
			    )
			  )
			  and (blockage.invalid_timeline or blockage.predecessor_dead)
			order by
			  successor.organization_id,
			  successor.lead_entry_event_id,
			  successor.event_sequence,
			  successor.id
			limit $2
			for update of successor skip locked
		), blocked as (
			update public.meta_crm_event_outbox as outbox
			set status = 'dead',
			    locked_at = null,
			    locked_by = null,
			    dead_lettered_at = coalesce(outbox.dead_lettered_at, now()),
			    last_error_code = blocked_candidates.error_code,
			    last_error_message = blocked_candidates.error_message,
			    updated_at = now()
			from blocked_candidates
			where outbox.id = blocked_candidates.id
			returning outbox.organization_id, outbox.integration_id, outbox.dataset_id,
			          outbox.last_error_message
		)
		update public.meta_integrations as integration
		set conversion_feedback_last_validated_at = now(),
		    conversion_feedback_last_error = left(blocked.last_error_message, 2000),
		    updated_at = now()
		from blocked
		where integration.id = blocked.integration_id
		  and integration.organization_id = blocked.organization_id
		  and integration.crm_dataset_id = blocked.dataset_id
	`, leaseSeconds, conversionFeedbackMaximumBatch); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		update public.meta_crm_event_outbox
		set status = 'retry',
		    locked_at = null,
		    locked_by = null,
		    next_attempt_at = now(),
		    last_error_code = 'lease_expired',
		    last_error_message = 'Previous delivery lease expired before acknowledgement',
		    updated_at = now()
		where status = 'processing'
		  and (locked_at is null or locked_at < now() - ($1::bigint * interval '1 second'))
		  and attempts < max_attempts
		  and event_time >= now() - interval '7 days'
	`, leaseSeconds); err != nil {
		return nil, err
	}

	rows, err := tx.Query(ctx, `
		with candidates as (
			select outbox.id
			from public.meta_crm_event_outbox as outbox
			where outbox.status in ('pending', 'retry')
			  and outbox.attempts < outbox.max_attempts
			  and outbox.next_attempt_at <= now()
			  and outbox.event_time >= now() - interval '7 days'
			  and (
			    select count(*)
			    from public.meta_crm_event_outbox as predecessor
			    where predecessor.organization_id = outbox.organization_id
			      and predecessor.lead_entry_event_id = outbox.lead_entry_event_id
			      and predecessor.integration_id is not distinct from outbox.integration_id
			      and predecessor.dataset_id = outbox.dataset_id
			      and predecessor.event_sequence < outbox.event_sequence
			      and predecessor.event_time <= outbox.event_time
			      and predecessor.status = 'sent'
			  ) = (outbox.event_sequence - 1)::bigint
			order by
			  outbox.next_attempt_at,
			  outbox.organization_id,
			  outbox.lead_entry_event_id,
			  outbox.event_sequence,
			  outbox.created_at,
			  outbox.id
			limit $1
			for update skip locked
		)
		update public.meta_crm_event_outbox as outbox
		set status = 'processing',
		    attempts = outbox.attempts + 1,
		    locked_at = now(),
		    locked_by = $2,
		    updated_at = now()
		from candidates
		where outbox.id = candidates.id
		returning
		  outbox.id::text,
		  outbox.organization_id::text,
		  coalesce(outbox.integration_id::text, ''),
		  outbox.dataset_id,
		  outbox.leadgen_id,
		  outbox.event_kind,
		  outbox.event_name,
		  outbox.event_id,
		  outbox.event_time,
		  coalesce(outbox.test_event_code, ''),
		  outbox.attempts,
		  outbox.max_attempts
	`, batch, conversionFeedbackWorkerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	jobs := make([]conversionFeedbackJob, 0, batch)
	for rows.Next() {
		var job conversionFeedbackJob
		if err := rows.Scan(
			&job.ID,
			&job.OrganizationID,
			&job.IntegrationID,
			&job.DatasetID,
			&job.LeadgenID,
			&job.EventKind,
			&job.EventName,
			&job.EventID,
			&job.EventTime,
			&job.TestEventCode,
			&job.Attempts,
			&job.MaxAttempts,
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

func (repo Repository) loadConversionFeedbackDelivery(ctx context.Context, job conversionFeedbackJob) (conversionFeedbackDelivery, error) {
	var (
		campaignsEnabled bool
		integrationID    string
		connected        bool
		feedbackEnabled  bool
		feedbackStatus   string
		currentDataset   string
		accessToken      string
		email            string
		phone            string
	)

	err := repo.db.Pool().QueryRow(ctx, `
		with renewed as (
			update public.meta_crm_event_outbox
			set locked_at = now(), updated_at = now()
			where id = $1::uuid
			  and organization_id = $2::uuid
			  and status = 'processing'
			  and locked_by = $3
			returning *
		)
		select
		  exists (
		    select 1
		    from public.organization_modules as module_access
		    where module_access.organization_id = outbox.organization_id
		      and lower(btrim(module_access.module_name)) = 'campaigns'
		      and module_access.is_enabled = true
		  ) as campaigns_enabled,
		  coalesce(integration.id::text, ''),
		  coalesce(integration.is_connected, false),
		  coalesce(integration.conversion_feedback_enabled, false),
		  coalesce(integration.conversion_feedback_status, ''),
		  coalesce(integration.crm_dataset_id, ''),
		  coalesce(secret.decrypted_secret, ''),
		  coalesce(lead.email, ''),
		  coalesce(lead.phone, '')
		from renewed as outbox
		left join public.meta_integrations as integration
		  on integration.id = outbox.integration_id
		 and integration.organization_id = outbox.organization_id
		left join vault.decrypted_secrets as secret
		  on secret.id = integration.crm_dataset_access_token_secret_ref
		left join public.leads as lead
		  on lead.id = outbox.lead_id
		 and lead.organization_id = outbox.organization_id
	`, job.ID, job.OrganizationID, conversionFeedbackWorkerID).Scan(
		&campaignsEnabled,
		&integrationID,
		&connected,
		&feedbackEnabled,
		&feedbackStatus,
		&currentDataset,
		&accessToken,
		&email,
		&phone,
	)
	if err != nil {
		return conversionFeedbackDelivery{}, err
	}

	eligibilityErr := validateConversionFeedbackEligibility(
		job,
		campaignsEnabled,
		integrationID,
		connected,
		feedbackEnabled,
		feedbackStatus,
		currentDataset,
		accessToken,
		time.Now().UTC(),
	)
	if eligibilityErr != nil {
		return conversionFeedbackDelivery{}, eligibilityErr
	}

	return conversionFeedbackDelivery{
		Job:         job,
		AccessToken: accessToken,
		Email:       email,
		Phone:       phone,
	}, nil
}

func validateConversionFeedbackEligibility(
	job conversionFeedbackJob,
	campaignsEnabled bool,
	integrationID string,
	connected bool,
	feedbackEnabled bool,
	feedbackStatus string,
	currentDataset string,
	accessToken string,
	now time.Time,
) error {
	if !campaignsEnabled {
		// Module access is a delivery gate, not an integration health state.
		// Keeping the configured integration active lets an organization connect
		// Meta once, disable Marketing, and resume future events automatically
		// when the module is granted again.
		return &conversionFeedbackEligibilityError{Code: "campaigns_module_disabled", Message: "Marketing module is no longer enabled"}
	}
	if integrationID == "" || integrationID != job.IntegrationID {
		return &conversionFeedbackEligibilityError{Code: "integration_missing", Message: "Meta integration is no longer available", IntegrationStatus: "error"}
	}
	if !connected {
		return &conversionFeedbackEligibilityError{Code: "integration_disconnected", Message: "Meta integration is disconnected", IntegrationStatus: "paused"}
	}
	if !feedbackEnabled {
		return &conversionFeedbackEligibilityError{Code: "feedback_disabled", Message: "Meta conversion feedback is disabled", IntegrationStatus: "paused"}
	}
	if feedbackStatus != "active" {
		return &conversionFeedbackEligibilityError{Code: "feedback_not_active", Message: "Meta conversion feedback is not active", IntegrationStatus: "paused"}
	}
	if currentDataset == "" || currentDataset != job.DatasetID {
		return &conversionFeedbackEligibilityError{Code: "dataset_changed", Message: "CRM Dataset changed after this event was queued", IntegrationStatus: "error"}
	}
	if strings.TrimSpace(accessToken) == "" {
		return &conversionFeedbackEligibilityError{Code: "dataset_token_missing", Message: "CRM Dataset token is unavailable", IntegrationStatus: "error"}
	}
	if job.EventTime.Before(now.Add(-conversionFeedbackMaximumAge)) {
		return &conversionFeedbackEligibilityError{Code: "event_expired", Message: "CRM event exceeded Meta seven-day delivery window"}
	}
	return nil
}

func (repo Repository) completeConversionFeedbackJob(ctx context.Context, job conversionFeedbackJob, result conversionFeedbackSendResult) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	acknowledged, err := tx.Exec(ctx, `
		update public.meta_crm_event_outbox
		set status = 'sent',
		    sent_at = now(),
		    locked_at = null,
		    locked_by = null,
		    last_error_code = null,
		    last_error_message = null,
		    provider_trace_id = nullif($2, ''),
		    provider_events_received = $3,
		    updated_at = now()
		where id = $1::uuid
		  and organization_id = $4::uuid
		  and status = 'processing'
		  and locked_by = $5
	`, job.ID, result.TraceID, result.EventsReceived, job.OrganizationID, conversionFeedbackWorkerID)
	if err != nil {
		return err
	}
	if acknowledged.RowsAffected() != 1 {
		return fmt.Errorf("meta conversion feedback lease was lost before acknowledgement")
	}

	if _, err := tx.Exec(ctx, `
		update public.meta_integrations
		set conversion_feedback_last_sent_at = now(),
		    conversion_feedback_last_validated_at = now(),
		    conversion_feedback_last_error = null,
		    updated_at = now()
		where id = nullif($1, '')::uuid
		  and organization_id = $2::uuid
		  and crm_dataset_id = $3
		  and is_connected = true
		  and conversion_feedback_enabled = true
		  and conversion_feedback_status = 'active'
	`, job.IntegrationID, job.OrganizationID, job.DatasetID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (repo Repository) failConversionFeedbackJob(ctx context.Context, job conversionFeedbackJob, cause error) error {
	code, message, retryable, traceID, requestedIntegrationStatus := conversionFeedbackFailure(cause)
	now := time.Now().UTC()
	delay := conversionFeedbackRetryDelay(job.EventID, job.Attempts)
	var providerErr *conversionFeedbackError
	if errors.As(cause, &providerErr) && providerErr.RetryAfter > delay {
		delay = providerErr.RetryAfter
	}
	status := "dead"
	if retryable && job.Attempts < job.MaxAttempts && now.Add(delay).Before(job.EventTime.Add(conversionFeedbackMaximumAge)) {
		status = "retry"
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	result, err := tx.Exec(ctx, `
		update public.meta_crm_event_outbox
		set status = $2,
		    next_attempt_at = case when $2 = 'retry' then $3 else next_attempt_at end,
		    locked_at = null,
		    locked_by = null,
		    dead_lettered_at = case when $2 = 'dead' then coalesce(dead_lettered_at, now()) else dead_lettered_at end,
		    last_error_code = left($4, 255),
		    last_error_message = left($5, 2000),
		    provider_trace_id = coalesce(nullif($6, ''), provider_trace_id),
		    updated_at = now()
		where id = $1::uuid
		  and organization_id = $7::uuid
		  and status = 'processing'
		  and locked_by = $8
	`, job.ID, status, now.Add(delay), code, message, traceID, job.OrganizationID, conversionFeedbackWorkerID)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return fmt.Errorf("meta conversion feedback lease was lost before failure handling")
	}

	if _, err := tx.Exec(ctx, `
		update public.meta_integrations
		set conversion_feedback_status = case
		      when nullif($4, '') is not null
		       and conversion_feedback_status = 'active'
		        then $4
		      else conversion_feedback_status
		    end,
		    conversion_feedback_last_validated_at = now(),
		    conversion_feedback_last_error = left($5, 2000),
		    updated_at = now()
		where id = nullif($1, '')::uuid
		  and organization_id = $2::uuid
		  and crm_dataset_id = $3
	`, job.IntegrationID, job.OrganizationID, job.DatasetID, requestedIntegrationStatus, message); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func conversionFeedbackFailure(cause error) (code string, message string, retryable bool, traceID string, integrationStatus string) {
	var eligibilityErr *conversionFeedbackEligibilityError
	if errors.As(cause, &eligibilityErr) {
		return eligibilityErr.Code, eligibilityErr.Message, false, "", eligibilityErr.IntegrationStatus
	}

	var providerErr *conversionFeedbackError
	if errors.As(cause, &providerErr) {
		return providerErr.Code, providerErr.Message, providerErr.Retryable, providerErr.TraceID, ""
	}

	message = "Meta conversion feedback failed"
	if cause != nil {
		message = sanitizeConversionFeedbackMessage(cause.Error())
	}
	return "delivery_failed", message, true, "", ""
}

func conversionFeedbackRetryDelay(eventID string, attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	exponent := attempt - 1
	if exponent > 18 {
		exponent = 18
	}
	base := 5 * time.Second * time.Duration(1<<exponent)
	if base > 24*time.Hour {
		base = 24 * time.Hour
	}

	digest := sha256.Sum256([]byte(eventID + ":" + strconv.Itoa(attempt)))
	window := uint64(base / 5)
	if window == 0 {
		return base
	}
	jitter := time.Duration(binary.BigEndian.Uint64(digest[:8]) % (window + 1))
	return base + jitter
}

func newConversionFeedbackWorkerID() string {
	random := make([]byte, 8)
	if _, err := rand.Read(random); err == nil {
		return "vimob-api-meta-conversion-" + hex.EncodeToString(random)
	}
	fallback := fmt.Sprintf("%s:%d:%d", hostname(), os.Getpid(), time.Now().UnixNano())
	digest := sha256.Sum256([]byte(fallback))
	return "vimob-api-meta-conversion-" + hex.EncodeToString(digest[:8])
}

func hostname() string {
	value, err := os.Hostname()
	if err != nil {
		return "unknown-host"
	}
	return value
}
