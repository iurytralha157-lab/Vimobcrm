package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// lockWhatsAppOutboxGrantForStart checks the exact grant on the same short
// transaction that writes the durable provider-started marker. A revoke that
// deletes the grant must serialize with this row lock. The transaction commits
// before provider I/O; a started send may finish after a later revoke.
func lockWhatsAppOutboxGrantForStart(ctx context.Context, tx pgx.Tx, item pendingWhatsAppOutbox) error {
	var senderID, ownerID, origin, grantID, provider, sessionStatus string
	var attendanceUserID string
	var sessionActive bool
	err := tx.QueryRow(ctx, `
		select coalesce(message.sender_user_id::text, ''),
		       session.owner_user_id::text,
	       coalesce(nullif(message.metadata->>'attendance_send_origin', ''),
	                message.metadata->>'origin', ''),
		       coalesce(message.metadata->>'session_access_grant_id', ''),
		       coalesce(session.provider, ''),
		       coalesce(session.status, ''),
		       coalesce(session.is_active, true),
		       coalesce((select attendance.user_id::text from public.whatsapp_attendance_entries attendance
		        where attendance.id::text=message.metadata->>'attendance_entry_id'
		        and attendance.organization_id=message.organization_id and attendance.session_id=message.session_id
		        and attendance.conversation_id=message.conversation_id and attendance.lead_id=message.lead_id),'')
		from public.whatsapp_messages message
		join public.whatsapp_sessions session
		  on session.id = message.session_id
		 and session.organization_id = message.organization_id
		where message.id = $1::uuid
		  and message.organization_id = $2::uuid
		  and message.session_id = $3::uuid
		  and message.conversation_id = $4::uuid
	`, item.MessageRowID, item.OrganizationID, item.SessionID, item.ConversationID).
		Scan(&senderID, &ownerID, &origin, &grantID, &provider, &sessionStatus, &sessionActive, &attendanceUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSessionAccessRevoked
	}
	if err != nil {
		return err
	}
	if provider != "evolution_go" || !sessionActive || sessionStatus == "deleted" {
		return fmt.Errorf("%w: WhatsApp session is not eligible for delivery", ErrSessionNotFound)
	}
	if sessionStatus != "connected" {
		return fmt.Errorf("%w: %w", ErrProviderFailed, errWhatsAppOutboxSessionDisconnected)
	}
	if origin != "automation" && origin != "human" {
		return ErrSessionAccessRevoked
	}
	if attendanceUserID == "" || (origin == "human" && attendanceUserID != senderID) {
		return ErrSessionAccessRevoked
	}
	// Users removal locks the actor/member before transferring leads or
	// disabling sessions. Discover identities without locks, then acquire that
	// same order before any route/work lock. Recheck the discovered identities
	// after acquiring the session so a changed owner cannot borrow these locks.
	userIDs := []string{ownerID, attendanceUserID}
	sort.Strings(userIDs)
	for index, userID := range userIDs {
		if index > 0 && userID == userIDs[index-1] {
			continue
		}
		if err := lockWhatsAppOutboxEligibilityRow(ctx, tx, `select id::text from public.users where id=$1::uuid for share`, userID); err != nil {
			return err
		}
		if err := lockWhatsAppOutboxEligibilityRow(ctx, tx, `select user_id::text from public.organization_members where organization_id=$1::uuid and user_id=$2::uuid for share`, item.OrganizationID, userID); err != nil {
			return err
		}
	}
	if origin == "human" {
		actorIdentity := tenant.Context{OrganizationID: item.OrganizationID, UserID: senderID}
		if err := lockWhatsAppActorRoles(ctx, tx, actorIdentity); err != nil {
			return err
		}
		actor, err := currentWhatsAppActor(ctx, tx, actorIdentity)
		if errors.Is(err, tenant.ErrOrganizationAccessDenied) {
			return ErrSessionAccessRevoked
		}
		if err != nil {
			return err
		}
		if !actor.HasPermission(permissions.WhatsAppOperate) {
			return fmt.Errorf("%w: permissao para operar WhatsApp revogada", ErrSessionAccessRevoked)
		}
	}
	var sessionID string
	err = tx.QueryRow(ctx, `select session.id::text,coalesce(session.provider,''),coalesce(session.status,''),coalesce(session.is_active,true)
	 from public.whatsapp_messages message join public.whatsapp_sessions session on session.id=message.session_id and session.organization_id=message.organization_id
	 where message.id=$1::uuid and message.organization_id=$2::uuid and message.session_id=$3::uuid and message.conversation_id=$4::uuid
	 and session.owner_user_id=$5::uuid and coalesce(message.sender_user_id::text,'')=$6
	 and coalesce(nullif(message.metadata->>'attendance_send_origin',''),message.metadata->>'origin','')=$7
	 and coalesce(message.metadata->>'session_access_grant_id','')=$8
	 for share of session`, item.MessageRowID, item.OrganizationID, item.SessionID, item.ConversationID, ownerID, senderID, origin, grantID).Scan(&sessionID, &provider, &sessionStatus, &sessionActive)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSessionAccessRevoked
	}
	if err != nil {
		return err
	}
	if provider != "evolution_go" || !sessionActive || sessionStatus == "deleted" {
		return ErrSessionAccessRevoked
	}
	if sessionStatus != "connected" {
		return fmt.Errorf("%w: %w", ErrProviderFailed, errWhatsAppOutboxSessionDisconnected)
	}
	sharedHuman := origin == "human" && senderID != ownerID
	if sharedHuman {
		if normalized, ok := normalizeUUID(grantID); !ok || normalized != grantID {
			// Older shared intents have no immutable grant identity. Sending them
			// under a newly granted permission would revive revoked work.
			return ErrSessionAccessRevoked
		}
	}
	// Owners and automations must also fence the current conversation/card.
	// Session -> conversation -> lead follows the mutation lock order, so a
	// transfer or rebind cannot slip between authorization and durable start.
	var currentLeadID string
	err = tx.QueryRow(ctx, `
		select conversation.lead_id::text
		from public.whatsapp_messages message
		join public.whatsapp_conversations conversation
		  on conversation.id = message.conversation_id
		 and conversation.organization_id = message.organization_id
		 and conversation.session_id = message.session_id
		 and conversation.lead_id = message.lead_id
		 and conversation.deleted_at is null
		where message.id = $1::uuid
		  and message.organization_id = $2::uuid
		  and message.session_id = $3::uuid
		  and message.conversation_id = $4::uuid
		for share of conversation
	`, item.MessageRowID, item.OrganizationID, item.SessionID,
		item.ConversationID).Scan(&currentLeadID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSessionAccessRevoked
	}
	if err != nil {
		return err
	}
	if err := lockWhatsAppOutboxEligibilityRow(ctx, tx, `
		select id::text from public.leads
		where organization_id = $1::uuid and id = $2::uuid for share
	`, item.OrganizationID, currentLeadID); err != nil {
		return err
	}
	if origin == "human" {
		if err := requireWhatsAppQueuePoolClaim(ctx, tx, item.OrganizationID, currentLeadID, senderID); err != nil {
			return err
		}
	}
	var currentAttendanceUserID string
	err = tx.QueryRow(ctx, `select attendance.user_id::text `+
		whatsappOutboxAttendanceSQL()+` order by attendance.joined_at, attendance.id limit 1`,
		item.MessageRowID, item.OrganizationID, item.SessionID, item.ConversationID).Scan(&currentAttendanceUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSessionAccessRevoked
	}
	if err != nil {
		return err
	}
	if currentAttendanceUserID != attendanceUserID {
		return ErrSessionAccessRevoked
	}

	var attendanceID string
	err = tx.QueryRow(ctx, `select attendance.id::text `+whatsappOutboxAttendanceSQL()+`
		and attendance.user_id = $5::uuid
		for share of binding, attendance
	`, item.MessageRowID, item.OrganizationID, item.SessionID,
		item.ConversationID, attendanceUserID).Scan(&attendanceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSessionAccessRevoked
	}
	if err != nil {
		return err
	}
	if err := lockWhatsAppOutboxTargetForStart(ctx, tx, item); err != nil {
		return err
	}
	if err := lockWhatsAppOutboxMediaSourceForStart(ctx, tx, item, senderID); err != nil {
		return err
	}
	if !sharedHuman && attendanceUserID == ownerID {
		return nil
	}

	// A shared human intent uses its immutable grant. An automation may use
	// the currently eligible assignee's attendance, without borrowing an old
	// human intent's grant identity.
	var lockedGrantID string
	err = tx.QueryRow(ctx, `
		select access.id::text
		from public.whatsapp_session_access access
		join public.whatsapp_sessions ws
		  on ws.id = access.session_id
		 and ws.organization_id = access.organization_id
		where access.organization_id = $1::uuid
		  and access.session_id = $2::uuid
		  and access.user_id = $3::uuid
		  and ($4::boolean = false or access.id::text = $5)
		  and ws.owner_user_id <> $3::uuid
		  and `+sessionGrantExistsSQL("ws", "$3::uuid", true)+`
		for share of access
	`, item.OrganizationID, item.SessionID, attendanceUserID, sharedHuman, grantID).Scan(&lockedGrantID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrSessionAccessRevoked
		}
		return err
	}
	return nil
}

func lockWhatsAppOutboxEligibilityRow(ctx context.Context, tx pgx.Tx, query string, args ...any) error {
	var lockedID string
	err := tx.QueryRow(ctx, query, args...).Scan(&lockedID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSessionAccessRevoked
	}
	return err
}
