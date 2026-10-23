package whatsapp

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestConversationSharedLeadDateAndAttributionFilters(t *testing.T) {
	filter, err := ParseConversationListFilter(url.Values{
		"leadCreatedFrom": {"2026-10-01T03:00:00Z"}, "leadCreatedTo": {"2026-10-13T02:59:59.999Z"},
		"lastMessageFrom": {"2026-10-12T03:00:00Z"}, "campaignIds": {"campaign-a", "campaign-b"},
		"adSetId": {"common-set"}, "adId": {"ad-a"},
	})
	if err != nil {
		t.Fatal(err)
	}
	args, where, empty, err := conversationFilterSQL(tenant.Context{OrganizationID: unreadCountOrganizationID, UserID: unreadCountUserID}, filter)
	if err != nil || empty {
		t.Fatalf("unexpected filter result: %v %v", empty, err)
	}
	sql := strings.Join(where, " and ")
	for _, fragment := range []string{"wc.last_message_at >=", "l.created_at >=", "l.created_at <=", "entry.adset_id", "entry.ad_id", "lm.adset_id", "lm.ad_id"} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("missing independent criterion %q", fragment)
		}
	}
	if strings.Contains(sql, "common-set") || strings.Contains(sql, "ad-a") || len(args) < 8 {
		t.Fatalf("expected parameterized attribution: %s", sql)
	}
	// Legacy first-touch values remain available, as one complete AND alternative.
	if !strings.Contains(sql, "btrim(l.meta_campaign_id)") || !strings.Contains(sql, ") and btrim(l.meta_adset_id)") || !strings.Contains(sql, "and btrim(l.meta_ad_id)") {
		t.Fatal("combined first-touch attribution must stay atomic")
	}
}

func TestConversationSharedFiltersRejectInvalidPeriodsAndPreserveUnicodeSearch(t *testing.T) {
	for _, values := range []url.Values{
		{"leadCreatedFrom": {"invalid"}},
		{"leadCreatedFrom": {"2026-10-13T00:00:00Z"}, "leadCreatedTo": {"2026-10-12T00:00:00Z"}},
		{"withoutLead": {"true"}, "leadCreatedFrom": {"2026-10-12T00:00:00Z"}},
		{"withoutLead": {"true"}, "adSetId": {"set-a"}},
		{"optionsOffset": {"-1"}}, {"optionsLimit": {"201"}}, {"search": {strings.Repeat("a", 181)}},
	} {
		if _, err := ParseConversationListFilter(values); err == nil {
			t.Fatalf("expected rejection for %#v", values)
		}
	}
	filter, err := ParseConversationListFilter(url.Values{"search": {strings.Repeat("á", 180)}})
	if err != nil || len([]rune(filter.Search)) != 180 {
		t.Fatalf("Unicode search unexpectedly changed: %v", err)
	}
}

func TestConversationFilterTextBoundsAreUnicodeAndRejectNUL(t *testing.T) {
	values := url.Values{
		"search": {strings.Repeat("🏠", 180)}, "leadSource": {strings.Repeat("á", 4096)},
		"pageId": {strings.Repeat("🏠", 255)}, "campaignIds": {strings.Repeat("á", 255)},
		"adSetId": {strings.Repeat("🏠", 255)}, "adId": {strings.Repeat("á", 255)},
		"optionsSearch": {strings.Repeat("🏠", 120)}, "expandedOptions": {"true"},
	}
	filter, err := ParseConversationListFilter(values)
	if err != nil {
		t.Fatalf("accepted Unicode text rejected by parser: %v", err)
	}
	tc := tenant.Context{OrganizationID: unreadCountOrganizationID, UserID: unreadCountUserID}
	if _, _, _, err := conversationFilterSQL(tc, filter); err != nil {
		t.Fatalf("accepted Unicode text rejected by list builder: %v", err)
	}
	if _, _, _, err := conversationFilterOptionsSQL(tc, filter); err != nil {
		t.Fatalf("accepted Unicode text rejected by catalog builder: %v", err)
	}
	for _, field := range []string{"search", "leadSource", "pageId", "campaignIds", "adSetId", "adId", "optionsSearch"} {
		invalid := url.Values{field: {"value\x00suffix"}}
		if _, err := ParseConversationListFilter(invalid); err == nil {
			t.Fatalf("NUL accepted in %s", field)
		}
	}
	if _, _, _, err := conversationFilterSQL(tc, ConversationListFilter{AdSetID: "bad\x00value"}); err == nil {
		t.Fatal("list builder accepted NUL attribution")
	}
	if _, _, _, err := conversationFilterOptionsSQL(tc, ConversationListFilter{PageID: "bad\x00value"}); err == nil {
		t.Fatal("catalog builder accepted NUL page")
	}
}

