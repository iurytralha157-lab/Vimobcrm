package whatsapp

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type lockedInboxConversation struct {
	Actor                            tenant.Context
	Snapshot, SessionID, OwnerID     string
	LeadID, RemoteJID, SessionStatus string
}

// Broad CRM history never grants operation of another account's inbox.
func lockOperationalInboxConversation(ctx context.Context, tx pgx.Tx, actor tenant.Context, conversationID, expectedLeadID string) (lockedInboxConversation, error) {
	var result lockedInboxConversation
	err := tx.QueryRow(ctx, `select ws.id::text,ws.owner_user_id::text from public.whatsapp_conversations wc
 join public.whatsapp_sessions ws on ws.organization_id=wc.organization_id and ws.id=wc.session_id
 where wc.organization_id=$1::uuid and wc.id=$2::uuid and ws.provider='evolution_go'
 and coalesce(ws.is_active,true) and ws.status<>'deleted'`, actor.OrganizationID, conversationID).Scan(&result.SessionID, &result.OwnerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, ErrConversationNotFound
	}
	if err != nil {
		return result, err
	}
	if err := lockWhatsAppUserMembershipRows(ctx, tx, actor.OrganizationID, result.OwnerID, actor.UserID); err != nil {
		return result, err
	}
	if err := requireOriginalWhatsAppOrganization(ctx, tx, actor); err != nil {
		return result, err
	}
	if err := lockWhatsAppActorRoles(ctx, tx, actor); err != nil {
		return result, err
	}
	var id string
	err = tx.QueryRow(ctx, `select id::text,coalesce(status,'') from public.whatsapp_sessions where organization_id=$1::uuid and id=$2::uuid and owner_user_id=$3::uuid
 and provider='evolution_go' and coalesce(is_active,true) and status<>'deleted' for share`, actor.OrganizationID, result.SessionID, result.OwnerID).Scan(&id, &result.SessionStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, ErrConversationNotFound
	}
	if err != nil {
		return result, err
	}
	err = tx.QueryRow(ctx, `select coalesce(wc.lead_id::text,''),coalesce(wc.remote_jid,'') from public.whatsapp_conversations wc
 where wc.organization_id=$1::uuid and wc.id=$2::uuid and wc.session_id=$3::uuid
 and wc.deleted_at is null and wc.retired_at is null and `+conversationRetentionVisibilitySQL()+` for update of wc`, actor.OrganizationID, conversationID, result.SessionID).Scan(&result.LeadID, &result.RemoteJID)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, ErrConversationNotFound
	}
	if err != nil {
		return result, err
	}
	if (result.LeadID == "" && expectedLeadID != unlinkedConversationLeadSnapshot) || (result.LeadID != "" && result.LeadID != expectedLeadID) {
		return result, ErrConversationNotFound
	}
	if result.LeadID != "" {
		err = tx.QueryRow(ctx, `select id::text from public.leads where organization_id=$1::uuid and id=$2::uuid for share`, actor.OrganizationID, result.LeadID).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return result, ErrConversationNotFound
		}
		if err != nil {
			return result, err
		}
	}
	result.Actor, result.Snapshot, err = currentWhatsAppActorWithSnapshot(ctx, tx, actor)
	if err != nil {
		return result, err
	}
	if !result.Actor.HasPermission(permissions.WhatsAppOperate) || !result.Actor.HasPermission(permissions.WhatsAppView) {
		return result, tenant.ErrOrganizationAccessDenied
	}
	if result.OwnerID != actor.UserID {
		err = tx.QueryRow(ctx, `select access.id::text from public.whatsapp_session_access access
 where access.organization_id=$1::uuid and access.session_id=$2::uuid and access.user_id=$3::uuid for share`, actor.OrganizationID, result.SessionID, actor.UserID).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return result, ErrConversationNotFound
		}
		if err != nil {
			return result, err
		}
	}
	args := append(baseConversationArgs(result.Actor), conversationID, result.SessionID, result.LeadID, result.Snapshot)
	var allowed bool
	err = tx.QueryRow(ctx, `select exists(select 1 from public.whatsapp_conversations wc
 join public.whatsapp_sessions ws on ws.id=wc.session_id and ws.organization_id=wc.organization_id
 left join public.leads l on l.id=wc.lead_id and l.organization_id=wc.organization_id
 where wc.organization_id=$1::uuid and wc.id=$5::uuid and wc.session_id=$6::uuid
 and coalesce(wc.lead_id::text,'')=$7 and wc.deleted_at is null and wc.retired_at is null
 and (ws.owner_user_id=$2::uuid or (l.assigned_user_id=$2::uuid and `+sessionGrantExistsSQL("ws", "$2::uuid", false)+`))
 and ((wc.lead_id is null and ws.owner_user_id=$2::uuid) or (l.id is not null and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(result.Actor))+`))
 and `+currentWhatsAppActorSnapshotPredicateSQL("$8")+`)`, args...).Scan(&allowed)
	if err != nil {
		return result, err
	}
	if !allowed {
		return result, ErrConversationNotFound
	}
	return result, nil
}

func (repo Repository) mutateConversationInbox(ctx context.Context, actor tenant.Context, conversationID, expectedLeadID string, markRead, archive bool, deleting ...bool) error {
	var ok bool
	conversationID, ok = normalizeUUID(conversationID)
	if !ok {
		return ErrConversationNotFound
	}
	expectedLeadID, err := validateExpectedConversationLeadSnapshot(expectedLeadID)
	if err != nil {
		return err
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	locked, err := lockOperationalInboxConversation(ctx, tx, actor, conversationID, expectedLeadID)
	if err != nil {
		return err
	}
	deleteConversation := len(deleting) > 0 && deleting[0]
	args := append(baseConversationArgs(locked.Actor), conversationID, locked.SessionID, locked.LeadID, markRead, archive, locked.Snapshot, deleteConversation)
	tag, err := tx.Exec(ctx, `update public.whatsapp_conversations wc
 set unread_count=case when $8::boolean then 0 else wc.unread_count end,
 archived_at=case when $8::boolean or $11::boolean then wc.archived_at when $9::boolean then now() else null end,
 deleted_at=case when $11::boolean then now() else wc.deleted_at end,updated_at=now()
 from public.whatsapp_sessions ws left join public.leads l on l.id=nullif($7,'')::uuid and l.organization_id=$1::uuid
 where wc.organization_id=$1::uuid and wc.id=$5::uuid and wc.session_id=$6::uuid
 and coalesce(wc.lead_id::text,'')=$7 and wc.deleted_at is null and wc.retired_at is null
 and ws.id=wc.session_id and ws.organization_id=wc.organization_id
 and (ws.owner_user_id=$2::uuid or (l.assigned_user_id=$2::uuid and `+sessionGrantExistsSQL("ws", "$2::uuid", false)+`))
 and ((wc.lead_id is null and ws.owner_user_id=$2::uuid) or (l.id is not null and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(locked.Actor))+`))
 and `+currentWhatsAppActorSnapshotPredicateSQL("$10"), args...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrConversationNotFound
	}
	return tx.Commit(ctx)
}
