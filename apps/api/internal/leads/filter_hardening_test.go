package leads

import (
	"context"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestContactFiltersPreserveAcceptedTextAndRejectInvalidPeriods(t *testing.T) {
	search := strings.Repeat("a", 180)
	campaign := strings.Repeat("c", 255)
	filter, err := ParseContactListFilter(url.Values{"search": {search}, "campaignIds": {campaign, "Campaign, with comma", campaign}})
	if err != nil || filter.Search != search || len(filter.CampaignIDs) != 2 || filter.CampaignIDs[1] != "Campaign, with comma" {
		t.Fatalf("accepted filters changed: %#v, %v", filter, err)
	}
	for _, values := range []url.Values{
		{"search": {search + "a"}},
		{"campaignId": {campaign + "c"}},
		{"pageId": {strings.Repeat("p", 256)}},
		{"createdFrom": {"not-a-date"}, "createdTo": {"2026-10-12T00:00:00Z"}},
		{"createdFrom": {"2026-10-12T00:00:00Z"}},
		{"createdFrom": {"2026-10-12T00:00:00Z"}, "createdTo": {"2026-10-11T00:00:00Z"}},
		{"createdFrom": {"2020-01-01T00:00:00Z"}, "createdTo": {"2026-01-01T00:00:00Z"}},
	} {
		if _, err := ParseContactListFilter(values); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid filter accepted: %#v: %v", values, err)
		}
	}
}

func TestSharedSourceFiltersPreserveHistoricalUnicodeValues(t *testing.T) {
	source := strings.Repeat("🏠", maxLeadSourceFilterLength)
	contact, err := ParseContactListFilter(url.Values{"source": {source}})
	if err != nil || contact.Source != source {
		t.Fatalf("contacts rejected accepted Dashboard source: length=%d, err=%v", len([]rune(contact.Source)), err)
	}
	board, err := ParsePipelineBoardFilter(url.Values{"pipelineId": {"22222222-2222-4222-8222-222222222222"}, "filterSource": {source}})
	if err != nil || board.FilterSource != source {
		t.Fatalf("pipeline rejected accepted Dashboard source: length=%d, err=%v", len([]rune(board.FilterSource)), err)
	}
	for _, invalid := range []string{source + "🏠", "unsafe\x00source"} {
		if _, err := ParseContactListFilter(url.Values{"source": {invalid}}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("contact accepted invalid source: %v", err)
		}
		if _, err := ParsePipelineBoardFilter(url.Values{"pipelineId": {"22222222-2222-4222-8222-222222222222"}, "filterSource": {invalid}}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("pipeline accepted invalid source: %v", err)
		}
	}
}

func TestCoreFilterReadsCompleteSQLReadOnlyIntegration(t *testing.T) {
	if os.Getenv("VIMOB_TEST_ISOLATED") != "1" {
		t.Skip("VIMOB_TEST_ISOLATED=1 is required")
	}
	databaseURL := strings.TrimSpace(os.Getenv("VIMOB_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("VIMOB_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil || (target.Scheme != "postgres" && target.Scheme != "postgresql") {
		t.Fatal("the read-only integration requires a PostgreSQL URL")
	}
	switch strings.ToLower(target.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
	default:
		t.Fatal("the read-only integration must use a disposable loopback database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 10 * time.Second, ForceReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close()
	var organizationID string
	if err := postgres.Pool().QueryRow(ctx, "select gen_random_uuid()::text").Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	repo := Repository{db: postgres}
	tc := tenant.Context{OrganizationID: organizationID, UserID: "11111111-1111-4111-8111-111111111111", IsSuperAdmin: true}
	for _, mode := range []string{"compact", "full", "export"} {
		t.Run("contacts "+mode, func(t *testing.T) {
			filter, err := ParseContactListFilter(url.Values{"mode": {mode}, "search": {"name %"}, "campaignIds": {"A", "B"}, "adSetId": {"set-x"}, "adId": {"ad-z"}, "createdFrom": {"2026-10-01T03:00:00Z"}, "createdTo": {"2026-10-13T02:59:59Z"}})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := repo.ListContacts(ctx, tc, filter); err != nil {
				t.Fatal(err)
			}
			if count, err := repo.countContacts(ctx, tc, filter); err != nil || count != 0 {
				t.Fatalf("count=%d, err=%v", count, err)
			}
		})
	}
	filter, err := ParsePipelineBoardFilter(url.Values{"pipelineId": {"22222222-2222-4222-8222-222222222222"}, "stageIds": {"33333333-3333-4333-8333-333333333333"}, "filterCampaigns": {"A", "B"}, "filterAdSet": {"set-x"}, "filterAd": {"ad-z"}, "search": {"name %"}, "dateFrom": {"2026-10-01T03:00:00Z"}, "dateTo": {"2026-10-13T02:59:59Z"}, "dateMode": {"origin"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(filter.StageIDs) == 0 || filter.DateFrom == nil || filter.DateTo == nil || filter.Search == "" {
		t.Fatal("pipeline stage, search and period are required to compile the selected scope")
	}
	if _, err := repo.listPipelineBoardLeads(ctx, tc, filter); err != nil {
		t.Fatalf("pipeline lead query: %v", err)
	}
	if _, err := repo.listInitialPipelineBoardLeadsByStage(ctx, tc, filter); err != nil {
		t.Fatalf("pipeline initial board query: %v", err)
	}
	if _, err := repo.listPipelineBoardStageMetrics(ctx, tc, filter); err != nil {
		t.Fatalf("pipeline stage counts query: %v", err)
	}
}

func TestPipelineAndContactMulticampaignAreBoundedRepeatedValues(t *testing.T) {
	pipeline, err := ParsePipelineBoardFilter(url.Values{"filterCampaigns": {"A", "B, with comma", "A"}})
	if err != nil || len(pipeline.FilterCampaigns) != 2 {
		t.Fatalf("pipeline = %#v, %v", pipeline, err)
	}
	tooMany := make([]string, 51)
	for index := range tooMany {
		tooMany[index] = strings.Repeat("a", index+1)
	}
	if _, err := ParsePipelineBoardFilter(url.Values{"filterCampaigns": tooMany}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("oversized campaign set: %v", err)
	}
}

func TestLeadAttributionWithoutPageKeepsBothLegacyProjectionsAtomic(t *testing.T) {
	args := []any{"organization"}
	conditions := []string{}
	addLeadAttributionFilterCondition(&args, &conditions, "l", "lm", leadAttributionFilter{Campaigns: []string{"A", "B"}, AdSet: "Common", Ad: "Ad"})
	query := conditions[0]
	// One legacy row must carry the whole selection. An OR for each separate
	// dimension would splice first-touch fields with a later reentry projection.
	if strings.Count(query, "from public.lead_meta lm") != 1 {
		t.Fatalf("independent legacy dimensions: %s", query)
	}
	metaStart := strings.Index(query, "from public.lead_meta lm")
	leadStart := strings.Index(query[metaStart:], ") or ((l.meta_campaign_id")
	if leadStart < 0 || !strings.Contains(query[:metaStart+leadStart], "lm.adset_id") || !strings.Contains(query[:metaStart+leadStart], "lm.ad_id") {
		t.Fatalf("legacy projections are not complete alternatives: %s", query)
	}
	if !strings.Contains(query, "entry.campaign_id = any(") || len(args) != 4 {
		t.Fatalf("campaign OR selection lost: %s, %#v", query, args)
	}
}
