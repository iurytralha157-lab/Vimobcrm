package whatsapp

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
)

// The original route stays private when another physical thread already owns
// its matched lead. Its canonical message is the proof used by exact successors.
const nativePrivateCollisionMarker = "lead_match_collision_v1"

func nativePrivateCollisionEligible(message nativeEvolutionMessage, snapshot *nativeIngressRoutingSnapshot) bool {
	return snapshot != nil && len(snapshot.RawSnapshot) > 0 && snapshot.BindingEligible &&
		snapshot.ProviderMessageID == message.ProviderMessageID && snapshot.IngressSequence > 0 &&
		snapshot.RoutingKey != "" && snapshot.RoutingKey != evolutionWebhookSessionRoute &&
		snapshot.UnlinkedCapturePolicy == "" && snapshot.QuarantineReason == "" &&
		snapshot.CurrentLeadID == "" && snapshot.ActiveBindingID == "" &&
		!snapshot.ManagedMessageDistribution && !snapshot.ManagedProviderEventPending && !snapshot.ManagedProviderEventHandled &&
		nativeOrganicRoutingProofMatchesMessage(snapshot, message) &&
		!message.FromMe && !message.IsGroup && !message.IsReaction && !message.IsDeletion &&
		!message.UnsupportedMessage && !message.ProviderMessageIDSynthetic && !message.ProviderTimestampMissing &&
		!message.SentAt.IsZero() && whatsAppContactPNKey(message.RemoteJID) != "" &&
		((snapshot.State == "lead_match" && snapshot.TargetMode == "snapshot" && snapshot.EventLeadID != "" && snapshot.ConversationID != "") ||
			(snapshot.State == "predecessor_inherit" && snapshot.TargetMode == "inherit_predecessor"))
}

