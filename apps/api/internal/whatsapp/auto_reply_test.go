package whatsapp

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

type autoReplyExistsTestQuerier struct {
	sql  string
	args []any
	row  pgx.Row
}

func (querier *autoReplyExistsTestQuerier) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	querier.sql = sql
	querier.args = args
	return querier.row
}

type autoReplyExistsTestRow struct {
	exists bool
	err    error
}

func (row autoReplyExistsTestRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	*(dest[0].(*bool)) = row.exists
	return nil
}

func TestAutoReplyExistsTreatsManagedDistributionReplyAndReservationAsPrecedence(t *testing.T) {
	t.Parallel()

	const (
		organizationID = "11111111-1111-4111-8111-111111111111"
		conversationID = "22222222-2222-4222-8222-222222222222"
		messageID      = "33333333-3333-4333-8333-333333333333"
	)
	querier := &autoReplyExistsTestQuerier{row: autoReplyExistsTestRow{exists: true}}
	exists, err := autoReplyExistsWithQuerier(context.Background(), querier, autoReplyContext{
		Session:      Session{OrganizationID: organizationID},
		Conversation: Conversation{ID: conversationID},
		Message:      Message{ID: messageID},
	})
	if err != nil {
		t.Fatalf("auto reply exists: %v", err)
	}
	if !exists {
		t.Fatal("managed distribution reply must prevent a second AI auto reply")
	}
	for _, fragment := range []string{
		"from_me = true",
		"metadata->>'ai_reply_to_message_id' = $4::text",
		"metadata->>'managed_whatsapp_reply_to_message_id' = $4::text",
		"id = $4::uuid",
		"from_me = false",
		"jsonb_typeof(metadata->'managed_whatsapp_distribution_auto_reply_reservation') = 'object'",
		"metadata->'managed_whatsapp_distribution_auto_reply_reservation'->>'version' = 'v1'",
		"metadata->'managed_whatsapp_distribution_auto_reply_reservation'->>'entry_event_id'",
		"~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'",
	} {
		if !strings.Contains(querier.sql, fragment) {
			t.Fatalf("auto reply precedence query is missing %q: %s", fragment, querier.sql)
		}
	}
	wantArgs := []any{organizationID, conversationID, autoReplyClientMessagePrefix + messageID, messageID}
	if len(querier.args) != len(wantArgs) {
		t.Fatalf("query args = %#v, want %#v", querier.args, wantArgs)
	}
	for index := range wantArgs {
		if querier.args[index] != wantArgs[index] {
			t.Fatalf("query args = %#v, want %#v", querier.args, wantArgs)
		}
	}
}

func TestAutoReplyExistsScopesReservationToInboundMessageAndTenant(t *testing.T) {
	t.Parallel()

	querier := &autoReplyExistsTestQuerier{row: autoReplyExistsTestRow{exists: false}}
	exists, err := autoReplyExistsWithQuerier(context.Background(), querier, autoReplyContext{
		Session:      Session{OrganizationID: "11111111-1111-4111-8111-111111111111"},
		Conversation: Conversation{ID: "22222222-2222-4222-8222-222222222222"},
		Message:      Message{ID: "33333333-3333-4333-8333-333333333333"},
	})
	if err != nil {
		t.Fatalf("auto reply exists: %v", err)
	}
	if exists {
		t.Fatal("auto reply unexpectedly exists")
	}

	for _, fragment := range []string{
		"organization_id = $1::uuid",
		"conversation_id = $2::uuid",
		"id = $4::uuid",
		"and from_me = false",
	} {
		if !strings.Contains(querier.sql, fragment) {
			t.Fatalf("managed reservation query is missing scope %q: %s", fragment, querier.sql)
		}
	}
}

func TestAutoReplyExistsPropagatesQueryError(t *testing.T) {
	t.Parallel()

	expectedErr := errors.New("query failed")
	querier := &autoReplyExistsTestQuerier{row: autoReplyExistsTestRow{err: expectedErr}}
	exists, err := autoReplyExistsWithQuerier(context.Background(), querier, autoReplyContext{
		Session:      Session{OrganizationID: "11111111-1111-4111-8111-111111111111"},
		Conversation: Conversation{ID: "22222222-2222-4222-8222-222222222222"},
		Message:      Message{ID: "33333333-3333-4333-8333-333333333333"},
	})
	if exists {
		t.Fatal("auto reply unexpectedly exists after query error")
	}
	if !errors.Is(err, expectedErr) {
		t.Fatalf("auto reply error = %v, want %v", err, expectedErr)
	}
}
