package ai

import (
	"os"
	"strings"
	"testing"
)

func TestConversationAIStateWriteIsFencedByCurrentWhatsAppLead(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)

	required := []string{
		"with whatsapp_binding_guard as materialized",
		"wc.organization_id = $1::uuid",
		"wc.id = $2::uuid",
		"wc.lead_id = nullif($5, '')::uuid",
		"for share",
		"exists (select 1 from whatsapp_binding_guard)",
		"from allowed_conversation",
	}
	for _, fragment := range required {
		if !strings.Contains(text, fragment) {
			t.Fatalf("SaveConversationState is missing WhatsApp binding fence %q", fragment)
		}
	}
}
