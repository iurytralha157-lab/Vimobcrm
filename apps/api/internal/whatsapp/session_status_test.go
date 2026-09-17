package whatsapp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	sessionStatusTestOrganizationID = "11111111-1111-4111-8111-111111111111"
	sessionStatusTestUserID         = "22222222-2222-4222-8222-222222222222"
	sessionStatusTestLedUserID      = "33333333-3333-4333-8333-333333333333"
	sessionStatusTestTeamID         = "44444444-4444-4444-8444-444444444444"
)

func TestResolveSessionStatusScopeRBAC(t *testing.T) {
	tests := []struct {
		name       string
		context    tenant.Context
		wantKind   string
		wantAll    bool
		wantTeam   bool
		wantUsers  []string
		wantTeams  []string
		wantDenied bool
	}{
		{
			name: "administrator sees organization",
			context: tenant.Context{
				OrganizationID: sessionStatusTestOrganizationID,
				UserID:         sessionStatusTestUserID,
				MemberRole:     "admin",
			},
			wantKind:  sessionStatusScopeOrganization,
			wantAll:   true,
			wantUsers: []string{},
		},
		{
			name: "owner sees organization",
			context: tenant.Context{
				OrganizationID: sessionStatusTestOrganizationID,
				UserID:         sessionStatusTestUserID,
				MemberRole:     "owner",
			},
			wantKind:  sessionStatusScopeOrganization,
			wantAll:   true,
			wantUsers: []string{},
		},
		{
			name: "super administrator sees selected organization",
			context: tenant.Context{
				OrganizationID: sessionStatusTestOrganizationID,
				UserID:         sessionStatusTestUserID,
				IsSuperAdmin:   true,
			},
			wantKind:  sessionStatusScopeOrganization,
			wantAll:   true,
			wantUsers: []string{},
		},
		{
			name: "leader sees self and deduplicated led scope",
			context: tenant.Context{
				OrganizationID: sessionStatusTestOrganizationID,
				UserID:         sessionStatusTestUserID,
				MemberRole:     "user",
				IsTeamLeader:   true,
				LedUserIDs: []string{
					sessionStatusTestLedUserID,
					strings.ToUpper(sessionStatusTestLedUserID),
					"invalid-user-id",
				},
				LedTeamIDs: []string{
					sessionStatusTestTeamID,
					strings.ToUpper(sessionStatusTestTeamID),
					"invalid-team-id",
				},
			},
			wantKind:  sessionStatusScopeTeam,
			wantTeam:  true,
			wantUsers: []string{sessionStatusTestUserID, sessionStatusTestLedUserID},
			wantTeams: []string{sessionStatusTestTeamID},
		},
		{
			name: "member sees only self even with management permission and stale led ids",
			context: tenant.Context{
				OrganizationID: sessionStatusTestOrganizationID,
				UserID:         sessionStatusTestUserID,
				MemberRole:     "user",
				Permissions:    []string{permissions.WhatsAppManage},
				LedUserIDs:     []string{sessionStatusTestLedUserID},
				LedTeamIDs:     []string{sessionStatusTestTeamID},
			},
			wantKind:  sessionStatusScopeSelf,
			wantUsers: []string{sessionStatusTestUserID},
		},
		{
			name: "missing organization is denied",
			context: tenant.Context{
				UserID: sessionStatusTestUserID,
			},
			wantDenied: true,
		},
		{
			name: "invalid caller is denied",
			context: tenant.Context{
				OrganizationID: sessionStatusTestOrganizationID,
				UserID:         "not-a-uuid",
			},
			wantDenied: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			scope, err := resolveSessionStatusScope(test.context)
			if test.wantDenied {
				if err == nil {
					t.Fatal("resolveSessionStatusScope() succeeded, want fail-closed denial")
				}
				return
			}
			if err != nil {
				t.Fatalf("resolveSessionStatusScope() error = %v", err)
			}
			if scope.Kind != test.wantKind || scope.AllOrganization != test.wantAll || scope.IncludeLedTeamMembers != test.wantTeam {
				t.Fatalf("scope flags = %#v", scope)
			}
			if !reflect.DeepEqual(scope.UserIDs, test.wantUsers) {
				t.Fatalf("scope.UserIDs = %v, want %v", scope.UserIDs, test.wantUsers)
			}
			if !reflect.DeepEqual(scope.TeamIDs, test.wantTeams) {
				t.Fatalf("scope.TeamIDs = %v, want %v", scope.TeamIDs, test.wantTeams)
			}
		})
	}
}

