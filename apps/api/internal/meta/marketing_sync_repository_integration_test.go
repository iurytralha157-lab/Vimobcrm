package meta

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMarketingSyncRepositoryAgainstPostgres(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("MARKETING_SYNC_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set MARKETING_SYNC_TEST_DATABASE_URL to run the PostgreSQL contract test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect PostgreSQL: %v", err)
	}
	defer pool.Close()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin transaction: %v", err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	var organizationID, userID string
	err = tx.QueryRow(ctx, `
		select member.organization_id::text, member.user_id::text
		from public.organization_members as member
		join public.users as app_user on app_user.id = member.user_id
		where coalesce(member.is_active, true) = true
		order by member.created_at
		limit 1
	`).Scan(&organizationID, &userID)
	if err != nil {
		t.Fatalf("load test tenant: %v", err)
	}
	_, err = tx.Exec(ctx, `
		insert into public.organization_modules (organization_id, module_name, is_enabled)
		values ($1::uuid, 'campaigns', true)
		on conflict (organization_id, module_name)
		do update set is_enabled = excluded.is_enabled
	`, organizationID)
	if err != nil {
		t.Fatalf("enable Marketing module: %v", err)
	}

	var integrationID string
	err = tx.QueryRow(ctx, `
		insert into public.meta_integrations (
		  organization_id, page_id, page_name, access_token,
		  user_access_token, is_connected, token_status,
		  ad_account_id, selected_ad_accounts
		)
		values (
		  $1::uuid, 'marketing-sync-pgx-test-' || gen_random_uuid()::text,
		  'Marketing sync pgx test', 'test-page-token',
		  'test-user-token', true, 'active', 'act_123', '["act_123"]'::jsonb
		)
		returning id::text
	`, organizationID).Scan(&integrationID)
	if err != nil {
		t.Fatalf("insert test integration: %v", err)
	}

	service := newMarketingSyncService(tx, Config{}, nil)
	fixedNow := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return fixedNow }
	targets, err := service.loadMarketingSyncTargets(ctx, organizationID)
	if err != nil {
		t.Fatalf("load targets: %v", err)
	}
	var target marketingSyncTarget
	for _, candidate := range targets {
		if candidate.IntegrationID == integrationID {
			target = candidate
			break
		}
	}
	if target.IntegrationID == "" || target.AccessToken != "test-user-token" {
		t.Fatalf("target = %#v", target)
	}
	_, err = tx.Exec(ctx, `
		update public.organization_modules
		set is_enabled = false
		where organization_id = $1::uuid
		  and lower(btrim(module_name)) = 'campaigns'
	`, organizationID)
	if err != nil {
		t.Fatalf("disable Marketing module: %v", err)
	}
	disabledTargets, err := service.loadMarketingSyncTargets(ctx, organizationID)
	if err != nil {
		t.Fatalf("load disabled targets: %v", err)
	}
	for _, candidate := range disabledTargets {
		if candidate.IntegrationID == integrationID {
			t.Fatalf("disabled Marketing module exposed sync target %#v", candidate)
		}
	}
	_, err = tx.Exec(ctx, `
		update public.organization_modules
		set is_enabled = true
		where organization_id = $1::uuid
		  and lower(btrim(module_name)) = 'campaigns'
	`, organizationID)
	if err != nil {
		t.Fatalf("re-enable Marketing module: %v", err)
	}

	account := marketingSyncAccountRow{
		OrganizationID: organizationID, IntegrationID: integrationID,
		ExternalAccountID: "act_123", Name: "Test account", Currency: "BRL",
		TimezoneName: "America/Sao_Paulo", AccountStatus: "1", IsActive: true, SyncedAt: fixedNow,
	}
	if err := service.upsertMarketingSyncAccount(ctx, account); err != nil {
		t.Fatalf("upsert account: %v", err)
	}
	performance := []marketingSyncPerformanceRow{{
		OrganizationID: organizationID, IntegrationID: integrationID,
		ExternalAccountID: "act_123", Level: "account", EntityID: "act_123",
		MetricDate: fixedNow, Spend: 10, Impressions: 100, Reach: 90, Clicks: 5,
		VideoViews: 77, VideoThreeSecondViews: 33, VideoThruplays: 11,
		RawActions: map[string]any{
			"actions":            map[string]float64{"lead": 1},
			"video_play_actions": map[string]float64{"video_view": 77},
		},
		VideoMetricsAvailable: true, FetchedAt: fixedNow,
	}}
	if written, err := service.upsertMarketingSyncPerformance(ctx, performance); err != nil || written != 1 {
		t.Fatalf("upsert performance written=%d error=%v", written, err)
	}
	partialPerformance := performance[0]
	partialPerformance.Spend = 20
	partialPerformance.VideoViews = 0
	partialPerformance.VideoThreeSecondViews = 0
	partialPerformance.VideoThruplays = 0
	partialPerformance.VideoMetricsAvailable = false
	partialPerformance.RawActions = map[string]any{"actions": map[string]float64{"lead": 2}}
	if written, err := service.upsertMarketingSyncPerformance(ctx, []marketingSyncPerformanceRow{partialPerformance}); err != nil || written != 1 {
		t.Fatalf("partial performance written=%d error=%v", written, err)
	}
	var spend float64
	var videoViews, videoThreeSecondViews, videoThruplays int64
	if err := tx.QueryRow(ctx, `
		select spend::double precision, video_views, video_three_second_views, video_thruplays
		from public.marketing_performance_daily
		where organization_id = $1::uuid and integration_id = $2::uuid
		  and external_account_id = 'act_123' and level = 'account'
		  and entity_id = 'act_123' and metric_date = $3::date
	`, organizationID, integrationID, fixedNow).Scan(&spend, &videoViews, &videoThreeSecondViews, &videoThruplays); err != nil {
		t.Fatalf("read partial performance: %v", err)
	}
	if spend != 20 || videoViews != 77 || videoThreeSecondViews != 33 || videoThruplays != 11 {
		t.Fatalf("partial performance overwrote valid group: spend=%v video=(%d,%d,%d)", spend, videoViews, videoThreeSecondViews, videoThruplays)
	}
	media := []marketingSyncMediaRow{{
		OrganizationID: organizationID, IntegrationID: integrationID, Provider: "meta",
		ExternalAccountID: "act_123", ExternalMediaID: "ad-test", SourceKind: "paid",
		Metrics: map[string]any{"spend": 10, "reach": 50}, RawMetadata: map[string]any{}, SyncedAt: fixedNow,
	}}
	if written, err := service.upsertMarketingSyncMedia(ctx, media); err != nil || written != 1 {
		t.Fatalf("upsert media written=%d error=%v", written, err)
	}
	partialMedia := media[0]
	partialMedia.Metrics = map[string]any{"spend": 20}
	if written, err := service.upsertMarketingSyncMedia(ctx, []marketingSyncMediaRow{partialMedia}); err != nil || written != 1 {
		t.Fatalf("partial media written=%d error=%v", written, err)
	}
	var mediaMetrics string
	if err := tx.QueryRow(ctx, `
		select metrics::text from public.marketing_media_assets
		where organization_id = $1::uuid and provider = 'meta' and external_media_id = 'ad-test'
	`, organizationID).Scan(&mediaMetrics); err != nil || !strings.Contains(mediaMetrics, `"reach": 50`) || !strings.Contains(mediaMetrics, `"spend": 20`) {
		t.Fatalf("merged media metrics=%s error=%v", mediaMetrics, err)
	}
	followers := int64(10)
	social := []marketingSyncSocialRow{{
		OrganizationID: organizationID, IntegrationID: integrationID,
		ProfileID: "ig-test", MetricDate: fixedNow, Followers: &followers, Reach: 50,
		RawMetrics: map[string]any{"availability": map[string]any{"followers": true, "reach": true}, "profile": map[string]any{"reach": 50}}, FetchedAt: fixedNow,
	}}
	if written, err := service.upsertMarketingSyncSocial(ctx, social); err != nil || written != 1 {
		t.Fatalf("upsert social written=%d error=%v", written, err)
	}
	partialSocial := social[0]
	partialSocial.Followers = nil
	partialSocial.Reach = 0
	partialSocial.ProfileViews = 5
	partialSocial.RawMetrics = map[string]any{"availability": map[string]any{"profile_views": true}, "profile": map[string]any{"profile_views": 5}}
	if written, err := service.upsertMarketingSyncSocial(ctx, []marketingSyncSocialRow{partialSocial}); err != nil || written != 1 {
		t.Fatalf("partial social written=%d error=%v", written, err)
	}
	var storedFollowers *int64
	var storedReach, storedProfileViews int64
	if err := tx.QueryRow(ctx, `
		select followers, reach, profile_views from public.marketing_social_daily
		where organization_id = $1::uuid and provider = 'instagram'
		  and profile_id = 'ig-test' and metric_date = $2::date
	`, organizationID, fixedNow).Scan(&storedFollowers, &storedReach, &storedProfileViews); err != nil {
		t.Fatalf("read partial social: %v", err)
	}
	if storedFollowers == nil || *storedFollowers != 10 || storedReach != 50 || storedProfileViews != 5 {
		t.Fatalf("partial social overwrote valid values: followers=%v reach=%d profile_views=%d", storedFollowers, storedReach, storedProfileViews)
	}
	historicalSocial := marketingSyncSocialRow{
		OrganizationID: organizationID, IntegrationID: integrationID,
		ProfileID: "ig-historical-unknown", MetricDate: fixedNow.AddDate(0, 0, -1), Followers: nil, Reach: 1,
		RawMetrics: map[string]any{"availability": map[string]any{"reach": true}, "profile": map[string]any{"reach": 1}}, FetchedAt: fixedNow,
	}
	if _, err := service.upsertMarketingSyncSocial(ctx, []marketingSyncSocialRow{historicalSocial}); err != nil {
		t.Fatalf("insert unknown historical followers: %v", err)
	}
	var historicalFollowersUnknown bool
	if err := tx.QueryRow(ctx, `
		select followers is null from public.marketing_social_daily
		where organization_id = $1::uuid and provider = 'instagram'
		  and profile_id = 'ig-historical-unknown'
	`, organizationID).Scan(&historicalFollowersUnknown); err != nil || !historicalFollowersUnknown {
		t.Fatalf("historical followers unknown=%v error=%v", historicalFollowersUnknown, err)
	}

	stalePerformance := performance[0]
	stalePerformance.EntityID = "stale-account-snapshot"
	if _, err := service.upsertMarketingSyncPerformance(ctx, []marketingSyncPerformanceRow{stalePerformance}); err != nil {
		t.Fatalf("insert stale performance: %v", err)
	}
	outsideDate := performance[0]
	outsideDate.EntityID = "outside-date-snapshot"
	outsideDate.MetricDate = fixedNow.AddDate(0, 0, 1)
	otherLevel := performance[0]
	otherLevel.Level = "campaign"
	otherLevel.EntityID = "other-level-snapshot"
	otherAccount := performance[0]
	otherAccount.ExternalAccountID = "act_456"
	otherAccount.EntityID = "other-account-snapshot"
	if _, err := service.upsertMarketingSyncPerformance(ctx, []marketingSyncPerformanceRow{outsideDate, otherLevel, otherAccount}); err != nil {
		t.Fatalf("insert reconciliation scope controls: %v", err)
	}
	dateRange := marketingSyncDateRange{From: fixedNow, To: fixedNow}
	if deleted, err := service.reconcileMarketingSyncPerformance(ctx, target, "act_123", "account", dateRange, performance); err != nil || deleted != 1 {
		t.Fatalf("reconcile performance deleted=%d error=%v", deleted, err)
	}
	var staleCount int
	if err := tx.QueryRow(ctx, `
		select count(*) from public.marketing_performance_daily
		where organization_id = $1::uuid and integration_id = $2::uuid
		  and external_account_id = 'act_123' and level = 'account'
		  and entity_id = 'stale-account-snapshot' and metric_date = $3::date
	`, organizationID, integrationID, fixedNow).Scan(&staleCount); err != nil || staleCount != 0 {
		t.Fatalf("stale snapshot count=%d error=%v", staleCount, err)
	}
	var protectedCount int
	if err := tx.QueryRow(ctx, `
		select count(*) from public.marketing_performance_daily
		where organization_id = $1::uuid and integration_id = $2::uuid
		  and (
		    (external_account_id = 'act_123' and level = 'account' and entity_id = 'outside-date-snapshot' and metric_date = $3::date + 1)
		    or (external_account_id = 'act_123' and level = 'campaign' and entity_id = 'other-level-snapshot' and metric_date = $3::date)
		    or (external_account_id = 'act_456' and level = 'account' and entity_id = 'other-account-snapshot' and metric_date = $3::date)
		  )
	`, organizationID, integrationID, fixedNow).Scan(&protectedCount); err != nil || protectedCount != 3 {
		t.Fatalf("reconciliation escaped scope: protected=%d error=%v", protectedCount, err)
	}

	runID, err := service.createMarketingSyncRun(ctx, target, dateRange, userID)
	if err != nil {
		t.Fatalf("create sync run: %v", err)
	}
	result := marketingSyncAggregate{Synced: 1, MediaSynced: 1, SocialSynced: 1}
	if err := service.finishMarketingSyncRun(ctx, runID, target, result); err != nil {
		t.Fatalf("finish sync run: %v", err)
	}
	if err := service.updateMarketingSyncIntegrationStatus(ctx, target, result); err != nil {
		t.Fatalf("update integration status: %v", err)
	}

	var runStatus string
	err = tx.QueryRow(ctx, `
		select status
		from public.marketing_sync_runs
		where id = $1::uuid and organization_id = $2::uuid and integration_id = $3::uuid
	`, runID, organizationID, integrationID).Scan(&runStatus)
	if err != nil || runStatus != "succeeded" {
		t.Fatalf("run status=%q error=%v", runStatus, err)
	}
}
