package whatsapp

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// discoverConversationSessionID intentionally does not lock the conversation.
// Callers use the result only to acquire the session read fence first, then
// lock and revalidate the conversation. This keeps every user write that needs
// both rows on the canonical session -> conversation order without trusting
// the discovery snapshot.
func discoverConversationSessionID(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	conversationID string,
) (string, error) {
	var sessionID string
	err := tx.QueryRow(ctx, `
		select session_id::text
		from public.whatsapp_conversations
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and deleted_at is null
	`, organizationID, conversationID).Scan(&sessionID)
	return sessionID, err
}

// lockOwnedConnectedEvolutionSession acquires the outer, read-only session
// fence used by conversation mutations. The row is never upgraded while a
// conversation lock is held; native paths that may mutate the session acquire
// FOR UPDATE before touching any conversation instead.
func lockOwnedConnectedEvolutionSession(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	sessionID string,
) error {
	var lockedSessionID string
	err := tx.QueryRow(ctx, `
		select ws.id::text
		from public.whatsapp_sessions as ws
		where ws.organization_id = $1::uuid
		  and ws.id = $2::uuid
		  and ws.owner_user_id = $3::uuid
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and ws.status = 'connected'
		for share of ws
	`, tenantContext.OrganizationID, sessionID, tenantContext.UserID).Scan(&lockedSessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSessionNotFound
	}
	return err
}

// Actors precede the session, conversation and lead. Discover the owner without
// a resource lock, then recheck that exact identity after acquiring the session.
func lockWhatsAppSessionActors(ctx context.Context, tx pgx.Tx, actor tenant.Context, sessionID string) (string, error) {
	var ownerID string
	err := tx.QueryRow(ctx, `select owner_user_id::text from public.whatsapp_sessions where organization_id=$1::uuid and id=$2::uuid`, actor.OrganizationID, sessionID).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrSessionNotFound
	}
	if err != nil {
		return "", err
	}
	if err := lockWhatsAppUserMembershipRows(ctx, tx, actor.OrganizationID, actor.UserID, ownerID); err != nil {
		return "", err
	}
	return ownerID, nil
}

// Send acquires actor fences before the session, conversation and lead.
// A grant alone is insufficient: SendMessage rechecks assignment under the
// lead lock before writing the durable outbound.
func lockConversationSendSession(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	sessionID string,
) error {
	ownerID, err := lockWhatsAppSessionActors(ctx, tx, tenantContext, sessionID)
	if err != nil {
		return err
	}
	var lockedSessionID, lockedStatus string
	err = tx.QueryRow(ctx, `
		select ws.id::text, coalesce(ws.status, '')
		from public.whatsapp_sessions as ws
		where ws.organization_id = $1::uuid
		  and ws.id = $2::uuid
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') <> 'deleted'
		  and ws.owner_user_id = $4::uuid
		  and (ws.owner_user_id = $3::uuid or `+sessionGrantExistsSQL("ws", "$3::uuid", true)+`)
		for share of ws
	`, tenantContext.OrganizationID, sessionID, tenantContext.UserID, ownerID).Scan(&lockedSessionID, &lockedStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSessionNotFound
	}
	if err != nil {
		return err
	}
	if lockedStatus != "connected" {
		return fmt.Errorf("%w: WhatsApp desconectado. Reconecte ou selecione uma conexao ativa.", ErrInvalidInput)
	}
	return nil
}
