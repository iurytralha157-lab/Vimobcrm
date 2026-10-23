package analytics

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestEnterpriseKPIsRejectsFinancialAccessBeforeQuerying(t *testing.T) {
	t.Setenv("FINANCIAL_ORGANIZATION_IDS", "")
	for _, viewer := range []tenant.Context{
		{UserID: businessBroker, OrganizationID: businessOrg, OrganizationName: "Vetter Co.", Permissions: []string{permissions.DashboardView}},
		{UserID: businessBroker, OrganizationID: businessOrg, OrganizationName: "Synthetic Other Company", Permissions: []string{permissions.DashboardView, permissions.FinancialView}},
	} {
		request := httptest.NewRequest(http.MethodGet, "/v1/analytics/enterprise-kpis", nil)
		request = request.WithContext(tenant.ContextWithTenant(request.Context(), viewer))
		response := httptest.NewRecorder()
		// A nil database makes this verify the permission guard runs before SQL.
		NewHandler(Repository{}).EnterpriseKPIs(response, request)
		if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "permission_denied") {
			t.Fatalf("expected explicit 403, got status=%d body=%s", response.Code, response.Body.String())
		}
	}
}

func TestDREExecutiveRejectsFinancialAccessBeforeQuerying(t *testing.T) {
	t.Setenv("FINANCIAL_ORGANIZATION_IDS", "")
	for _, scenario := range []struct {
		name   string
		viewer tenant.Context
	}{
		{"without financial permission", tenant.Context{UserID: businessBroker, OrganizationID: businessOrg, OrganizationName: "Vetter Co.", Permissions: []string{permissions.DashboardView}}},
		{"module disabled", tenant.Context{UserID: businessBroker, OrganizationID: businessOrg, OrganizationName: "Synthetic Other Company", Permissions: []string{permissions.FinancialView}}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			defer func() {
				if failure := recover(); failure != nil {
					t.Fatalf("denied request reached the nil database: %v", failure)
				}
			}()
			request := httptest.NewRequest(http.MethodGet, "/v1/analytics/dre-executive", nil)
			request = request.WithContext(tenant.ContextWithTenant(request.Context(), scenario.viewer))
			response := httptest.NewRecorder()
			NewHandler(Repository{}).DREExecutive(response, request)
			if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "permission_denied") {
				t.Fatalf("expected explicit 403, got status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}
