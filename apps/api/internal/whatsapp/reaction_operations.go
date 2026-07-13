package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type reactionTarget struct {
	MessageID         string
	SessionID         string
	ConversationID    string
	LeadID            string
	ProviderMessageID string
	RemoteJID         string
	SessionPhone      string
	TargetFromMe      bool
}

func reactionTargetAuthorizationSQL() string {
	return `
		select
			wm.id::text,
			wm.session_id::text,
			wc.id::text,
			l.id::text,
			coalesce(nullif(wm.provider_message_id, ''), nullif(wm.message_id, ''), ''),
			coalesce(nullif(wm.remote_jid, ''), wc.remote_jid),
			coalesce(ws.phone_number, ''),
			wm.from_me
		from public.whatsapp_messages wm
		join public.whatsapp_conversations wc
		  on wc.id = wm.conversation_id
		 and wc.organization_id = wm.organization_id
		join public.whatsapp_sessions ws
		  on ws.id = wm.session_id
		 and ws.organization_id = wm.organization_id
		 and wc.session_id = ws.id
		join public.leads l
		  on l.id = wc.lead_id
		 and l.organization_id = wc.organization_id
		where wm.organization_id = $1::uuid
		  and wc.id = $5::uuid
		  and wm.id = $6::uuid
		  and wc.deleted_at is null
		  and ` + conversationMessageLeadMatchSQL() + `
		  and wm.message_type <> 'reaction'
		  and coalesce(nullif(wm.provider_message_id, ''), nullif(wm.message_id, ''), '') <> ''
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and ws.status = 'connected'
		  and ws.owner_user_id = $2::uuid
		  and ` + leadVisibilitySQL() + `
		for update of wm, wc, ws, l`
}

