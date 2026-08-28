package meta

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type marketingSyncAccountRow struct {
	OrganizationID    string
	IntegrationID     string
	ExternalAccountID string
	Name              string
	Currency          string
	TimezoneName      string
	AccountStatus     string
	IsActive          bool
	LastError         string
	SyncedAt          time.Time
}

type marketingSyncPerformanceRow struct {
	OrganizationID        string
	IntegrationID         string
	ExternalAccountID     string
	Level                 string
	EntityID              string
	MetricDate            time.Time
	CampaignID            string
	CampaignName          string
	AdsetID               string
	AdsetName             string
	AdID                  string
	AdName                string
	Status                string
	Objective             string
	OptimizationGoal      string
	BuyingType            string
	Budget                *float64
	BudgetType            string
	Currency              string
	TimezoneName          string
	Spend                 float64
	Impressions           int64
	Reach                 int64
	Clicks                int64
	LinkClicks            int64
	LeadsReported         int64
	ConversationsReported int64
	ConversionsReported   int64
	VideoViews            int64
	VideoThreeSecondViews int64
	VideoThruplays        int64
	CTR                   *float64
	CPC                   *float64
	CPM                   *float64
	CPL                   *float64
	Frequency             *float64
	HookRate              *float64
	CreativeID            string
	CreativeURL           string
	CreativeVideoURL      string
	CreativePermalinkURL  string
	ThumbnailURL          string
	RawActions            map[string]any
	VideoMetricsAvailable bool
	FetchedAt             time.Time
}

type marketingSyncMediaRow struct {
	OrganizationID    string
	IntegrationID     string
	Provider          string
	ExternalAccountID string
	ExternalMediaID   string
	SourceKind        string
	MediaType         string
	Title             string
	Caption           string
	CampaignID        string
	CampaignName      string
	AdsetID           string
	AdsetName         string
	AdID              string
	AdName            string
	CreativeID        string
	ThumbnailURL      string
	MediaURL          string
	VideoURL          string
	PermalinkURL      string
	PublishedAt       *time.Time
	Metrics           map[string]any
	RawMetadata       map[string]any
	SyncedAt          time.Time
}

type marketingSyncSocialRow struct {
	OrganizationID string
	IntegrationID  string
	ProfileID      string
	ProfileName    string
	MetricDate     time.Time
	Followers      *int64
	FollowerGrowth int64
	Posts          int64
	Impressions    int64
	Reach          int64
	Interactions   int64
	Likes          int64
	Comments       int64
	Saves          int64
	Shares         int64
	ProfileViews   int64
	WebsiteClicks  int64
	VideoViews     int64
	RawMetrics     map[string]any
	FetchedAt      time.Time
}

type marketingSyncSocialSnapshot struct {
	Followers      *int64
	FollowerGrowth int64
}

func (service *MarketingSyncService) loadMarketingSyncTargets(ctx context.Context, organizationID string) ([]marketingSyncTarget, error) {
	if service.db == nil {
		return nil, newMarketingSyncFailure("marketing_database_unavailable", 503, nil)
	}
	dbCtx, cancel := service.marketingSyncDatabaseContext(ctx)
	defer cancel()
	rows, err := service.db.Query(dbCtx, `
		select
		  integration.id::text,
		  integration.organization_id::text,
		  coalesce(integration.page_id, ''),
		  coalesce(integration.page_name, ''),
		  coalesce(integration.instagram_business_account_id, ''),
		  coalesce(integration.instagram_username, ''),
		  coalesce(integration.ad_account_id, ''),
		  coalesce(integration.selected_ad_accounts, '[]'::jsonb)::text,
		  secret.decrypted_secret
		from public.meta_integrations as integration
		join vault.decrypted_secrets as secret
		  on secret.id = integration.user_access_token_secret_ref
		join public.organization_modules as module_access
		  on module_access.organization_id = integration.organization_id
		 and lower(btrim(module_access.module_name)) = 'campaigns'
		 and module_access.is_enabled = true
		where integration.organization_id = $1::uuid
		  and coalesce(integration.is_connected, false) = true
		  and coalesce(integration.token_status, 'active') = 'active'
		  and nullif(secret.decrypted_secret, '') is not null
		order by integration.updated_at desc, integration.created_at desc
	`, organizationID)
	if err != nil {
		return nil, newMarketingSyncFailure("sync_target_lookup_failed", 503, err)
	}
	defer rows.Close()

	targets := make([]marketingSyncTarget, 0)
	for rows.Next() {
		var target marketingSyncTarget
		var selected string
		if err := rows.Scan(
			&target.IntegrationID,
			&target.OrganizationID,
			&target.PageID,
			&target.PageName,
			&target.InstagramBusinessAccountID,
			&target.InstagramUsername,
			&target.AdAccountID,
			&selected,
			&target.AccessToken,
		); err != nil {
			return nil, newMarketingSyncFailure("sync_target_lookup_failed", 503, err)
		}
		if target.OrganizationID != organizationID || !marketingSyncUUIDPattern.MatchString(target.IntegrationID) || strings.TrimSpace(target.AccessToken) == "" {
			continue
		}
		if err := json.Unmarshal([]byte(selected), &target.SelectedAdAccounts); err != nil {
			target.SelectedAdAccounts = nil
		}
		targets = append(targets, target)
	}
	if err := rows.Err(); err != nil {
		return nil, newMarketingSyncFailure("sync_target_lookup_failed", 503, err)
	}
	return targets, nil
}

