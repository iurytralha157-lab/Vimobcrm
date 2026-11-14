package whatsapp

import (
	"context"
	"encoding/json"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

type automationReplyIngress struct {
	Versioned  bool
	Enabled    bool
	Generation string
}

func automationReplyIngressState(payload []byte) automationReplyIngress {
	decoded, err := decodeNativeEvolutionPayload(payload)
	if err != nil {
		return automationReplyIngress{}
	}
	metadata := mapFromAny(decoded[evolutionWebhookRoutingMetaKey])
	versioned, _ := metadata["automation_reply_v2"].(bool)
	generation, _ := normalizeUUID(stringFromAny(metadata["automation_reply_generation"]))
	return automationReplyIngress{Versioned: versioned, Generation: generation}
}

// A configured immutable instance ID is required; the legacy instance-name
// fallback still admits normal WhatsApp traffic. Reload under the session lock
// so a callback authorized before a replacement cannot inherit its identity.
func loadAutomationReplyIngress(ctx context.Context, tx pgx.Tx, session evolutionWebhookSession, envelope evolutionWebhookEnvelope) (automationReplyIngress, error) {
	var versioned bool
	var enabled bool
	err := tx.QueryRow(ctx, `select coalesce(config.activated_at <= clock_timestamp(), false), coalesce(config.enabled, false)
		from (values ($1::uuid, $2::uuid)) as target(organization_id, session_id)
		left join private.whatsapp_automation_reply_sessions config using (organization_id, session_id)
	`, session.OrganizationID, session.ID).Scan(&versioned, &enabled)
	if err != nil || !versioned {
		return automationReplyIngress{}, err
	}
	if session.InstanceID == "" || !strings.EqualFold(firstNonEmpty(envelope.InstanceID, envelope.RouteInstanceID), session.InstanceID) {
		// A missing instance does not authorize V2, but must not fall back to V1
		// if this session has entered versioned processing.
		envelope.InstanceID = ""
		envelope.RouteInstanceID = ""
	}
	state := automationReplyIngress{Versioned: true, Enabled: enabled}
	err = tx.QueryRow(ctx, `
		select case when session.instance_id = nullif($3, '') and session.instance_id is distinct from session.instance_name
		    and session.advanced_settings->>'token' = $4
		    and coalesce(session.advanced_settings->>'webhook_token', '') = $5
		    and session.automation_reply_generation_at <= $6::timestamptz
		    and session.advanced_settings->>'lifecycle_operation_id' is null
		    then session.automation_reply_generation::text else '' end
		from public.whatsapp_sessions session
		where session.organization_id = $1::uuid and session.id = $2::uuid
		for share of session
	`, session.OrganizationID, session.ID, firstNonEmpty(envelope.InstanceID, envelope.RouteInstanceID),
		session.InstanceToken, session.WebhookToken, envelope.ReceivedAt).Scan(&state.Generation)
	return state, err
}

type automationReplyAdmission struct {
	part     evolutionWebhookDurablePart
	snapshot *nativeIngressRoutingSnapshot
	message  nativeEvolutionMessage
}

func prepareAutomationReplyAdmissions(ctx context.Context, tx pgx.Tx, session evolutionWebhookSession, parts []evolutionWebhookDurablePart, ingress automationReplyIngress) ([]automationReplyAdmission, error) {
	if !ingress.Versioned && ingress.Generation == "" {
		return nil, nil
	}
	var candidates []automationReplyAdmission
	for index := range parts {
		part := &parts[index]
		decoded, err := decodeNativeEvolutionPayload(part.Payload)
		if err != nil {
			return nil, err
		}
		metadata := mapFromAny(decoded[evolutionWebhookRoutingMetaKey])
		metadata["automation_reply_v2"] = ingress.Versioned
		metadata["automation_reply_generation"] = ingress.Generation
		part.Payload, err = json.Marshal(decoded)
		if err != nil {
			return nil, err
		}
		if !ingress.Enabled || ingress.Generation == "" || part.ProcessingLane != evolutionWebhookLaneLive {
			continue
		}
		messages := withoutNativeEvolutionEncryptedEditControls(withoutNativeEvolutionHistorySyncControls(extractNativeEvolutionMessages(decoded)))
		for _, message := range withoutNativeWebhookQuarantinedMessages(decoded, withoutNativeEvolutionGroupMessages(messages)) {
			if !canAdmitAutomationReplyMessage(message) || message.IdentityPNConflict {
				continue
			}
			snapshot, err := nativeIngressRoutingSnapshotForMessage(part.Payload, nativeEvolutionSession{ID: session.ID, OrganizationID: session.OrganizationID}, message)
			if err != nil {
				return nil, err
			}
			if snapshot == nil || !canAdmitAutomationReply(*part, snapshot, message) {
				continue
			}
			candidates = append(candidates, automationReplyAdmission{part: *part, snapshot: snapshot, message: message})
		}
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		return candidates[i].snapshot.CurrentLeadID < candidates[j].snapshot.CurrentLeadID
	})
	lockedLead := ""
	for _, candidate := range candidates {
		if candidate.snapshot.CurrentLeadID != lockedLead {
			lockedLead = candidate.snapshot.CurrentLeadID
			if _, err := tx.Exec(ctx, `select private.lock_whatsapp_automation_reply_scope($1::uuid, $2::uuid)`, session.OrganizationID, lockedLead); err != nil {
				return nil, err
			}
		}
	}
	return candidates, nil
}

