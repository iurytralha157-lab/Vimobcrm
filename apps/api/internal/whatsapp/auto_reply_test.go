package whatsapp

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestAutoReplyInputPinsImmutableMessageLead(t *testing.T) {
	t.Parallel()
	const (
		organizationID = "11111111-1111-4111-8111-111111111111"
		sessionID      = "22222222-2222-4222-8222-222222222222"
		conversationID = "33333333-3333-4333-8333-333333333333"
		messageID      = "44444444-4444-4444-8444-444444444444"
		leadID         = "55555555-5555-4555-8555-555555555555"
	)
	input, err := (AutoReplyRequest{
		OrganizationID: organizationID,
		SessionID:      sessionID,
		ConversationID: conversationID,
		MessageID:      messageID,
		ExpectedLeadID: leadID,
	}).validate()
	if err != nil || input.ExpectedLeadID != leadID {
		t.Fatalf("AutoReplyRequest.validate() = %#v, %v", input, err)
	}
	if _, err := (AutoReplyRequest{
		OrganizationID: organizationID,
		SessionID:      sessionID,
		ConversationID: conversationID,
		MessageID:      messageID,
	}).validate(); err == nil {
		t.Fatal("AutoReplyRequest accepted a missing expectedLeadId")
	}
	if _, err := (AutoReplyRequest{
		OrganizationID: organizationID,
		SessionID:      sessionID,
		ConversationID: conversationID,
		MessageID:      messageID,
		ExpectedLeadID: unlinkedConversationLeadSnapshot,
	}).validate(); err == nil {
		t.Fatal("AutoReplyRequest accepted an unlinked conversation")
	}

	fromPayload, err := autoReplyInputFromPayload(map[string]any{
		"organizationId": organizationID,
		"sessionId":      sessionID,
		"conversationId": conversationID,
		"messageId":      messageID,
		"expectedLeadId": leadID,
	})
	if err != nil || fromPayload.ExpectedLeadID != leadID {
		t.Fatalf("autoReplyInputFromPayload() = %#v, %v", fromPayload, err)
	}
}

func TestAutoReplyContextSourceRequiresCurrentConversationAndMessageLead(t *testing.T) {
	t.Parallel()
	sourceBytes, err := os.ReadFile("auto_reply.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	for _, fragment := range []string{
		"and wc.lead_id = $4::uuid",
		"and event_message.lead_id = wc.lead_id",
		"and wm.lead_id = $5::uuid",
		"replyContext, err = handler.repo.loadAutoReplyContext(ctx, input)",
		`Reason: "binding_changed"`,
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("auto-reply binding fence is missing %q", fragment)
		}
	}
}

func TestAutoReplyEnqueueAtomicallyPinsConversationAndMessageLead(t *testing.T) {
	t.Parallel()
	sourceBytes, err := os.ReadFile("ai_worker.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	for _, fragment := range []string{
		"with bound_context as materialized",
		"message.lead_id = conversation.lead_id",
		"conversation.lead_id = $7::uuid",
		"for share of conversation, message",
		"from bound_context",
		"return false, errAutoReplyBindingStale",
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("auto-reply enqueue binding fence is missing %q", fragment)
		}
	}
}

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
