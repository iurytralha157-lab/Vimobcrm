package whatsapp

import (
	"strings"
	"testing"
	"time"

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
		"select not wm.from_me",
		"wm.organization_id = wc.organization_id",
		"wm.conversation_id = wc.id",
		"wm.capture_state is distinct from 'suppressed'",
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

func TestOperationalInboxRequiresOwnedOrGrantedAssignedNumberForNonAdmin(t *testing.T) {
	_, where, empty, err := conversationFilterSQL(tenant.Context{
		OrganizationID: unreadCountOrganizationID,
		UserID:         unreadCountUserID,
		MemberRole:     "manager",
		Permissions:    []string{"lead_view_all"},
	}, ConversationListFilter{})
	if err != nil || empty {
		t.Fatalf("inbox filter = empty:%v error:%v", empty, err)
	}
	joined := strings.Join(where, " and ")
	for _, required := range []string{
		"ws.owner_user_id = $2::uuid",
		"l.assigned_user_id = $2::uuid",
		"access.session_id = ws.id",
		"access.can_view = true",
		"access.can_read = true",
		"wc.lead_id is not null and false",
	} {
		if !strings.Contains(joined, required) {
			t.Fatalf("inbox missing shared-session boundary %q", required)
		}
	}
	if strings.Contains(conversationVisibilitySQL(true), "sessionGrantExistsSQL") ||
		strings.Contains(conversationVisibilitySQL(true), "whatsapp_session_access") {
		t.Fatal("direct lead history visibility must not depend on a session grant")
	}
}

func TestAdminInboxCanReadOtherNumbersOnlyForLeads(t *testing.T) {
	_, where, empty, err := conversationFilterSQL(tenant.Context{
		OrganizationID: unreadCountOrganizationID,
		UserID:         unreadCountUserID,
		MemberRole:     "admin",
	}, ConversationListFilter{})
	if err != nil || empty {
		t.Fatalf("admin inbox filter = empty:%v error:%v", empty, err)
	}
	joined := strings.Join(where, " and ")
	if !strings.Contains(joined, "wc.lead_id is not null and true") ||
		!strings.Contains(joined, "wc.lead_id is null") ||
		!strings.Contains(joined, "ws.owner_user_id = $2::uuid") {
		t.Fatalf("admin lead inbox must keep unlinked conversations owner-only: %s", joined)
	}
}

func TestConversationPeriodUsesSameScopeForListAndUnreadCount(t *testing.T) {
	from := time.Date(2026, time.October, 1, 0, 0, 0, 0, time.UTC)
	to := from.Add(72 * time.Hour)
	args, where, empty, err := conversationFilterSQL(tenant.Context{
		OrganizationID: unreadCountOrganizationID,
		UserID:         unreadCountUserID,
	}, ConversationListFilter{LastMessageFrom: &from, LastMessageTo: &to})
	if err != nil || empty {
		t.Fatalf("period filter = empty:%v error:%v", empty, err)
	}
	joined := strings.Join(where, " and ")
	for _, clause := range []string{
		"wc.organization_id = $1::uuid",
		"wc.deleted_at is null",
		"wc.last_message_at >= $5::timestamptz",
		"wc.last_message_at <= $6::timestamptz",
	} {
		if !strings.Contains(joined, clause) {
			t.Fatalf("period scope is missing %q: %s", clause, joined)
		}
	}
	if len(args) != 6 || args[4] != from || args[5] != to {
		t.Fatalf("period arguments = %#v", args)
	}
}

func TestConversationLeadSourceUsesScopedParameterizedFilter(t *testing.T) {
	source := "Meta Ads' OR true --"
	args, where, empty, err := conversationFilterSQL(tenant.Context{
		OrganizationID: unreadCountOrganizationID,
		UserID:         unreadCountUserID,
	}, ConversationListFilter{LeadSource: source})
	if err != nil || empty {
		t.Fatalf("lead source filter = empty:%v error:%v", empty, err)
	}
	joined := strings.Join(where, " and ")
	if !strings.Contains(joined, "(l.organization_id = wc.organization_id and l.source = $5)") {
		t.Fatalf("source must match the linked lead in the same organization: %s", joined)
	}
	if strings.Contains(joined, source) || len(args) != 5 || args[4] != source {
		t.Fatalf("source must remain a bound argument: where=%s args=%#v", joined, args)
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