func ensureNativePrivateCollisionConversation(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession,
	message nativeEvolutionMessage, stored nativeEvolutionStoredMessageIdentity, snapshot *nativeIngressRoutingSnapshot,
) (nativeEvolutionConversation, bool, error) {
	if !nativePrivateCollisionEligible(message, snapshot) {
		return nativeEvolutionConversation{}, false, nil
	}
	if stored.ID == "" && snapshot.TargetMode == "snapshot" && !session.privateCollisionCaptureEnabled {
		return nativeEvolutionConversation{}, false, nil
	}
	var canonical bool
	if err := tx.QueryRow(ctx, `select exists (
		select 1 from public.whatsapp_webhook_routing_snapshots route
		join public.whatsapp_webhook_inbox inbox on inbox.organization_id=route.organization_id
		 and inbox.session_id=route.session_id and inbox.processing_epoch=route.processing_epoch
		 and inbox.event_key=route.inbox_event_key
		left join private.whatsapp_webhook_session_cutovers cutover on cutover.session_id=route.session_id
		where route.organization_id=$1::uuid and route.session_id=$2::uuid and route.provider_message_id=$3
		 and route.snapshot=$4::jsonb and route.processing_epoch=coalesce(cutover.active_epoch,0)
		 and inbox.status='processing' and inbox.locked_by=$5 and inbox.edge_execution_id is null
		 and exists(select 1 from jsonb_array_elements(inbox.payload#>'{__vimob_ingress,routing_snapshot,messages}') current_route(snapshot)
		   where current_route.snapshot=route.snapshot)
	)`, session.OrganizationID, session.ID, message.ProviderMessageID, string(snapshot.RawSnapshot), whatsappWebhookWorkerID).Scan(&canonical); err != nil {
		return nativeEvolutionConversation{}, false, err
	}
	if !canonical {
		return nativeEvolutionConversation{}, false, errors.New("WhatsApp private collision lost its immutable active inbox scope")
	}

	var conversation nativeEvolutionConversation
	privateReady := true
	var err error
	if stored.ID != "" {
		// A retry retains its original private decision after a later manual link.
		err = tx.QueryRow(ctx, `select conversation.id::text,coalesce(conversation.lead_id::text,''),conversation.remote_jid
		 from public.whatsapp_messages message
		 join public.whatsapp_conversations conversation on conversation.organization_id=message.organization_id
		  and conversation.session_id=message.session_id and conversation.id=message.conversation_id
		 join public.whatsapp_webhook_routing_snapshots route on route.organization_id=message.organization_id
		  and route.session_id=message.session_id and route.provider_message_id=message.provider_message_id
		 where message.organization_id=$1::uuid and message.session_id=$2::uuid and message.id=$3::uuid
		  and message.provider_message_id=$4 and message.lead_id is null and message.capture_state='unlinked_ephemeral'
		  and message.from_me=false and message.direction='inbound'
		  and route.snapshot=$5::jsonb
		  and message.metadata#>>'{private_collision_route,kind}'=$6
		  and message.metadata#>>'{private_collision_route,snapshot_md5}'=md5(route.snapshot::text)
		 for update of conversation`, session.OrganizationID, session.ID, stored.ID, message.ProviderMessageID,
			string(snapshot.RawSnapshot), nativePrivateCollisionMarker).Scan(&conversation.ID, &conversation.LeadID, &conversation.RemoteJID)
	} else if snapshot.TargetMode == "snapshot" {
		err = tx.QueryRow(ctx, `select conversation.id::text,''::text,conversation.remote_jid
		 from public.whatsapp_conversations conversation
		 where conversation.organization_id=$1::uuid and conversation.session_id=$2::uuid and conversation.id=$3::uuid
		  and conversation.lead_id is null and conversation.deleted_at is null and conversation.retired_at is null
		  and not conversation.unlinked_retention_v1 and conversation.is_group is not true
		  and not exists(select 1 from public.whatsapp_conversation_lead_bindings binding
		    where binding.organization_id=conversation.organization_id and binding.conversation_id=conversation.id and binding.active_to is null)
		  and exists(select 1 from public.whatsapp_conversations occupied
		    join public.leads matched on matched.organization_id=occupied.organization_id and matched.id=occupied.lead_id
		    where occupied.organization_id=conversation.organization_id and occupied.session_id=conversation.session_id
		     and occupied.id<>conversation.id and occupied.lead_id=$4::uuid
		     and matched.assigned_user_id=$5::uuid
		     and occupied.deleted_at is null and occupied.retired_at is null and occupied.is_group is not true)
		 for update of conversation`, session.OrganizationID, session.ID, snapshot.ConversationID, snapshot.EventLeadID, session.OwnerUserID).
			Scan(&conversation.ID, &conversation.LeadID, &conversation.RemoteJID)
	} else {
		err = tx.QueryRow(ctx, `select conversation.id::text,coalesce(conversation.lead_id::text,''),conversation.remote_jid,
		 (conversation.lead_id is null and conversation.deleted_at is null and conversation.retired_at is null
		  and not conversation.unlinked_retention_v1 and conversation.is_group is not true
		  and not exists(select 1 from public.whatsapp_conversation_lead_bindings binding
		    where binding.organization_id=conversation.organization_id and binding.conversation_id=conversation.id
		     and (binding.active_to is null or binding.created_at>=message.created_at)))
		 from public.whatsapp_webhook_routing_snapshots current_route
		 join public.whatsapp_webhook_routing_snapshots predecessor on predecessor.organization_id=current_route.organization_id
		  and predecessor.session_id=current_route.session_id and predecessor.provider_message_id=current_route.predecessor_provider_message_id
		  and predecessor.processing_epoch=current_route.processing_epoch and predecessor.routing_key=current_route.routing_key
		  and predecessor.ingress_sequence<current_route.ingress_sequence
		 join public.whatsapp_webhook_routing_outcomes outcome on outcome.organization_id=predecessor.organization_id
		  and outcome.session_id=predecessor.session_id and outcome.provider_message_id=predecessor.provider_message_id
		  and outcome.ingress_sequence=predecessor.ingress_sequence
		 join public.whatsapp_messages message on message.organization_id=predecessor.organization_id
		  and message.session_id=predecessor.session_id and message.provider_message_id=predecessor.provider_message_id
		 join public.whatsapp_conversations conversation on conversation.organization_id=message.organization_id
		  and conversation.session_id=message.session_id and conversation.id=message.conversation_id
		 where current_route.organization_id=$1::uuid and current_route.session_id=$2::uuid and current_route.provider_message_id=$3
		  and current_route.snapshot=$4::jsonb
		  and current_route.snapshot->>'predecessor_inbox_event_key'=predecessor.inbox_event_key
		  and current_route.snapshot->>'predecessor_processing_lane'=predecessor.processing_lane
		  and (nullif(current_route.snapshot->>'conversation_id','') is null or current_route.snapshot->>'conversation_id'=conversation.id::text)
		  and message.metadata#>>'{private_collision_route,kind}'=$5
		  and message.metadata#>>'{private_collision_route,snapshot_md5}'=md5(predecessor.snapshot::text)
		  and message.metadata#>>'{private_collision_route,ingress_sequence}'=predecessor.ingress_sequence::text
		  and message.metadata#>>'{private_collision_route,processing_epoch}'=predecessor.processing_epoch::text
		  and message.lead_id is null and message.capture_state='unlinked_ephemeral' and message.unlinked_retention_scrubbed_at is null
		  and message.from_me=false and message.direction='inbound'
		 for update of conversation`, session.OrganizationID, session.ID, message.ProviderMessageID, string(snapshot.RawSnapshot),
			nativePrivateCollisionMarker).Scan(&conversation.ID, &conversation.LeadID, &conversation.RemoteJID, &privateReady)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nativeEvolutionConversation{}, false, nil
	}
	if err != nil {
		return nativeEvolutionConversation{}, false, err
	}
	if !privateReady {
		return nativeEvolutionConversation{}, false, ErrConversationBindingChanged
	}
	if whatsAppContactPNKey(conversation.RemoteJID) != whatsAppContactPNKey(message.RemoteJID) {
		return nativeEvolutionConversation{}, false, errNativeStoredContactPNConflict
	}
	if conflict, err := nativeStoredContactPNConflict(ctx, tx, session, message, conversation.ID); err != nil || conflict {
		if conflict {
			err = errNativeStoredContactPNConflict
		}
		return nativeEvolutionConversation{}, false, err
	}
	conversation.PrivateCollisionRoute = true
	conversation.HistoricalBindingReplay = strings.TrimSpace(conversation.LeadID) != ""
	return conversation, true, nil
}