func TestSessionStatusQueryRevalidatesTenantActivityAndLeadership(t *testing.T) {
	spec, err := buildSessionStatusQuery(tenant.Context{
		OrganizationID: sessionStatusTestOrganizationID,
		UserID:         sessionStatusTestUserID,
		MemberRole:     "user",
		IsTeamLeader:   true,
		LedUserIDs:     []string{sessionStatusTestLedUserID},
		LedTeamIDs:     []string{sessionStatusTestTeamID},
	})
	if err != nil {
		t.Fatalf("buildSessionStatusQuery() error = %v", err)
	}

	for _, required := range []string{
		"ws.organization_id = $1::uuid",
		"active_organization.id = $1::uuid",
		"coalesce(active_organization.is_active, true) = true",
		"caller_user.id = $2::uuid",
		"coalesce(caller_user.is_active, false) = true",
		"caller_membership.organization_id = $1::uuid",
		"caller_membership.deleted_at is null",
		"administrative_membership.user_id = $2::uuid",
		"lower(btrim(administrative_membership.role)) in",
		"join public.users owner",
		"coalesce(owner.is_active, false) = true",
		"owner_membership.organization_id = $1::uuid",
		"owner_membership.user_id = ws.owner_user_id",
		"owner_membership.deleted_at is null",
		"ws.owner_user_id = $2::uuid",
		"leader.team_id = any($7::uuid[])",
		"member.user_id = any($6::uuid[])",
		"coalesce(leader.is_leader, false) = true",
		"member.user_id = ws.owner_user_id",
		"ws.provider in ('evolution', 'evolution_go')",
	} {
		if !strings.Contains(spec.SQL, required) {
			t.Errorf("query is missing security predicate %q", required)
		}
	}

	if len(spec.Args) != 7 {
		t.Fatalf("query args = %d, want 7", len(spec.Args))
	}
	if got := spec.Args[0]; got != sessionStatusTestOrganizationID {
		t.Fatalf("organization arg = %v", got)
	}
	if got := spec.Args[1]; got != sessionStatusTestUserID {
		t.Fatalf("caller arg = %v", got)
	}
	if got := spec.Args[4]; got != true {
		t.Fatalf("team restriction arg = %v, want true", got)
	}
	if got := spec.Args[5]; !reflect.DeepEqual(got, []string{sessionStatusTestUserID, sessionStatusTestLedUserID}) {
		t.Fatalf("visible user args = %v", got)
	}
	if got := spec.Args[6]; !reflect.DeepEqual(got, []string{sessionStatusTestTeamID}) {
		t.Fatalf("led team args = %v", got)
	}
}

func TestListSessionStatusesFailsClosedBeforeDatabaseAccess(t *testing.T) {
	tests := []struct {
		name    string
		context *tenant.Context
	}{
		{name: "missing tenant"},
		{
			name: "invalid caller",
			context: &tenant.Context{
				OrganizationID: sessionStatusTestOrganizationID,
				UserID:         "not-a-uuid",
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/v1/whatsapp/session-statuses", nil)
			if test.context != nil {
				request = request.WithContext(tenant.ContextWithTenant(request.Context(), *test.context))
			}
			response := httptest.NewRecorder()

			Handler{}.ListSessionStatuses(response, request)

			if response.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusForbidden, response.Body.String())
			}
			if got := response.Header().Get("Cache-Control"); got != "private, no-store" {
				t.Fatalf("Cache-Control = %q", got)
			}
		})
	}
}

func TestSessionStatusQuerySelectsNoConversationOrProviderSecrets(t *testing.T) {
	query := strings.ToLower(listSessionStatusesSQL)
	for _, forbidden := range []string{
		"whatsapp_conversations",
		"whatsapp_messages",
		"remote_jid",
		"advanced_settings",
		"last_message",
		"unread_count",
		"metadata",
		"instance_id",
		"instance_name",
		"qr_code",
		"token",
	} {
		if strings.Contains(query, forbidden) {
			t.Errorf("status query contains forbidden field/relation %q", forbidden)
		}
	}
}

func TestSessionStatusCapabilitiesStayOwnerScopedAndAdminOnlyForNotifications(t *testing.T) {
	tests := []struct {
		name                string
		context             tenant.Context
		ownerUserID         string
		supportsManagement  bool
		wantManage          bool
		wantNotificationSet bool
	}{
		{
			name: "admin may manage own notification sender",
			context: tenant.Context{
				UserID:     sessionStatusTestUserID,
				MemberRole: "admin",
			},
			ownerUserID:         sessionStatusTestUserID,
			supportsManagement:  true,
			wantManage:          true,
			wantNotificationSet: true,
		},
		{
			name: "admin cannot manage another users session",
			context: tenant.Context{
				UserID:     sessionStatusTestUserID,
				MemberRole: "admin",
			},
			ownerUserID:        sessionStatusTestLedUserID,
			supportsManagement: true,
		},
		{
			name: "leader may manage own session but not select notification sender",
			context: tenant.Context{
				UserID:       sessionStatusTestUserID,
				MemberRole:   "user",
				IsTeamLeader: true,
				Permissions:  []string{permissions.WhatsAppManage},
			},
			ownerUserID:        sessionStatusTestUserID,
			supportsManagement: true,
			wantManage:         true,
		},
		{
			name: "legacy provider remains visible but view-only",
			context: tenant.Context{
				UserID:     sessionStatusTestUserID,
				MemberRole: "admin",
			},
			ownerUserID: sessionStatusTestUserID,
		},
		{
			name: "member without manage permission has view-only capability",
			context: tenant.Context{
				UserID:     sessionStatusTestUserID,
				MemberRole: "user",
			},
			ownerUserID:        sessionStatusTestUserID,
			supportsManagement: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			capabilities := sessionStatusCapabilitiesFor(test.context, test.ownerUserID, test.supportsManagement)
			if capabilities.CanManage != test.wantManage {
				t.Fatalf("CanManage = %v, want %v", capabilities.CanManage, test.wantManage)
			}
			if capabilities.CanSetNotificationSender != test.wantNotificationSet {
				t.Fatalf("CanSetNotificationSender = %v, want %v", capabilities.CanSetNotificationSender, test.wantNotificationSet)
			}
		})
	}
}

