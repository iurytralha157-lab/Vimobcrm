package integrations

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const reserveMetaOutboundMessageQuery = `
	insert into public.meta_messages (
		conversation_id,
		client_request_id,
		content,
		message_type,
		from_me,
		status,
		sent_at,
		created_at
	)
	select
		conversation.id,
		$3::uuid,
		$4,
		'text',
		true,
		'pending',
		null,
		now()
	from public.meta_conversations conversation
	where conversation.organization_id = $1::uuid
	  and conversation.id = $2::uuid
	on conflict (conversation_id, client_request_id)
	do nothing
	returning
		id::text,
		conversation_id::text,
		client_request_id::text,
		coalesce(external_id, ''),
		coalesce(content, ''),
		coalesce(message_type, ''),
		coalesce(from_me, false),
		coalesce(status, ''),
		sent_at,
		created_at,
		provider_attempted_at,
		completed_at,
		coalesce(delivery_error_code, '')
`

const loadMetaOutboundReservationQuery = `
	select
		message.id::text,
		message.conversation_id::text,
		message.client_request_id::text,
		coalesce(message.external_id, ''),
		coalesce(message.content, ''),
		coalesce(message.message_type, ''),
		coalesce(message.from_me, false),
		coalesce(message.status, ''),
		message.sent_at,
		message.created_at,
		message.provider_attempted_at,
		message.completed_at,
		coalesce(message.delivery_error_code, '')
	from public.meta_messages message
	join public.meta_conversations conversation
	  on conversation.id = message.conversation_id
	where conversation.organization_id = $1::uuid
	  and message.conversation_id = $2::uuid
	  and message.client_request_id = $3::uuid
	limit 1
`

const markMetaOutboundAttemptQuery = `
	update public.meta_messages message
	set status = 'pending',
		provider_attempted_at = coalesce(message.provider_attempted_at, now()),
		delivery_error_code = null
	from public.meta_conversations conversation
	where conversation.id = message.conversation_id
	  and conversation.organization_id = $1::uuid
	  and message.id = $2::uuid
	  and message.client_request_id = $3::uuid
	  and message.status = 'pending'
	returning
		message.id::text,
		message.conversation_id::text,
		message.client_request_id::text,
		coalesce(message.external_id, ''),
		coalesce(message.content, ''),
		coalesce(message.message_type, ''),
		coalesce(message.from_me, false),
		coalesce(message.status, ''),
		message.sent_at,
		message.created_at,
		message.provider_attempted_at,
		message.completed_at,
		coalesce(message.delivery_error_code, '')
`

const markMetaOutboundStateQuery = `
	update public.meta_messages message
	set status = $4,
		delivery_error_code = $5,
		completed_at = case when $4 = 'failed' then now() else null end
	from public.meta_conversations conversation
	where conversation.id = message.conversation_id
	  and conversation.organization_id = $1::uuid
	  and message.id = $2::uuid
	  and message.client_request_id = $3::uuid
	  and message.status in ('pending', 'uncertain')
	returning
		message.id::text,
		message.conversation_id::text,
		message.client_request_id::text,
		coalesce(message.external_id, ''),
		coalesce(message.content, ''),
		coalesce(message.message_type, ''),
		coalesce(message.from_me, false),
		coalesce(message.status, ''),
		message.sent_at,
		message.created_at,
		message.provider_attempted_at,
		message.completed_at,
		coalesce(message.delivery_error_code, '')
`

const finalizeMetaOutboundMessageQuery = `
	update public.meta_messages message
	set external_id = $4,
		status = 'sent',
		sent_at = now(),
		provider_attempted_at = coalesce(message.provider_attempted_at, now()),
		completed_at = now(),
		delivery_error_code = null
	from public.meta_conversations conversation
	where conversation.id = message.conversation_id
	  and conversation.organization_id = $1::uuid
	  and message.id = $2::uuid
	  and message.client_request_id = $3::uuid
	  and message.status in ('pending', 'uncertain')
	returning
		message.id::text,
		message.conversation_id::text,
		message.client_request_id::text,
		coalesce(message.external_id, ''),
		coalesce(message.content, ''),
		coalesce(message.message_type, ''),
		coalesce(message.from_me, false),
		coalesce(message.status, ''),
		message.sent_at,
		message.created_at,
		message.provider_attempted_at,
		message.completed_at,
		coalesce(message.delivery_error_code, '')
`

type metaOutboundReservation struct {
	ID                  string
	ConversationID      string
	ClientRequestID     string
	ExternalID          string
	Content             string
	MessageType         string
	FromMe              bool
	Status              string
	SentAt              *time.Time
	CreatedAt           time.Time
	ProviderAttemptedAt *time.Time
	CompletedAt         *time.Time
	DeliveryErrorCode   string
}

func normalizeMetaIdempotencyKey(value string) (string, bool) {
	var key pgtype.UUID
	if err := key.Scan(strings.TrimSpace(value)); err != nil || !key.Valid {
		return "", false
	}
	return key.String(), true
}

