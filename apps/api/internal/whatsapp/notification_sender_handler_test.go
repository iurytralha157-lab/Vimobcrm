package whatsapp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestToggleNotificationSessionHandlerRejectsNonAdminBeforeParsingOrDatabase(t *testing.T) {
	tests := []struct {
		name    string
		context tenant.Context
	}{
		{
			name: "ordinary member with WhatsApp management permission",
			context: tenant.Context{
				OrganizationID: sessionStatusTestOrganizationID,
				UserID:         sessionStatusTestUserID,
				MemberRole:     "user",
				Permissions:    []string{permissions.WhatsAppManage},
			},
		},
		{
			name: "team leader with WhatsApp management permission",
			context: tenant.Context{
				OrganizationID: sessionStatusTestOrganizationID,
				UserID:         sessionStatusTestUserID,
				MemberRole:     "user",
				IsTeamLeader:   true,
				Permissions:    []string{permissions.WhatsAppManage},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(
				http.MethodPost,
				"/v1/whatsapp/sessions/55555555-5555-4555-8555-555555555555/notification-session",
				strings.NewReader("not-json"),
			)
			request = request.WithContext(tenant.ContextWithTenant(request.Context(), test.context))
			response := httptest.NewRecorder()

			Handler{}.ToggleNotificationSession(response, request)

			if response.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusForbidden, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), `"code":"permission_denied"`) {
				t.Fatalf("body = %s, want permission_denied", response.Body.String())
			}
		})
	}
}
