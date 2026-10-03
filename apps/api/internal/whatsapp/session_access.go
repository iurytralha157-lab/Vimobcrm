package whatsapp

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// sessionGrantExistsSQL is used only with source-controlled SQL aliases and
// placeholders. Legacy grants have no grant_scope and are deliberately inert.
// Team grants are bound to the exact team chosen when access was granted.
func sessionGrantExistsSQL(sessionAlias, userExpression string, requireSend bool) string {
	capability := "access.can_view = true and access.can_read = true"
	if requireSend {
		capability += " and access.can_send = true"
	}
	return fmt.Sprintf(`exists (
		select 1
		from public.whatsapp_session_access access
		join public.users recipient
		  on recipient.id = access.user_id
		 and coalesce(recipient.is_active, false) = true
		join public.organization_members recipient_member
		  on recipient_member.organization_id = access.organization_id
		 and recipient_member.user_id = access.user_id
		 and coalesce(recipient_member.is_active, false) = true
		 and recipient_member.deleted_at is null
		join public.users owner_user
		  on owner_user.id = %s.owner_user_id
		 and coalesce(owner_user.is_active, false) = true
		join public.organization_members owner_member
		  on owner_member.organization_id = access.organization_id
		 and owner_member.user_id = %s.owner_user_id
		 and coalesce(owner_member.is_active, false) = true
		 and owner_member.deleted_at is null
		where access.organization_id = %s.organization_id
		  and access.session_id = %s.id
		  and access.user_id = %s
		  and access.granted_by = %s.owner_user_id
		  and access.access_mode = 'assigned_leads_only'
		  and access.only_leads_access = true
		  and %s
		  and (
		    (
		      access.grant_scope = 'organization'
		      and access.grant_team_id is null
		      and lower(btrim(owner_member.role)) in (
		        'owner', 'admin', 'manager'
		      )
		    )
		    or (
		      access.grant_scope = 'team'
		      and access.grant_team_id is not null
		      and exists (
		        select 1
		        from public.teams team
		        join public.team_members leader
		          on leader.team_id = team.id
		         and leader.organization_id = team.organization_id
		         and leader.user_id = %s.owner_user_id
		         and coalesce(leader.is_active, true) = true
		         and coalesce(leader.is_leader, false) = true
		        join public.team_members member
		          on member.team_id = team.id
		         and member.organization_id = team.organization_id
		         and member.user_id = access.user_id
		         and coalesce(member.is_active, true) = true
		        where team.organization_id = access.organization_id
		          and team.id = access.grant_team_id
		          and coalesce(team.is_active, true) = true
		      )
		    )
		  )
	)`, sessionAlias, sessionAlias, sessionAlias, sessionAlias, userExpression, sessionAlias, capability, sessionAlias)
}

// outboundSessionAccessGrantID records the exact grant that authorized a
// human outbound intent. An owner does not need a grant. A later regrant must
// never revive an intent queued under a revoked grant.
func outboundSessionAccessGrantID(
	ctx context.Context,
	tx pgx.Tx,
	organizationID, sessionID, userID string,
) (string, error) {
	var ownerUserID, sessionStatus string
	err := tx.QueryRow(ctx, `
		select owner_user_id::text, coalesce(status, '')
		from public.whatsapp_sessions
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and provider = 'evolution_go'
		  and coalesce(is_active, true) = true
	`, organizationID, sessionID).Scan(&ownerUserID, &sessionStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrSessionAccessRevoked
	}
	if err != nil {
		return "", err
	}
	if sessionStatus != "connected" {
		return "", fmt.Errorf("%w: WhatsApp desconectado. Reconecte ou selecione uma conexao ativa.", ErrInvalidInput)
	}
	if ownerUserID == userID {
		return "", nil
	}

	var grantID string
	err = tx.QueryRow(ctx, `
		select access.id::text
		from public.whatsapp_session_access access
		join public.whatsapp_sessions ws
		  on ws.id = access.session_id
		 and ws.organization_id = access.organization_id
		where access.organization_id = $1::uuid
		  and access.session_id = $2::uuid
		  and access.user_id = $3::uuid
		  and `+sessionGrantExistsSQL("ws", "$3::uuid", true)+`
	`, organizationID, sessionID, userID).Scan(&grantID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrSessionAccessRevoked
	}
	return grantID, err
}

// Call only after the conversation has passed its lead-visibility check. A
// missing arbitrary session remains 404; an existing shared session whose
// access was revoked gives the composer a stable, actionable error.
func (repo Repository) revokedSessionErrorIfShared(
	ctx context.Context,
	tenantContext tenant.Context,
	sessionID string,
) error {
	var ownerUserID string
	err := repo.db.Pool().QueryRow(ctx, `
		select owner_user_id::text
		from public.whatsapp_sessions
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and provider = 'evolution_go'
		  and coalesce(is_active, true) = true
		  and coalesce(status, '') <> 'deleted'
	`, tenantContext.OrganizationID, sessionID).Scan(&ownerUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSessionNotFound
	}
	if err != nil {
		return err
	}
	if ownerUserID != tenantContext.UserID {
		return ErrSessionAccessRevoked
	}
	return ErrSessionNotFound
}

// Map a denied operational conversation to an actionable error only when the
// caller may see the exact current lead and is its assignee. No conversation
// data is returned, and guessed IDs outside that scope retain the 404.
func (repo Repository) revokedConversationErrorIfAssigned(
	ctx context.Context,
	tenantContext tenant.Context,
	conversationID, sessionID, leadID string,
	fallback error,
) error {
	if !errors.Is(fallback, ErrConversationNotFound) {
		return fallback
	}
	var ok bool
	if conversationID, ok = normalizeUUID(conversationID); !ok {
		return fallback
	}
	if sessionID, ok = normalizeUUID(sessionID); !ok {
		return fallback
	}
	if leadID, ok = normalizeUUID(leadID); !ok {
		return fallback
	}
	args := append(baseConversationArgs(tenantContext), conversationID, sessionID, leadID)
	var revoked bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.whatsapp_conversations wc
			join public.whatsapp_sessions ws
			  on ws.id = wc.session_id
			 and ws.organization_id = wc.organization_id
			join public.leads l
			  on l.id = wc.lead_id
			 and l.organization_id = wc.organization_id
			where wc.organization_id = $1::uuid
			  and wc.id = $5::uuid
			  and wc.session_id = $6::uuid
			  and wc.lead_id = $7::uuid
			  and wc.deleted_at is null
			  and ws.provider = 'evolution_go'
			  and coalesce(ws.is_active, true) = true
			  and coalesce(ws.status, '') <> 'deleted'
			  and ws.owner_user_id <> $2::uuid
			  and l.assigned_user_id = $2::uuid
			  and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
			  and not `+sessionGrantExistsSQL("ws", "$2::uuid", false)+`
		)
	`, args...).Scan(&revoked)
	if err != nil {
		return err
	}
	if revoked {
		return ErrSessionAccessRevoked
	}
	return fallback
}
