package leads

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Executes the actual ranking and fallback SELECTs over synthetic VALUES only.
// It creates no tables and requires an explicitly selected loopback fixture.
func TestDashboardCreativeSnapshotPreferenceReadOnlyIntegration(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DASHBOARD_PREVIEW_SQL_TESTS") != "LOCAL_READ_TEST" {
		t.Skip("set VIMOB_RUN_DASHBOARD_PREVIEW_SQL_TESTS=LOCAL_READ_TEST and DASHBOARD_PREVIEW_TEST_URL for a disposable loopback fixture")
	}
	parsed, err := url.Parse(strings.TrimSpace(os.Getenv("DASHBOARD_PREVIEW_TEST_URL")))
	if err != nil || parsed.User == nil || parsed.User.Username() != "postgres" ||
		(parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") || parsed.Path != "/postgres" {
		t.Fatal("creative snapshot regression requires an explicit loopback postgres fixture URL")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: parsed.String(), MaxConns: 1, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatalf("open local fixture: %v", err)
	}
	t.Cleanup(database.Close)
	repo := Repository{}
	viewer := tenant.Context{OrganizationID: dashboardTestUUID, MemberRole: "admin"}
	cte, _, _, err := repo.buildDashboardEntriesCTE(viewer, DashboardFilter{})
	if err != nil {
		t.Fatal(err)
	}
	ranking, _, err := repo.buildDashboardCreativesQuery(viewer, DashboardFilter{})
	if err != nil {
		t.Fatal(err)
	}
	fallback, fallbackArgs, err := repo.buildDashboardCreativeMediaKeyQuery(viewer, DashboardFilter{}, "creative:123")
	if err != nil {
		t.Fatal(err)
	}
	// The production cohort CTE is separately tested for authorization. Here we
	// replace only that CTE with two arrivals to isolate snapshot preference.
	rankingSuffix := strings.TrimPrefix(ranking, cte)
	ranking = dashboardCreativePreviewValuesCTE + rankingSuffix
	linkValues := strings.Replace(dashboardCreativePreviewValuesCTE,
		"media_url as creative_thumbnail_url, media_url as creative_url,",
		"null::text as creative_thumbnail_url, null::text as creative_url,", 1)
	linkValues = strings.Replace(linkValues, "null::text as creative_permalink_url", "media_url as creative_permalink_url", 1)
	linkRanking := linkValues + rankingSuffix
	fallback = dashboardCreativePreviewValuesCTE + strings.ReplaceAll(strings.TrimPrefix(fallback, cte),
		fmt.Sprintf("$%d", len(fallbackArgs)), "$3")
	safe := "https://cdn.example.test/old.jpg?oe=123&url=a%2Fb"
	for name, rejected := range map[string]string{
		"port":        "https://cdn.example.test:443/new.jpg",
		"token":       "https://cdn.example.test/new.jpg?access_token=private",
		"encoded key": "https://cdn.example.test/new.jpg?access%5Ftoken=private",
		"proof":       "https://cdn.example.test/new.jpg?APPSECRET_PROOF=private",
		"fragment":    "https://cdn.example.test/new.jpg#access_token=private",
		"credentials": "https://user:pass@cdn.example.test/new.jpg",
		"bad escape":  "https://cdn.example.test/new.jpg?oe=%zz",
		"semicolon":   "https://cdn.example.test/new.jpg?oe=123;secret=private",
		"oversized":   "https://cdn.example.test/" + strings.Repeat("a", 4096),
	} {
		t.Run(name, func(t *testing.T) {
			if dashboardSafeCreativeURL(&rejected) != nil {
				t.Fatal("fixture URL must be rejected by the response sanitizer")
			}
			var selected string
			if err := database.Pool().QueryRow(ctx, "select thumbnail_url from ("+ranking+") ranked", safe, rejected).Scan(&selected); err != nil {
				t.Fatalf("ranking snapshot query: %v", err)
			}
			if selected != safe {
				t.Fatalf("ranking chose %q instead of older safe preview", selected)
			}
			if err := database.Pool().QueryRow(ctx, "select permalink_url from ("+linkRanking+") ranked", safe, rejected).Scan(&selected); err != nil {
				t.Fatalf("link snapshot query: %v", err)
			}
			if selected != safe {
				t.Fatal("link-only ranking did not retain the older safe permalink")
			}
			var creative, ad, thumbnail, image string
			if err := database.Pool().QueryRow(ctx, fallback, safe, rejected, "123").Scan(&creative, &ad, &thumbnail, &image); err != nil {
				t.Fatalf("fallback snapshot query: %v", err)
			}
			if thumbnail != safe || image != safe || creative != "123" || ad != "456" {
				t.Fatal("fallback did not retain the coherent older safe snapshot")
			}
		})
	}
}

const dashboardCreativePreviewValuesCTE = `with entries as (
	select sequence::text as entry_id, sequence::text as lead_id,
		timestamptz '2026-10-01 00:00:00+00' + sequence * interval '1 day' as occurred_at,
		'meta'::text as provider, null::text as meta_source_type, null::text as meta_leadgen_id,
		'123'::text as creative_id, 'Creative'::text as creative_name, 'image'::text as creative_type,
		media_url as creative_thumbnail_url, media_url as creative_url,
		null::text as creative_video_url, null::text as creative_instagram_url,
		null::text as creative_permalink_url, '456'::text as ad_id, 'Ad'::text as ad_name,
		'campaign'::text as campaign_id, 'Campaign'::text as campaign_name, null::text as utm_campaign
	from (values (1, $1::text), (2, $2::text)) fixture(sequence, media_url)
)
`
