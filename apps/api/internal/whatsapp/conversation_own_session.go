package whatsapp

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func validateStartSessionOwnership(ownSessionOnly bool, ownerID, actorID string) error {
	if ownSessionOnly && (strings.TrimSpace(actorID) == "" || ownerID != actorID) {
		return ErrSessionNotFound
	}
	return nil
}

// The caller already holds the existing session lock. This check adds the
// personal-start fence without changing the normal shared-session contract.
func revalidateOwnStartSession(ctx context.Context, queryer whatsappQueryRower, actor tenant.Context, sessionID string, ownSessionOnly bool) error {
	if !ownSessionOnly {
		return nil
	}
	var ownerID string
	err := queryer.QueryRow(ctx, `select owner_user_id::text from public.whatsapp_sessions where organization_id=$1::uuid and id=$2::uuid`, actor.OrganizationID, sessionID).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSessionNotFound
	}
	if err != nil {
		return err
	}
	return validateStartSessionOwnership(true, ownerID, actor.UserID)
}

// Resolve only routing identity here. The existing linking transaction repeats
// ownership after taking its session lock and pins that SID to the locked CID.
func resolveOwnedConversationLinkSession(ctx context.Context, queryer whatsappQueryRower, actor tenant.Context, conversationID string) (string, error) {
	var sessionID string
	err := queryer.QueryRow(ctx, `select ws.id::text from public.whatsapp_conversations wc
		join public.whatsapp_sessions ws on ws.id=wc.session_id and ws.organization_id=wc.organization_id
		where wc.organization_id=$1::uuid and wc.id=$2::uuid and wc.deleted_at is null
		and ws.owner_user_id=$3::uuid and ws.provider='evolution_go' and coalesce(ws.is_active,true)
		and ws.status='connected'`, actor.OrganizationID, conversationID, actor.UserID).Scan(&sessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrSessionNotFound
	}
	if err != nil {
		return "", err
	}
	if value, valid := normalizeUUID(sessionID); valid {
		return value, nil
	}
	return "", ErrSessionNotFound
}

func (repo Repository) LinkOwnedConversationToLead(ctx context.Context, actor tenant.Context, conversationID, leadID, expectedPreviousLeadID string, resultOut ...*ConversationLeadLinkResult) error {
	if err := requireOriginalWhatsAppOrganization(ctx, repo.db.Pool(), actor); err != nil {
		return err
	}
	conversationID, valid := normalizeUUID(conversationID)
	if !valid {
		return ErrConversationNotFound
	}
	sessionID, err := resolveOwnedConversationLinkSession(ctx, repo.db.Pool(), actor, conversationID)
	if err != nil {
		return err
	}
	return repo.linkConversationToLeadWithOwnSession(ctx, actor, conversationID, leadID, expectedPreviousLeadID, sessionID, resultOut...)
}
