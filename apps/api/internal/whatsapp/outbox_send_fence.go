package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

// holdWhatsAppOutboxGrant locks the exact grant that authorized a human
// outbound intent. FOR SHARE allows concurrent sends but makes DELETE/UPDATE
// of that grant wait until the provider call finishes. The separate pool keeps
// the ordinary query pool available to resolve the Evolution session and renew
// the outbox lease while this transaction is open.
func (repo Repository) holdWhatsAppOutboxGrant(ctx context.Context, item pendingWhatsAppOutbox) (func(), error) {
	var senderID, ownerID, origin, grantID string
	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce(message.sender_user_id::text, ''),
		       session.owner_user_id::text,
		       coalesce(message.metadata->>'origin', ''),
		       coalesce(message.metadata->>'session_access_grant_id', '')
		from public.whatsapp_messages message
		join public.whatsapp_sessions session
		  on session.id = message.session_id
		 and session.organization_id = message.organization_id
		where message.id = $1::uuid
		  and message.organization_id = $2::uuid
		  and message.session_id = $3::uuid
		  and message.conversation_id = $4::uuid
	`, item.MessageRowID, item.OrganizationID, item.SessionID, item.ConversationID).
		Scan(&senderID, &ownerID, &origin, &grantID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSessionAccessRevoked
	}
	if err != nil {
		return nil, err
	}
	if origin == "automation" || senderID == "" || (grantID == "" && senderID == ownerID) {
		return func() {}, nil
	}
	if normalized, ok := normalizeUUID(grantID); !ok || normalized != grantID {
		// Older shared intents have no immutable grant identity. Sending them
		// under a newly granted permission would revive revoked work.
		return nil, ErrSessionAccessRevoked
	}
	if repo.outboxSendFenceError != nil {
		return nil, repo.outboxSendFenceError
	}
	if repo.outboxSendFencePool == nil {
		return nil, fmt.Errorf("WhatsApp shared-send fence pool is unavailable")
	}

	tx, err := repo.outboxSendFencePool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	var once sync.Once
	release := func() {
		once.Do(func() {
			cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = tx.Rollback(cleanupCtx)
		})
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
		  and ws.owner_user_id <> $4::uuid
		  and `+sessionGrantExistsSQL("ws", "$4::uuid", true)+`
		for share of access
	`, grantID, item.OrganizationID, item.SessionID, senderID).Scan(&lockedGrantID)
	if err != nil {
		release()
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrSessionAccessRevoked
		}
		return nil, err
	}
	return release, nil
}
