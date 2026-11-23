package meta

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (repo Repository) InsertWebhookEvent(ctx context.Context, eventContext webhookEventContext, payload map[string]any, signatureValid bool) (string, error) {
	storagePayload, err := repo.webhookPayloadForStorage(ctx, payload)
	if err != nil {
		return "", err
	}
	payloadJSON := jsonb(storagePayload)

	var eventID string
	err = repo.db.Pool().QueryRow(ctx, `
		insert into public.meta_webhook_events (
			object,
			page_id,
			form_id,
			leadgen_id,
			raw_payload,
			signature_valid,
			status,
			received_at,
			attempts,
			next_retry_at
		)
		values ($1, $2, $3, $4, $5::jsonb, $6, 'received', now(), 0, null)
		returning id::text
	`, nullableString(eventContext.Object), nullableString(eventContext.PageID), nullableString(eventContext.FormID), nullableString(eventContext.LeadgenID), payloadJSON, signatureValid).Scan(&eventID)
	// The worker needs the canonical inbox schema. A legacy insert here
	// would acknowledge a receipt that the queue cannot recover.
	return eventID, err
}

// webhookPayloadForStorage strips message bodies and sender data before the
// durable event log is written when the destination organization does not
// have the advanced Marketing module. Leadgen changes are intentionally kept:
// lead intake is a base Meta capability available to every organization.
func (repo Repository) webhookPayloadForStorage(ctx context.Context, payload map[string]any) (map[string]any, error) {
	return filterMessagingPayload(payload, func(routeID string, platform string) (bool, error) {
		var matchCount int64
		var enabled bool
		err := repo.db.Pool().QueryRow(ctx, `
			select
			  count(*)::bigint,
			  coalesce(bool_and(
			    coalesce(marketing_access.is_enabled, false)
			    and coalesce(conversations_access.is_enabled, false)
			  ), false)
			from public.meta_integrations as integration
			left join public.organization_modules as marketing_access
			  on marketing_access.organization_id = integration.organization_id
			 and lower(btrim(marketing_access.module_name)) = 'campaigns'
			left join public.organization_modules as conversations_access
			  on conversations_access.organization_id = integration.organization_id
			 and lower(btrim(conversations_access.module_name)) = 'whatsapp'
			where coalesce(integration.is_connected, false) = true
			  and (
			    ($2 = 'messenger' and integration.page_id = $1)
			    or (
			      $2 = 'instagram'
			      and (
			        integration.instagram_business_account_id = $1
			        or integration.page_id = $1
			      )
			    )
			  )
		`, routeID, platform).Scan(&matchCount, &enabled)
		if err != nil {
			return false, err
		}
		// Ambiguous provider destinations fail closed. They must never make one
		// tenant's entitlement authorize storage for another tenant.
		return matchCount == 1 && enabled, nil
	})
}

var errWebhookClaimLost = errors.New("Meta webhook processing lease was lost")

type webhookEventClaimContextKey struct{}

func (repo Repository) FinishWebhookEvent(ctx context.Context, claim webhookEventClaim, organizationID string, status string, errorMessage string) error {
	if claim.ID == "" || claim.ExpiresAt.IsZero() {
		return errWebhookClaimLost
	}
	retryableFailure := isRetryableMetaWebhookFailure(status, errorMessage)

	updated, err := repo.db.Pool().Exec(ctx, `
		update public.meta_webhook_events
		set organization_id = coalesce($2::uuid, organization_id),
		    status = $3,
		    error_message = $4,
		    last_error = $4,
		    processed_at = case when $3 = 'deferred' then null else now() end,
		    attempts = coalesce(attempts, 0) + 1,
		    next_retry_at = case
		      when $3 = 'deferred'
		       and coalesce(attempts, 0) + 1 < 29
		        then now() + case coalesce(attempts, 0)
		          when 0 then interval '30 seconds'
		          when 1 then interval '1 minute'
		          when 2 then interval '2 minutes'
		          when 3 then interval '5 minutes'
		          when 4 then interval '15 minutes'
		          when 5 then interval '30 minutes'
		          else interval '6 hours'
		        end
		      when $3 = 'failed'
		       and $5::boolean
		       and coalesce(attempts, 0) + 1 < 5
		        then now() + (least(30, (coalesce(attempts, 0) + 1) * 2) * interval '1 minute')
		      else null
		    end
		where id = $1::uuid
		  and status = 'processing'
		  and next_retry_at = $6::timestamptz
		  and next_retry_at > clock_timestamp()
	`, claim.ID, nullableString(organizationID), status, nullableString(errorMessage), retryableFailure, claim.ExpiresAt)
	if err != nil {
		return err
	}
	if updated.RowsAffected() != 1 {
		return errWebhookClaimLost
	}
	return nil
}

