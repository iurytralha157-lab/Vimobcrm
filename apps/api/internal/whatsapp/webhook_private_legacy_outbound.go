package whatsapp

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
)

const nativePrivateLegacyOutboundMarker = "lead_match_legacy_outbound_private_v1"

func nativePrivateLegacyOutboundEligible(message nativeEvolutionMessage, snapshot *nativeIngressRoutingSnapshot) bool {
	info := nativeFirstMap(message.Raw, "Info", "info")
	peerPN := whatsAppContactPNKey(firstString(info, "RecipientAlt", "recipientAlt"))
	return snapshot != nil && len(snapshot.RawSnapshot) > 0 && !snapshot.BindingEligible &&
		snapshot.State == "lead_match" && snapshot.TargetMode == "snapshot" &&
		snapshot.ProviderMessageID == message.ProviderMessageID && snapshot.IngressSequence > 0 &&
		snapshot.RoutingKey != "" && snapshot.RoutingKey != evolutionWebhookSessionRoute &&
		snapshot.ConversationID != "" && snapshot.EventLeadID != "" &&
		snapshot.CurrentLeadID == "" && snapshot.ActiveBindingID == "" &&
		snapshot.UnlinkedCapturePolicy == "" && snapshot.QuarantineReason == "" &&
		!snapshot.ManagedMessageDistribution && !snapshot.ManagedProviderEventPending && !snapshot.ManagedProviderEventHandled &&
		nativeOrganicRoutingProofMatchesMessage(snapshot, message) &&
		message.FromMe && !message.IsGroup && !message.IsReaction && !message.IsDeletion &&
		!message.UnsupportedID && !message.UnsupportedMessage && !message.IdentityPNConflict &&
		!message.ProviderMessageIDSynthetic && !message.ProviderTimestampMissing && !message.SentAt.IsZero() &&
		strings.HasSuffix(normalizeRemoteAlias(firstString(info, "Chat", "chat")), "@lid") &&
		peerPN != "" && peerPN == whatsAppContactPNKey(message.RemoteJID) && peerPN == whatsAppContactPNKey(message.ContactPhone)
}

