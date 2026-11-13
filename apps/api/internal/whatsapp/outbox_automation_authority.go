package whatsapp

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
)

// A partial or unknown marker must never fall back to attendance authority.
const whatsappAutomationOutboxPolicyPresent = `message.metadata ?| array[
	'automation_delivery_policy', 'automation_binding_id', 'automation_flow_version_id'
]`

const whatsappAutomationOutboxPolicy = "tenant_session_v1"

// The policy marker selects the validation path. The committed dispatch,
// outbox, execution and immutable version establish authority and identity.
// This query uses the pre-release schema, so an API rollout can precede the SQL.
func whatsappAutomationOutboxPublisher(ctx context.Context, queryer whatsappQueryRower, item pendingWhatsAppOutbox, lock bool) (string, error) {
	queuedPayload, err := json.Marshal(item.Payload)
	if err != nil {
		return "", err
	}
	query := `
		select flow.created_by::text
		from public.whatsapp_messages as message
		join public.whatsapp_conversations as conversation
		  on conversation.id = message.conversation_id
		 and conversation.organization_id = message.organization_id
		 and conversation.session_id = message.session_id
		 and conversation.lead_id = message.lead_id
		 and conversation.deleted_at is null
		 and conversation.retired_at is null
		 and not coalesce(conversation.is_group, false)
		join public.whatsapp_conversation_lead_bindings as binding
		  on binding.organization_id = message.organization_id
		 and binding.conversation_id = message.conversation_id
		 and binding.session_id = message.session_id
		 and binding.lead_id = message.lead_id
		 and binding.id::text = message.metadata->>'automation_binding_id'
		 and binding.active_to is null and not binding.stale
		join public.automation_executions as execution
		  on execution.organization_id = message.organization_id
		 and execution.conversation_id = message.conversation_id
		 and execution.lead_id = message.lead_id
		 and execution.id::text = message.metadata->>'execution_id'
		 and execution.cancellation_requested_at is null
		 and execution.status not in ('cancelled', 'canceled')
		join public.automation_flow_versions as flow
		  on flow.id = execution.flow_version_id
		 and flow.organization_id = execution.organization_id
		 and flow.automation_id = execution.automation_id
		 and flow.id::text = message.metadata->>'automation_flow_version_id'
		 and flow.created_by = message.sender_user_id
		join public.automation_effect_dispatches as dispatch
		  on dispatch.effect_key = message.client_message_id
		 and dispatch.effect_key = message.metadata->>'automation_effect_key'
		 and dispatch.organization_id = message.organization_id
		 and dispatch.execution_id = execution.id
		 and dispatch.node_key = message.metadata->>'node_key'
		 and dispatch.effect_type = case message.message_type
		   when 'text' then 'send_whatsapp' when 'image' then 'send_image'
		   when 'audio' then 'send_audio' when 'video' then 'send_video' end
		 and dispatch.status = 'succeeded'
		 and dispatch.request->>'delivery_contract' = 'canonical_whatsapp_outbox_v1'
		 and dispatch.request->>'session_id' = message.session_id::text
		 and dispatch.response->>'delivery' = 'outbox'
		 and dispatch.response->>'message_id' = message.id::text
		join public.whatsapp_outbox as outbox
		  on outbox.id = $5::uuid
		 and outbox.id::text = dispatch.response->>'outbox_id'
		 and outbox.message_id = message.id
		 and outbox.organization_id = message.organization_id
		 and outbox.session_id = message.session_id
		 and outbox.conversation_id = message.conversation_id
		 and outbox.client_message_id = message.client_message_id
		 and outbox.client_message_id = $9
		 and outbox.message_type = message.message_type
		 and outbox.recipient_jid = message.remote_jid
		 and outbox.recipient_jid = (outbox.payload#>>'{body,number}') || '@s.whatsapp.net'
		 and outbox.provider_message_id = message.provider_message_id
		 and outbox.payload = $6::jsonb
		 and outbox.status = 'processing' and outbox.locked_by = $7
		where message.id = $1::uuid
		  and message.organization_id = $2::uuid
		  and message.session_id = $3::uuid
		  and message.conversation_id = $4::uuid
		  and message.metadata->>'automation_delivery_policy' = $8
		  and message.metadata->>'origin' = 'automation'
		  and coalesce(message.metadata->>'attendance_send_origin', '') = ''
		  and message.metadata->>'delivery' = 'outbox'
		  and coalesce(message.metadata->>'outbound_media_source_message_id', '') = ''
		  and coalesce(message.metadata->>'outbound_media_source_path', '') = ''
		  and message.remote_jid ~ '^[0-9]{10,15}@s[.]whatsapp[.]net$'
		  and message.from_me and message.direction = 'outbound'
		  and message.capture_state = 'captured'
		  and exists (
		    select 1 from jsonb_array_elements(case when jsonb_typeof(flow.graph->'nodes') = 'array'
		      then flow.graph->'nodes' else '[]'::jsonb end) as node(value)
		    where node.value->>'id' = dispatch.node_key
		      and node.value->>'type' = 'action'
		      and node.value->>'action_type' = dispatch.effect_type
		      and lower(node.value#>>'{config,session_id}') = message.session_id::text
		  )`
	if lock {
		query += ` for share of binding, execution, dispatch`
	}
	var publisherID string
	err = queryer.QueryRow(ctx, query, item.MessageRowID, item.OrganizationID, item.SessionID,
		item.ConversationID, item.ID, queuedPayload, item.LeaseToken, whatsappAutomationOutboxPolicy, item.ClientMessageID).Scan(&publisherID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrSessionAccessRevoked
	}
	return publisherID, err
}

// Called after the publisher, owner, session, conversation and lead are
// locked. The same authority predicate as enqueue sees any revocation that
// committed while those locks were acquired.
func lockWhatsAppAutomationOutboxForStart(ctx context.Context, tx pgx.Tx, item pendingWhatsAppOutbox, ownerID, publisherID, leadID string) error {
	if err := lockWhatsAppOutboxEligibilityRow(ctx, tx, `
		select organization_id::text from public.organization_modules
		where organization_id = $1::uuid and lower(trim(module_name)) = 'automations' and is_enabled = true
		for share
	`, item.OrganizationID); err != nil {
		return err
	}
	if publisherID != ownerID {
		if err := lockWhatsAppOutboxEligibilityRow(ctx, tx, `
			select id::text from public.whatsapp_session_access
			where organization_id = $1::uuid and session_id = $2::uuid
			  and user_id = $3::uuid and granted_by = $4::uuid
			for share
		`, item.OrganizationID, item.SessionID, publisherID, ownerID); err != nil {
			return err
		}
	}
	currentPublisherID, err := whatsappAutomationOutboxPublisher(ctx, tx, item, true)
	if err != nil {
		return err
	}
	if currentPublisherID != publisherID {
		return ErrSessionAccessRevoked
	}
	var allowed bool
	if err := tx.QueryRow(ctx, `select private.automation_whatsapp_session_can_send($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
		item.OrganizationID, item.SessionID, leadID, publisherID).Scan(&allowed); err != nil {
		return err
	}
	if !allowed {
		return ErrSessionAccessRevoked
	}
	return nil
}