func (service *MarketingSyncService) upsertMarketingSyncAccount(ctx context.Context, row marketingSyncAccountRow) error {
	dbCtx, cancel := service.marketingSyncDatabaseContext(ctx)
	defer cancel()
	_, err := service.db.Exec(dbCtx, `
		insert into public.marketing_accounts (
		  organization_id, integration_id, provider, external_account_id,
		  name, currency, timezone_name, account_status, is_active,
		  last_synced_at, last_error, updated_at
		)
		values ($1::uuid, $2::uuid, 'meta', $3, $4, $5, $6, $7, $8, $9, $10, $9)
		on conflict (organization_id, provider, external_account_id)
		do update set
		  integration_id = excluded.integration_id,
		  name = excluded.name,
		  currency = excluded.currency,
		  timezone_name = excluded.timezone_name,
		  account_status = excluded.account_status,
		  is_active = excluded.is_active,
		  last_synced_at = excluded.last_synced_at,
		  last_error = excluded.last_error,
		  updated_at = excluded.updated_at
	`, row.OrganizationID, row.IntegrationID, row.ExternalAccountID,
		nullableMarketingSyncText(row.Name), nullableMarketingSyncText(row.Currency),
		nullableMarketingSyncText(row.TimezoneName), nullableMarketingSyncText(row.AccountStatus),
		row.IsActive, row.SyncedAt, nullableMarketingSyncText(row.LastError))
	if err != nil {
		return newMarketingSyncFailure("marketing_accounts_write_failed", 500, err)
	}
	return nil
}

func (service *MarketingSyncService) recordMarketingSyncAccountError(ctx context.Context, target marketingSyncTarget, accountID, errorCode string) error {
	dbCtx, cancel := service.marketingSyncDatabaseContext(ctx)
	defer cancel()
	now := service.now().UTC()
	_, err := service.db.Exec(dbCtx, `
		update public.marketing_accounts
		set last_synced_at = $4,
		    last_error = $5,
		    updated_at = $4
		where organization_id = $1::uuid
		  and integration_id = $2::uuid
		  and provider = 'meta'
		  and external_account_id = $3
	`, target.OrganizationID, target.IntegrationID, accountID, now, errorCode)
	if err != nil {
		return newMarketingSyncFailure("marketing_accounts_write_failed", 500, err)
	}
	return nil
}

