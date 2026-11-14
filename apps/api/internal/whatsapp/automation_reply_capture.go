package whatsapp

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

const automationReplyConfirmationWindow = 30 * time.Second

var errAutomationReplyConfirmationPending = errors.New("WhatsApp automation reply waiting for provider confirmation")

// The owner started this exact conversation through a verified automated send.
// Proof is read only during first capture, never when replaying a stored message.
func automationReplyCaptureForEvent(
	ctx context.Context,
	queryer whatsappQueryRower,
	session nativeEvolutionSession,
	conversation nativeEvolutionConversation,
	item pendingEvolutionWebhook,
	providerOccurredAt time.Time,
	ingressSequence int64,
) (bool, error) {
	if ingressSequence <= 0 || !attendanceEventTimesValid(providerOccurredAt, item.CreatedAt) {
		return false, nil
	}

	var accepted, pending bool
	err := queryer.QueryRow(ctx, `
		with eligible as materialized (
		  select start.outbox_id, start.provider_message_id, start.accepted_at
		  from private.whatsapp_automation_reply_starts start
		  join public.whatsapp_sessions account on account.id = start.session_id
		   and account.organization_id = start.organization_id
		  join public.whatsapp_conversation_lead_bindings binding
		    on binding.id = start.binding_id and binding.organization_id = start.organization_id
		   and binding.session_id = start.session_id and binding.conversation_id = start.conversation_id
		   and binding.lead_id = start.lead_id and binding.active_to is null and not binding.stale
		  where start.organization_id = $1::uuid and start.session_id = $2::uuid
		    and start.conversation_id = $3::uuid and start.lead_id = $4::uuid and start.binding_id = $5::uuid
		    and start.owner_user_id = $6::uuid and start.publisher_user_id = $6::uuid
		    and start.started_at <= $7::timestamptz
		    and $8::timestamptz >= start.started_at
		    and start.ingress_cutoff < $9::bigint
		    and coalesce(start.account_generation, '00000000-0000-0000-0000-000000000000'::uuid) = account.automation_reply_generation
		    and private.whatsapp_automation_reply_owner_can_capture($1::uuid, $2::uuid, $4::uuid, start.publisher_user_id)
		)
		select
		  exists (select 1 from eligible where accepted_at is not null)
		  or exists (
		    select 1 from eligible join public.whatsapp_outbox outbox on outbox.id = eligible.outbox_id
		      and outbox.organization_id = $1::uuid and outbox.session_id = $2::uuid
		      and outbox.conversation_id = $3::uuid and outbox.provider_message_id = eligible.provider_message_id
		    where outbox.status in ('sent', 'delivered', 'read')
		       or (outbox.status in ('processing', 'retry') and outbox.last_error = $10)
		  ),
		  $11::boolean and clock_timestamp() < $7::timestamptz + make_interval(secs => $12::int)
		  and exists (
		    select 1 from eligible join public.whatsapp_outbox outbox on outbox.id = eligible.outbox_id
		      and outbox.organization_id = $1::uuid and outbox.session_id = $2::uuid
		      and outbox.conversation_id = $3::uuid and outbox.provider_message_id = eligible.provider_message_id
		    where eligible.accepted_at is null and (
		      (outbox.status = 'processing' and outbox.last_error = $13)
		      or (outbox.status = 'dead' and outbox.last_error = $14)
		    )
		  )
	`, session.OrganizationID, session.ID, conversation.ID, conversation.LeadID, conversation.ActiveBindingID,
		session.OwnerUserID, item.CreatedAt, providerOccurredAt, ingressSequence, whatsappOutboxProviderAcceptedMarker,
		item.Attempts < item.MaxAttempts, int(automationReplyConfirmationWindow/time.Second),
		whatsappOutboxProviderStartedMarker, whatsappOutboxProviderUnknownMarker).Scan(&accepted, &pending)
	if err != nil {
		return false, err
	}
	if !accepted && pending {
		// Let the normal durable retry release the conversation lock so the send
		// can finalize. Later attempts check acceptance before the wait deadline.
		return false, errAutomationReplyConfirmationPending
	}
	return accepted, nil
}

func canCheckAutomationReplyCapture(
	conversation nativeEvolutionConversation,
	message nativeEvolutionMessage,
	snapshot *nativeIngressRoutingSnapshot,
	inheritedBindingProven bool,
) bool {
	if !nativeOrganicRoutingProofMatchesMessage(snapshot, message) || message.FromMe || message.IsGroup ||
		message.IsReaction || message.IsDeletion || nativeCTWAIntakeEligible(message) || message.ProviderMessageIDSynthetic ||
		message.UnsupportedMessage || message.IdentityPNConflict || conversation.RetentionClosed ||
		conversation.HistoricalBindingReplay || conversation.LeadScopeCompatibilityFallback ||
		conversation.LeadResolutionQuarantineReason != "" || snapshot.QuarantineReason != "" ||
		snapshot.ManagedMessageDistribution || snapshot.ManagedProviderEventPending || snapshot.ManagedProviderEventHandled ||
		!snapshot.BindingEligible || snapshot.ProviderMessageID != message.ProviderMessageID ||
		conversation.LeadID == "" || conversation.ActiveBindingID == "" ||
		nativeEvolutionMessageLeadID(conversation) != conversation.LeadID {
		return false
	}
	if inheritedBindingProven {
		return true
	}
	return snapshot.State == "bound" && snapshot.TargetMode == "snapshot" &&
		snapshot.ConversationID == conversation.ID && snapshot.ActiveBindingID == conversation.ActiveBindingID &&
		snapshot.EventLeadID == conversation.LeadID && snapshot.CurrentLeadID == conversation.LeadID
}

