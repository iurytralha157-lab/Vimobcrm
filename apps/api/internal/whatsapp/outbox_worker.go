package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	whatsappOutboxWorkerInterval = time.Second
	whatsappOutboxWorkerBatch    = 5
)

var whatsappOutboxWorkerID = "vimob-api-whatsapp-outbox-" + randomHex(8)
var whatsappOutboxWorkerWake = make(chan struct{}, 1)

func wakeWhatsAppOutboxWorker() {
	select {
	case whatsappOutboxWorkerWake <- struct{}{}:
	default:
	}
}

type pendingWhatsAppOutbox struct {
	ID                string
	OrganizationID    string
	SessionID         string
	ConversationID    string
	MessageRowID      string
	ClientMessageID   string
	ProviderMessageID string
	Payload           map[string]any
	Attempts          int
	MaxAttempts       int
}

func (handler Handler) StartOutboxWorker(ctx context.Context, logger *slog.Logger) {
	if logger == nil {
		logger = slog.Default()
	}

	go func() {
		pollTicker := time.NewTicker(whatsappOutboxWorkerInterval)
		cleanupTicker := time.NewTicker(time.Hour)
		defer pollTicker.Stop()
		defer cleanupTicker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-cleanupTicker.C:
				if _, err := handler.repo.CleanupTerminalWhatsAppOutbox(ctx, 1000); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp outbox cleanup failed", "error", err)
				}
			case <-pollTicker.C:
				if err := handler.repo.ProcessWhatsAppOutbox(ctx); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp outbox worker failed", "error", err)
				}
			case <-whatsappOutboxWorkerWake:
				if err := handler.repo.ProcessWhatsAppOutbox(ctx); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp outbox worker failed", "error", err)
				}
			}
		}
	}()
}

func (repo Repository) CleanupTerminalWhatsAppOutbox(ctx context.Context, limit int) (int64, error) {
	if limit < 1 || limit > 10000 {
		limit = 1000
	}
	result, err := repo.db.Pool().Exec(ctx, `
		with expired as (
			select id
			from public.whatsapp_outbox
			where (
				status in ('sent', 'delivered', 'read')
				and updated_at < now() - interval '90 days'
			) or (
				status in ('failed', 'dead')
				and updated_at < now() - interval '180 days'
			)
			order by updated_at, id
			limit $1
			for update skip locked
		)
		delete from public.whatsapp_outbox outbox
		using expired
		where outbox.id = expired.id
	`, limit)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}

func (repo Repository) ProcessWhatsAppOutbox(ctx context.Context) error {
	items, err := repo.claimWhatsAppOutbox(ctx)
	if err != nil {
		return err
	}
	for _, item := range items {
		leaseOwned, renewErr := repo.renewWhatsAppOutboxLease(ctx, item.ID)
		if renewErr != nil {
			return renewErr
		}
		if !leaseOwned {
			continue
		}
		action := strings.TrimSpace(stringFromAny(item.Payload["action"]))
		body := mapFromAny(item.Payload["body"])
		if action == "" || len(body) == 0 {
			if failErr := repo.failWhatsAppOutbox(ctx, item, fmt.Errorf("invalid outbox payload"), true, false); failErr != nil {
				return failErr
			}
			continue
		}
		permanentSessionFailure, sessionErr := repo.validateWhatsAppOutboxSession(ctx, item)
		if sessionErr != nil {
			if failErr := repo.failWhatsAppOutbox(ctx, item, sessionErr, permanentSessionFailure, false); failErr != nil {
				return failErr
			}
			continue
		}
		if storagePath := strings.TrimSpace(stringFromAny(body["mediaStoragePath"])); storagePath != "" {
			signedURL, signErr := repo.storage.signedURL(ctx, whatsappMediaBucket, storagePath, 15*60)
			if signErr != nil || signedURL == "" {
				if signErr == nil {
					signErr = fmt.Errorf("media signed URL is empty")
				}
				if failErr := repo.failWhatsAppOutbox(ctx, item, signErr, false, false); failErr != nil {
					return failErr
				}
				continue
			}
			body["media"] = signedURL
			body["url"] = signedURL
			body["mediaUrl"] = signedURL
			delete(body, "mediaStoragePath")
		}

		providerResult, sendErr := repo.functions.invokeEvolution(ctx, action, map[string]any{
			"session_id": item.SessionID,
			"body":       body,
		})
		if sendErr != nil {
			if failErr := repo.failWhatsAppOutbox(ctx, item, sendErr, false, errors.Is(sendErr, ErrProviderOutcomeUnknown)); failErr != nil {
				return failErr
			}
			continue
		}

		providerID := stripNullBytes(providerMessageID(providerResult))
		expectedProviderID := stripNullBytes(strings.TrimSpace(item.ProviderMessageID))
		if expectedProviderID == "" {
			expectedProviderID = deterministicProviderMessageID(item.ClientMessageID)
		}
		if action != "message.react" && providerID != "" && providerID != expectedProviderID {
			// Evolution Go receives the deterministic stanza ID in body.id. If a
			// successful response reports another ID, the provider has already
			// observed the request but our idempotency contract is no longer
			// provable. Stop automatic retries instead of risking a duplicate.
			mismatchErr := fmt.Errorf(
				"%w: provider message id mismatch (expected %s, received %s)",
				ErrProviderOutcomeUnknown,
				expectedProviderID,
				providerID,
			)
			if failErr := repo.failWhatsAppOutbox(ctx, item, mismatchErr, false, true); failErr != nil {
				return failErr
			}
			continue
		}
		if action == "message.react" && providerID == strings.TrimSpace(stringFromAny(body["messageId"])) {
			// Some providers acknowledge a reaction by echoing the target message
			// ID. Never overwrite the reaction event with the target's identity.
			providerID = item.ProviderMessageID
		}
		if providerID == "" {
			providerID = expectedProviderID
		}
		if err := repo.completeWhatsAppOutbox(ctx, item, providerID); err != nil {
			return err
		}
	}
	return nil
}