func (service *MarketingSyncService) upsertMarketingSyncPerformance(ctx context.Context, rows []marketingSyncPerformanceRow) (int, error) {
	const query = `
		insert into public.marketing_performance_daily (
		  organization_id, integration_id, provider, external_account_id,
		  level, entity_id, metric_date,
		  campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
		  status, objective, optimization_goal, buying_type, budget, budget_type,
		  currency, timezone_name, spend, impressions, reach, clicks, link_clicks,
		  leads_reported, conversations_reported, conversions_reported,
		  video_views, video_three_second_views, video_thruplays,
		  ctr, cpc, cpm, cpl, frequency, hook_rate,
		  creative_id, creative_url, creative_video_url,
		  creative_permalink_url, thumbnail_url, raw_actions,
		  fetched_at, updated_at
		)
		values (
		  $1::uuid, $2::uuid, 'meta', $3, $4, $5, $6::date,
		  $7, $8, $9, $10, $11, $12,
		  $13, $14, $15, $16, $17, $18, $19, $20,
		  $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31,
		  $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42,
		  $43::jsonb, $44, $44
		)
		on conflict (organization_id, provider, external_account_id, level, entity_id, metric_date)
		do update set
		  integration_id = excluded.integration_id,
		  campaign_id = excluded.campaign_id,
		  campaign_name = excluded.campaign_name,
		  adset_id = excluded.adset_id,
		  adset_name = excluded.adset_name,
		  ad_id = excluded.ad_id,
		  ad_name = excluded.ad_name,
		  status = excluded.status,
		  objective = excluded.objective,
		  optimization_goal = excluded.optimization_goal,
		  buying_type = excluded.buying_type,
		  budget = excluded.budget,
		  budget_type = excluded.budget_type,
		  currency = excluded.currency,
		  timezone_name = excluded.timezone_name,
		  spend = excluded.spend,
		  impressions = excluded.impressions,
		  reach = excluded.reach,
		  clicks = excluded.clicks,
		  link_clicks = excluded.link_clicks,
		  leads_reported = excluded.leads_reported,
		  conversations_reported = excluded.conversations_reported,
		  conversions_reported = excluded.conversions_reported,
		  video_views = case when $45 then excluded.video_views else marketing_performance_daily.video_views end,
		  video_three_second_views = case when $45 then excluded.video_three_second_views else marketing_performance_daily.video_three_second_views end,
		  video_thruplays = case when $45 then excluded.video_thruplays else marketing_performance_daily.video_thruplays end,
		  ctr = excluded.ctr,
		  cpc = excluded.cpc,
		  cpm = excluded.cpm,
		  cpl = excluded.cpl,
		  frequency = excluded.frequency,
		  hook_rate = case when $45 then excluded.hook_rate else marketing_performance_daily.hook_rate end,
		  creative_id = excluded.creative_id,
		  creative_url = excluded.creative_url,
		  creative_video_url = excluded.creative_video_url,
		  creative_permalink_url = excluded.creative_permalink_url,
		  thumbnail_url = excluded.thumbnail_url,
		  raw_actions = case
		    when $45 then excluded.raw_actions
		    else coalesce(marketing_performance_daily.raw_actions, '{}'::jsonb)
		      || (
		        excluded.raw_actions
		        - 'video_play_actions'
		        - 'video_30_sec_watched_actions'
		        - 'video_thruplay_watched_actions'
		        - 'video_p25_watched_actions'
		        - 'video_p50_watched_actions'
		        - 'video_p75_watched_actions'
		        - 'video_p95_watched_actions'
		        - 'video_p100_watched_actions'
		      )
		  end,
		  fetched_at = excluded.fetched_at,
		  updated_at = excluded.updated_at
	`
	return service.sendMarketingSyncBatches(ctx, len(rows), "marketing_performance_daily_write_failed", func(batch *pgx.Batch, index int) {
		row := rows[index]
		batch.Queue(query,
			row.OrganizationID, row.IntegrationID, row.ExternalAccountID,
			row.Level, row.EntityID, row.MetricDate,
			nullableMarketingSyncText(row.CampaignID), nullableMarketingSyncText(row.CampaignName),
			nullableMarketingSyncText(row.AdsetID), nullableMarketingSyncText(row.AdsetName),
			nullableMarketingSyncText(row.AdID), nullableMarketingSyncText(row.AdName),
			nullableMarketingSyncText(row.Status), nullableMarketingSyncText(row.Objective),
			nullableMarketingSyncText(row.OptimizationGoal), nullableMarketingSyncText(row.BuyingType),
			row.Budget, nullableMarketingSyncText(row.BudgetType), nullableMarketingSyncText(row.Currency),
			nullableMarketingSyncText(row.TimezoneName), row.Spend, row.Impressions, row.Reach,
			row.Clicks, row.LinkClicks, row.LeadsReported, row.ConversationsReported,
			row.ConversionsReported, row.VideoViews, row.VideoThreeSecondViews, row.VideoThruplays,
			row.CTR, row.CPC, row.CPM, row.CPL, row.Frequency, row.HookRate,
			nullableMarketingSyncText(row.CreativeID), nullableMarketingSyncText(row.CreativeURL),
			nullableMarketingSyncText(row.CreativeVideoURL), nullableMarketingSyncText(row.CreativePermalinkURL),
			nullableMarketingSyncText(row.ThumbnailURL), marketingSyncJSON(row.RawActions), row.FetchedAt,
			row.VideoMetricsAvailable,
		)
	})
}

