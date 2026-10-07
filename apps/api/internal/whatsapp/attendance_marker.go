package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// confirmHumanWhatsAppAttendance is called inside the same transaction that
// records a provider-accepted outbound. It must never be called when a request
// is merely queued, when delivery is unknown, or for a reaction/automation.
// The query repeats those conditions against durable rows rather than trusting
// the caller. The append-only capture entry itself is never changed.
func confirmHumanWhatsAppAttendance(
	ctx context.Context,
	tx pgx.Tx,
	organizationID, messageRowID string,
) error {
	var entryID, leadID, conversationID, sessionID, bindingID, userID string
	var actorName, entrySource string
	var ingressSequenceCutoff int64
	var acceptedAt time.Time
	var priorConversation bool
	err := tx.QueryRow(ctx, `
		select entry.id::text, entry.lead_id::text,
		       entry.conversation_id::text, entry.session_id::text,
		       entry.binding_id::text, entry.user_id::text,
		       entry.actor_name_snapshot, entry.entry_source,
		       entry.ingress_sequence_cutoff,
		       coalesce(outbox.sent_at, clock_timestamp()),
		       exists (
		         select 1
		         from public.whatsapp_messages as previous
		         where previous.organization_id = message.organization_id
		           and previous.lead_id = message.lead_id
		           and previous.id <> message.id
		           and previous.capture_state is distinct from 'suppressed'
		           and previous.message_type <> 'reaction'
		           and (
		             coalesce(previous.from_me, false) = false
		             or previous.status in ('sent', 'delivered', 'read')
		           )
		           and previous.created_at <= coalesce(outbox.sent_at, clock_timestamp())
		       )
		from public.whatsapp_messages as message
		join public.whatsapp_outbox as outbox
		  on outbox.organization_id = message.organization_id
		 and outbox.message_id = message.id
		 and outbox.conversation_id = message.conversation_id
		 and outbox.session_id = message.session_id
		 and outbox.client_message_id = message.client_message_id
		join public.whatsapp_attendance_entries as entry
		  on entry.id = case
		       when message.metadata->>'attendance_entry_id' ~*
		         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
		       then (message.metadata->>'attendance_entry_id')::uuid
		       else null::uuid
		     end
		 and entry.organization_id = message.organization_id
		 and entry.lead_id = message.lead_id
		 and entry.conversation_id = message.conversation_id
		 and entry.session_id = message.session_id
		 and entry.user_id = message.sender_user_id
		where message.organization_id = $1::uuid
		  and message.id = $2::uuid
		  and message.lead_id is not null
		  and coalesce(message.from_me, false) = true
		  and message.direction = 'outbound'
		  and message.capture_state = 'captured'
		  and message.message_type <> 'reaction'
		  and message.status in ('sent', 'delivered', 'read')
		  and message.metadata->>'attendance_send_origin' = 'human'
		  and outbox.payload->>'attendance_send_origin' = 'human'
		  and outbox.payload->>'action' <> 'message.react'
		  and outbox.message_type <> 'reaction'
		  and outbox.status in ('sent', 'delivered', 'read')
		  and outbox.sent_at is not null
		limit 1
	`, organizationID, messageRowID).Scan(
		&entryID, &leadID, &conversationID, &sessionID, &bindingID,
		&userID, &actorName, &entrySource, &ingressSequenceCutoff,
		&acceptedAt, &priorConversation,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}

	markerKind := "started"
	title := fmt.Sprintf("%s iniciou uma conversa", actorName)
	if priorConversation {
		markerKind = "joined"
		title = fmt.Sprintf("%s entrou no atendimento", actorName)
	}

	var confirmedEntryID string
	err = tx.QueryRow(ctx, `
		insert into public.whatsapp_attendance_marker_confirmations (
			entry_id, organization_id, lead_id, conversation_id,
			session_id, user_id, message_id, confirmed_at, marker_kind
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5::uuid, $6::uuid, $7::uuid, $8::timestamptz, $9
		)
		on conflict (entry_id) do nothing
		returning entry_id::text
	`, entryID, organizationID, leadID, conversationID, sessionID,
		userID, messageRowID, acceptedAt, markerKind).Scan(&confirmedEntryID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
		insert into public.lead_timeline_events (
			organization_id, lead_id, user_id, actor_user_id,
			event_type, title, description, event_at, metadata
		) values (
			$1::uuid, $2::uuid, $3::uuid, $3::uuid,
			'whatsapp_attendance_joined', $4,
			'Primeira mensagem humana aceita pelo WhatsApp.',
			$5::timestamptz,
			jsonb_build_object(
				'attendance_entry_id', $6::uuid,
				'conversation_id', $7::uuid,
				'session_id', $8::uuid,
				'binding_id', $9::uuid,
				'ingress_sequence_cutoff', $10::bigint,
				'entry_source', $11,
				'confirmed_message_id', $12::uuid,
				'marker_kind', $13
			)
		)
	`, organizationID, leadID, userID, title, acceptedAt, confirmedEntryID,
		conversationID, sessionID, bindingID, ingressSequenceCutoff, entrySource,
		messageRowID, markerKind)
	return err
}
