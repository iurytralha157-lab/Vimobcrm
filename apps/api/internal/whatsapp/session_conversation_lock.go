package whatsapp

import (
	"context"
	"errors"

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
