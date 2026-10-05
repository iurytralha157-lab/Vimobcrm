package leads

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestDashboardCreativesUseSameScopedArrivalsAndRankBeforeLimit(t *testing.T) {
	from := time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)
	viewer := tenant.Context{
		OrganizationID: dashboardTestUUID,
		UserID:         "22222222-2222-4222-8222-222222222222",
		Permissions:    []string{permissions.LeadViewOwn},
	}
	filter := DashboardFilter{
		DateFrom: &from, UserID: viewer.UserID,
		PageID: "page-a", CampaignIDs: []string{"campaign-a", "campaign-b"},
		AdSetID: "adset-a", TagID: "33333333-3333-4333-8333-333333333333",
	}
	repo := Repository{}
	query, args, err := repo.buildDashboardCreativesQuery(viewer, filter)
	if err != nil {
		t.Fatal(err)
	}
	cte, entryWhere, expectedArgs, err := repo.buildDashboardEntriesCTE(viewer, filter)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(query, cte) || !strings.Contains(query, "from entries entry\n\t\t\twhere "+entryWhere) {
		t.Fatal("creatives must use the campaign chart's visible-card and same-arrival filters")
	}
	if !reflect.DeepEqual(args, expectedArgs) {
		t.Fatalf("creative filter arguments diverged from entries: %#v != %#v", args, expectedArgs)
	}
	for _, fragment := range []string{
		"l.organization_id = $1::uuid", "l.assigned_user_id =", "entry.occurred_at >=",
		"btrim(entry.page_id) =", "btrim(entry.campaign_id) = any(",
		"btrim(entry.adset_id) =", "e.entry_type = 'reentry' and e.is_countable = true",
		"nullif(btrim(initial.provider), '') as provider", "nullif(btrim(e.provider), '') as provider",
		"initial.metadata->>'source_type'", "e.metadata->>'source_type'",
		"initial.metadata->>'leadgen_id'", "e.metadata->>'leadgen_id'",
		"initial.metadata->>'creative_id'", "e.metadata->>'creative_id'",
		"initial.metadata->>'creative_thumbnail_url'", "e.metadata->>'creative_thumbnail_url'",
		"initial.metadata->>'creative_instagram_url'", "e.metadata->>'creative_instagram_url'",
		"initial.metadata->>'creative_permalink_url'", "e.metadata->>'creative_permalink_url'",
		"lower(entry.provider) = 'meta'",
		"lower(entry.meta_source_type) = 'meta_lead_ads' and entry.meta_leadgen_id is not null",
		"entry.creative_id is not null or entry.ad_id is not null",
		"when entry.creative_id is not null then 'creative:' || entry.creative_id",
		"else 'ad:' || entry.ad_id", "count(distinct lead_id)::bigint as lead_count",
		"count(*)::bigint as entry_count", "count(distinct campaign_key)::bigint as campaign_count",
		"when entry.campaign_id is not null then 'id:' || entry.campaign_id",
		"then 'text:' || coalesce(entry.campaign_name, entry.utm_campaign)",
		"coalesce(max(campaign_name), max(utm_campaign)) as campaign_name", "limit 10",
		"max(creative_name) as creative_name, max(ad_name) as ad_name",
		"'Anúncio sem título'", "'Criativo sem título'",
		"when entry.creative_thumbnail_url ~* '^https://", "when entry.creative_url ~* '^https://",
		"order by (candidate.preview_url is not null) desc,",
		"snapshot.creative_video_url as video_url", "snapshot.creative_instagram_url as instagram_url",
		"snapshot.creative_permalink_url as permalink_url",
		"candidate.occurred_at desc, candidate.entry_id desc",
	} {
		if !strings.Contains(query, fragment) {
			t.Errorf("creative query missing %q", fragment)
		}
	}
	if strings.Contains(query, "from public.lead_meta") || strings.Contains(query, "from public.marketing_media_assets") {
		t.Fatal("creative identity and preview must come from the recorded arrival")
	}
	if strings.Contains(query, "lower(btrim(coalesce(entry.source, ''))) = 'meta'") {
		t.Fatal("a customized source must not hide a provider-confirmed Meta arrival")
	}
	if strings.Contains(query, "ranked.ad_id, ''") || strings.Contains(query, "ranked.creative_id, ''") || strings.Contains(query, "max(campaign_id)) as campaign_name") {
		t.Fatal("display labels must not fall back to internal IDs")
	}
	if strings.Index(query, "limit 10") < strings.Index(query, "creative_groups as (") {
		t.Fatal("the complete filtered cohort must be grouped before limiting to ten")
	}
}

func TestDashboardCreativesRejectUnsafePreviewURLs(t *testing.T) {
	for _, value := range []string{"javascript:alert(1)", "file:///etc/passwd", "http://example.test/a.jpg", "https://user:pass@example.test/a.jpg", "/relative.jpg", "https://"} {
		if dashboardSafeThumbnailURL(&value) != nil {
			t.Errorf("unsafe thumbnail URL was accepted: %q", value)
		}
	}
	valid := " https://example.test/a.jpg "
	if got := dashboardSafeThumbnailURL(&valid); got == nil || *got != "https://example.test/a.jpg" {
		t.Fatalf("valid static preview was rejected: %v", got)
	}
	invalid := "https://"
	if got := dashboardBestThumbnailURL(&invalid, &valid); got == nil || *got != "https://example.test/a.jpg" {
		t.Fatalf("valid image fallback was rejected: %v", got)
	}
	if got := dashboardSafeCreativeURL(&valid); got == nil || *got != "https://example.test/a.jpg" {
		t.Fatalf("valid video or permalink URL was rejected: %v", got)
	}
}

func TestDashboardCreativesResponseHasStableEmptyListAndNullablePreview(t *testing.T) {
	raw, err := json.Marshal(DashboardCreatives{Creatives: []DashboardCreativePoint{}})
	if err != nil || string(raw) != `{"creatives":[]}` {
		t.Fatalf("empty response = %s, error = %v", raw, err)
	}
	raw, err = json.Marshal(DashboardCreativePoint{Key: "ad:123", AttributionLevel: "ad", Name: "Anúncio 123"})
	if err != nil || !strings.Contains(string(raw), `"thumbnailUrl":null`) || !strings.Contains(string(raw), `"imageUrl":null`) ||
		!strings.Contains(string(raw), `"videoUrl":null`) || !strings.Contains(string(raw), `"instagramUrl":null`) ||
		!strings.Contains(string(raw), `"permalinkUrl":null`) || !strings.Contains(string(raw), `"campaignName":null`) {
		t.Fatalf("nullable creative fields lost from response: %s, error = %v", raw, err)
	}
}

func TestDashboardCreativesHandlerChecksDashboardPermissionBeforeParsing(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/v1/dashboard/creatives?userId=invalid", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		UserID: "11111111-1111-4111-8111-111111111111", OrganizationID: dashboardTestUUID,
		Permissions: []string{permissions.LeadViewOwn},
	}))
	recorder := httptest.NewRecorder()
	(Handler{}).ShowDashboardCreatives(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status=%d, want forbidden; body=%s", recorder.Code, recorder.Body.String())
	}
}