func recoverNativePrivateCollisionMessage(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession,
	item pendingEvolutionWebhook, conversation nativeEvolutionConversation, message nativeEvolutionMessage, rowID string,
	snapshot *nativeIngressRoutingSnapshot,
) error {
	recovered, target, err := recoverSuppressedBacklogMessage(ctx, tx, session, message, whatsappMediaBackfillPriority)
	if err != nil {
		return err
	}
	if !recovered || target != "unlinked_ephemeral" {
		return errors.New("WhatsApp private collision message was not captured on its unlinked route")
	}
	tag, err := tx.Exec(ctx, `update public.whatsapp_messages message
	 set metadata=message.metadata||jsonb_build_object('whatsapp_event_binding_is_current',false,'private_collision_route',jsonb_build_object(
	  'kind',$8::text,'snapshot_md5',md5(route.snapshot::text),'processing_epoch',route.processing_epoch,
	  'ingress_sequence',route.ingress_sequence))
	 from public.whatsapp_webhook_routing_snapshots route
	 join public.whatsapp_webhook_inbox inbox on inbox.organization_id=route.organization_id
	  and inbox.session_id=route.session_id and inbox.event_key=route.inbox_event_key and inbox.processing_epoch=route.processing_epoch
	 where message.organization_id=$1::uuid and message.session_id=$2::uuid and message.id=$3::uuid
	  and message.conversation_id=$4::uuid and message.provider_message_id=$5
	  and message.lead_id is null and message.capture_state='unlinked_ephemeral'
	  and route.organization_id=message.organization_id and route.session_id=message.session_id and route.provider_message_id=message.provider_message_id
	  and route.snapshot=$6::jsonb and inbox.id=$7::uuid and inbox.status='processing'
	  and inbox.locked_by=$9 and inbox.edge_execution_id is null`, session.OrganizationID, session.ID, rowID,
		conversation.ID, message.ProviderMessageID, string(snapshot.RawSnapshot), item.ID,
		firstNonEmpty(conversation.PrivateCollisionKind, nativePrivateCollisionMarker), whatsappWebhookWorkerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("WhatsApp private collision capture lost its canonical message scope")
	}
	return nil
}
