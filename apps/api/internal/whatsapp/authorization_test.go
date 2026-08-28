package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestConversationJSONUsesNullForUnavailableHistoricalSession(t *testing.T) {
	payload, err := json.Marshal(Conversation{
		ID:        "50000000-0000-4000-8000-000000000001",
		SessionID: "",
	})
	if err != nil {
		t.Fatal(err)
	}

	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatal(err)
	}
	if value, exists := decoded["session_id"]; !exists || value != nil {
		t.Fatalf("session_id = %#v (exists=%t), want explicit null", value, exists)
	}
}

func TestConversationJSONKeepsAuthorizedSessionUUID(t *testing.T) {
	sessionID := "40000000-0000-4000-8000-000000000001"
	payload, err := json.Marshal(Conversation{
		ID:        "50000000-0000-4000-8000-000000000001",
		SessionID: sessionID,
	})
	if err != nil {
		t.Fatal(err)
	}

	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["session_id"] != sessionID {
		t.Fatalf("session_id = %#v, want %q", decoded["session_id"], sessionID)
	}
}

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
	query := conversationVisibilitySQL(true)
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
	query := leadHistoryVisibilitySQL(true)
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

func TestNotificationSenderAdministrationRequiresOrganizationAdmin(t *testing.T) {
	tests := []struct {
		name string
		ctx  tenant.Context
		want bool
	}{
		{
			name: "ordinary user with WhatsApp management permission",
			ctx: tenant.Context{
				MemberRole:  "user",
				Permissions: []string{"whatsapp_manage"},
			},
			want: false,
		},
		{
			name: "organization admin",
			ctx:  tenant.Context{MemberRole: "admin"},
			want: true,
		},
		{
			name: "organization owner",
			ctx:  tenant.Context{MemberRole: "owner"},
			want: true,
		},
		{
			name: "super admin",
			ctx:  tenant.Context{MemberRole: "user", IsSuperAdmin: true},
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := canManageNotificationSender(tt.ctx); got != tt.want {
				t.Fatalf("canManageNotificationSender() = %t, want %t", got, tt.want)
			}
		})
	}
}

func TestToggleNotificationSessionRejectsOrdinaryUserBeforeDatabaseAccess(t *testing.T) {
	repo := Repository{}
	err := repo.ToggleNotificationSession(context.Background(), tenant.Context{
		OrganizationID: "20000000-0000-0000-0000-000000000001",
		UserID:         "10000000-0000-0000-0000-000000000001",
		MemberRole:     "user",
		Permissions:    []string{"whatsapp_manage"},
	}, "40000000-0000-0000-0000-000000000001", true)

	if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("ToggleNotificationSession() error = %v, want organization access denied", err)
	}
}

func TestLeadVisibilityCanDisableOwnLeadBranch(t *testing.T) {
	query := leadVisibilitySQL(false)
	if !strings.Contains(query, "(false and l.assigned_user_id = $2::uuid)") {
		t.Fatal("own-lead branch must be disabled when lead_view_own is denied")
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
	query := reactionTargetAuthorizationSQL(true)
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
