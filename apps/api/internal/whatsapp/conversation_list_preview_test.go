package whatsapp

import (
	"testing"
	"time"
)

func TestConversationListPreviewCarriesSameHeadIdentityWithoutMovingCursor(t *testing.T) {
	cursor := time.Date(2026, 10, 18, 10, 0, 0, 0, time.UTC)
	conversation := Conversation{LastMessageAt: &cursor}
	err := applyConversationListPreview(&conversation, `{"preview":"Synthetic","from_me":true,"status":"delivered","id":"00000000-0000-4000-8000-000000000001","sent_at":"2026-10-18T09:59:00Z"}`)
	if err != nil {
		t.Fatal(err)
	}
	if conversation.LastMessageID == nil || *conversation.LastMessageID != "00000000-0000-4000-8000-000000000001" || conversation.LastMessageSentAt == nil || conversation.LastMessageSentAt.Hour() != 9 {
		t.Fatalf("head identity missing: %+v", conversation)
	}
	if conversation.LastMessageAt != &cursor {
		t.Fatal("head projection changed inbox cursor")
	}
	if err := applyConversationListPreview(&conversation, `{"preview":null,"from_me":null,"status":null}`); err != nil {
		t.Fatal(err)
	}
	if conversation.LastMessageID != nil || conversation.LastMessageSentAt != nil {
		t.Fatal("empty head retained a former identity")
	}
}
