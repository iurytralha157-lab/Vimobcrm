package whatsapp

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// The caller holds the canonical automation send fence and has started the
// exact outbox attempt. Proof belongs to the publisher who owns this session;
// a delegated publisher continues using the existing conversation permissions.
func recordWhatsAppAutomationReplyStart(ctx context.Context, tx pgx.Tx, item pendingWhatsAppOutbox) error {
	_, err := tx.Exec(ctx, `
		insert into private.whatsapp_automation_reply_starts as start (
		  outbox_id, organization_id, session_id, conversation_id, lead_id, binding_id,
		  publisher_user_id, owner_user_id, provider_message_id, started_at, ingress_cutoff
		)
		select outbox.id, message.organization_id, message.session_id, message.conversation_id,
		       message.lead_id, binding.id, message.sender_user_id, session.owner_user_id,
		       outbox.provider_message_id, clock_timestamp(),
		       (select case when is_called then last_value::bigint else 0::bigint end
		        from public.whatsapp_webhook_routing_ingress_sequence)
		from public.whatsapp_outbox outbox
		join public.whatsapp_messages message
		  on message.id = outbox.message_id
		 and message.organization_id = outbox.organization_id
		 and message.session_id = outbox.session_id
		 and message.conversation_id = outbox.conversation_id
		 and message.provider_message_id = outbox.provider_message_id
		join public.whatsapp_sessions session
		  on session.id = message.session_id
		 and session.organization_id = message.organization_id
		 and session.owner_user_id = message.sender_user_id
		join public.whatsapp_conversation_lead_bindings binding
		  on binding.id::text = message.metadata->>'automation_binding_id'
		 and binding.organization_id = message.organization_id
		 and binding.session_id = message.session_id
		 and binding.conversation_id = message.conversation_id
		 and binding.lead_id = message.lead_id
		 and binding.active_to is null and not binding.stale
		where outbox.id = $1::uuid
		  and outbox.organization_id = $2::uuid
		  and outbox.session_id = $3::uuid
		  and outbox.conversation_id = $4::uuid
		  and outbox.status = 'processing' and outbox.locked_by = $5
		  and outbox.last_error = $6
		  and nullif(btrim(outbox.provider_message_id), '') is not null
		  and message.metadata->>'automation_delivery_policy' = $7
		  and not exists (
		    select 1 from private.whatsapp_automation_reply_starts accepted
		    where accepted.organization_id = binding.organization_id
		      and accepted.session_id = binding.session_id
		      and accepted.conversation_id = binding.conversation_id
		      and accepted.lead_id = binding.lead_id
		      and accepted.binding_id = binding.id
		      and accepted.publisher_user_id = message.sender_user_id
		      and accepted.owner_user_id = session.owner_user_id
		      and accepted.accepted_at is not null
		  )
		on conflict (outbox_id) do update
		set started_at = excluded.started_at,
		    ingress_cutoff = excluded.ingress_cutoff
		where start.accepted_at is null
		  and start.organization_id = excluded.organization_id
		  and start.session_id = excluded.session_id
		  and start.conversation_id = excluded.conversation_id
		  and start.lead_id = excluded.lead_id
		  and start.binding_id = excluded.binding_id
		  and start.publisher_user_id = excluded.publisher_user_id
		  and start.owner_user_id = excluded.owner_user_id
		  and start.provider_message_id = excluded.provider_message_id
	`, item.ID, item.OrganizationID, item.SessionID, item.ConversationID, item.LeaseToken,
		whatsappOutboxProviderStartedMarker, whatsappAutomationOutboxPolicy)
	return err
}

// Called only after the exact outbox has acquired trustworthy provider success.
// Persist that evidence before terminal outbox retention can remove the row.
func acceptWhatsAppAutomationReplyStart(
	ctx context.Context,
	tx pgx.Tx,
	organizationID, sessionID, conversationID, outboxID, providerMessageID string,
) error {
	if providerMessageID == "" {
		return nil
	}
	_, err := tx.Exec(ctx, `
		update private.whatsapp_automation_reply_starts
		set accepted_at = greatest(clock_timestamp(), started_at)
		where outbox_id = $1::uuid
		  and organization_id = $2::uuid
		  and session_id = $3::uuid
		  and conversation_id = $4::uuid
		  and provider_message_id = $5
		  and accepted_at is null
	`, outboxID, organizationID, sessionID, conversationID, providerMessageID)
	return err
}