// reserveMetaOutboundMessage commits the write-ahead row before any provider
// request. The unique key and second read (a fresh READ COMMITTED snapshot)
// make concurrent retries converge on the same row.
func (repo Repository) reserveMetaOutboundMessage(
	ctx context.Context,
	organizationID string,
	conversationID string,
	clientRequestID string,
	text string,
) (metaOutboundReservation, bool, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return metaOutboundReservation{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	reservation, err := scanMetaOutboundReservation(tx.QueryRow(
		ctx,
		reserveMetaOutboundMessageQuery,
		organizationID,
		conversationID,
		clientRequestID,
		text,
	))
	owned := err == nil
	if errors.Is(err, pgx.ErrNoRows) {
		reservation, err = scanMetaOutboundReservation(tx.QueryRow(
			ctx,
			loadMetaOutboundReservationQuery,
			organizationID,
			conversationID,
			clientRequestID,
		))
		owned = false
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return metaOutboundReservation{}, false, ErrIntegrationNotFound
	}
	if err != nil {
		return metaOutboundReservation{}, false, err
	}
	if reservation.Content != text || reservation.MessageType != "text" || !reservation.FromMe {
		return metaOutboundReservation{}, false, ErrIdempotencyConflict
	}
	if err := tx.Commit(ctx); err != nil {
		return metaOutboundReservation{}, false, err
	}
	return reservation, owned, nil
}

func (repo Repository) markMetaOutboundAttempt(
	ctx context.Context,
	organizationID string,
	reservation metaOutboundReservation,
) (metaOutboundReservation, error) {
	return scanMetaOutboundReservation(repo.db.Pool().QueryRow(
		ctx,
		markMetaOutboundAttemptQuery,
		organizationID,
		reservation.ID,
		reservation.ClientRequestID,
	))
}

func (repo Repository) markMetaOutboundState(
	ctx context.Context,
	organizationID string,
	reservation metaOutboundReservation,
	status string,
	errorCode string,
) (metaOutboundReservation, error) {
	if status != "failed" && status != "uncertain" {
		return metaOutboundReservation{}, ErrInvalidInput
	}
	return scanMetaOutboundReservation(repo.db.Pool().QueryRow(
		ctx,
		markMetaOutboundStateQuery,
		organizationID,
		reservation.ID,
		reservation.ClientRequestID,
		status,
		errorCode,
	))
}

func (repo Repository) finalizeMetaOutboundMessage(
	ctx context.Context,
	organizationID string,
	reservation metaOutboundReservation,
	providerMessageID string,
) (metaOutboundReservation, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return metaOutboundReservation{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	completed, err := scanMetaOutboundReservation(tx.QueryRow(
		ctx,
		finalizeMetaOutboundMessageQuery,
		organizationID,
		reservation.ID,
		reservation.ClientRequestID,
		providerMessageID,
	))
	if err != nil {
		return metaOutboundReservation{}, err
	}
	command, err := tx.Exec(ctx, `
		update public.meta_conversations
		set last_message = $3,
			last_message_at = $4,
			updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, reservation.ConversationID, reservation.Content, completed.SentAt)
	if err != nil {
		return metaOutboundReservation{}, err
	}
	if command.RowsAffected() != 1 {
		return metaOutboundReservation{}, ErrIntegrationNotFound
	}
	if err := tx.Commit(ctx); err != nil {
		return metaOutboundReservation{}, err
	}
	return completed, nil
}

func scanMetaOutboundReservation(row pgx.Row) (metaOutboundReservation, error) {
	var (
		reservation       metaOutboundReservation
		sentAt            pgtype.Timestamptz
		providerAttempted pgtype.Timestamptz
		completedAt       pgtype.Timestamptz
	)
	err := row.Scan(
		&reservation.ID,
		&reservation.ConversationID,
		&reservation.ClientRequestID,
		&reservation.ExternalID,
		&reservation.Content,
		&reservation.MessageType,
		&reservation.FromMe,
		&reservation.Status,
		&sentAt,
		&reservation.CreatedAt,
		&providerAttempted,
		&completedAt,
		&reservation.DeliveryErrorCode,
	)
	if err != nil {
		return metaOutboundReservation{}, err
	}
	if sentAt.Valid {
		value := sentAt.Time.UTC()
		reservation.SentAt = &value
	}
	if providerAttempted.Valid {
		value := providerAttempted.Time.UTC()
		reservation.ProviderAttemptedAt = &value
	}
	if completedAt.Valid {
		value := completedAt.Time.UTC()
		reservation.CompletedAt = &value
	}
	reservation.CreatedAt = reservation.CreatedAt.UTC()
	return reservation, nil
}

func metaOutboundSendResult(reservation metaOutboundReservation, replay bool, created bool) SendMetaMessageResult {
	statusCode := http.StatusOK
	if reservation.Status == "pending" || reservation.Status == "uncertain" {
		statusCode = http.StatusAccepted
	} else if reservation.Status == "sent" && created {
		statusCode = http.StatusCreated
	}
	message := map[string]any{
		"id":                    reservation.ID,
		"conversation_id":       reservation.ConversationID,
		"client_request_id":     reservation.ClientRequestID,
		"external_id":           nullableMetaOutboundValue(reservation.ExternalID),
		"content":               reservation.Content,
		"message_type":          reservation.MessageType,
		"from_me":               reservation.FromMe,
		"status":                reservation.Status,
		"sent_at":               reservation.SentAt,
		"created_at":            reservation.CreatedAt,
		"provider_attempted_at": reservation.ProviderAttemptedAt,
		"completed_at":          reservation.CompletedAt,
		"delivery_error_code":   nullableMetaOutboundValue(reservation.DeliveryErrorCode),
		"idempotent_replay":     replay,
	}
	return SendMetaMessageResult{Message: message, StatusCode: statusCode}
}

func nullableMetaOutboundValue(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func metaDetachedContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 5*time.Second)
}
