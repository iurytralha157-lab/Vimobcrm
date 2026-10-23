package whatsapp

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Sharing grants operations only on the actor's currently assigned lead. A
// selected shared number is never a general-purpose unknown-contact session.
func (repo Repository) resolveLeadStartSession(ctx context.Context, actor tenant.Context, selectedSessionID, explicitLeadID string) (Session, error) {
	session, err := repo.resolveStartSession(ctx, actor, selectedSessionID)
	if err == nil || !errors.Is(err, ErrSessionNotFound) || strings.TrimSpace(selectedSessionID) == "" || explicitLeadID == "" {
		return session, err
	}
	sessionID, valid := normalizeUUID(selectedSessionID)
	if !valid {
		return Session{}, ErrSessionNotFound
	}
	session, err = scanSession(repo.db.Pool().QueryRow(ctx, `select `+sessionSelectFields()+`
		from public.whatsapp_sessions ws
		join public.leads lead on lead.organization_id=ws.organization_id and lead.id=$4::uuid and lead.assigned_user_id=$3::uuid
		left join public.users owner on owner.id=ws.owner_user_id
		where ws.organization_id=$1::uuid and ws.id=$2::uuid and ws.provider='evolution_go'
		and coalesce(ws.is_active,true) and ws.status='connected'
		and `+sessionGrantExistsSQL("ws", "$3::uuid", true), actor.OrganizationID, sessionID, actor.UserID, explicitLeadID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrSessionNotFound
	}
	return session, err
}

// Do not expose an unknown conversation ID or import its history through a
// shared grant. Read only the physical row's binding, after lead/grant checks.
func (repo Repository) validateSharedStartDestination(ctx context.Context, actor tenant.Context, sessionID, remoteJID, leadID string) error {
	var boundLead *string
	err := repo.db.Pool().QueryRow(ctx, `select lead_id::text from public.whatsapp_conversations
		where organization_id=$1::uuid and session_id=$2::uuid and remote_jid=$3
		and deleted_at is null and retired_at is null`, actor.OrganizationID, sessionID, remoteJID).Scan(&boundLead)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if boundLead == nil {
		return ErrConversationHistoryLinkRequired
	}
	if *boundLead != leadID {
		return ErrConversationBindingChanged
	}
	return nil
}