// reconcileMarketingSyncPerformance removes facts that disappeared from one
// complete Meta snapshot. The caller is responsible for invoking it only
// after every page for the level was collected, every item was mapped, and
// the replacement rows were written successfully.
func (service *MarketingSyncService) reconcileMarketingSyncPerformance(
	ctx context.Context,
	target marketingSyncTarget,
	accountID string,
	level string,
	dateRange marketingSyncDateRange,
	rows []marketingSyncPerformanceRow,
) (int64, error) {
	switch level {
	case "account", "campaign", "adset", "ad":
	default:
		return 0, newMarketingSyncFailure("invalid_marketing_performance_level", 500, nil)
	}
	keys := make([]map[string]string, 0, len(rows))
	seen := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		if row.OrganizationID != target.OrganizationID || row.IntegrationID != target.IntegrationID ||
			row.ExternalAccountID != accountID || row.Level != level || row.EntityID == "" ||
			row.MetricDate.Before(dateRange.From) || row.MetricDate.After(dateRange.To) {
			return 0, newMarketingSyncFailure("invalid_marketing_performance_snapshot", 500, nil)
		}
		identity := row.EntityID + "\x00" + row.MetricDate.Format(time.DateOnly)
		if _, exists := seen[identity]; exists {
			continue
		}
		seen[identity] = struct{}{}
		keys = append(keys, map[string]string{
			"entity_id":   row.EntityID,
			"metric_date": row.MetricDate.Format(time.DateOnly),
		})
	}
	dbCtx, cancel := service.marketingSyncDatabaseContext(ctx)
	defer cancel()
	tag, err := service.db.Exec(dbCtx, `
		delete from public.marketing_performance_daily as snapshot
		where snapshot.organization_id = $1::uuid
		  and snapshot.integration_id = $2::uuid
		  and snapshot.provider = 'meta'
		  and snapshot.external_account_id = $3
		  and snapshot.level = $4
		  and snapshot.metric_date between $5::date and $6::date
		  and not exists (
		    select 1
		    from jsonb_to_recordset($7::jsonb) as collected(entity_id text, metric_date date)
		    where collected.entity_id = snapshot.entity_id
		      and collected.metric_date = snapshot.metric_date
		  )
	`, target.OrganizationID, target.IntegrationID, accountID, level,
		dateRange.From, dateRange.To, marketingSyncJSONString(keys))
	if err != nil {
		return 0, newMarketingSyncFailure("marketing_performance_daily_reconcile_failed", 500, err)
	}
	return tag.RowsAffected(), nil
}

func (service *MarketingSyncService) upsertMarketingSyncMedia(ctx context.Context, rows []marketingSyncMediaRow) (int, error) {
	const query = `
		insert into public.marketing_media_assets (
		  organization_id, integration_id, provider, external_account_id,
		  external_media_id, source_kind, media_type, title, caption,
		  campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
		  creative_id, thumbnail_url, media_url, video_url, permalink_url,
		  published_at, metrics, raw_metadata, last_synced_at, updated_at
		)
		values (
		  $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11,
		  $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
		  $22::jsonb, $23::jsonb, $24, $24
		)
		on conflict (organization_id, provider, external_media_id)
		do update set
		  integration_id = excluded.integration_id,
		  external_account_id = excluded.external_account_id,
		  source_kind = excluded.source_kind,
		  media_type = excluded.media_type,
		  title = excluded.title,
		  caption = excluded.caption,
		  campaign_id = excluded.campaign_id,
		  campaign_name = excluded.campaign_name,
		  adset_id = excluded.adset_id,
		  adset_name = excluded.adset_name,
		  ad_id = excluded.ad_id,
		  ad_name = excluded.ad_name,
		  creative_id = excluded.creative_id,
		  thumbnail_url = excluded.thumbnail_url,
		  media_url = excluded.media_url,
		  video_url = excluded.video_url,
		  permalink_url = excluded.permalink_url,
		  published_at = excluded.published_at,
		  -- Partial metric groups intentionally omit unavailable keys. Merge the
		  -- fresh keys so a transient Graph failure cannot replace known values
		  -- with synthetic zeroes.
		  metrics = coalesce(marketing_media_assets.metrics, '{}'::jsonb) || excluded.metrics,
		  raw_metadata = coalesce(marketing_media_assets.raw_metadata, '{}'::jsonb) || excluded.raw_metadata,
		  last_synced_at = excluded.last_synced_at,
		  updated_at = excluded.updated_at
	`
	return service.sendMarketingSyncBatches(ctx, len(rows), "marketing_media_assets_write_failed", func(batch *pgx.Batch, index int) {
		row := rows[index]
		batch.Queue(query,
			row.OrganizationID, row.IntegrationID, row.Provider, nullableMarketingSyncText(row.ExternalAccountID),
			row.ExternalMediaID, row.SourceKind, nullableMarketingSyncText(row.MediaType),
			nullableMarketingSyncText(row.Title), nullableMarketingSyncText(row.Caption),
			nullableMarketingSyncText(row.CampaignID), nullableMarketingSyncText(row.CampaignName),
			nullableMarketingSyncText(row.AdsetID), nullableMarketingSyncText(row.AdsetName),
			nullableMarketingSyncText(row.AdID), nullableMarketingSyncText(row.AdName),
			nullableMarketingSyncText(row.CreativeID), nullableMarketingSyncText(row.ThumbnailURL),
			nullableMarketingSyncText(row.MediaURL), nullableMarketingSyncText(row.VideoURL),
			nullableMarketingSyncText(row.PermalinkURL), row.PublishedAt,
			marketingSyncJSON(row.Metrics), marketingSyncJSON(row.RawMetadata), row.SyncedAt,
		)
	})
}

