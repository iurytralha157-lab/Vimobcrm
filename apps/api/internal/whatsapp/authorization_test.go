package whatsapp

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestConversationAuthorizationScopeArguments(t *testing.T) {
	broker := tenant.Context{
		OrganizationID: "20000000-0000-0000-0000-000000000001",
		UserID:         "10000000-0000-0000-0000-000000000001",
		MemberRole:     "user",
	}
	args := baseConversationArgs(broker)
	if len(args) != 4 {
		t.Fatalf("baseConversationArgs() length = %d, want 4", len(args))
	}
	if args[0] != broker.OrganizationID || args[1] != broker.UserID {
		t.Fatalf("tenant boundary arguments = %#v, want organization and user", args[:2])
	}
	if args[2] != false || args[3] != false {
		t.Fatalf("ordinary broker received elevated WhatsApp scope: %#v", args)
	}

	leader := broker
	leader.Permissions = []string{"lead_view_team"}
	leaderArgs := baseConversationArgs(leader)
	if leaderArgs[2] != false || leaderArgs[3] != true {
		t.Fatalf("team leader scope = %#v, want only lead_view_team", leaderArgs)
	}

	admin := broker
	admin.MemberRole = "admin"
	adminArgs := baseConversationArgs(admin)
	if adminArgs[2] != true {
		t.Fatalf("admin scope = %#v, want lead view-all", adminArgs)
	}
}

func TestConversationVisibilityAllowsLeadAccessOrOwnedUnlinkedConversation(t *testing.T) {
	query := conversationVisibilitySQL()
	required := []string{
		"ws.organization_id = wc.organization_id",
		"wc.lead_id is not null",
		"l.id is not null",
		"l.organization_id = wc.organization_id",
		"l.assigned_user_id = $2::uuid",
		"leader.organization_id = l.organization_id",
		"member.user_id = l.assigned_user_id",
		"wc.lead_id is null",
		"ws.owner_user_id = $2::uuid",
	}
	for _, fragment := range required {
		if !strings.Contains(query, fragment) {
			t.Fatalf("conversation visibility is missing %q:\n%s", fragment, query)
		}
	}
}

func TestLeadHistoryVisibilityKeepsDeletedSessionEvidence(t *testing.T) {
	query := leadHistoryVisibilitySQL()
	for _, fragment := range []string{
		"l.id is not null",
		"l.organization_id = wc.organization_id",
		"l.assigned_user_id = $2::uuid",
		"leader.organization_id = l.organization_id",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("lead history visibility is missing %q:\n%s", fragment, query)
		}
	}
	for _, forbidden := range []string{"ws.status", "ws.is_active", "ws.owner_user_id"} {
		if strings.Contains(query, forbidden) {
			t.Fatalf("lead history visibility depends on session lifecycle %q:\n%s", forbidden, query)
		}
	}
}

func TestMessageLeadPredicatesFailClosedOnMismatchedAttribution(t *testing.T) {
	if got := conversationMessageLeadMatchSQL(); got != "(wm.lead_id is null or wm.lead_id = wc.lead_id)" {
		t.Fatalf("conversation message predicate = %q", got)
	}
	if got := leadHistoryMessageLeadMatchSQL(); got != "(wm.lead_id = $5::uuid or (wm.lead_id is null and wc.lead_id = $5::uuid))" {
		t.Fatalf("lead history message predicate = %q", got)
	}
}

func TestProviderActionRequiresWhatsAppManager(t *testing.T) {
	repo := Repository{}
	_, err := repo.RunProviderAction(context.Background(), tenant.Context{
		OrganizationID: "20000000-0000-0000-0000-000000000001",
		UserID:         "10000000-0000-0000-0000-000000000001",
		MemberRole:     "user",
	}, ProviderActionRequest{Action: "send.text"})
	if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("RunProviderAction() error = %v, want organization access denied", err)
	}
}

func TestCreateOwnWhatsAppSessionAllowsOrganizationMemberWithModule(t *testing.T) {
	broker := tenant.Context{
		OrganizationID: "20000000-0000-0000-0000-000000000001",
		UserID:         "10000000-0000-0000-0000-000000000001",
		MemberRole:     "user",
		EnabledModules: []string{"crm", "whatsapp"},
	}
	if !canCreateOwnWhatsAppSession(broker) {
		t.Fatal("organization member with WhatsApp module should create their own session")
	}

	broker.EnabledModules = []string{"crm"}
	if canCreateOwnWhatsAppSession(broker) {
		t.Fatal("organization member without WhatsApp module should not create a session")
	}
}

func TestCreateOwnWhatsAppSessionAllowsOrganizationMemberWithQuota(t *testing.T) {
	maxSessions := 2
	broker := tenant.Context{
		OrganizationID: "20000000-0000-0000-0000-000000000001",
		UserID:         "10000000-0000-0000-0000-000000000001",
		MemberRole:     "user",
		EnabledModules: []string{"crm"},
	}

	if !canCreateOwnWhatsAppSessionWithQuota(broker, SessionQuota{MaxSessions: &maxSessions, CurrentSessions: 1, CanCreate: true}) {
		t.Fatal("organization member with WhatsApp quota should create their own session")
	}

	if canCreateOwnWhatsAppSessionWithQuota(broker, SessionQuota{MaxSessions: nil, CurrentSessions: 0, CanCreate: true}) {
		t.Fatal("organization member without module or WhatsApp quota should not create a session")
	}
}

func TestGenericProviderActionCannotBypassLeadBoundAPIs(t *testing.T) {
	for _, action := range []string{
		"send.text",
		"send.media",
		"chat.historySync",
		"user.contacts",
		"group.myAll",
		"message.delete",
		"message.react",
		"instance.advancedSettings",
	} {
		if _, allowed := providerActionAllowed(action); allowed {
			t.Fatalf("providerActionAllowed(%q) bypasses the lead-bound API", action)
		}
	}
	for _, action := range []string{"instance.status", "instance.qr", "label.list", "user.check", "user.avatar"} {
		requireSend, allowed := providerActionAllowed(action)
		if !allowed || requireSend {
			t.Fatalf("providerActionAllowed(%q) = send:%t allowed:%t", action, requireSend, allowed)
		}
	}
}

func TestReactionTargetAuthorizationIsConversationAndLeadBound(t *testing.T) {
	query := reactionTargetAuthorizationSQL()
	required := []string{
		"wm.organization_id = $1::uuid",
		"wc.id = $5::uuid",
		"wm.id = $6::uuid",
		conversationMessageLeadMatchSQL(),
		"wc.session_id = ws.id",
		"ws.owner_user_id = $2::uuid",
		"l.organization_id = wc.organization_id",
		"l.assigned_user_id = $2::uuid",
	}
	for _, fragment := range required {
		if !strings.Contains(query, fragment) {
			t.Fatalf("reaction authorization is missing %q:\n%s", fragment, query)
		}
	}
}
