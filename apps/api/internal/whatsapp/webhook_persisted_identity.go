package whatsapp

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

var errNativeStoredContactPNConflict = errors.New(whatsappPNConflictReason)

// The selected physical route is already tenant/session scoped by its loader.
// Persisted PNs are evidence only, never candidates for finding another card.
func nativeStoredContactPNConflict(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession,
	message nativeEvolutionMessage, conversationID string,
) (bool, error) {
	var evidence []string
	if err := tx.QueryRow(ctx, `select private.whatsapp_conversation_contact_pn_evidence($1::uuid,$2::uuid,$3::uuid)`,
		session.OrganizationID, session.ID, conversationID).Scan(&evidence); err != nil {
		return false, err
	}
	values := append([]string{message.RemoteJID, message.ContactPhone}, message.RemoteAliases...)
	return whatsAppContactPNConflict(append(values, evidence...)...), nil
}

func recordNativeStoredContactPNQuarantine(ctx context.Context, tx pgx.Tx, item pendingEvolutionWebhook, providerID string) error {
	tag, err := tx.Exec(ctx, `insert into private.whatsapp_webhook_ignored_events(organization_id,session_id,event_key,reason)
		select inbox.organization_id,inbox.session_id,inbox.event_key,$5
		from public.whatsapp_webhook_inbox inbox
		where inbox.id=$1::uuid and inbox.organization_id=$2::uuid and inbox.session_id=$3::uuid
		  and inbox.status='processing' and inbox.locked_by=$6 and inbox.edge_execution_id is null
		  and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(
		    inbox.payload#>'{__vimob_ingress,routing_snapshot,messages}')='array'
		    then inbox.payload#>'{__vimob_ingress,routing_snapshot,messages}' else '[]'::jsonb end) route(snapshot)
		    join public.whatsapp_webhook_routing_snapshots canonical
		      on canonical.organization_id=inbox.organization_id and canonical.session_id=inbox.session_id
		     and canonical.processing_epoch=inbox.processing_epoch and canonical.provider_message_id=$4
		     and canonical.snapshot=route.snapshot
		    where route.snapshot->>'provider_message_id'=$4)
		on conflict(organization_id,session_id,event_key) do update set reason=excluded.reason`,
		item.ID, item.OrganizationID, item.SessionID, providerID, whatsappPNRouteConflictReason, whatsappWebhookWorkerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("WhatsApp contact PN quarantine lost its canonical inbox scope")
	}
	return nil
}
