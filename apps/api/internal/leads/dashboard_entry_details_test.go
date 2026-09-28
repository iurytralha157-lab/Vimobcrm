package leads

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestDashboardEntryDetailsRejectInvalidInputBeforeDatabaseAccess(t *testing.T) {
	for _, testCase := range []struct {
		name        string
		path        string
		permissions []string
		wantStatus  int
	}{
		{"missing dashboard permission", "/v1/dashboard/lead-entries?limit=25", []string{permissions.LeadViewOwn}, http.StatusForbidden},
		{"bad cursor", "/v1/dashboard/lead-entries?cursor=not-base64!", []string{permissions.DashboardView, permissions.LeadViewOwn}, http.StatusBadRequest},
		{"excessive page size", "/v1/dashboard/lead-entries?limit=51", []string{permissions.DashboardView, permissions.LeadViewOwn}, http.StatusBadRequest},
		{"bad pipeline", "/v1/dashboard/lead-entries?pipelineId=not-a-uuid", []string{permissions.DashboardView, permissions.LeadViewOwn}, http.StatusBadRequest},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, testCase.path, nil)
			request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
				OrganizationID: "11111111-1111-4111-8111-111111111111",
				UserID:         "22222222-2222-4222-8222-222222222222",
				Permissions:    testCase.permissions,
			}))
			recorder := httptest.NewRecorder()
			(Handler{}).ListDashboardLeadEntries(recorder, request)
			if recorder.Code != testCase.wantStatus {
				t.Fatalf("status=%d want=%d body=%s", recorder.Code, testCase.wantStatus, recorder.Body.String())
			}
		})
	}
}

func TestDashboardEntryCursorRoundTripAndRejectsInvalidValues(t *testing.T) {
	want := dashboardEntryCursor{
		OccurredAt: time.Date(2026, 9, 27, 10, 12, 0, 123, time.UTC),
		IsReentry:  true,
		EntryID:    "11111111-1111-4111-8111-111111111111",
	}
	got, err := parseDashboardEntryCursor(encodeDashboardEntryCursor(want))
	if err != nil || got == nil || !got.OccurredAt.Equal(want.OccurredAt) || got.EntryID != want.EntryID || got.IsReentry != want.IsReentry {
		t.Fatalf("cursor round trip: got=%+v err=%v", got, err)
	}
	for _, raw := range []string{"!", strings.Repeat("x", dashboardEntryCursorMaxLength+1), encodeDashboardEntryCursor(dashboardEntryCursor{EntryID: want.EntryID}), encodeDashboardEntryCursor(dashboardEntryCursor{OccurredAt: want.OccurredAt, EntryID: "not-a-uuid"})} {
		if _, err := parseDashboardEntryCursor(raw); err == nil {
			t.Fatalf("invalid cursor accepted: %q", raw)
		}
	}
}

func TestDashboardEntryDetailsReuseTheCountCohortAndKeepStableKeysetOrder(t *testing.T) {
	orgID := "11111111-1111-4111-8111-111111111111"
	userID := "22222222-2222-4222-8222-222222222222"
	filter := DashboardFilter{
		PipelineID: "33333333-3333-4333-8333-333333333333",
		PageID:     "meta-page", CampaignID: "meta-campaign", Limit: 25,
	}
	query, args, err := (Repository{}).buildDashboardLeadEntryDetailsQuery(tenant.Context{
		OrganizationID: orgID,
		UserID:         userID,
		Permissions:    []string{permissions.LeadViewOwn},
	}, filter, &dashboardEntryCursor{
		OccurredAt: time.Date(2026, 9, 27, 10, 0, 0, 0, time.UTC),
		IsReentry:  true,
		EntryID:    "44444444-4444-4444-8444-444444444444",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, fragment := range []string{
		"from entries entry",
		"l.organization_id = $1::uuid",
		"l.assigned_user_id =",
		"l.pipeline_id =",
		"btrim(entry.page_id) =",
		"btrim(entry.campaign_id) =",
		"join public.leads l on l.id = entry.lead_id and l.organization_id = $1::uuid",
		"order by entry.occurred_at desc, entry.is_reentry desc, entry.entry_id desc",
		"(entry.occurred_at, entry.is_reentry, entry.entry_id)",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("detail query lacks %q:\n%s", fragment, query)
		}
	}
	if len(args) < 5 || args[0] != orgID || args[len(args)-1] != 26 {
		t.Fatalf("unexpected detail query arguments: %#v", args)
	}
}
