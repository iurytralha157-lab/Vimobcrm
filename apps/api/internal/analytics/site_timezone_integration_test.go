package analytics

import (
	"context"
	"math"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestSiteAnalyticsLocalDayBoundaryAgainstPostgres(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("SITE_ANALYTICS_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set SITE_ANALYTICS_TEST_DATABASE_URL to run the local PostgreSQL boundary test")
	}
	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse SITE_ANALYTICS_TEST_DATABASE_URL: %v", err)
	}
	if host := parsedURL.Hostname(); host != "localhost" && host != "127.0.0.1" && host != "::1" {
		t.Skip("SITE_ANALYTICS_TEST_DATABASE_URL must point to a local PostgreSQL instance")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 1})
	if err != nil {
		t.Fatalf("connect local PostgreSQL: %v", err)
	}
	defer database.Close()

	var beforeBoundaryIncluded, atBoundaryIncluded bool
	var beforeBoundaryDay, atBoundaryDay string
	err = database.Pool().QueryRow(ctx, `
		with report_settings(timezone_name) as (
			values ('America/Sao_Paulo'::text)
		), time_bounds as (
			select
				date '2026-09-06'::timestamp at time zone timezone_name as starts_at,
				(date '2026-09-06' + 1)::timestamp at time zone timezone_name as ends_at,
				timezone_name
			from report_settings
		)
		select
			timestamptz '2026-09-06 02:59:59+00' >= starts_at and timestamptz '2026-09-06 02:59:59+00' < ends_at,
			timestamptz '2026-09-06 03:00:00+00' >= starts_at and timestamptz '2026-09-06 03:00:00+00' < ends_at,
			(timestamptz '2026-09-06 02:59:59+00' at time zone timezone_name)::date::text,
			(timestamptz '2026-09-06 03:00:00+00' at time zone timezone_name)::date::text
		from time_bounds
	`).Scan(&beforeBoundaryIncluded, &atBoundaryIncluded, &beforeBoundaryDay, &atBoundaryDay)
	if err != nil {
		t.Fatalf("query local calendar boundary: %v", err)
	}

	if beforeBoundaryIncluded || beforeBoundaryDay != "2026-09-05" {
		t.Fatalf("02:59:59Z inclusion=%t day=%s, want previous local day", beforeBoundaryIncluded, beforeBoundaryDay)
	}
	if !atBoundaryIncluded || atBoundaryDay != "2026-09-06" {
		t.Fatalf("03:00:00Z inclusion=%t day=%s, want selected local day", atBoundaryIncluded, atBoundaryDay)
	}
}

func TestSiteAcquisitionClassifierAgainstLocalPostgres(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("SITE_ANALYTICS_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set SITE_ANALYTICS_TEST_DATABASE_URL to run the local PostgreSQL acquisition test")
	}
	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse SITE_ANALYTICS_TEST_DATABASE_URL: %v", err)
	}
	if host := parsedURL.Hostname(); host != "localhost" && host != "127.0.0.1" && host != "::1" {
		t.Skip("SITE_ANALYTICS_TEST_DATABASE_URL must point to a local PostgreSQL instance")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 1})
	if err != nil {
		t.Fatalf("connect local PostgreSQL: %v", err)
	}
	defer database.Close()

	rows, err := database.Pool().Query(ctx, `
		with session_sources(label, utm_source, utm_medium, utm_campaign, referrer, google_ads_click, facebook_click) as (values
			('paid-medium', 'google', 'cpc', null, 'https://google.com', false, false),
			('paid-campaign', 'google', 'organic', 'launch', 'https://google.com', false, false),
			('gclid-only', null, null, null, null, true, false),
			('fbclid-only', null, null, null, null, false, true),
			('fbclid-paid', null, 'paid_social', null, null, false, true),
			('organic-social', 'instagram', 'organic_social', null, null, false, false),
			('organic-search', 'google', 'organic', null, 'https://google.com', false, false),
			('organic-referrer', null, null, null, 'https://google.com/search', false, false),
			('search-name-in-path', null, null, null, 'https://partner.example/articles/google', false, false),
			('search-lookalike-host', null, null, null, 'https://www.google.example.com/search', false, false),
			('yahoo-lookalike-host', null, null, null, 'https://yahoo.example.com/search', false, false),
			('social-name-in-host', null, null, null, 'https://notinstagram.example/path', false, false),
			('social-name-in-path', null, null, null, 'https://partner.example/articles/meta', false, false),
			('social-source-lookalike', 'metaverse', null, null, null, false, false),
			('direct', null, null, null, null, false, false),
			('referral', null, null, null, 'https://partner.example', false, false)
		), typed_sessions as (
			select session_sources.*, `+siteAcquisitionSourceTypeSQL+` source_type
			from session_sources
		)
		select label, source_type, `+siteAcquisitionSourceLabelSQL+` source
		from typed_sessions
		order by label
	`)
	if err != nil {
		t.Fatalf("query acquisition classifier: %v", err)
	}
	defer rows.Close()

	type acquisitionExpectation struct {
		sourceType string
		source     string
	}
	want := map[string]acquisitionExpectation{
		"paid-medium":             {sourceType: "campaign", source: "google"},
		"paid-campaign":           {sourceType: "campaign", source: "google"},
		"gclid-only":              {sourceType: "campaign", source: "Google Ads"},
		"fbclid-only":             {sourceType: "social", source: "Facebook / Meta"},
		"fbclid-paid":             {sourceType: "campaign", source: "Facebook / Meta"},
		"organic-social":          {sourceType: "social", source: "instagram"},
		"organic-search":          {sourceType: "search", source: "google"},
		"organic-referrer":        {sourceType: "search", source: "google.com"},
		"search-name-in-path":     {sourceType: "referral", source: "partner.example"},
		"search-lookalike-host":   {sourceType: "referral", source: "www.google.example.com"},
		"yahoo-lookalike-host":    {sourceType: "referral", source: "yahoo.example.com"},
		"social-name-in-host":     {sourceType: "referral", source: "notinstagram.example"},
		"social-name-in-path":     {sourceType: "referral", source: "partner.example"},
		"social-source-lookalike": {sourceType: "campaign", source: "metaverse"},
		"direct":                  {sourceType: "direct", source: "Direto"},
		"referral":                {sourceType: "referral", source: "partner.example"},
	}
	seen := make(map[string]acquisitionExpectation, len(want))
	for rows.Next() {
		var label, sourceType, source string
		if err := rows.Scan(&label, &sourceType, &source); err != nil {
			t.Fatalf("scan acquisition classifier: %v", err)
		}
		seen[label] = acquisitionExpectation{sourceType: sourceType, source: source}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate acquisition classifier: %v", err)
	}
	for label, expected := range want {
		if got := seen[label]; got != expected {
			t.Errorf("%s acquisition=%#v want=%#v", label, got, expected)
		}
	}
}

