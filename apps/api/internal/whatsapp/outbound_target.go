package whatsapp

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"strings"
)

func confirmedWhatsAppOutboundStatus(status string) bool {
	return validEnum(strings.ToLower(strings.TrimSpace(status)), "sent", "delivered", "read", "played")
}

func lockWhatsAppOutboxTargetForStart(ctx context.Context, tx pgx.Tx, item pendingWhatsAppOutbox) error {
	reaction := strings.TrimSpace(stringFromAny(item.Payload["action"])) == "message.react"
	if !reaction && mapFromAny(item.Payload["body"])["quoted"] == nil {
		return nil
	}
	var id string
	err := tx.QueryRow(ctx, `
	  select target.id::text
	  from public.whatsapp_messages pending
	  join public.whatsapp_messages target
	    on target.organization_id=pending.organization_id
	   and target.session_id=pending.session_id and target.conversation_id=pending.conversation_id
	   and target.lead_id=pending.lead_id
	   and coalesce(nullif(target.provider_message_id,''),target.message_id)=
	     case when $5::boolean then pending.reaction_to_message_id else pending.metadata->>'quoted_message_id' end
	  where pending.id=$1::uuid and pending.organization_id=$2::uuid
	    and pending.session_id=$3::uuid and pending.conversation_id=$4::uuid
	    and `+messageTargetEligibleSQL("target")+`
	  for share of target
	`, item.MessageRowID, item.OrganizationID, item.SessionID, item.ConversationID, reaction).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		if reaction {
			return ErrReactionTargetUnconfirmed
		}
		return ErrQuoteTargetUnavailable
	}
	return err
}

// A target may have failed or been deleted after the user queued a reaction or
// quote. Revalidate the immutable target before writing provider-started.
func (repo Repository) whatsappOutboxTargetCurrent(ctx context.Context, item pendingWhatsAppOutbox) (bool, error) {
	var valid bool
	err := repo.db.Pool().QueryRow(ctx, `
	  select exists (
	    select 1 from public.whatsapp_messages pending
	    join public.whatsapp_messages target
	      on target.organization_id=pending.organization_id
	     and target.session_id=pending.session_id and target.conversation_id=pending.conversation_id
	     and target.lead_id=pending.lead_id
	     and coalesce(nullif(target.provider_message_id,''),target.message_id)=
	       case when $5::boolean then pending.reaction_to_message_id else pending.metadata->>'quoted_message_id' end
	    where pending.id=$1::uuid and pending.organization_id=$2::uuid
	      and pending.session_id=$3::uuid and pending.conversation_id=$4::uuid
	      and `+messageTargetEligibleSQL("target")+`
	  )
	`, item.MessageRowID, item.OrganizationID, item.SessionID, item.ConversationID,
		strings.TrimSpace(stringFromAny(item.Payload["action"])) == "message.react").Scan(&valid)
	return valid, err
}