func TestConversationOptionsSearchAndPaginationRetainTenantBoundaries(t *testing.T) {
	filter, err := ParseConversationListFilter(url.Values{
		"expandedOptions": {"true"}, "optionsSearch": {"Campanha %"}, "optionsOffset": {"500"}, "optionsLimit": {"100"},
		"sessionIds": {unreadCountSessionID}, "pageId": {"page-a"}, "campaignIds": {"campaign-a"},
	})
	if err != nil {
		t.Fatal(err)
	}
	args, sql, empty, err := conversationFilterOptionsSQL(tenant.Context{OrganizationID: unreadCountOrganizationID, UserID: unreadCountUserID}, filter)
	if err != nil || empty {
		t.Fatalf("catalog rejected: %v %v", empty, err)
	}
	if strings.Contains(sql, "Campanha %") || strings.Contains(sql, "page-a") || args[len(args)-2] != 500 || args[len(args)-1] != 601 {
		t.Fatalf("catalog bounds/input were not bound: %#v", args)
	}
	for _, clause := range []string{"wc.organization_id = $1::uuid", "lt.organization_id=l.organization_id", "partition by kind", "t.color", "'adset'", "'ad'"} {
		if !strings.Contains(sql, clause) {
			t.Fatalf("missing catalog boundary %q", clause)
		}
	}
	_, _, empty, err = conversationFilterOptionsSQL(tenant.Context{}, ConversationListFilter{AccessibleProvided: true, SessionIDs: []string{}})
	if err != nil || !empty {
		t.Fatalf("empty authorized sessions must be fail closed: %v %v", empty, err)
	}
}

// Plans the actual repository SQL without executing the plan or creating fixtures.
func TestConversationExpandedCatalogSQLReadOnlyIntegration(t *testing.T) {
	if os.Getenv("WHATSAPP_TEST_ISOLATED") != "1" {
		t.Skip("WHATSAPP_TEST_ISOLATED=1 is required")
	}
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil || (target.Scheme != "postgres" && target.Scheme != "postgresql") {
		t.Fatal("WHATSAPP_TEST_DATABASE_URL must be a PostgreSQL URL")
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
	from, to := time.Now().Add(-time.Hour), time.Now()
	filter := ConversationListFilter{ExpandedOptions: true, PageID: "fixture-page", CampaignIDs: []string{"fixture-campaign"}, AdSetID: "fixture-adset", OptionsSearch: "name %", OptionsOffset: 500, OptionsLimit: 100, LeadCreatedFrom: &from, LeadCreatedTo: &to}
	args, query, empty, err := conversationFilterOptionsSQL(tenant.Context{OrganizationID: unreadCountOrganizationID, UserID: unreadCountUserID}, filter)
	if err != nil || empty {
		t.Fatalf("unexpected catalog builder result: %v %v", empty, err)
	}
	rows, err := postgres.Pool().Query(ctx, "explain "+query, args...)
	if err != nil {
		t.Fatal(err)
	}
	if !rows.Next() {
		rows.Close()
		t.Fatalf("expected a query plan: %v", rows.Err())
	}
	rows.Close()
	// A synthetic lead projection requires no durable rows. Fresh IDs ensure
	// historical/lead_meta alternatives cannot satisfy the predicate by chance.
	for _, item := range []struct {
		name   string
		filter ConversationListFilter
		want   bool
	}{
		{"first touch combined", ConversationListFilter{CampaignIDs: []string{"campaign-a"}, AdSetID: "set-x", AdID: "ad-z"}, true},
		{"mismatched set", ConversationListFilter{CampaignIDs: []string{"campaign-a"}, AdSetID: "set-y"}, false},
		{"campaign OR", ConversationListFilter{CampaignIDs: []string{"campaign-b", "campaign-a"}, AdSetID: "set-x"}, true},
		{"page absent from first touch", ConversationListFilter{PageID: "page-a", CampaignIDs: []string{"campaign-a"}}, false},
	} {
		t.Run(item.name, func(t *testing.T) {
			args, where := []any{}, []string{}
			if err := appendConversationAttributionFilter(&args, &where, item.filter); err != nil {
				t.Fatal(err)
			}
			query := `with seed as materialized (select gen_random_uuid() organization_id, gen_random_uuid() lead_id)
			select ` + strings.Join(where, " and ") + `
			from seed cross join lateral (select seed.organization_id) wc
			cross join lateral (select seed.organization_id, seed.lead_id id,
			  'campaign-a'::text meta_campaign_id, null::text utm_campaign,
			  'set-x'::text meta_adset_id, 'ad-z'::text meta_ad_id) l`
			var matches bool
			if err := postgres.Pool().QueryRow(ctx, query, args...).Scan(&matches); err != nil {
				t.Fatal(err)
			}
			if matches != item.want {
				t.Fatalf("attribution matches=%v, want %v", matches, item.want)
			}
		})
	}
}