func TestSiteAnalyticsQueriesAgainstLocalPostgres(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("SITE_ANALYTICS_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set SITE_ANALYTICS_TEST_DATABASE_URL to run the local PostgreSQL repository test")
	}
	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse SITE_ANALYTICS_TEST_DATABASE_URL: %v", err)
	}
	if host := parsedURL.Hostname(); host != "localhost" && host != "127.0.0.1" && host != "::1" {
		t.Skip("SITE_ANALYTICS_TEST_DATABASE_URL must point to a local PostgreSQL instance")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 2})
	if err != nil {
		t.Fatalf("connect local PostgreSQL: %v", err)
	}
	defer database.Close()

	var organizationID string
	if err := database.Pool().QueryRow(ctx, `
		select organization_id::text
		from public.site_analytics_events
		order by created_at desc
		limit 1
	`).Scan(&organizationID); err != nil {
		t.Skipf("local database has no site analytics fixture: %v", err)
	}

	repo := NewRepository(database)
	tenantContext := tenant.Context{OrganizationID: organizationID}
	filters := url.Values{
		"dateFrom": {"2026-01-01"},
		"dateTo":   {"2026-12-31"},
	}

	summary, err := repo.SiteSummary(ctx, tenantContext, filters)
	if err != nil {
		t.Fatalf("SiteSummary query: %v", err)
	}
	if _, ok := summary["otherDevicePct"]; !ok {
		t.Fatal("SiteSummary query omitted otherDevicePct")
	}
	if sessions, ok := summary["uniqueSessions"].(float64); ok && sessions > 0 {
		deviceTotal := summary["desktopPct"].(float64) +
			summary["mobilePct"].(float64) +
			summary["tabletPct"].(float64) +
			summary["otherDevicePct"].(float64)
		if math.Abs(deviceTotal-100) > 0.000_001 {
			t.Fatalf("device percentages total=%v want=100", deviceTotal)
		}
	}
	detailed, err := repo.SiteDetailed(ctx, tenantContext, filters)
	if err != nil {
		t.Fatalf("SiteDetailed query: %v", err)
	}
	for _, rawCampaign := range detailed["campaigns"].([]any) {
		campaign := rawCampaign.(map[string]any)
		sourceType, ok := campaign["source_type"].(string)
		if !ok || sourceType == "" {
			t.Fatalf("SiteDetailed campaign omitted canonical source_type: %#v", campaign)
		}
	}

	leadAnalytics, err := repo.LeadAnalytics(ctx, tenantContext, filters)
	if err != nil {
		t.Fatalf("LeadAnalytics query: %v", err)
	}
	totalSessions := leadAnalytics["total_sessions"].(float64)
	for _, rawStep := range leadAnalytics["funnel"].([]any) {
		step := rawStep.(map[string]any)
		if step["total"].(float64) > totalSessions {
			t.Fatalf("funnel stage exceeds distinct sessions: %#v total_sessions=%v", step, totalSessions)
		}
	}
	var deviceSessions float64
	for _, rawDevice := range leadAnalytics["device_breakdown"].([]any) {
		device := rawDevice.(map[string]any)
		deviceSessions += device["total"].(float64)
	}
	if deviceSessions != totalSessions {
		t.Fatalf("device breakdown sessions=%v want=%v", deviceSessions, totalSessions)
	}
	for _, rawJourney := range leadAnalytics["journeys"].([]any) {
		journey := rawJourney.(map[string]any)
		pageEvents := 0
		for _, rawEventType := range journey["event_sequence"].([]any) {
			eventType := rawEventType.(string)
			if eventType == "pageview" || eventType == "page_view" {
				pageEvents++
			}
		}
		if len(journey["path_sequence"].([]any)) > pageEvents {
			t.Fatalf("journey path contains non-navigation events: %#v", journey)
		}
	}
	legacyCapabilities := siteAnalyticsSchemaCapabilities{lastSeenAt: true}
	if _, err := repo.siteDetailedLegacy(ctx, tenantContext, filters, legacyCapabilities); err != nil {
		t.Fatalf("siteDetailedLegacy query: %v", err)
	}
	if _, err := repo.leadAnalyticsLegacy(ctx, tenantContext, filters, legacyCapabilities); err != nil {
		t.Fatalf("leadAnalyticsLegacy query: %v", err)
	}

	if _, err := repo.SiteDetailed(ctx, tenantContext, url.Values{}); err != nil {
		t.Fatalf("SiteDetailed default-range query: %v", err)
	}
	if _, err := repo.LeadAnalytics(ctx, tenantContext, url.Values{}); err != nil {
		t.Fatalf("LeadAnalytics default-range query: %v", err)
	}
}
