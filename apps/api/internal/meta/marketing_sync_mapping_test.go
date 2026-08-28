package meta

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestParseMarketingSyncRequestAndDateChunks(t *testing.T) {
	request := MarketingSyncRequest{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		DateFrom:       "2026-01-01",
		DateTo:         "2026-03-31",
	}
	dateRange, err := parseMarketingSyncRequest(request)
	if err != nil {
		t.Fatalf("parse request error = %v", err)
	}
	chunks := chunkMarketingSyncDateRange(dateRange, 30)
	if len(chunks) != 3 {
		t.Fatalf("chunks = %d, want 3", len(chunks))
	}
	if chunks[0].fromText() != "2026-01-01" || chunks[0].toText() != "2026-01-30" || chunks[2].toText() != "2026-03-31" {
		t.Fatalf("chunks = %#v", chunks)
	}

	request.DateTo = "2026-04-01"
	_, err = parseMarketingSyncRequest(request)
	if marketingSyncErrorCode(err) != "date_range_exceeds_90_days" {
		t.Fatalf("error code = %q", marketingSyncErrorCode(err))
	}
}

func TestDeriveMarketingSyncInsightMetricsAvoidsAliasDoubleCount(t *testing.T) {
	metrics := deriveMarketingSyncInsightMetrics(map[string]any{
		"spend":       "120.00",
		"impressions": "1000",
		"actions": []any{
			map[string]any{"action_type": "lead", "value": "5"},
			map[string]any{"action_type": "onsite_conversion.lead_grouped", "value": "5"},
			map[string]any{"action_type": "messaging_conversation_started_7d", "value": "3"},
			map[string]any{"action_type": "purchase", "value": "2"},
			map[string]any{"action_type": "video_view", "value": "250"},
		},
	})
	if metrics.Leads != 5 || metrics.Conversations != 3 || metrics.Conversions != 2 {
		t.Fatalf("reported metrics = %#v", metrics.marketingSyncReportedMetrics)
	}
	if metrics.CPL == nil || *metrics.CPL != 24 {
		t.Fatalf("CPL = %v, want 24", metrics.CPL)
	}
	if metrics.HookRate == nil || *metrics.HookRate != 25 {
		t.Fatalf("hook rate = %v, want 25", metrics.HookRate)
	}
}

func TestMarketingSyncPerformanceIdentityIsDailyAndTenantScoped(t *testing.T) {
	target := marketingSyncTarget{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		IntegrationID:  "22222222-2222-4222-8222-222222222222",
	}
	row, ok := marketingSyncPerformanceRowFromInsight(
		map[string]any{"date_start": "2026-07-30", "campaign_id": "campaign-1", "campaign_name": "Campaign", "spend": "10"},
		"campaign", target, "act_123", map[string]any{"currency": "BRL"},
		marketingSyncEntityCatalog{Campaigns: map[string]map[string]any{"campaign-1": {"id": "campaign-1"}}, Adsets: map[string]map[string]any{}, Ads: map[string]map[string]any{}, Creatives: map[string]map[string]any{}},
		time.Now(),
	)
	if !ok || row.OrganizationID != target.OrganizationID || row.IntegrationID != target.IntegrationID || row.EntityID != "campaign-1" || row.MetricDate.Format(time.DateOnly) != "2026-07-30" {
		t.Fatalf("row = %#v, ok = %v", row, ok)
	}
}

func TestMarketingSyncPerformanceMarksFallbackMetricGroupsUnavailable(t *testing.T) {
	target := marketingSyncTarget{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		IntegrationID:  "22222222-2222-4222-8222-222222222222",
	}
	row, ok := marketingSyncPerformanceRowFromInsight(
		map[string]any{
			"date_start": "2026-07-30", "spend": "15",
			"_vimob_video_metrics_available": false,
		},
		"account", target, "act_123", map[string]any{"currency": "BRL"},
		marketingSyncEntityCatalog{Campaigns: map[string]map[string]any{}, Adsets: map[string]map[string]any{}, Ads: map[string]map[string]any{}, Creatives: map[string]map[string]any{}},
		time.Now(),
	)
	if !ok || row.VideoMetricsAvailable {
		t.Fatalf("row=%#v ok=%v", row, ok)
	}
}

func TestMarketingSyncSnapshotRequiresCompleteCollectionAndMapping(t *testing.T) {
	complete := marketingSyncInsightResult{Items: []map[string]any{{"id": "1"}}, Complete: true}
	if !marketingSyncInsightSnapshotComplete(complete, 1) {
		t.Fatal("complete snapshot was rejected")
	}
	for _, incomplete := range []marketingSyncInsightResult{
		{Items: complete.Items, Complete: false},
		{Items: complete.Items, Complete: true, Err: newMarketingSyncFailure("failed", 500, nil)},
	} {
		if marketingSyncInsightSnapshotComplete(incomplete, 1) {
			t.Fatalf("incomplete snapshot accepted: %#v", incomplete)
		}
	}
	if marketingSyncInsightSnapshotComplete(complete, 0) {
		t.Fatal("snapshot with mapping loss was accepted")
	}
}

func TestPaidMediaOmitsVideoMetricWhenInsightFallbackLostTheGroup(t *testing.T) {
	target := marketingSyncTarget{OrganizationID: "11111111-1111-4111-8111-111111111111", IntegrationID: "22222222-2222-4222-8222-222222222222"}
	rows := buildMarketingSyncPaidMedia(target, "act_123", marketingSyncEntityCatalog{
		Campaigns: map[string]map[string]any{}, Adsets: map[string]map[string]any{},
		Ads: map[string]map[string]any{"ad-1": {"id": "ad-1"}}, Creatives: map[string]map[string]any{},
	}, []marketingSyncPerformanceRow{{
		Level: "ad", AdID: "ad-1", VideoViews: 500, VideoMetricsAvailable: false,
	}}, time.Now())
	if len(rows) != 1 {
		t.Fatalf("media rows=%#v", rows)
	}
	if _, exists := rows[0].Metrics["video_views"]; exists {
		t.Fatalf("partial video metric must be omitted, got %#v", rows[0].Metrics)
	}
}