// A provider echo with second precision establishes the latest possible send
// time at the end of that second. A fine-grained timestamp keeps its precision.
func automationReplyProviderUpperBound(occurredAt time.Time) time.Time {
	if occurredAt.Nanosecond() == 0 {
		return occurredAt.Add(time.Second)
	}
	return occurredAt
}

func automationReplyCaptureV2(
	ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, conversation nativeEvolutionConversation,
	item pendingEvolutionWebhook, message nativeEvolutionMessage, ingressSequence int64,
) (bool, error) {
	var accepted, pending bool
	err := tx.QueryRow(ctx, `
		select coalesce(bool_or(start.accepted_at is not null and start.account_confirmation and (
		    candidate.provider_occurred_at >= least(start.accepted_at, start.provider_sent_before)
		    or start.provider_message_id = $8
		  )), false),
		  coalesce(bool_or(clock_timestamp() < candidate.hold_until and (
		    (start.accepted_at is null and ((outbox.status = 'processing' and outbox.last_error = $10)
		      or (outbox.status = 'dead' and outbox.last_error = $11)))
		    or (start.accepted_at is not null and (not start.account_confirmation or (start.provider_sent_before is null
		      and candidate.provider_occurred_at < start.accepted_at)))
		  )), false)
		from private.whatsapp_automation_pending_replies candidate
		join public.whatsapp_sessions session on session.id = candidate.session_id
		  and session.organization_id = candidate.organization_id
		  and session.automation_reply_generation = candidate.account_generation
		join public.whatsapp_conversation_lead_bindings binding on binding.id = candidate.binding_id
		  and binding.organization_id = candidate.organization_id and binding.session_id = candidate.session_id
		  and binding.conversation_id = candidate.conversation_id and binding.lead_id = candidate.lead_id
		  and binding.active_to is null and not binding.stale
		join private.whatsapp_automation_reply_starts start on start.organization_id = candidate.organization_id
		  and start.session_id = candidate.session_id and start.conversation_id = candidate.conversation_id
		  and start.lead_id = candidate.lead_id and start.binding_id = candidate.binding_id
		  and start.account_generation = candidate.account_generation
		  and start.owner_user_id = session.owner_user_id and start.publisher_user_id = session.owner_user_id
		  and start.ingress_cutoff < $9::bigint and start.started_at <= candidate.inbox_accepted_at
		  and (candidate.provider_occurred_at >= start.started_at or (start.provider_message_id = $8
		    and candidate.provider_occurred_at = date_trunc('second', candidate.provider_occurred_at)
		    and candidate.provider_occurred_at >= date_trunc('second', start.started_at)))
		left join public.whatsapp_outbox outbox on outbox.id = start.outbox_id
		  and outbox.organization_id = start.organization_id and outbox.session_id = start.session_id
		  and outbox.conversation_id = start.conversation_id and outbox.provider_message_id = start.provider_message_id
		where candidate.organization_id = $1::uuid and candidate.session_id = $2::uuid
		  and candidate.conversation_id = $3::uuid and candidate.lead_id = $4::uuid
		  and candidate.binding_id = $5::uuid and candidate.inbox_id = $6::uuid and candidate.provider_message_id = $7
		  and private.whatsapp_automation_reply_owner_can_capture($1::uuid, $2::uuid, $4::uuid, session.owner_user_id)
	`, session.OrganizationID, session.ID, conversation.ID, conversation.LeadID, conversation.ActiveBindingID,
		item.ID, message.ProviderMessageID, message.QuotedMessageID, ingressSequence,
		whatsappOutboxProviderStartedMarker, whatsappOutboxProviderUnknownMarker).Scan(&accepted, &pending)
	if err == nil && !accepted && pending && item.Attempts < item.MaxAttempts {
		return false, errAutomationReplyConfirmationPending
	}
	return accepted, err
}

func clearAutomationReplyCandidates(ctx context.Context, tx pgx.Tx, item pendingEvolutionWebhook) error {
	_, err := tx.Exec(ctx, `delete from private.whatsapp_automation_pending_replies
		where organization_id = $1::uuid and session_id = $2::uuid and inbox_id = $3::uuid`, item.OrganizationID, item.SessionID, item.ID)
	return err
}