func isRetryableMetaWebhookFailure(status string, errorMessage string) bool {
	if !strings.EqualFold(strings.TrimSpace(status), "failed") {
		return false
	}

	normalized := strings.ToLower(strings.TrimSpace(errorMessage))
	if normalized == "" {
		return true
	}

	permanentFailures := []string{
		"invalid x-hub-signature-256 signature",
		"meta_app_secret is not configured",
		"apps in dev mode should only access leads",
		"unsupported get request",
		"meta page access token is missing",
	}
	for _, failure := range permanentFailures {
		if strings.Contains(normalized, failure) {
			return false
		}
	}
	return true
}

const claimPendingWebhookEventsQuery = `
	with picked as (
		select id
		from public.meta_webhook_events
		where coalesce(signature_valid, true) = true
		  and (
		    status = 'received'
		    or (
		      status = 'deferred'
		      and coalesce(attempts, 0) < 29
		      and coalesce(next_retry_at, received_at, created_at, now()) <= now()
		    )
		    or (
		      status = 'failed'
		      and coalesce(attempts, 0) < 5
		      and next_retry_at is not null
		      and next_retry_at <= now()
		    )
		    or (
		      status = 'processing'
		      and coalesce(next_retry_at, received_at, created_at, now()) <= now()
		    )
		  )
		order by coalesce(received_at, created_at) asc, id
		limit 1
		for update skip locked
	)
	update public.meta_webhook_events event
	set status = 'processing',
	    next_retry_at = clock_timestamp() + ($1::int * interval '1 second')
	from picked
	where event.id = picked.id
	returning event.id::text, event.next_retry_at, coalesce(event.raw_payload, '{}'::jsonb)
`

func (repo Repository) ClaimPendingWebhookEvent(ctx context.Context, lease time.Duration) (*webhookEventJob, error) {
	leaseSeconds := int(lease / time.Second)
	if leaseSeconds < 1 {
		leaseSeconds = int(webhookEventLease / time.Second)
	}

	var job webhookEventJob
	var payload []byte
	err := repo.db.Pool().QueryRow(ctx, claimPendingWebhookEventsQuery, leaseSeconds).Scan(&job.Claim.ID, &job.Claim.ExpiresAt, &payload)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(payload, &job.Payload); err != nil || job.Payload == nil {
		job.Payload = map[string]any{}
	}
	return &job, nil
}

func (repo Repository) ProcessWebhookPayload(ctx context.Context, job webhookEventJob) (WebhookResponse, error) {
	if job.Claim.ID == "" || job.Claim.ExpiresAt.IsZero() {
		return WebhookResponse{}, errWebhookClaimLost
	}
	ctx = context.WithValue(ctx, webhookEventClaimContextKey{}, job.Claim)

	changes := extractLeadgenChanges(job.Payload)
	messagingEvents := extractMessagingEvents(job.Payload)
	results := make([]LeadgenResult, 0, len(changes))
	for _, change := range changes {
		results = append(results, repo.processLeadgenChange(ctx, job.Payload, change))
	}
	messagingResults := make([]MessagingResult, 0, len(messagingEvents))
	for _, event := range messagingEvents {
		messagingResults = append(messagingResults, repo.processMessagingEvent(ctx, event))
	}

	status, organizationID, errorMessage, processed := aggregateWebhookResults(results, messagingResults)
	var warnings []string
	if len(changes) == 0 && len(messagingEvents) == 0 {
		errorMessage = "No supported Meta changes found"
		warnings = []string{"no_supported_changes"}
	}
	if err := repo.FinishWebhookEvent(ctx, job.Claim, organizationID, status, errorMessage); err != nil {
		return WebhookResponse{}, err
	}

	return WebhookResponse{
		OK:               true,
		EventID:          job.Claim.ID,
		Processed:        processed,
		Results:          results,
		MessagingResults: messagingResults,
		Warnings:         warnings,
	}, nil
}

// Hold the receipt row through domain writes so a takeover cannot happen
// between the ownership check and commit. Graph calls happen before this lock.
func (repo Repository) beginWebhookMutation(ctx context.Context) (pgx.Tx, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	claim, ok := ctx.Value(webhookEventClaimContextKey{}).(webhookEventClaim)
	if !ok {
		return tx, nil
	}

	var owned bool
	err = tx.QueryRow(ctx, `
		select coalesce(status = 'processing'
			and next_retry_at = $2::timestamptz
			and next_retry_at > clock_timestamp(), false)
		from (
			select status, next_retry_at
			from public.meta_webhook_events
			where id = $1::uuid
			for update
		) as receipt
	`, claim.ID, claim.ExpiresAt).Scan(&owned)
	if err == nil && owned {
		return tx, nil
	}
	_ = tx.Rollback(ctx)
	if err == nil || errors.Is(err, pgx.ErrNoRows) {
		return nil, errWebhookClaimLost
	}
	return nil, err
}
