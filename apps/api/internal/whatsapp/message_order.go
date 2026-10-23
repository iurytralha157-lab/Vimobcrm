package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const messageOrderTimestampLayout = "2006-01-02T15:04:05.000000Z"

// The immutable ingress route predates native processing. A route admitted
// after a legacy/outbox row (such as a later echo) must not change its order.
// The exact PK guarantees at most one row. No global sequence leaves the API.
func messageIngressOrderSQL() string {
	return `coalesce((select ordering_route.ingress_sequence
		from public.whatsapp_webhook_routing_snapshots ordering_route
		where ordering_route.organization_id = wm.organization_id
		  and ordering_route.session_id = wm.session_id
		  and ordering_route.provider_message_id = coalesce(wm.provider_message_id, wm.message_id)
		  and ordering_route.created_at <= wm.created_at), 0::bigint)`
}

func messageOrderSQL(filter MessageFilter) string {
	if filter.OrderingVersion != 2 {
		return "coalesce(wm.sent_at, wm.created_at) desc, wm.id desc"
	}
	return "coalesce(wm.sent_at, wm.created_at) desc, wm.created_at desc, " + messageIngressOrderSQL() + " desc, wm.id desc"
}

func messageCursor(message Message, filter MessageFilter) string {
	if filter.OrderingVersion == 2 {
		return "v2|" + message.SentAt.UTC().Format(messageOrderTimestampLayout) + "|" +
			message.OrderCreatedAt.UTC().Format(messageOrderTimestampLayout) + "|" + message.ID
	}
	return message.SentAt.UTC().Format(time.RFC3339Nano) + "|" + message.ID
}

// Resolve the cursor only within the identical tenant/conversation/lead view
// used for this page. Missing/revoked/mismatched anchors fail closed, rather
// than silently resuming with an older protocol or a caller-supplied sequence.
func (repo Repository) appendCanonicalMessageCursor(ctx context.Context, args *[]any,
	where *[]string, fromSQL string, filter MessageFilter) error {
	if filter.CursorAt == nil {
		return nil
	}
	if filter.CursorCreatedAt == nil || filter.CursorID == "" {
		return fmt.Errorf("%w: canonical message cursor is incomplete", ErrInvalidInput)
	}
	anchorArgs := append([]any{}, (*args)...)
	anchorArgs = append(anchorArgs, filter.CursorID, *filter.CursorAt, *filter.CursorCreatedAt)
	last := len(anchorArgs)
	anchorPredicate := fmt.Sprintf("wm.id = $%d::uuid and coalesce(wm.sent_at, wm.created_at) = $%d::timestamptz and wm.created_at = $%d::timestamptz",
		last-2, last-1, last)
	var sequence int64
	err := repo.db.Pool().QueryRow(ctx, "select "+messageIngressOrderSQL()+fromSQL+
		" where "+strings.Join(*where, " and ")+" and $6::integer > 0 and "+anchorPredicate,
		anchorArgs...).Scan(&sequence)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrMessageCursorRebaseRequired
	}
	if err != nil {
		return err
	}
	*args = append(*args, *filter.CursorAt, *filter.CursorCreatedAt, sequence, filter.CursorID)
	last = len(*args)
	*where = append(*where, fmt.Sprintf("(coalesce(wm.sent_at, wm.created_at), wm.created_at, %s, wm.id) < ($%d::timestamptz, $%d::timestamptz, $%d::bigint, $%d::uuid)",
		messageIngressOrderSQL(), last-3, last-2, last-1, last))
	return nil
}