func ensureNativePrivateLegacyOutboundConversation(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession,
	message nativeEvolutionMessage, stored nativeEvolutionStoredMessageIdentity, snapshot *nativeIngressRoutingSnapshot,
) (nativeEvolutionConversation, bool, error) {
	if stored.ID != "" {
		if stored.PrivateCollisionKind != nativePrivateLegacyOutboundMarker {
			return nativeEvolutionConversation{}, false, nil
		}
		if !nativePrivateLegacyOutboundEligible(message, snapshot) {
			return nativeEvolutionConversation{}, false, ErrConversationBindingChanged
		}
	}
	if !nativePrivateLegacyOutboundEligible(message, snapshot) ||
		(stored.ID == "" && (!session.privateLegacyOutboundEnabled || session.OwnerUserID == "")) {
		return nativeEvolutionConversation{}, false, nil
	}
	var conversation nativeEvolutionConversation
	err := tx.QueryRow(ctx, `select conversation.id::text,coalesce(conversation.lead_id::text,''),conversation.remote_jid
	 from public.whatsapp_conversations conversation
	 join public.whatsapp_webhook_routing_snapshots route on route.organization_id=conversation.organization_id
	  and route.session_id=conversation.session_id and route.provider_message_id=$3 and route.snapshot=$4::jsonb
	 join public.whatsapp_webhook_inbox inbox on inbox.organization_id=route.organization_id
	  and inbox.session_id=route.session_id and inbox.processing_epoch=route.processing_epoch and inbox.event_key=route.inbox_event_key
	 left join private.whatsapp_webhook_session_cutovers cutover on cutover.session_id=route.session_id
	 where conversation.organization_id=$1::uuid and conversation.session_id=$2::uuid and conversation.id=$5::uuid
	  and route.processing_epoch=coalesce(cutover.active_epoch,0) and inbox.status='processing'
	  and inbox.locked_by=$8 and inbox.edge_execution_id is null
	  and exists(select 1 from jsonb_array_elements(inbox.payload#>'{__vimob_ingress,routing_snapshot,messages}') current_route(snapshot)
	   where current_route.snapshot=route.snapshot)
	  and (($6<>'' and exists(select 1 from public.whatsapp_messages message
	   where message.organization_id=conversation.organization_id and message.session_id=conversation.session_id
	    and message.conversation_id=conversation.id and message.id=nullif($6,'')::uuid and message.provider_message_id=$3
	    and message.lead_id is null and message.capture_state='unlinked_ephemeral' and message.unlinked_retention_scrubbed_at is null
	    and message.from_me=true and message.direction='outbound' and message.metadata#>>'{private_collision_route,kind}'=$9
	    and message.metadata#>>'{private_collision_route,snapshot_md5}'=md5(route.snapshot::text)))
	  or ($6='' and conversation.lead_id is null and conversation.deleted_at is null and conversation.retired_at is null
	   and not conversation.unlinked_retention_v1 and conversation.is_group is not true
	   and not exists(select 1 from public.whatsapp_conversation_lead_bindings binding
	    where binding.organization_id=conversation.organization_id and binding.conversation_id=conversation.id and binding.active_to is null)
	   and exists(select 1 from public.whatsapp_messages history
	    where history.organization_id=conversation.organization_id and history.session_id=conversation.session_id
	     and history.conversation_id=conversation.id and history.lead_id is null and history.capture_state='unlinked_ephemeral'
	     and history.unlinked_retention_scrubbed_at is null and nullif(history.provider_message_id,'') is not null)
	   and exists(select 1 from public.whatsapp_conversations occupied
	    join public.leads matched on matched.organization_id=occupied.organization_id and matched.id=occupied.lead_id
	    join public.users owner_user on owner_user.id=matched.assigned_user_id and coalesce(owner_user.is_active,false)
	    join public.organization_members owner_member on owner_member.user_id=owner_user.id and owner_member.organization_id=occupied.organization_id
	     and coalesce(owner_member.is_active,false) and owner_member.deleted_at is null
	    where occupied.organization_id=conversation.organization_id and occupied.session_id=conversation.session_id
	     and occupied.id<>conversation.id and occupied.lead_id=nullif(route.snapshot->>'event_lead_id','')::uuid
	     and matched.assigned_user_id=nullif($7,'')::uuid
	     and occupied.deleted_at is null and occupied.retired_at is null and occupied.is_group is not true)))
	 for update of conversation`, session.OrganizationID, session.ID, message.ProviderMessageID, string(snapshot.RawSnapshot),
		snapshot.ConversationID, stored.ID, session.OwnerUserID, whatsappWebhookWorkerID, nativePrivateLegacyOutboundMarker).
		Scan(&conversation.ID, &conversation.LeadID, &conversation.RemoteJID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nativeEvolutionConversation{}, false, ErrConversationBindingChanged
	}
	if err != nil {
		return nativeEvolutionConversation{}, false, err
	}
	if whatsAppContactPNKey(message.RemoteJID) != whatsAppContactPNKey(conversation.RemoteJID) {
		return nativeEvolutionConversation{}, false, errNativeStoredContactPNConflict
	}
	if stored.ID == "" {
		// Observe only external echoes; CRM sends retain their existing reconciliation.
		if err := lockNativeOutboundOutbox(ctx, tx, session, message.ProviderMessageID); err != nil {
			return nativeEvolutionConversation{}, false, err
		}
		if managed, err := nativeOutboundManagedByCRM(ctx, tx, session, conversation.ID, message.ProviderMessageID); err != nil || managed {
			if managed {
				err = ErrConversationBindingChanged
			}
			return nativeEvolutionConversation{}, false, err
		}
	}
	if conflict, err := nativeStoredContactPNConflict(ctx, tx, session, message, conversation.ID); err != nil || conflict {
		if conflict {
			err = errNativeStoredContactPNConflict
		}
		return nativeEvolutionConversation{}, false, err
	}
	conversation.PrivateCollisionRoute = true
	conversation.PrivateCollisionKind = nativePrivateLegacyOutboundMarker
	conversation.HistoricalBindingReplay = strings.TrimSpace(conversation.LeadID) != ""
	return conversation, true, nil
}