func (service *MarketingSyncService) upsertMarketingSyncSocial(ctx context.Context, rows []marketingSyncSocialRow) (int, error) {
	const query = `
		insert into public.marketing_social_daily (
		  organization_id, integration_id, provider, profile_id, profile_name,
		  metric_date, followers, follower_growth, posts, impressions, reach,
		  interactions, likes, comments, saves, shares, profile_views,
		  website_clicks, video_views, raw_metrics, fetched_at, updated_at
		)
		values (
		  $1::uuid, $2::uuid, 'instagram', $3, $4, $5::date, $6, $7, $8,
		  $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20, $20
		)
		on conflict (organization_id, provider, profile_id, metric_date)
		do update set
		  integration_id = excluded.integration_id,
		  profile_name = excluded.profile_name,
		  followers = coalesce(excluded.followers, marketing_social_daily.followers),
		  follower_growth = case when coalesce(excluded.raw_metrics->'availability', '{}'::jsonb) ? 'follower_growth' then excluded.follower_growth else marketing_social_daily.follower_growth end,
		  posts = case when coalesce(excluded.raw_metrics->'availability', '{}'::jsonb) ? 'posts' then excluded.posts else marketing_social_daily.posts end,
		  impressions = case when coalesce(excluded.raw_metrics->'availability', '{}'::jsonb) ? 'impressions' then excluded.impressions else marketing_social_daily.impressions end,
		  reach = case when coalesce(excluded.raw_metrics->'availability', '{}'::jsonb) ? 'reach' then excluded.reach else marketing_social_daily.reach end,
		  interactions = case when coalesce(excluded.raw_metrics->'availability', '{}'::jsonb) ? 'interactions' then excluded.interactions else marketing_social_daily.interactions end,
		  likes = case when coalesce(excluded.raw_metrics->'availability', '{}'::jsonb) ? 'likes' then excluded.likes else marketing_social_daily.likes end,
		  comments = case when coalesce(excluded.raw_metrics->'availability', '{}'::jsonb) ? 'comments' then excluded.comments else marketing_social_daily.comments end,
		  saves = case when coalesce(excluded.raw_metrics->'availability', '{}'::jsonb) ? 'saves' then excluded.saves else marketing_social_daily.saves end,
		  shares = case when coalesce(excluded.raw_metrics->'availability', '{}'::jsonb) ? 'shares' then excluded.shares else marketing_social_daily.shares end,
		  profile_views = case when coalesce(excluded.raw_metrics->'availability', '{}'::jsonb) ? 'profile_views' then excluded.profile_views else marketing_social_daily.profile_views end,
		  website_clicks = case when coalesce(excluded.raw_metrics->'availability', '{}'::jsonb) ? 'website_clicks' then excluded.website_clicks else marketing_social_daily.website_clicks end,
		  video_views = case when coalesce(excluded.raw_metrics->'availability', '{}'::jsonb) ? 'video_views' then excluded.video_views else marketing_social_daily.video_views end,
		  raw_metrics = jsonb_set(
		    jsonb_set(
		      coalesce(marketing_social_daily.raw_metrics, '{}'::jsonb)
		        || (excluded.raw_metrics - 'profile' - 'availability'),
		      '{profile}',
		      coalesce(marketing_social_daily.raw_metrics->'profile', '{}'::jsonb)
		        || coalesce(excluded.raw_metrics->'profile', '{}'::jsonb),
		      true
		    ),
		    '{availability}',
		    coalesce(marketing_social_daily.raw_metrics->'availability', '{}'::jsonb)
		      || coalesce(excluded.raw_metrics->'availability', '{}'::jsonb),
		    true
		  ),
		  fetched_at = excluded.fetched_at,
		  updated_at = excluded.updated_at
	`
	return service.sendMarketingSyncBatches(ctx, len(rows), "marketing_social_daily_write_failed", func(batch *pgx.Batch, index int) {
		row := rows[index]
		batch.Queue(query,
			row.OrganizationID, row.IntegrationID, row.ProfileID, nullableMarketingSyncText(row.ProfileName),
			row.MetricDate, row.Followers, row.FollowerGrowth, row.Posts, row.Impressions,
			row.Reach, row.Interactions, row.Likes, row.Comments, row.Saves, row.Shares,
			row.ProfileViews, row.WebsiteClicks, row.VideoViews, marketingSyncJSON(row.RawMetrics), row.FetchedAt,
		)
	})
}

