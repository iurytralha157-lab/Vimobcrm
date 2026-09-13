package whatsapp

import (
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	unreadCountOrganizationID = "11111111-1111-4111-8111-111111111111"
	unreadCountUserID         = "22222222-2222-4222-8222-222222222222"
	unreadCountSessionID      = "33333333-3333-4333-8333-333333333333"
	unreadCountSecondSession  = "44444444-4444-4444-8444-444444444444"
)

func TestConversationUnreadCountUsesCanonicalInboxScope(t *testing.T) {
	tenantContext := tenant.Context{
		OrganizationID: unreadCountOrganizationID,
		UserID:         unreadCountUserID,
		MemberRole:     "user",
		Permissions:    []string{"lead_view_own"},
	}
	filter := ConversationListFilter{
		SessionIDs:         []string{unreadCountSessionID, unreadCountSessionID, unreadCountSecondSession},
		AccessibleProvided: true,
		HideGroups:         true,
		OnlyLeads:          true,
		PendingReply:       true,
		Search:             "+55 (11) 99999-0000",
	}

	args, where, empty, err := conversationFilterSQL(tenantContext, filter)
	if err != nil {
		t.Fatalf("conversationFilterSQL() error = %v", err)
	}
	if empty {
		t.Fatal("valid explicit session scope must not be empty")
	}
	joined := strings.Join(where, " and ")
	for _, clause := range []string{
		"wc.organization_id = $1::uuid",
		"wc.deleted_at is null",
		"wc.session_id in ($5::uuid, $6::uuid)",
		"wc.is_group = false",
		"wc.lead_id is not null",
		"coalesce(wc.unread_count, 0) > 0",
		"regexp_replace(coalesce(wc.contact_phone, ''), '\\D', '', 'g') like $8",
	} {
		if !strings.Contains(joined, clause) {
			t.Fatalf("canonical unread scope is missing %q:\n%s", clause, joined)
		}
	}
	if strings.Contains(joined, "wc.archived_at") {
		t.Fatalf("search must preserve the list's cross-archive behavior: %s", joined)
	}
	if len(args) != 8 || args[0] != unreadCountOrganizationID || args[1] != unreadCountUserID {
		t.Fatalf("unexpected canonical arguments: %#v", args)
	}
}

func TestConversationUnreadCountExplicitEmptySessionScopeIsFailClosed(t *testing.T) {
	_, _, empty, err := conversationFilterSQL(tenant.Context{
		OrganizationID: unreadCountOrganizationID,
		UserID:         unreadCountUserID,
	}, ConversationListFilter{AccessibleProvided: true})
	if err != nil {
		t.Fatalf("conversationFilterSQL() error = %v", err)
	}
	if !empty {
		t.Fatal("explicit empty session scope must return no conversations")
	}
}

func TestConversationUnreadCountRejectsInvalidSessionScope(t *testing.T) {
	_, _, _, err := conversationFilterSQL(tenant.Context{
		OrganizationID: unreadCountOrganizationID,
		UserID:         unreadCountUserID,
	}, ConversationListFilter{SessionID: "not-a-uuid"})
	if err == nil {
		t.Fatal("invalid session scope must be rejected")
	}
}

func TestConversationUnreadCountDefaultsToActiveInbox(t *testing.T) {
	_, where, empty, err := conversationFilterSQL(tenant.Context{
		OrganizationID: unreadCountOrganizationID,
		UserID:         unreadCountUserID,
	}, ConversationListFilter{})
	if err != nil || empty {
		t.Fatalf("default filter = empty:%v error:%v", empty, err)
	}
	if joined := strings.Join(where, " and "); !strings.Contains(joined, "wc.archived_at is null") {
		t.Fatalf("default count must match the active inbox: %s", joined)
	}
}
