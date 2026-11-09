package whatsapp

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// The legacy reaction path preserves the existing attendance fence while the canonical RPC is staged.
func processLegacyNativeEvolutionReaction(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, message nativeEvolutionMessage, inboxAcceptedAt time.Time, routingSnapshot *nativeIngressRoutingSnapshot) error {
	target, err := lockNativeEvolutionMessageTarget(
		ctx,
		tx,
		session,
		message.ReactionTargetID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("WhatsApp reaction target is not available yet")
	}
	if err != nil {
		return err
	}
	if target.CaptureState == "suppressed" || target.LeadID == "" {
		return nil
	}
	bindingID := ""
	if routingSnapshot != nil {
		bindingID = routingSnapshot.ActiveBindingID
	} else {
		bindingID, err = attendanceBindingID(ctx, tx, session.OrganizationID, target.ConversationID, session.ID, target.LeadID)
		if err != nil {
			return err
		}
	}
	ingressSequence := int64(0)
	if routingSnapshot != nil {
		ingressSequence = routingSnapshot.IngressSequence
	}
	providerOccurredAt := message.SentAt
	if message.ProviderTimestampMissing {
		providerOccurredAt = time.Time{}
	}
	attendanceEntryID, err := eventAttendanceEntry(ctx, tx, session.OrganizationID,
		target.ConversationID, session.ID, target.LeadID, bindingID,
		message.ProviderMessageID, providerOccurredAt, inboxAcceptedAt, ingressSequence)
	if err != nil {
		return err
	}
	if attendanceEntryID == "" {
		return nil
	}
	actorJID := normalizeRemoteAlias(message.SenderJID)
	if message.FromMe {
		var valid bool
		actorJID, valid = canonicalWhatsAppSelfJID(message.SenderJID)
		if !valid {
			actorJID, valid = canonicalWhatsAppSelfJID(session.PhoneNumber)
		}
		if !valid {
			return errors.New("outbound reaction actor identity is unavailable")
		}
	}
	actorJID = firstNonEmpty(actorJID, message.RemoteJID)
	if actorJID == "" {
		return errors.New("reaction actor is missing")
	}
	state := "active"
	if message.ReactionEmoji == "" {
		state = "removed"
	}
	if _, err := tx.Exec(ctx, `
		insert into public.whatsapp_message_reactions (
			organization_id, session_id, conversation_id, target_message_id,
			target_provider_message_id, provider_reaction_message_id, actor_jid,
			actor_name, from_me, emoji, status, reacted_at, removed_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $6, $7, nullif($8, ''), $9, nullif($10, ''), $11, $12::timestamptz,
			case when $11 = 'removed' then $12::timestamptz else null::timestamptz end
		)
		on conflict (organization_id, session_id, target_provider_message_id, actor_jid)
		do update set
			provider_reaction_message_id = excluded.provider_reaction_message_id,
			actor_name = coalesce(excluded.actor_name, whatsapp_message_reactions.actor_name),
			from_me = excluded.from_me,
			emoji = excluded.emoji,
			status = excluded.status,
			reacted_at = excluded.reacted_at,
			removed_at = excluded.removed_at,
			updated_at = now()
	`, session.OrganizationID, session.ID, target.ConversationID, target.ID, target.CanonicalProviderID,
		message.ProviderMessageID, actorJID, message.SenderName, message.FromMe,
		message.ReactionEmoji, state, message.SentAt); err != nil {
		return err
	}

	direction := "inbound"
	status := "received"
	if message.FromMe {
		direction = "outbound"
		status = "sent"
	}
	_, err = tx.Exec(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id, lead_id,
			provider_message_id, message_id, from_me, direction, content,
			message_type, reaction_to_message_id, reaction_emoji,
			reaction_sender_jid, reaction_sender_name, remote_jid, sender_jid,
			sender_name, status, sent_at, received_at, metadata, capture_state
		) values (
			$1::uuid, $2::uuid, $3::uuid, nullif($4, '')::uuid,
			$5, $5, $6, $7, nullif($8, ''),
			'reaction', $9, nullif($8, ''), $10, nullif($11, ''), $12, $10,
			nullif($11, ''), $13, $14, case when $6 then null else now() end,
			jsonb_build_object(
			  'source', 'evolution_go_native',
			  'attendance_entry_id', $15::uuid,
			  'whatsapp_attendance_capture', jsonb_build_object(
			    'state', 'captured', 'attendance_entry_id', $15::uuid
			  )
			), 'captured'
		)
		on conflict (conversation_id, message_id)
		do update set
			content = case when whatsapp_messages.capture_state = 'suppressed' then null else excluded.content end,
			reaction_emoji = case when whatsapp_messages.capture_state = 'suppressed' then null else excluded.reaction_emoji end,
			reaction_sender_jid = excluded.reaction_sender_jid,
			reaction_sender_name = excluded.reaction_sender_name,
			sent_at = excluded.sent_at,
			updated_at = now()
	`, session.OrganizationID, target.ConversationID, session.ID, target.LeadID,
		message.ProviderMessageID, message.FromMe, direction, message.ReactionEmoji,
		target.CanonicalProviderID, actorJID, message.SenderName, message.RemoteJID, status, message.SentAt, attendanceEntryID)
	return err
}