func (repo Repository) validateWhatsAppOutboxSession(ctx context.Context, item pendingWhatsAppOutbox) (bool, error) {
	var organizationID, provider, status string
	var active bool
	err := repo.db.Pool().QueryRow(ctx, `
		select organization_id::text, coalesce(provider, ''), coalesce(status, ''), coalesce(is_active, true)
		from public.whatsapp_sessions
		where id = $1::uuid
		limit 1
	`, item.SessionID).Scan(&organizationID, &provider, &status, &active)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, fmt.Errorf("%w: WhatsApp session no longer exists", ErrSessionNotFound)
	}
	if err != nil {
		return false, err
	}
	if organizationID != item.OrganizationID || provider != "evolution_go" || !active || status == "deleted" {
		return true, fmt.Errorf("%w: WhatsApp session is not eligible for delivery", ErrSessionNotFound)
	}
	if status != "connected" {
		return false, fmt.Errorf("%w: WhatsApp session is temporarily disconnected", ErrProviderFailed)
	}
	return false, nil
}

func (repo Repository) renewWhatsAppOutboxLease(ctx context.Context, id string) (bool, error) {
	result, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_outbox
		set locked_at = now(), updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
	`, id, whatsappOutboxWorkerID)
	if err != nil {
		return false, err
	}
	return result.RowsAffected() == 1, nil
}

func (repo Repository) getOutboundMessageByClientID(ctx context.Context, organizationID string, sessionID string, clientMessageID string) (Message, error) {
	message, err := scanMessage(repo.db.Pool().QueryRow(ctx, `
		select `+messageSelectFields()+`
		from public.whatsapp_messages wm
		where wm.organization_id = $1::uuid
		  and wm.session_id = $2::uuid
		  and wm.client_message_id = $3
		limit 1
	`, organizationID, sessionID, clientMessageID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Message{}, ErrMessageNotFound
	}
	if err != nil {
		return Message{}, err
	}
	messages := []Message{message}
	if err := repo.hydrateMessageMediaURLs(ctx, organizationID, messages); err != nil {
		return Message{}, err
	}
	return messages[0], nil
}

func (repo Repository) claimWhatsAppOutbox(ctx context.Context) ([]pendingWhatsAppOutbox, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		update public.whatsapp_outbox
		set status = 'dead',
		    dead_lettered_at = coalesce(dead_lettered_at, now()),
		    locked_at = null,
		    locked_by = null,
		    last_error = coalesce(last_error, 'retry_exhausted'),
		    updated_at = now()
		where attempts >= max_attempts
		  and (
		    (status in ('pending', 'retry') and next_attempt_at <= now())
		    or (status = 'processing' and locked_at < now() - interval '5 minutes')
		  )
	`); err != nil {
		return nil, err
	}
	if err := repo.syncTerminalWhatsAppOutboxFailures(ctx, tx, ""); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		update public.whatsapp_outbox
		set status = 'retry',
		    locked_at = null,
		    locked_by = null,
		    next_attempt_at = now(),
		    updated_at = now()
		where status = 'processing'
		  and locked_at < now() - interval '5 minutes'
		  and attempts < max_attempts
	`); err != nil {
		return nil, err
	}

	rows, err := tx.Query(ctx, `
		with candidates as (
			select id
			from public.whatsapp_outbox
			where status in ('pending', 'retry')
			  and attempts < max_attempts
			  and next_attempt_at <= now()
			order by next_attempt_at, created_at, id
			limit $1
			for update skip locked
		)
		update public.whatsapp_outbox queued
		set status = 'processing',
		    attempts = queued.attempts + 1,
		    locked_at = now(),
		    locked_by = $2,
		    updated_at = now()
		from candidates
		where queued.id = candidates.id
		returning
			queued.id::text,
			queued.organization_id::text,
			queued.session_id::text,
			queued.conversation_id::text,
			queued.message_id::text,
			queued.client_message_id,
			coalesce(queued.provider_message_id, ''),
			queued.payload::text,
			queued.attempts,
			queued.max_attempts
	`, whatsappOutboxWorkerBatch, whatsappOutboxWorkerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]pendingWhatsAppOutbox, 0, whatsappOutboxWorkerBatch)
	for rows.Next() {
		var item pendingWhatsAppOutbox
		var rawPayload string
		if err := rows.Scan(
			&item.ID,
			&item.OrganizationID,
			&item.SessionID,
			&item.ConversationID,
			&item.MessageRowID,
			&item.ClientMessageID,
			&item.ProviderMessageID,
			&rawPayload,
			&item.Attempts,
			&item.MaxAttempts,
		); err != nil {
			return nil, err
		}
		item.Payload = map[string]any{}
		if err := json.Unmarshal([]byte(rawPayload), &item.Payload); err != nil {
			item.Payload = map[string]any{}
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return items, nil
}

func (repo Repository) completeWhatsAppOutbox(ctx context.Context, item pendingWhatsAppOutbox, providerMessageID string) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	canonicalMessageID := item.MessageRowID
	var existingID string
	err = tx.QueryRow(ctx, `
		select id::text
		from public.whatsapp_messages
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and coalesce(provider_message_id, message_id) = $3
		  and id <> $4::uuid
		limit 1
		for update
	`, item.OrganizationID, item.SessionID, providerMessageID, item.MessageRowID).Scan(&existingID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	if existingID != "" {
		// Release the partial unique client id before moving it to a webhook row
		// that won the provider-id race.
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_messages
			set client_message_id = null,
			    updated_at = now()
			where id = $1::uuid
		`, item.MessageRowID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_messages existing
			set client_message_id = coalesce(existing.client_message_id, $4),
			    lead_id = coalesce(existing.lead_id, pending.lead_id),
			    sender_user_id = coalesce(existing.sender_user_id, pending.sender_user_id),
			    content = coalesce(existing.content, pending.content),
			    media_url = coalesce(existing.media_url, pending.media_url),
			    media_storage_path = coalesce(existing.media_storage_path, pending.media_storage_path),
			    provider_message_id = $3,
			    message_id = $3,
			    status = case when existing.status in ('delivered', 'read') then existing.status else 'sent' end,
			    sent_at = coalesce(existing.sent_at, now()),
			    updated_at = now()
			from public.whatsapp_messages pending
			where existing.id = $1::uuid
			  and pending.id = $2::uuid
		`, existingID, item.MessageRowID, providerMessageID, item.ClientMessageID); err != nil {
			return err
		}
		canonicalMessageID = existingID
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_outbox
			set message_id = $2::uuid
			where id = $1::uuid
			  and locked_by = $3
		`, item.ID, canonicalMessageID, whatsappOutboxWorkerID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `delete from public.whatsapp_messages where id = $1::uuid`, item.MessageRowID); err != nil {
			return err
		}
	} else {
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_messages
			set provider_message_id = $2,
			    message_id = $2,
			    status = case when status in ('delivered', 'read') then status else 'sent' end,
			    sent_at = coalesce(sent_at, now()),
			    updated_at = now()
			where id = $1::uuid
			  and organization_id = $3::uuid
		`, item.MessageRowID, providerMessageID, item.OrganizationID); err != nil {
			return err
		}
	}

	result, err := tx.Exec(ctx, `
		update public.whatsapp_outbox
		set status = 'sent',
		    provider_message_id = $2,
		    sent_at = now(),
		    locked_at = null,
		    locked_by = null,
		    last_error = null,
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $3
	`, item.ID, providerMessageID, whatsappOutboxWorkerID)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return fmt.Errorf("whatsapp outbox lease was lost before acknowledgement")
	}

	if strings.TrimSpace(stringFromAny(item.Payload["action"])) != "message.react" {
		// CRM contact clocks and the timeline are provider-acknowledgement facts.
		// They are intentionally written here, in the same transaction that turns
		// the durable outbox row into `sent`, never when the browser/automation
		// merely queues the message.
		if _, err := tx.Exec(ctx, `
			update public.leads as lead
			set last_contact_at = greatest(
			      coalesce(lead.last_contact_at, '-infinity'::timestamptz),
			      coalesce(message.sent_at, now())
			    ),
			    first_response_at = coalesce(lead.first_response_at, message.sent_at, now()),
			    first_response_seconds = coalesce(
			      lead.first_response_seconds,
			      greatest(0, extract(epoch from (coalesce(message.sent_at, now()) - lead.created_at))::integer)
			    ),
			    first_response_channel = coalesce(lead.first_response_channel, 'whatsapp'),
			    first_response_is_automation = coalesce(
			      lead.first_response_is_automation,
			      coalesce(message.metadata->>'origin', '') = 'automation'
			    ),
			    first_response_actor_user_id = coalesce(lead.first_response_actor_user_id, message.sender_user_id),
			    updated_at = now()
			from public.whatsapp_messages as message
			where message.id = $1::uuid
			  and message.organization_id = $2::uuid
			  and message.lead_id = lead.id
			  and lead.organization_id = message.organization_id
		`, canonicalMessageID, item.OrganizationID); err != nil {
			return err
		}

		timelineResult, err := tx.Exec(ctx, `
			update public.lead_timeline_events as timeline
			set event_type = 'whatsapp_message_sent',
			    title = 'Mensagem WhatsApp enviada',
			    description = coalesce(nullif(message.content, ''), case message.message_type
			      when 'image' then '[Imagem]' when 'audio' then '[Audio]'
			      when 'video' then '[Video]' when 'document' then '[Documento]'
			      else '[Mensagem]' end),
			    user_id = coalesce(timeline.user_id, message.sender_user_id),
			    actor_user_id = coalesce(timeline.actor_user_id, message.sender_user_id),
			    metadata = coalesce(timeline.metadata, '{}'::jsonb) || jsonb_build_object(
			      'outbox_id', $3,
			      'message_row_id', message.id,
			      'message_id', $4,
			      'client_message_id', $5,
			      'session_id', message.session_id,
			      'conversation_id', message.conversation_id,
			      'message_type', message.message_type,
			      'delivery_status', 'sent'
			    ),
			    event_at = coalesce(message.sent_at, now())
			from public.whatsapp_messages as message
			where message.id = $1::uuid
			  and message.organization_id = $2::uuid
			  and timeline.organization_id = message.organization_id
			  and timeline.lead_id = message.lead_id
			  and timeline.metadata->>'outbox_id' = $3
		`, canonicalMessageID, item.OrganizationID, item.ID, providerMessageID, item.ClientMessageID)
		if err != nil {
			return err
		}
		if timelineResult.RowsAffected() == 0 {
			if _, err := tx.Exec(ctx, `
				insert into public.lead_timeline_events (
				  organization_id, lead_id, event_type, title, description,
				  user_id, actor_user_id, metadata, event_at
				)
				select
				  message.organization_id, message.lead_id,
				  'whatsapp_message_sent',
				  'Mensagem WhatsApp enviada',
				  coalesce(nullif(message.content, ''), case message.message_type
				    when 'image' then '[Imagem]' when 'audio' then '[Audio]'
				    when 'video' then '[Video]' when 'document' then '[Documento]'
				    else '[Mensagem]' end),
				  message.sender_user_id, message.sender_user_id,
				  jsonb_build_object(
				    'outbox_id', $3,
				    'message_row_id', message.id,
				    'message_id', $4,
				    'client_message_id', $5,
				    'session_id', message.session_id,
				    'conversation_id', message.conversation_id,
				    'message_type', message.message_type,
				    'delivery_status', 'sent'
				  ),
				  coalesce(message.sent_at, now())
				from public.whatsapp_messages as message
				where message.id = $1::uuid
				  and message.organization_id = $2::uuid
				  and message.lead_id is not null
			`, canonicalMessageID, item.OrganizationID, item.ID, providerMessageID, item.ClientMessageID); err != nil {
				return err
			}
		}

		if _, err := tx.Exec(ctx, `
			update public.automation_effect_dispatches
			set status = 'succeeded',
			    provider_id = $2,
			    error_message = null,
			    completed_at = now(),
			    response = coalesce(response, '{}'::jsonb) || jsonb_build_object(
			      'status', 'sent',
			      'provider_id', $2,
			      'message_id', $3::uuid,
			      'outbox_id', $1::uuid
			    )
			where response->>'outbox_id' = $1
			  and organization_id = $4::uuid
			  and effect_key = $5
			  and request->>'delivery_contract' = 'canonical_whatsapp_outbox_v1'
			  and status in ('succeeded', 'failed', 'unknown')
		`, item.ID, providerMessageID, canonicalMessageID, item.OrganizationID, item.ClientMessageID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (repo Repository) failWhatsAppOutbox(ctx context.Context, item pendingWhatsAppOutbox, cause error, permanent bool, outcomeUnknown bool) error {
	status := "retry"
	if outcomeUnknown {
		// A timeout or broken response can happen after WhatsApp accepted the
		// stanza. Evolution Go documents the custom message ID but does not
		// guarantee exactly-once delivery, so automatic resend is unsafe.
		status = "dead"
	} else if permanent {
		status = "failed"
	} else if item.Attempts >= item.MaxAttempts {
		status = "dead"
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, `
		update public.whatsapp_outbox
		set status = $2,
		    next_attempt_at = case
		      when $2 = 'retry' then now() + make_interval(secs => least(3600, 5 * (power(2, least(attempts, 9)))::int))
		      else next_attempt_at
		    end,
		    failed_at = case when $2 = 'failed' then now() else failed_at end,
		    dead_lettered_at = case when $2 = 'dead' then now() else dead_lettered_at end,
		    locked_at = null,
		    locked_by = null,
		    last_error = left($3, 4000),
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $4
	`, item.ID, status, cause.Error(), whatsappOutboxWorkerID)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return fmt.Errorf("whatsapp outbox lease was lost before failure handling")
	}
	if status == "dead" || status == "failed" {
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_messages
			set status = 'failed',
			    updated_at = now()
			where id = $1::uuid
			  and organization_id = $2::uuid
		`, item.MessageRowID, item.OrganizationID); err != nil {
			return err
		}
		if err := repo.syncTerminalWhatsAppOutboxFailures(ctx, tx, item.ID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// syncTerminalWhatsAppOutboxFailures projects a terminal durable-delivery
// failure into the CRM and automation observability model. It is intentionally
// idempotent because it runs both after a worker failure and while recovering
// exhausted/abandoned leases.
func (repo Repository) syncTerminalWhatsAppOutboxFailures(ctx context.Context, tx pgx.Tx, outboxID string) error {
	if _, err := tx.Exec(ctx, `
		update public.whatsapp_messages as message
		set status = 'failed',
		    updated_at = now()
		from public.whatsapp_outbox as outbox
		where outbox.message_id = message.id
		  and outbox.organization_id = message.organization_id
		  and outbox.status in ('failed', 'dead')
		  and message.status is distinct from 'failed'
		  and (nullif($1, '') is null or outbox.id = nullif($1, '')::uuid)
	`, outboxID); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		update public.lead_timeline_events as timeline
		set event_type = 'whatsapp_message_failed',
		    title = 'Falha no envio de mensagem WhatsApp',
		    metadata = coalesce(timeline.metadata, '{}'::jsonb) || jsonb_build_object(
		      'delivery_status', outbox.status,
		      'last_error', left(coalesce(outbox.last_error, 'delivery_failed'), 500)
		    )
		from public.whatsapp_outbox as outbox
		where outbox.organization_id = timeline.organization_id
		  and timeline.metadata->>'outbox_id' = outbox.id::text
		  and outbox.status in ('failed', 'dead')
		  and timeline.metadata->>'delivery_status' is distinct from outbox.status
		  and (nullif($1, '') is null or outbox.id = nullif($1, '')::uuid)
	`, outboxID); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		update public.automation_effect_dispatches as dispatch
		set status = case when outbox.status = 'dead' then 'unknown' else 'failed' end,
		    error_message = left(case
		      when outbox.status = 'dead' then 'whatsapp_delivery_not_confirmed: ' || coalesce(outbox.last_error, 'retry_exhausted')
		      else coalesce(outbox.last_error, 'whatsapp_delivery_failed')
		    end, 4000),
		    response = coalesce(dispatch.response, '{}'::jsonb) || jsonb_build_object(
		      'status', case when outbox.status = 'dead' then 'unknown' else 'failed' end,
		      'delivery_status', outbox.status,
		      'outbox_id', outbox.id,
		      'message_id', outbox.message_id,
		      'last_error', left(coalesce(outbox.last_error, 'whatsapp_delivery_failed'), 4000)
		    ),
		    completed_at = coalesce(dispatch.completed_at, now())
		from public.whatsapp_outbox as outbox
		where dispatch.organization_id = outbox.organization_id
		  and dispatch.response->>'outbox_id' = outbox.id::text
		  and dispatch.request->>'delivery_contract' = 'canonical_whatsapp_outbox_v1'
		  and dispatch.effect_key = outbox.client_message_id
		  and dispatch.status = 'succeeded'
		  and outbox.status in ('failed', 'dead')
		  and (nullif($1, '') is null or outbox.id = nullif($1, '')::uuid)
	`, outboxID); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		insert into public.notifications (
		  organization_id, user_id, title, content, body, type, channel,
		  lead_id, target_url, metadata
		)
		select
		  dispatch.organization_id,
		  member.user_id,
		  'Falha em automacao do WhatsApp',
		  case when outbox.status = 'dead'
		    then 'A entrega de uma mensagem automatica nao foi confirmada apos todas as tentativas.'
		    else 'Uma mensagem automatica nao foi entregue.' end,
		  case when outbox.status = 'dead'
		    then 'A entrega de uma mensagem automatica nao foi confirmada apos todas as tentativas.'
		    else 'Uma mensagem automatica nao foi entregue.' end,
		  'automation_whatsapp_delivery_failed',
		  'in_app',
		  execution.lead_id,
		  '/automations',
		  jsonb_build_object(
		    'dedupe_key', 'automation_whatsapp_delivery_failed:' || outbox.id::text || ':' || member.user_id::text,
		    'automation_id', execution.automation_id,
		    'execution_id', dispatch.execution_id,
		    'effect_id', dispatch.id,
		    'outbox_id', outbox.id,
		    'delivery_status', outbox.status,
		    'last_error', left(coalesce(outbox.last_error, 'whatsapp_delivery_failed'), 500)
		  )
		from public.whatsapp_outbox as outbox
		join public.automation_effect_dispatches as dispatch
		  on dispatch.organization_id = outbox.organization_id
		 and dispatch.response->>'outbox_id' = outbox.id::text
		 and dispatch.request->>'delivery_contract' = 'canonical_whatsapp_outbox_v1'
		 and dispatch.effect_key = outbox.client_message_id
		 and dispatch.status in ('failed', 'unknown')
		join public.automation_executions as execution
		  on execution.id = dispatch.execution_id
		 and execution.organization_id = dispatch.organization_id
		join public.organization_members as member
		  on member.organization_id = dispatch.organization_id
		 and member.role in ('owner', 'admin', 'manager')
		 and coalesce(member.is_active, false) = true
		join public.users as recipient
		  on recipient.id = member.user_id
		 and recipient.organization_id = member.organization_id
		 and coalesce(recipient.is_active, false) = true
		where outbox.status in ('failed', 'dead')
		  and (nullif($1, '') is null or outbox.id = nullif($1, '')::uuid)
		on conflict do nothing
	`, outboxID); err != nil {
		return err
	}

	return nil
}
