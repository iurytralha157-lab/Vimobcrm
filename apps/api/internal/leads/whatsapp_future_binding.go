package leads

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Lock the actor, session and conversation before either creation path can lock a lead.
// A busy reconnect, transfer or membership change fails this new intent atomically.
func lockFutureLeadWhatsAppSession(ctx context.Context, tx pgx.Tx, actor tenant.Context, input createInput) (string, error) {
	if !input.FutureOnly {
		return "", nil
	}
	if !canBindWhatsAppConversationDuringLeadCreation(actor) {
		return "", tenant.ErrOrganizationAccessDenied
	}
	if input.ConversationID == nil {
		return "", ErrInvalidReference
	}

	var actorID string
	err := tx.QueryRow(ctx, `
		select actor.id::text
		from public.users actor
		join public.organization_members member
		  on member.user_id=actor.id and member.organization_id=actor.organization_id
		where actor.id=$1::uuid and actor.organization_id=$2::uuid
		  and coalesce(actor.is_active,false) and coalesce(member.is_active,false)
		  and member.deleted_at is null
		for share of actor, member nowait
	`, actor.UserID, actor.OrganizationID).Scan(&actorID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", tenant.ErrOrganizationAccessDenied
	}
	if err != nil {
		return "", futureLeadBindingLockError(err)
	}

	var sessionID string
	err = tx.QueryRow(ctx, `
		select ws.id::text
		from public.whatsapp_conversations wc
		join public.whatsapp_sessions ws
		  on ws.id=wc.session_id and ws.organization_id=wc.organization_id
		where wc.organization_id=$1::uuid and wc.id=$2::uuid and wc.deleted_at is null
		  and ws.owner_user_id=$3::uuid and ws.provider='evolution_go'
		  and coalesce(ws.is_active,true) and ws.status='connected'
		for share of ws nowait
	`, actor.OrganizationID, *input.ConversationID, actor.UserID).Scan(&sessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrInvalidReference
	}
	if err != nil {
		return "", futureLeadBindingLockError(err)
	}

	var conversationID string
	err = tx.QueryRow(ctx, `
		select wc.id::text from public.whatsapp_conversations wc
		where wc.organization_id=$1::uuid and wc.id=$2::uuid and wc.session_id=$3::uuid
		  and wc.deleted_at is null and wc.retired_at is null
		  and wc.lead_id is null and not wc.unlinked_retention_v1
		for update of wc nowait
	`, actor.OrganizationID, *input.ConversationID, sessionID).Scan(&conversationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrConversationBindingChanged
	}
	return sessionID, futureLeadBindingLockError(err)
}

func futureLeadBindingLockError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "55P03" {
		return ErrConversationBindingChanged
	}
	return err
}
