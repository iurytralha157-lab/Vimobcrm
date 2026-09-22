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
	}{
		{name: "lead creation range"},
		{name: "lead creation range with attribution", campaignID: "campaign-1"},
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
			if !strings.Contains(query, "l.created_at >= $") {
				t.Fatalf("query does not combine search with lower date bound: %s", query)
			}
			if !strings.Contains(query, "l.created_at <= $") {
				t.Fatalf("query does not combine search with upper date bound: %s", query)
			}
			if strings.Contains(query, "entry.occurred_at >=") || strings.Contains(query, "entry.occurred_at <=") {
				t.Fatalf("contact period must use the same lead-origin date as pipeline and dashboard: %s", query)
			}
		})
	}
}

func TestContactTeamFilterMatchesCurrentAssigneeTeam(t *testing.T) {
	teamID := "33333333-3333-4333-8333-333333333333"
	where, args, err := buildContactWhere(tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}, ContactListFilter{TeamID: teamID})
	if err != nil {
		t.Fatalf("buildContactWhere() error = %v", err)
	}
	query := strings.Join(where, " and ")
	teamClause := where[len(where)-1]
	for _, fragment := range []string{
		"from public.team_members dtm",
		"dtm.organization_id = l.organization_id",
		"dtm.user_id = l.assigned_user_id",
		"dt.is_active = true",
		"coalesce(dom.is_active, false) = true",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("contact team predicate is missing %q: %s", fragment, query)
		}
	}
	if strings.Contains(teamClause, "to_jsonb(l)->>'team_id'") {
		t.Fatalf("contact team filter must not use assignment provenance: %s", teamClause)
	}
	if strings.Contains(teamClause, "l.assigned_user_id is null") || strings.Contains(teamClause, "l.team_id = $5::uuid") {
		t.Fatalf("contact team-only filter must not include unassigned queue provenance: %s", teamClause)
	}
	if args[len(args)-1] != teamID {
		t.Fatalf("team filter argument = %#v, want %q", args[len(args)-1], teamID)
	}
}

func TestContactTeamAndUnassignedFiltersUseQueueProvenance(t *testing.T) {
	teamID := "33333333-3333-4333-8333-333333333333"
	where, args, err := buildContactWhere(tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}, ContactListFilter{TeamID: teamID, Unassigned: true})
	if err != nil {
		t.Fatalf("buildContactWhere() error = %v", err)
	}
	query := strings.Join(where, " and ")
	for _, fragment := range []string{
		"l.team_id = $5::uuid",
		"l.assigned_user_id is null",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("contact team + unassigned predicate is missing %q: %s", fragment, query)
		}
	}
	if strings.Contains(query, "from public.team_members dtm") {
		t.Fatalf("contact team + unassigned must use queue provenance instead of current membership: %s", query)
	}
	if args[len(args)-1] != teamID {
		t.Fatalf("team filter argument = %#v, want %q", args[len(args)-1], teamID)
	}
}
