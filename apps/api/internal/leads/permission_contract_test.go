package leads

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
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

	createOnlyContext := tenant.Context{UserID: "user-1", OrganizationID: "org-1", Permissions: []string{permissions.LeadCreate}}
	if canCreateLeadInput(createOnlyContext, createInput{ImportMode: true}) {
		t.Fatal("lead_create must not authorize import rows without lead_import")
	}
}

func TestContactExportModeRequiresLeadExport(t *testing.T) {
	for _, mode := range []string{"export", "full"} {
		t.Run(mode, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/v1/contacts?mode="+mode, nil)
			request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{UserID: "user-1", OrganizationID: "org-1", Permissions: []string{permissions.LeadViewOwn}}))
			response := httptest.NewRecorder()
			Handler{}.ListContacts(response, request)
			if response.Code != http.StatusForbidden {
				t.Fatalf("%s status = %d, want %d", mode, response.Code, http.StatusForbidden)
			}
		})
	}
}

func TestContactListModeDefaultsToCompact(t *testing.T) {
	filter, err := ParseContactListFilter(url.Values{})
	if err != nil {
		t.Fatalf("ParseContactListFilter returned error: %v", err)
	}
	if filter.Mode != "compact" {
		t.Fatalf("default mode = %q, want compact", filter.Mode)
	}
}

func TestContactWhereCombinesSearchAndCreatedRange(t *testing.T) {
	tenantContext := tenant.Context{
		UserID:         "user-1",
		OrganizationID: "org-1",
		Permissions:    []string{permissions.LeadViewOwn},
	}

	for _, testCase := range []struct {
		name       string
		campaignID string
		fromSQL    string
		toSQL      string
	}{
		{
			name:    "lead creation range",
			fromSQL: "l.created_at >= $",
			toSQL:   "l.created_at <= $",
		},
		{
			name:       "attribution occurrence range",
			campaignID: "campaign-1",
			fromSQL:    "entry.occurred_at >= $",
			toSQL:      "entry.occurred_at <= $",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			where, _, err := buildContactWhere(tenantContext, ContactListFilter{
				Search:      "Ana",
				CampaignID:  testCase.campaignID,
				CreatedFrom: "2026-09-01T00:00:00Z",
				CreatedTo:   "2026-09-02T23:59:59Z",
			})
			if err != nil {
				t.Fatalf("buildContactWhere returned error: %v", err)
			}

			query := strings.Join(where, " ")
			if !strings.Contains(query, testCase.fromSQL) {
				t.Fatalf("query does not combine search with lower date bound: %s", query)
			}
			if !strings.Contains(query, testCase.toSQL) {
				t.Fatalf("query does not combine search with upper date bound: %s", query)
			}
		})
	}
}