func TestDefaultTeamLeaderSatisfiesSessionStatusRoutePermission(t *testing.T) {
	resolved := permissions.Resolve("user", true, nil, nil)
	context := tenant.Context{Permissions: resolved, IsTeamLeader: true}
	if !context.HasPermission(permissions.WhatsAppView) {
		t.Fatalf("default leader permissions do not include %s: %v", permissions.WhatsAppView, resolved)
	}

	denied := permissions.Resolve("user", true, nil, map[string]bool{
		permissions.WhatsAppView:    false,
		permissions.WhatsAppOperate: false,
		permissions.WhatsAppManage:  false,
	})
	deniedContext := tenant.Context{Permissions: denied, IsTeamLeader: true}
	if deniedContext.HasPermission(permissions.WhatsAppView) {
		t.Fatalf("explicit WhatsApp denial must remain authoritative: %v", denied)
	}
}

func TestSessionStatusJSONContractIsMinimal(t *testing.T) {
	updatedAt := time.Date(2026, time.September, 12, 13, 45, 0, 0, time.UTC)
	connectedAt := updatedAt.Add(-time.Minute)
	phoneNumber := "5511999999999"
	profileName := "Atendimento"
	payload := Envelope[[]SessionStatus]{
		Data: []SessionStatus{{
			ID:              "55555555-5555-4555-8555-555555555555",
			DisplayName:     "WhatsApp Comercial",
			Status:          "connected",
			PhoneNumber:     &phoneNumber,
			ProfileName:     &profileName,
			LastConnectedAt: &connectedAt,
			UpdatedAt:       updatedAt,
			Owner: SessionStatusOwner{
				ID:   sessionStatusTestUserID,
				Name: "Usuário",
			},
			Capabilities: SessionStatusCapabilities{
				CanManage:                true,
				CanSetNotificationSender: true,
			},
		}},
		Meta: SessionStatusListMeta{Scope: sessionStatusScopeOrganization},
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	for _, forbidden := range []string{
		"organization_id",
		"instance_id",
		"instance_name",
		"provider",
		"advanced_settings",
		"remote_jid",
		"content",
		"count",
		"email",
		"token",
		"qr_code",
	} {
		if strings.Contains(strings.ToLower(string(raw)), forbidden) {
			t.Errorf("serialized status leaks forbidden field %q: %s", forbidden, raw)
		}
	}

	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	assertSessionStatusJSONKeys(t, decoded, []string{"data", "meta"})
	data, ok := decoded["data"].([]any)
	if !ok || len(data) != 1 {
		t.Fatalf("data = %#v", decoded["data"])
	}
	item, ok := data[0].(map[string]any)
	if !ok {
		t.Fatalf("status item = %#v", data[0])
	}
	assertSessionStatusJSONKeys(t, item, []string{
		"capabilities",
		"display_name",
		"id",
		"last_connected_at",
		"owner",
		"phone_number",
		"profile_name",
		"status",
		"updated_at",
	})
	assertSessionStatusJSONKeys(t, item["owner"].(map[string]any), []string{"avatar_url", "id", "name"})
	assertSessionStatusJSONKeys(t, item["capabilities"].(map[string]any), []string{
		"can_manage",
		"can_set_notification_sender",
	})
	assertSessionStatusJSONKeys(t, decoded["meta"].(map[string]any), []string{"scope"})
}

func assertSessionStatusJSONKeys(t *testing.T, value map[string]any, want []string) {
	t.Helper()
	got := make([]string, 0, len(value))
	for key := range value {
		got = append(got, key)
	}
	sort.Strings(got)
	wantCopy := append([]string(nil), want...)
	sort.Strings(wantCopy)
	if !reflect.DeepEqual(got, wantCopy) {
		t.Fatalf("JSON keys = %v, want %v", got, wantCopy)
	}
}