func (repo Repository) ReactToMessage(
	ctx context.Context,
	tenantContext tenant.Context,
	conversationID string,
	targetMessageID string,
	input reactToMessageInput,
) (ReactToMessageResponse, error) {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return ReactToMessageResponse{}, ErrConversationNotFound
	}
	targetMessageID, ok = normalizeUUID(targetMessageID)
	if !ok {
		return ReactToMessageResponse{}, ErrMessageNotFound
	}
	input.ClientReactionID = stripNullBytes(strings.TrimSpace(input.ClientReactionID))
	if input.ClientReactionID == "" {
		return ReactToMessageResponse{}, fmt.Errorf("%w: clientReactionId is invalid", ErrInvalidInput)
	}

	senderName := repo.userDisplayName(ctx, tenantContext.UserID)
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return ReactToMessageResponse{}, err
	}
	defer tx.Rollback(ctx)

	args := append(baseConversationArgs(tenantContext), conversationID, targetMessageID)
	target := reactionTarget{}
	err = tx.QueryRow(ctx, reactionTargetAuthorizationSQL(), args...).Scan(
		&target.MessageID,
		&target.SessionID,
		&target.ConversationID,
		&target.LeadID,
		&target.ProviderMessageID,
		&target.RemoteJID,
		&target.SessionPhone,
		&target.TargetFromMe,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return ReactToMessageResponse{}, ErrMessageNotFound
	}
	if err != nil {
		return ReactToMessageResponse{}, err
	}

	actorJID, validActorJID := canonicalWhatsAppSelfJID(target.SessionPhone)
	if !validActorJID {
		return ReactToMessageResponse{}, fmt.Errorf("%w: connected WhatsApp session has no phone number", ErrInvalidReference)
	}

	providerRequestID := deterministicProviderMessageID(input.ClientReactionID)
	reactionState := "active"
	if input.Emoji == "" {
		reactionState = "removed"
	}

	var reactionRowID string
	err = tx.QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id, lead_id, sender_user_id,
			message_id, client_message_id, from_me, direction, content, message_type,
			reaction_to_message_id, reaction_emoji, reaction_sender_jid,
			reaction_sender_name, remote_jid, sender_jid, sender_name, status, sent_at,
			metadata
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
			$6, $7, true, 'outbound', nullif($8, ''), 'reaction',
			$9, nullif($8, ''), $10, nullif($11, ''), $12, $10,
			nullif($11, ''), 'queued', now(),
			jsonb_build_object('delivery', 'outbox', 'intent', 'reaction')
		)
		on conflict (organization_id, session_id, client_message_id)
		  where client_message_id is not null
		do nothing
		returning id::text
	`, tenantContext.OrganizationID, target.ConversationID, target.SessionID, target.LeadID,
		tenantContext.UserID, providerRequestID, input.ClientReactionID, input.Emoji,
		target.ProviderMessageID, actorJID, senderName, target.RemoteJID).Scan(&reactionRowID)
	if errors.Is(err, pgx.ErrNoRows) {
		existing, existingErr := scanMessage(tx.QueryRow(ctx, `
			select `+messageSelectFields()+`
			from public.whatsapp_messages wm
			where wm.organization_id = $1::uuid
			  and wm.session_id = $2::uuid
			  and wm.client_message_id = $3
			limit 1
		`, tenantContext.OrganizationID, target.SessionID, input.ClientReactionID))
		if existingErr != nil {
			return ReactToMessageResponse{}, existingErr
		}
		existingEmoji := ""
		if existing.ReactionEmoji != nil {
			existingEmoji = *existing.ReactionEmoji
		}
		existingTarget := ""
		if existing.ReactionToMessageID != nil {
			existingTarget = *existing.ReactionToMessageID
		}
		if existing.ConversationID != target.ConversationID ||
			pointerValue(existing.SessionID) != target.SessionID ||
			existing.MessageType != "reaction" ||
			existingTarget != target.ProviderMessageID ||
			existingEmoji != input.Emoji {
			return ReactToMessageResponse{}, fmt.Errorf("%w: clientReactionId already belongs to another reaction", ErrInvalidInput)
		}
		if err := tx.Commit(ctx); err != nil {
			return ReactToMessageResponse{}, err
		}
		return ReactToMessageResponse{
			ClientReactionID:        input.ClientReactionID,
			ConversationID:          target.ConversationID,
			TargetMessageID:         target.MessageID,
			TargetProviderMessageID: target.ProviderMessageID,
			Status:                  existing.Status,
			Reaction:                &existing,
			LeadID:                  target.LeadID,
		}, nil
	}
	if err != nil {
		return ReactToMessageResponse{}, err
	}

	if _, err := tx.Exec(ctx, `
		insert into public.whatsapp_message_reactions (
			organization_id, session_id, conversation_id, target_message_id,
			target_provider_message_id, actor_jid, actor_name, from_me, emoji,
			status, reacted_at, removed_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $6, nullif($7, ''), true, nullif($8, ''),
			$9, now(), case when $9 = 'removed' then now() else null end
		)
		on conflict (organization_id, session_id, target_provider_message_id, actor_jid)
		do update set
			target_message_id = excluded.target_message_id,
			conversation_id = excluded.conversation_id,
			actor_name = coalesce(excluded.actor_name, whatsapp_message_reactions.actor_name),
			from_me = true,
			emoji = excluded.emoji,
			status = excluded.status,
			reacted_at = excluded.reacted_at,
			removed_at = excluded.removed_at,
			updated_at = now()
	`, tenantContext.OrganizationID, target.SessionID, target.ConversationID,
		target.MessageID, target.ProviderMessageID, actorJID, senderName, input.Emoji,
		reactionState); err != nil {
		return ReactToMessageResponse{}, err
	}

	outboxPayload := jsonb(map[string]any{
		"action": "message.react",
		"body": map[string]any{
			// Official Evolution Go ReactStruct fields.
			"number":   target.RemoteJID,
			"id":       target.ProviderMessageID,
			"reaction": input.Emoji,
			"fromMe":   target.TargetFromMe,
			// Kept during the transition for older compatible builds.
			"jid":       target.RemoteJID,
			"messageId": target.ProviderMessageID,
			"emoji":     input.Emoji,
		},
	})
	if _, err := tx.Exec(ctx, `
		insert into public.whatsapp_outbox (
			organization_id, session_id, conversation_id, message_id,
			client_message_id, recipient_jid, message_type, payload,
			provider_message_id, status, next_attempt_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $6, 'reaction', $7::jsonb,
			$8, 'pending', now()
		)
		on conflict (organization_id, session_id, client_message_id) do nothing
	`, tenantContext.OrganizationID, target.SessionID, target.ConversationID,
		reactionRowID, input.ClientReactionID, target.RemoteJID, outboxPayload,
		providerRequestID); err != nil {
		return ReactToMessageResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return ReactToMessageResponse{}, err
	}
	reaction, err := repo.getOutboundMessageByClientID(
		ctx,
		tenantContext.OrganizationID,
		target.SessionID,
		input.ClientReactionID,
	)
	if err != nil {
		return ReactToMessageResponse{}, err
	}

	return ReactToMessageResponse{
		ClientReactionID:        input.ClientReactionID,
		ConversationID:          target.ConversationID,
		TargetMessageID:         target.MessageID,
		TargetProviderMessageID: target.ProviderMessageID,
		Status:                  reaction.Status,
		Reaction:                &reaction,
		LeadID:                  target.LeadID,
	}, nil
}
