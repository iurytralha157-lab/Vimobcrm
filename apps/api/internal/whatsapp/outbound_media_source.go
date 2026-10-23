package whatsapp

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// A same-tenant path is not authority to copy bytes. Forwarded MediaURL must
// resolve to a captured canonical message whose immutable lead is readable by
// the current actor. Observed/unlinked files cannot be promoted by sending.
func authorizeOutboundMediaSource(ctx context.Context, queryer whatsappQueryRower, orgID, userID, path, expectedID string, lock bool) (string, error) {
	var id, leadID string
	query := `select wm.id::text,wm.lead_id::text from public.whatsapp_messages wm
	 join public.leads l on l.id=wm.lead_id and l.organization_id=wm.organization_id
	 where wm.organization_id=$1::uuid and wm.media_storage_path=$3 and ($4='' or wm.id::text=$4)
	 and wm.capture_state='captured' and wm.unlinked_retention_scrubbed_at is null
	 and wm.media_status='ready' and wm.message_type not in ('text','reaction','deleted','deleted_event','system')
	 and private.whatsapp_actor_can_read_lead(wm.organization_id,wm.lead_id,$2::uuid)
	 order by wm.id limit 1`
	err := queryer.QueryRow(ctx, query, orgID, userID, path, expectedID).Scan(&id, &leadID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", tenant.ErrOrganizationAccessDenied
	}
	if err != nil {
		return "", err
	}
	if lock {
		// Freeze authorization on the immutable source lead without a message
		// row lock. Deletion/recovery project WM before acquiring the exclusive
		// lead lock, so lead -> WM would introduce an inverse order here.
		var locked string
		err = queryer.QueryRow(ctx, `select id::text from public.leads where organization_id=$1::uuid and id=$2::uuid for share`, orgID, leadID).Scan(&locked)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", tenant.ErrOrganizationAccessDenied
		}
		if err != nil {
			return "", err
		}
		// A transfer committed while waiting must be seen in a fresh statement.
		err = queryer.QueryRow(ctx, query, orgID, userID, path, id).Scan(&id, &leadID)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", tenant.ErrOrganizationAccessDenied
		}
	}
	return id, err
}

func lockWhatsAppOutboxMediaSourceForStart(ctx context.Context, tx pgx.Tx, item pendingWhatsAppOutbox, senderID string) error {
	var sourceID, sourcePath string
	if err := tx.QueryRow(ctx, `select coalesce(metadata->>'outbound_media_source_message_id',''),coalesce(metadata->>'outbound_media_source_path','')
	 from public.whatsapp_messages where organization_id=$1::uuid and id=$2::uuid`, item.OrganizationID, item.MessageRowID).Scan(&sourceID, &sourcePath); err != nil {
		return err
	}
	if sourceID == "" {
		return nil
	}
	if _, err := authorizeOutboundMediaSource(ctx, tx, item.OrganizationID, senderID, sourcePath, sourceID, true); err != nil {
		if errors.Is(err, tenant.ErrOrganizationAccessDenied) {
			return ErrSessionAccessRevoked
		}
		return err
	}
	return nil
}
