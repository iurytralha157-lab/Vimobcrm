package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5"
)

// lockWhatsAppOutboxGrantForStart checks the exact grant on the same short
// transaction that writes the durable provider-started marker. A revoke that
// deletes the grant must serialize with this row lock. The transaction commits
// before provider I/O; a started send may finish after a later revoke.
func lockWhatsAppOutboxGrantForStart(ctx context.Context, tx pgx.Tx, item pendingWhatsAppOutbox) error {
	var senderID, ownerID, origin, grantID, provider, sessionStatus string
	var sessionActive bool
	err := tx.QueryRow(ctx, `
		select coalesce(message.sender_user_id::text, ''),
		       session.owner_user_id::text,
	       coalesce(nullif(message.metadata->>'attendance_send_origin', ''),
	                message.metadata->>'origin', ''),
		       coalesce(message.metadata->>'session_access_grant_id', ''),
		       coalesce(session.provider, ''),
		       coalesce(session.status, ''),
		       coalesce(session.is_active, true)
		from public.whatsapp_messages message
		join public.whatsapp_sessions session
		  on session.id = message.session_id
		 and session.organization_id = message.organization_id
		where message.id = $1::uuid
		  and message.organization_id = $2::uuid
		  and message.session_id = $3::uuid
		  and message.conversation_id = $4::uuid
		for share of session
	`, item.MessageRowID, item.OrganizationID, item.SessionID, item.ConversationID).
		Scan(&senderID, &ownerID, &origin, &grantID, &provider, &sessionStatus, &sessionActive)
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
	if origin == "automation" || senderID == "" || (grantID == "" && senderID == ownerID) {
		return nil
	}
	if normalized, ok := normalizeUUID(grantID); !ok || normalized != grantID {
		// Older shared intents have no immutable grant identity. Sending them
		// under a newly granted permission would revive revoked work.
		return ErrSessionAccessRevoked
	}
	// A grant never authorizes a different lead. Take the lead read fence in the
	// same short transaction as provider_delivery_started so a transfer cannot
	// slip between the final check and the durable start marker.
	var assignedLeadID string
	err = tx.QueryRow(ctx, `
		select lead.id::text
		from public.whatsapp_messages message
		join public.leads lead
		  on lead.id = message.lead_id
		 and lead.organization_id = message.organization_id
		where message.id = $1::uuid
		  and message.organization_id = $2::uuid
		  and message.session_id = $3::uuid
		  and message.conversation_id = $4::uuid
		  and message.sender_user_id = $5::uuid
		  and lead.assigned_user_id = $5::uuid
		for share of lead
	`, item.MessageRowID, item.OrganizationID, item.SessionID,
		item.ConversationID, senderID).Scan(&assignedLeadID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSessionAccessRevoked
	}
	if err != nil {
		return err
	}
	// A grant is valid only while its owner and recipient remain active members,
	// and a team grant is valid only while the team and both members remain
	// active. Lock those exact rows before writing provider_delivery_started.
	// Their UPDATE/DELETE must either commit first (the final eligibility check
	// rejects the send) or wait for this short transaction to commit. The locks
	// are released before Evolution is called.
	// Different sessions can reverse owner and sender. Use one global user-row
	// order so their simultaneous sends cannot deadlock on those shared rows.
	userIDs := []string{ownerID, senderID}
	sort.Strings(userIDs)
	for index, userID := range userIDs {
		if index > 0 && userID == userIDs[index-1] {
			continue
		}
		if err := lockWhatsAppOutboxEligibilityRow(ctx, tx, `
			select id::text from public.users where id = $1::uuid for share
		`, userID); err != nil {
			return err
		}
		if err := lockWhatsAppOutboxEligibilityRow(ctx, tx, `
			select user_id::text from public.organization_members
			where organization_id = $1::uuid and user_id = $2::uuid for share
		`, item.OrganizationID, userID); err != nil {
			return err
		}
	}

	var grantScope string
	var grantTeamID *string
	err = tx.QueryRow(ctx, `
		select coalesce(grant_scope, ''), grant_team_id::text
		from public.whatsapp_session_access
		where id = $1::uuid
		  and organization_id = $2::uuid
		  and session_id = $3::uuid
		  and user_id = $4::uuid
	`, grantID, item.OrganizationID, item.SessionID, senderID).Scan(&grantScope, &grantTeamID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSessionAccessRevoked
	}
	if err != nil {
		return err
	}
	if grantScope == "team" && grantTeamID != nil {
		if err := lockWhatsAppOutboxEligibilityRow(ctx, tx, `
			select id::text from public.teams
			where organization_id = $1::uuid and id = $2::uuid for share
		`, item.OrganizationID, *grantTeamID); err != nil {
			return err
		}
		for index, userID := range userIDs {
			if index > 0 && userID == userIDs[index-1] {
				continue
			}
			if err := lockWhatsAppOutboxEligibilityRow(ctx, tx, `
				select user_id::text from public.team_members
				where organization_id = $1::uuid and team_id = $2::uuid
				  and user_id = $3::uuid for share
			`, item.OrganizationID, *grantTeamID, userID); err != nil {
				return err
			}
		}
	}

	var lockedGrantID string
	err = tx.QueryRow(ctx, `
		select access.id::text
		from public.whatsapp_session_access access
		join public.whatsapp_sessions ws
		  on ws.id = access.session_id
		 and ws.organization_id = access.organization_id
		where access.id = $1::uuid
		  and access.organization_id = $2::uuid
		  and access.session_id = $3::uuid
		  and access.user_id = $4::uuid
		  and access.grant_scope = $5
		  and access.grant_team_id is not distinct from $6::uuid
		  and ws.owner_user_id <> $4::uuid
		  and `+sessionGrantExistsSQL("ws", "$4::uuid", true)+`
		for share of access
	`, grantID, item.OrganizationID, item.SessionID, senderID,
		grantScope, grantTeamID).Scan(&lockedGrantID)
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