func TestCollectMarketingSyncProfileMetricsIgnoresLifetimeTotals(t *testing.T) {
	dateRange := marketingSyncDateRange{From: mustMarketingSyncDate(t, "2026-07-01"), To: mustMarketingSyncDate(t, "2026-07-31")}
	metrics := collectMarketingSyncProfileMetrics([]map[string]any{{
		"data": []any{
			map[string]any{"name": "reach", "total_value": map[string]any{"value": 999}},
			map[string]any{"name": "profile_views", "values": []any{
				map[string]any{"end_time": "2026-07-20T07:00:00+0000", "value": 12},
			}},
		},
	}}, dateRange)
	if len(metrics) != 1 || marketingSyncInteger(metrics["2026-07-20"]["profile_views"]) != 12 {
		t.Fatalf("daily metrics=%#v", metrics)
	}
	if _, exists := metrics["2026-07-31"]; exists {
		t.Fatalf("lifetime total was assigned to a day: %#v", metrics)
	}
}

func TestSelectedMarketingSyncAccountsAreNormalizedAndDeduplicated(t *testing.T) {
	accounts := selectedMarketingSyncAccountIDs(marketingSyncTarget{
		SelectedAdAccounts: []any{
			"123",
			map[string]any{"id": "act_123"},
			map[string]any{"account_id": "456"},
			"not-an-account",
		},
		AdAccountID: "act_999",
	})
	if strings.Join(accounts, ",") != "act_123,act_456" {
		t.Fatalf("accounts = %#v", accounts)
	}
}

func TestMarketingSyncGraphOriginIsPinned(t *testing.T) {
	unsafeValues := []string{
		"http://graph.facebook.com",
		"https://attacker.example",
		"https://graph.facebook.com.evil.example",
		"https://user:password@graph.facebook.com",
		"https://graph.facebook.com:444",
		"https://graph.facebook.com/path",
		"https://graph.facebook.com?token=steal",
	}
	for _, value := range unsafeValues {
		if got := normalizeMarketingSyncGraphBaseURL(value); got != marketingSyncGraphOrigin {
			t.Fatalf("normalize(%q) = %q", value, got)
		}
	}
	if got := normalizeMarketingSyncGraphBaseURL("https://graph.facebook.com/"); got != marketingSyncGraphOrigin {
		t.Fatalf("official graph origin = %q", got)
	}
}

func TestMarketingSyncRepositoryVaultAndTenantContract(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	sourcePath := filepath.Join(filepath.Dir(filename), "marketing_sync_repository.go")
	source, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatalf("read repository source: %v", err)
	}
	text := string(source)
	required := []string{
		"vault.decrypted_secrets",
		"integration.user_access_token_secret_ref",
		"join public.organization_modules as module_access",
		"lower(btrim(module_access.module_name)) = 'campaigns'",
		"module_access.is_enabled = true",
		"integration.organization_id = $1::uuid",
		"where id = $1::uuid",
		"and organization_id = $2::uuid",
		"and integration_id = $3::uuid",
		"snapshot.organization_id = $1::uuid",
		"snapshot.integration_id = $2::uuid",
		"snapshot.external_account_id = $3",
		"snapshot.level = $4",
		"snapshot.metric_date between $5::date and $6::date",
		"jsonb_to_recordset($7::jsonb)",
		"when $45 then excluded.video_views",
		"coalesce(marketing_media_assets.metrics, '{}'::jsonb) || excluded.metrics",
	}
	for _, fragment := range required {
		if !strings.Contains(text, fragment) {
			t.Fatalf("repository is missing tenant/Vault contract fragment %q", fragment)
		}
	}
	if strings.Contains(text, "SUPABASE_SERVICE_ROLE_KEY") || strings.Contains(text, ".from(") {
		t.Fatal("Go synchronizer must not use a service-role key or PostgREST")
	}
}

func TestMarketingSyncSocialStorageDoesNotFabricateHistoricalFollowersOrPostLifetimeDailyMetrics(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	directory := filepath.Dir(filename)
	migrationPath := filepath.Clean(filepath.Join(directory, "../../../../supabase/migrations/20260731120000_marketing_intelligence_foundation.sql"))
	migration, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read marketing migration: %v", err)
	}
	migrationText := string(migration)
	if !strings.Contains(migrationText, "followers bigint,") || strings.Contains(migrationText, "followers bigint not null") {
		t.Fatal("marketing_social_daily.followers must remain nullable for unknown historical snapshots")
	}

	socialPath := filepath.Join(directory, "marketing_sync_social.go")
	social, err := os.ReadFile(socialPath)
	if err != nil {
		t.Fatalf("read social synchronizer: %v", err)
	}
	socialText := string(social)
	for _, forbidden := range []string{"aggregate.Reach +=", "aggregate.Interactions +=", "aggregate.Likes +=", "aggregate.VideoViews +="} {
		if strings.Contains(socialText, forbidden) {
			t.Fatalf("post lifetime metric is still written to social daily: %q", forbidden)
		}
	}
	if !strings.Contains(socialText, "Deliberately ignore total_value") {
		t.Fatal("profile lifetime totals must be excluded from daily snapshots")
	}
}

func mustMarketingSyncDate(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.DateOnly, value)
	if err != nil {
		t.Fatalf("parse date %q: %v", value, err)
	}
	return parsed
}