func (service *MarketingSyncService) loadMarketingSyncSocialSnapshots(ctx context.Context, target marketingSyncTarget, profileID string, dateRange marketingSyncDateRange) (map[string]marketingSyncSocialSnapshot, error) {
	dbCtx, cancel := service.marketingSyncDatabaseContext(ctx)
	defer cancel()
	rows, err := service.db.Query(dbCtx, `
		select metric_date::text, followers, follower_growth
		from public.marketing_social_daily
		where organization_id = $1::uuid
		  and provider = 'instagram'
		  and profile_id = $2
		  and metric_date between $3::date and $4::date
	`, target.OrganizationID, profileID, dateRange.From, dateRange.To)
	if err != nil {
		return nil, newMarketingSyncFailure("marketing_social_snapshot_read_failed", 500, err)
	}
	defer rows.Close()
	result := make(map[string]marketingSyncSocialSnapshot)
	for rows.Next() {
		var date string
		var snapshot marketingSyncSocialSnapshot
		if err := rows.Scan(&date, &snapshot.Followers, &snapshot.FollowerGrowth); err != nil {
			return nil, newMarketingSyncFailure("marketing_social_snapshot_read_failed", 500, err)
		}
		result[date] = snapshot
	}
	if err := rows.Err(); err != nil {
		return nil, newMarketingSyncFailure("marketing_social_snapshot_read_failed", 500, err)
	}
	return result, nil
}

func (service *MarketingSyncService) createMarketingSyncRun(ctx context.Context, target marketingSyncTarget, dateRange marketingSyncDateRange, userID string) (string, error) {
	dbCtx, cancel := service.marketingSyncDatabaseContext(ctx)
	defer cancel()
	var runID string
	err := service.db.QueryRow(dbCtx, `
		insert into public.marketing_sync_runs (
		  organization_id, integration_id, provider, status,
		  date_from, date_to, created_by
		)
		values ($1::uuid, $2::uuid, 'meta', 'running', $3::date, $4::date, $5::uuid)
		returning id::text
	`, target.OrganizationID, target.IntegrationID, dateRange.From, dateRange.To, userID).Scan(&runID)
	if err != nil {
		return "", newMarketingSyncFailure("marketing_sync_run_create_failed", 500, err)
	}
	return runID, nil
}

