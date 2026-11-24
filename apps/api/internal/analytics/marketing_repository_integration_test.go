package analytics

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

func TestCampaignInsightsDimensionsAndReconciliationAgainstPostgres(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("MARKETING_ANALYTICS_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set MARKETING_ANALYTICS_TEST_DATABASE_URL to run the PostgreSQL contract test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 2})
	if err != nil {
		t.Fatalf("connect PostgreSQL: %v", err)
	}
	defer database.Close()

	var organizationID, accountID, objective, dateFrom, dateTo string
	err = database.Pool().QueryRow(ctx, `
		select
			organization_id::text,
			external_account_id,
			objective,
			min(metric_date)::text,
			max(metric_date)::text
		from public.marketing_performance_daily
		where provider = 'meta'
		  and nullif(btrim(objective), '') is not null
		group by organization_id, external_account_id, objective
		order by count(*) desc
		limit 1
	`).Scan(&organizationID, &accountID, &objective, &dateFrom, &dateTo)
	if err != nil {
		t.Fatalf("load local Marketing fixture: %v", err)
	}

	repository := NewRepository(database)
	item, err := repository.CampaignInsights(ctx, tenant.Context{OrganizationID: organizationID}, url.Values{
		"dateFrom":  {dateFrom},
		"dateTo":    {dateTo},
		"accountId": {accountID},
		"objective": {objective},
	})
	if err != nil {
		t.Fatalf("campaign insights: %v", err)
	}

	summary := item["summary"].(map[string]any)
	reportedResults := summary["reportedResults"].(float64)
	reportedBreakdown := summary["metaReportedLeads"].(float64) + summary["metaReportedConversations"].(float64)
	if reportedResults != reportedBreakdown {
		t.Fatalf("reportedResults=%v breakdown=%v", reportedResults, reportedBreakdown)
	}
	if summary["crmAttributedLeads"] != summary["totalLeads"] {
		t.Fatalf("CRM attribution alias drifted: %#v", summary)
	}

	filterOptions := item["filterOptions"].(map[string]any)
	if len(filterOptions["accounts"].([]any)) == 0 || len(filterOptions["objectives"].([]any)) == 0 {
		t.Fatalf("filter options are empty: %#v", filterOptions)
	}

	isolated, err := repository.CampaignInsights(ctx, tenant.Context{OrganizationID: "00000000-0000-4000-8000-000000000001"}, url.Values{
		"dateFrom": {dateFrom},
		"dateTo":   {dateTo},
	})
	if err != nil {
		t.Fatalf("isolated tenant query: %v", err)
	}
	isolatedOptions := isolated["filterOptions"].(map[string]any)
	if len(isolatedOptions["accounts"].([]any)) != 0 || len(isolatedOptions["objectives"].([]any)) != 0 {
		t.Fatalf("filter options crossed tenant boundary: %#v", isolatedOptions)
	}
}

func TestCampaignInsightsSummaryMatchesCampaignsWhenAccountFactsDiverge(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("MARKETING_ANALYTICS_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set MARKETING_ANALYTICS_TEST_DATABASE_URL to run the PostgreSQL contract test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 2})
	if err != nil {
		t.Fatalf("connect PostgreSQL: %v", err)
	}
	defer database.Close()

	var organizationID string
	if err := database.Pool().QueryRow(ctx, `
		select organization_id::text
		from public.organization_members
		where coalesce(is_active, true) = true
		order by created_at
		limit 1
	`).Scan(&organizationID); err != nil {
		t.Fatalf("load local test tenant: %v", err)
	}

	suffix := time.Now().UnixNano()
	accountID := fmt.Sprintf("act_summary_regression_%d", suffix)
	campaignOneID := fmt.Sprintf("campaign_summary_one_%d", suffix)
	campaignTwoID := fmt.Sprintf("campaign_summary_two_%d", suffix)
	metricDate := "2026-09-15"

	if _, err := database.Pool().Exec(ctx, `
		insert into public.marketing_accounts (
			organization_id, provider, external_account_id, name, currency
		) values ($1::uuid, 'meta', $2, 'Regression account', 'BRL')
	`, organizationID, accountID); err != nil {
		t.Fatalf("insert regression account: %v", err)
	}
	defer func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = database.Pool().Exec(cleanupContext, `
			delete from public.marketing_performance_daily
			where organization_id = $1::uuid and external_account_id = $2;
			delete from public.marketing_accounts
			where organization_id = $1::uuid and provider = 'meta' and external_account_id = $2
		`, organizationID, accountID)
	}()

	if _, err := database.Pool().Exec(ctx, `
		insert into public.marketing_performance_daily (
			organization_id, provider, external_account_id, level, entity_id,
			metric_date, campaign_id, campaign_name, objective, currency,
			spend, impressions, reach, clicks, link_clicks,
			leads_reported, conversations_reported
		) values
			($1::uuid, 'meta', $2, 'account', $2, $5::date, null, null,
			 'OUTCOME_LEADS', 'BRL', 999, 9999, 9000, 900, 800, 99, 9),
			($1::uuid, 'meta', $2, 'campaign', $3, $5::date, $3, 'Campaign one',
			 'OUTCOME_LEADS', 'BRL', 10, 100, 90, 10, 8, 2, 1),
			($1::uuid, 'meta', $2, 'campaign', $4, $5::date, $4, 'Campaign two',
			 'OUTCOME_LEADS', 'BRL', 20, 200, 180, 20, 16, 3, 1)
	`, organizationID, accountID, campaignOneID, campaignTwoID, metricDate); err != nil {
		t.Fatalf("insert divergent Marketing facts: %v", err)
	}

	item, err := NewRepository(database).CampaignInsights(
		ctx,
		tenant.Context{OrganizationID: organizationID},
		url.Values{
			"dateFrom":  {metricDate},
			"dateTo":    {metricDate},
			"accountId": {accountID},
		},
	)
	if err != nil {
		t.Fatalf("campaign insights: %v", err)
	}

	campaigns := item["campaigns"].([]any)
	if len(campaigns) != 2 {
		t.Fatalf("campaigns=%d want=2", len(campaigns))
	}
	var campaignSpend, campaignImpressions, campaignReportedResults float64
	for _, value := range campaigns {
		campaign := value.(map[string]any)
		campaignSpend += campaign["spend"].(float64)
		campaignImpressions += campaign["impressions"].(float64)
		campaignReportedResults += campaign["reported_results"].(float64)
	}

	summary := item["summary"].(map[string]any)
	if summary["totalSpend"] != campaignSpend {
		t.Fatalf("summary spend=%v campaigns=%v", summary["totalSpend"], campaignSpend)
	}
	if summary["totalImpressions"] != campaignImpressions {
		t.Fatalf("summary impressions=%v campaigns=%v", summary["totalImpressions"], campaignImpressions)
	}
	if summary["reportedResults"] != campaignReportedResults {
		t.Fatalf("summary reportedResults=%v campaigns=%v", summary["reportedResults"], campaignReportedResults)
	}
}

func TestCampaignInsightsPageIncludesDedicatedInstagram(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("MARKETING_ANALYTICS_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set MARKETING_ANALYTICS_TEST_DATABASE_URL to run the PostgreSQL contract test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 2})
	if err != nil {
		t.Fatalf("connect PostgreSQL: %v", err)
	}
	defer database.Close()

	var organizationID string
	if err := database.Pool().QueryRow(ctx, `select id::text from public.organizations order by id limit 1`).Scan(&organizationID); err != nil {
		t.Fatalf("load local test tenant: %v", err)
	}
	pageID := fmt.Sprintf("instagram-page-regression-%d", time.Now().UnixNano())
	metricDate := "2040-01-05"
	if _, err := database.Pool().Exec(ctx, `
		with legacy as (
			insert into public.meta_integrations (organization_id, page_id, is_connected)
			values ($1::uuid, $2, false) returning id
		), fixtures as (
			select * from (values
				('dedicated', null::uuid, jsonb_build_object('vimob_page_id', $2::text), 8),
				('legacy', (select id from legacy), '{}'::jsonb, 4),
				('other', null::uuid, jsonb_build_object('vimob_page_id', $2::text || '-other'), 100)
			) as fixture(kind, integration_id, metadata, reach)
		), social as (
			insert into public.marketing_social_daily (
				organization_id, integration_id, provider, profile_id, metric_date, followers, reach, raw_metrics
			)
			select $1::uuid, integration_id, 'instagram', $2 || '-' || kind, $3::date, reach, reach, metadata
			from fixtures
		)
		insert into public.marketing_media_assets (
			organization_id, integration_id, provider, source_kind, external_media_id, published_at, raw_metadata
		)
		select $1::uuid, integration_id, 'instagram', 'organic', $2 || '-' || kind,
			$3::date + time '15:00', metadata
		from fixtures
	`, organizationID, pageID, metricDate); err != nil {
		t.Fatalf("seed social facts: %v", err)
	}
	defer func() {
		cleanup, cancelCleanup := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelCleanup()
		if _, err := database.Pool().Exec(cleanup, `
			with social as (
				delete from public.marketing_social_daily
				where organization_id = $1::uuid and profile_id like $2 || '-%'
			), media as (
				delete from public.marketing_media_assets
				where organization_id = $1::uuid and external_media_id like $2 || '-%'
			)
			delete from public.meta_integrations where organization_id = $1::uuid and page_id = $2
		`, organizationID, pageID); err != nil {
			t.Errorf("clean up social facts: %v", err)
		}
	}()

	repository := NewRepository(database)
	values := url.Values{"dateFrom": {metricDate}, "dateTo": {metricDate}, "pageId": {pageID}}
	for _, scenario := range []struct {
		organizationID string
		count          int
		reach          float64
	}{
		{organizationID, 2, 12},
		{"00000000-0000-4000-8000-000000000001", 0, 0},
	} {
		item, err := repository.CampaignInsights(ctx, tenant.Context{OrganizationID: scenario.organizationID}, values)
		if err != nil {
			t.Fatalf("campaign insights: %v", err)
		}
		social := item["social"].(map[string]any)
		days := item["socialDaily"].([]any)
		if social["reach"] != scenario.reach || social["profileCount"] != float64(scenario.count) || len(item["media"].([]any)) != scenario.count {
			t.Fatalf("unexpected filtered social data: %#v; media=%#v", social, item["media"])
		}
		if (scenario.count == 0 && len(days) != 0) ||
			(scenario.count > 0 && (len(days) != 1 || days[0].(map[string]any)["reach"] != scenario.reach)) {
			t.Fatalf("unexpected filtered daily facts: %#v", days)
		}
	}
}