func canAdmitAutomationReplyMessage(message nativeEvolutionMessage) bool {
	return !message.FromMe && !message.IsGroup && !message.IsReaction && !message.IsDeletion && !message.UnsupportedMessage &&
		!message.ProviderMessageIDSynthetic && !message.ProviderTimestampMissing
}

func canAdmitAutomationReply(part evolutionWebhookDurablePart, snapshot *nativeIngressRoutingSnapshot, message nativeEvolutionMessage) bool {
	message = nativeMessageWithAcceptedIntakePolicy(message, snapshot, nativeInboundRule{})
	if !nativeOrganicRoutingProofMatchesMessage(snapshot, message) || !snapshot.BindingEligible ||
		snapshot.ManagedMessageDistribution || snapshot.ManagedProviderEventPending || snapshot.ManagedProviderEventHandled ||
		snapshot.InboxEventKey != part.EventKey || snapshot.QuarantineReason != "" ||
		snapshot.ConversationID == "" || snapshot.ActiveBindingID == "" || snapshot.CurrentLeadID == "" {
		return false
	}
	return (snapshot.State == "bound" && snapshot.EventLeadID == snapshot.CurrentLeadID) || snapshot.State == "predecessor_inherit"
}

func (candidate automationReplyAdmission) record(ctx context.Context, tx pgx.Tx, session evolutionWebhookSession, generation string) error {
	snapshot := candidate.snapshot
	_, err := tx.Exec(ctx, `
		insert into private.whatsapp_automation_pending_replies (
		  organization_id, session_id, conversation_id, lead_id, binding_id, inbox_id,
		  provider_message_id, account_generation, provider_occurred_at, inbox_accepted_at, hold_until
		)
		select inbox.organization_id, inbox.session_id, binding.conversation_id, binding.lead_id, binding.id, inbox.id,
		  $6, $7::uuid, $8::timestamptz, inbox.created_at, inbox.created_at + interval '30 seconds'
		from public.whatsapp_webhook_inbox inbox
		join public.whatsapp_sessions session on session.id = inbox.session_id and session.organization_id = inbox.organization_id
		  and session.automation_reply_generation = $7::uuid
		join private.whatsapp_automation_reply_sessions config on config.organization_id = inbox.organization_id
		  and config.session_id = inbox.session_id and config.enabled and config.activated_at <= inbox.created_at
		join public.whatsapp_conversation_lead_bindings binding on binding.id = $5::uuid
		  and binding.organization_id = inbox.organization_id and binding.session_id = inbox.session_id
		  and binding.conversation_id = $4::uuid and binding.lead_id = $9::uuid
		  and binding.active_to is null and not binding.stale
		where inbox.organization_id = $1::uuid and inbox.session_id = $2::uuid and inbox.event_key = $3
		  and $8::timestamptz between session.automation_reply_generation_at and inbox.created_at
		  and private.whatsapp_automation_reply_owner_can_capture(inbox.organization_id, inbox.session_id, binding.lead_id, session.owner_user_id)
		  and exists (
		    select 1 from private.whatsapp_automation_reply_starts start
		    left join public.whatsapp_outbox outbox on outbox.id = start.outbox_id
		      and outbox.organization_id = start.organization_id and outbox.session_id = start.session_id
		      and outbox.conversation_id = start.conversation_id and outbox.provider_message_id = start.provider_message_id
		    where start.organization_id = inbox.organization_id and start.session_id = inbox.session_id
		      and start.conversation_id = binding.conversation_id and start.lead_id = binding.lead_id and start.binding_id = binding.id
		      and start.account_generation = session.automation_reply_generation
		      and start.owner_user_id = session.owner_user_id and start.publisher_user_id = session.owner_user_id
		      and start.ingress_cutoff < $10::bigint and start.started_at <= inbox.created_at
		      and ($8::timestamptz >= start.started_at or (start.provider_message_id = $11
		        and $8 = date_trunc('second', $8::timestamptz) and $8 >= date_trunc('second', start.started_at)))
		      and (start.accepted_at is not null or (outbox.status = 'processing' and outbox.last_error = $12)
		        or (outbox.status = 'dead' and outbox.last_error = $13))
		  )
		on conflict (organization_id, session_id, provider_message_id) do nothing
	`, session.OrganizationID, session.ID, candidate.part.EventKey, snapshot.ConversationID, snapshot.ActiveBindingID,
		candidate.message.ProviderMessageID, generation, candidate.message.SentAt, snapshot.CurrentLeadID,
		snapshot.IngressSequence, candidate.message.QuotedMessageID, whatsappOutboxProviderStartedMarker, whatsappOutboxProviderUnknownMarker)
	return err
}
