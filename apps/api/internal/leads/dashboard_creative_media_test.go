package leads

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestDashboardCreativeMediaKeyUsesVisibleFilteredArrivals(t *testing.T) {
	viewer := tenant.Context{
		OrganizationID: dashboardTestUUID,
		UserID:         "22222222-2222-4222-8222-222222222222",
		Permissions:    []string{permissions.LeadViewOwn},
	}
	filter := DashboardFilter{UserID: viewer.UserID, PageID: "page-a", CampaignIDs: []string{"campaign-a", "campaign-b"}}
	repo := Repository{}
	cte, where, expectedArgs, err := repo.buildDashboardEntriesCTE(viewer, filter)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"creative:123", "ad:456"} {
		query, args, err := repo.buildDashboardCreativeMediaKeyQuery(viewer, filter, key)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(query, cte) || !strings.Contains(query, "from entries entry\n\t\twhere "+where) ||
			!strings.Contains(query, "limit 1") || strings.Contains(query, "creative_groups") {
			t.Fatal("media key must use the dashboard visibility and arrival filters without re-aggregating the ranking")
		}
		if !reflect.DeepEqual(args[:len(args)-1], expectedArgs) || args[len(args)-1] != strings.SplitN(key, ":", 2)[1] {
			t.Fatalf("media key arguments diverged from dashboard filters: %#v", args)
		}
		if key == "ad:456" && !strings.Contains(query, "entry.creative_id is null and entry.ad_id =") {
			t.Fatal("ad fallback must not expose a creative-keyed arrival")
		}
		if key == "creative:123" && !strings.Contains(query, "entry.creative_id =") {
			t.Fatal("creative key does not bind its ID")
		}
	}
	for _, key := range []string{"", "creative:abc", "creative:123/evil", "ad:-1", "other:123"} {
		if _, _, err := repo.buildDashboardCreativeMediaKeyQuery(viewer, filter, key); err == nil {
			t.Errorf("invalid key accepted: %q", key)
		}
	}
}

func TestDashboardCreativeMediaHandlerChecksPermissionAndKeyBeforeDatabase(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/v1/dashboard/creative-media?key=creative:123", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		OrganizationID: dashboardTestUUID, UserID: "22222222-2222-4222-8222-222222222222",
		Permissions: []string{permissions.LeadViewOwn},
	}))
	recorder := httptest.NewRecorder()
	(Handler{}).ShowDashboardCreativeMedia(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status=%d, want forbidden", recorder.Code)
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/dashboard/creative-media?key=creative:invalid", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		OrganizationID: dashboardTestUUID, UserID: "22222222-2222-4222-8222-222222222222",
		Permissions: []string{permissions.DashboardView},
	}))
	recorder = httptest.NewRecorder()
	(Handler{}).ShowDashboardCreativeMedia(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status=%d, want invalid key rejected before database; body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestDashboardHistoricalMediaFallbackRejectsTokenURLs(t *testing.T) {
	for _, raw := range []string{
		"http://cdn.example.test/a.jpg", "https://cdn.example.test/a.jpg?access_token=private",
		"https://cdn.example.test/a.jpg?appsecret_proof=private", "https://user:pass@cdn.example.test/a.jpg",
	} {
		if safe := dashboardSafeHistoricalMediaURL(&raw); safe != nil {
			t.Errorf("unsafe historical URL accepted: %s", raw)
		}
	}
	valid := "https://cdn.example.test/a.jpg?oe=123"
	if safe := dashboardSafeHistoricalMediaURL(&valid); safe == nil || *safe != valid {
		t.Fatal("ordinary signed CDN URL was rejected")
	}
}
