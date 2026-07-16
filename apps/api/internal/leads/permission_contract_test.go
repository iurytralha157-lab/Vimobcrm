package leads

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestImportModeUsesLeadImportPermission(t *testing.T) {
	context := tenant.Context{UserID: "user-1", OrganizationID: "org-1", Permissions: []string{permissions.LeadImport}}
	if !canCreateLeadInput(context, createInput{ImportMode: true}) {
		t.Fatal("lead_import should authorize an import row")
	}
	if canCreateLeadInput(context, createInput{}) {
		t.Fatal("lead_import must not authorize manual creation")
	}
}

func TestContactExportModeRequiresLeadExport(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/v1/contacts?mode=export", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{UserID: "user-1", OrganizationID: "org-1", Permissions: []string{permissions.LeadViewOwn}}))
	response := httptest.NewRecorder()
	Handler{}.ListContacts(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("export status = %d, want %d", response.Code, http.StatusForbidden)
	}
}
