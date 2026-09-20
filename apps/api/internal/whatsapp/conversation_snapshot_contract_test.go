package whatsapp

import (
	"os"
	"strings"
	"testing"
)

func TestConversationSnapshotReadIsTenantScopedAndNonMutating(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) GetConversationSnapshot(")
	end := strings.Index(source, "func (repo Repository) GetConversationForExpectedLead(")
	if start < 0 || end <= start {
		t.Fatal("conversation snapshot repository boundary is missing")
	}
	method := source[start:end]

	for _, required := range []string{
		"normalizeUUID(conversationID)",
		"wc.organization_id = $1::uuid",
		"wc.deleted_at is null",
		"conversationVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))",
		"wc.id = $5::uuid",
		"ErrConversationNotFound",
	} {
		if !strings.Contains(method, required) {
			t.Fatalf("conversation snapshot read is missing %q:\n%s", required, method)
		}
	}

	for _, forbidden := range []string{
		"resolveConversationLead(",
		"activateRepositoryWhatsAppConversationLeadBinding(",
		"attachConversationToLead(",
		"\n\t\tupdate public.",
		"\n\t\tinsert into public.",
	} {
		if strings.Contains(method, forbidden) {
			t.Fatalf("conversation snapshot read contains mutating fallback %q:\n%s", forbidden, method)
		}
	}
}