func (service *MarketingSyncService) finishMarketingSyncRun(ctx context.Context, runID string, target marketingSyncTarget, result marketingSyncAggregate) error {
	errorsList := deduplicateMarketingSyncErrors(result.Errors)
	completed := result.Synced + result.MediaSynced + result.SocialSynced
	status := "succeeded"
	if len(errorsList) > 0 && completed > 0 {
		status = "partial"
	} else if len(errorsList) > 0 {
		status = "failed"
	}
	errorCode := ""
	if len(errorsList) > 0 {
		pieces := strings.Split(errorsList[0], ":")
		errorCode = pieces[len(pieces)-1]
	}
	errorMessage := truncateMarketingSyncText(strings.Join(errorsList, "; "), marketingSyncMaxErrorLength)
	dbCtx, cancel := service.marketingSyncDatabaseContext(ctx)
	defer cancel()
	tag, err := service.db.Exec(dbCtx, `
		update public.marketing_sync_runs
		set status = $4,
		    rows_synced = $5,
		    media_synced = $6,
		    social_rows_synced = $7,
		    error_code = $8,
		    error_message = $9,
		    finished_at = $10
		where id = $1::uuid
		  and organization_id = $2::uuid
		  and integration_id = $3::uuid
	`, runID, target.OrganizationID, target.IntegrationID, status,
		result.Synced, result.MediaSynced, result.SocialSynced,
		nullableMarketingSyncText(errorCode), nullableMarketingSyncText(errorMessage), service.now().UTC())
	if err != nil || tag.RowsAffected() != 1 {
		return newMarketingSyncFailure("marketing_sync_run_update_failed", 500, err)
	}
	return nil
}

func (service *MarketingSyncService) updateMarketingSyncIntegrationStatus(ctx context.Context, target marketingSyncTarget, result marketingSyncAggregate) error {
	errorsList := deduplicateMarketingSyncErrors(result.Errors)
	tokenInvalid := false
	for _, item := range errorsList {
		for _, part := range strings.Split(item, ":") {
			if part == "meta_access_token_invalid" {
				tokenInvalid = true
			}
		}
	}
	health := "ok"
	if tokenInvalid || (len(errorsList) > 0 && result.Synced == 0 && result.SocialSynced == 0) {
		health = "error"
	} else if len(errorsList) > 0 {
		health = "degraded"
	}
	tokenStatus := ""
	if tokenInvalid {
		tokenStatus = "invalid"
	} else if len(errorsList) == 0 {
		tokenStatus = "active"
	}
	dbCtx, cancel := service.marketingSyncDatabaseContext(ctx)
	defer cancel()
	tag, err := service.db.Exec(dbCtx, `
		update public.meta_integrations
		set last_sync_at = $3,
		    last_error = $4,
		    health_status = $5,
		    token_status = case when $6 = '' then token_status else $6 end,
		    updated_at = $3
		where id = $1::uuid
		  and organization_id = $2::uuid
	`, target.IntegrationID, target.OrganizationID, service.now().UTC(),
		nullableMarketingSyncText(truncateMarketingSyncText(strings.Join(errorsList, "; "), marketingSyncMaxErrorLength)),
		health, tokenStatus)
	if err != nil || tag.RowsAffected() != 1 {
		return newMarketingSyncFailure("meta_integration_status_update_failed", 500, err)
	}
	return nil
}

func (service *MarketingSyncService) sendMarketingSyncBatches(ctx context.Context, count int, errorCode string, queue func(*pgx.Batch, int)) (int, error) {
	if count == 0 {
		return 0, nil
	}
	if service.db == nil {
		return 0, newMarketingSyncFailure("marketing_database_unavailable", 503, nil)
	}
	written := 0
	for start := 0; start < count; start += marketingSyncDatabaseChunkSize {
		end := min(start+marketingSyncDatabaseChunkSize, count)
		batch := &pgx.Batch{}
		for index := start; index < end; index++ {
			queue(batch, index)
		}
		dbCtx, cancel := service.marketingSyncDatabaseContext(ctx)
		results := service.db.SendBatch(dbCtx, batch)
		var batchErr error
		for index := start; index < end; index++ {
			if _, err := results.Exec(); err != nil {
				batchErr = err
				break
			}
		}
		closeErr := results.Close()
		cancel()
		if batchErr == nil {
			batchErr = closeErr
		}
		if batchErr != nil {
			return written, newMarketingSyncFailure(errorCode, 500, batchErr)
		}
		written += end - start
	}
	return written, nil
}

func (service *MarketingSyncService) marketingSyncDatabaseContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) <= marketingSyncDatabaseTimeout {
		return context.WithCancel(ctx)
	}
	return context.WithTimeout(ctx, marketingSyncDatabaseTimeout)
}

func nullableMarketingSyncText(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func marketingSyncJSON(value map[string]any) string {
	if value == nil {
		return "{}"
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(payload)
}

func closeMarketingSyncRunContext(ctx context.Context) (context.Context, context.CancelFunc) {
	base := context.WithoutCancel(ctx)
	return context.WithTimeout(base, marketingSyncDatabaseTimeout)
}
