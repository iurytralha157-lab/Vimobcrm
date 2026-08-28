package meta

import (
	"context"
	"encoding/json"
	"math"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const marketingSyncCampaignFields = "id,name,status,effective_status,objective,buying_type,daily_budget,lifetime_budget,budget_remaining,updated_time"
const marketingSyncAdsetFields = "id,name,campaign_id,status,effective_status,optimization_goal,billing_event,daily_budget,lifetime_budget,bid_amount,updated_time"
const marketingSyncAdFields = "id,name,campaign_id,adset_id,status,effective_status,preview_shareable_link,updated_time,creative{id,name,title,body,image_url,thumbnail_url,video_id,effective_object_story_id,object_url}"
const marketingSyncAdFallbackFields = "id,name,campaign_id,adset_id,status,effective_status,creative"
const marketingSyncCreativeFields = "id,name,title,body,image_url,thumbnail_url,video_id,effective_object_story_id,object_url,object_story_spec,asset_feed_spec"
const marketingSyncCreativeFallbackFields = "id,name,title,body,image_url,thumbnail_url,video_id"

var (
	marketingSyncLeadPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(^|[._])lead($|[._])`),
		regexp.MustCompile(`(?i)leadgen`),
		regexp.MustCompile(`(?i)lead_grouped`),
	}
	marketingSyncConversationPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)messaging_conversation_started`),
		regexp.MustCompile(`(?i)messaging_first_reply`),
	}
	marketingSyncConversionPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(^|[._])purchase($|[._])`),
		regexp.MustCompile(`(?i)complete_registration`),
		regexp.MustCompile(`(?i)schedule_total`),
	}
)

type marketingSyncEntityCatalog struct {
	Campaigns map[string]map[string]any
	Adsets    map[string]map[string]any
	Ads       map[string]map[string]any
	Creatives map[string]map[string]any
	Errors    []string
}

type marketingSyncInsightResult struct {
	Items    []map[string]any
	Warning  string
	Err      error
	Complete bool
}

type marketingSyncReportedMetrics struct {
	Leads                 int64
	Conversations         int64
	Conversions           int64
	VideoViews            int64
	VideoThreeSecondViews int64
	VideoThruplays        int64
	RawActions            map[string]any
}

type marketingSyncDerivedMetrics struct {
	Spend       float64
	Impressions int64
	Reach       int64
	Clicks      int64
	LinkClicks  int64
	CTR         *float64
	CPC         *float64
	CPM         *float64
	CPL         *float64
	Frequency   *float64
	HookRate    *float64
	marketingSyncReportedMetrics
}

func fetchMarketingSyncEntityCatalog(ctx context.Context, graph *marketingSyncGraphClient, accountID string) marketingSyncEntityCatalog {
	type request struct {
		path     string
		primary  string
		fallback string
	}
	requests := []request{
		{accountID + "/campaigns", marketingSyncCampaignFields, "id,name,status,effective_status,objective,daily_budget,lifetime_budget"},
		{accountID + "/adsets", marketingSyncAdsetFields, "id,name,campaign_id,status,effective_status,optimization_goal,daily_budget,lifetime_budget"},
		{accountID + "/ads", marketingSyncAdFields, marketingSyncAdFallbackFields},
	}
	type response struct {
		collection marketingSyncGraphCollection
		err        error
	}
	responses := marketingSyncMapLimited(ctx, requests, 3, func(ctx context.Context, item request, _ int) response {
		collection, err := marketingSyncCollectionWithFieldFallback(ctx, graph, item.path, item.primary, item.fallback, marketingSyncMaxGraphItems)
		return response{collection: collection, err: err}
	})
	errorsList := make([]string, 0)
	collections := make([][]map[string]any, len(requests))
	for index, response := range responses {
		if response.err != nil {
			errorsList = append(errorsList, marketingSyncScopedError("entities_"+marketingSyncText(index), response.err))
			continue
		}
		collections[index] = response.collection.Items
		if response.collection.Truncated {
			errorsList = append(errorsList, "entities_"+marketingSyncText(index)+":page_limit_reached")
		}
	}
	catalog := marketingSyncEntityCatalog{
		Campaigns: marketingSyncIndexByID(collections[0]),
		Adsets:    marketingSyncIndexByID(collections[1]),
		Ads:       marketingSyncIndexByID(collections[2]),
		Creatives: make(map[string]map[string]any),
		Errors:    errorsList,
	}
	creativeIDs := make([]string, 0)
	seenCreatives := make(map[string]struct{})
	for _, ad := range catalog.Ads {
		nested := marketingSyncRecord(ad["creative"])
		creativeID := marketingSyncText(ad["creative"])
		if nested != nil {
			creativeID = marketingSyncText(nested["id"])
		}
		if creativeID == "" {
			continue
		}
		if nested != nil {
			catalog.Creatives[creativeID] = nested
		}
		if _, ok := seenCreatives[creativeID]; !ok {
			seenCreatives[creativeID] = struct{}{}
			creativeIDs = append(creativeIDs, creativeID)
		}
	}
	type creativeResponse struct {
		ID       string
		Creative map[string]any
		Err      error
	}
	creativeResponses := marketingSyncMapLimited(ctx, creativeIDs, marketingSyncCreativeWorkers, func(ctx context.Context, creativeID string, _ int) creativeResponse {
		creative, err := graph.object(ctx, creativeID, map[string]any{"fields": marketingSyncCreativeFields})
		if err != nil && marketingSyncErrorCode(err) == "meta_unsupported_parameter" {
			creative, err = graph.object(ctx, creativeID, map[string]any{"fields": marketingSyncCreativeFallbackFields})
		}
		return creativeResponse{ID: creativeID, Creative: creative, Err: err}
	})
	for _, response := range creativeResponses {
		if response.Err != nil {
			catalog.Errors = append(catalog.Errors, marketingSyncScopedError("creative_"+response.ID, response.Err))
			continue
		}
		catalog.Creatives[response.ID] = response.Creative
	}

	type videoRequest struct {
		CreativeID string
		VideoID    string
	}
	videoRequests := make([]videoRequest, 0)
	for creativeID, creative := range catalog.Creatives {
		if videoID := marketingSyncText(creative["video_id"]); videoID != "" {
			videoRequests = append(videoRequests, videoRequest{CreativeID: creativeID, VideoID: videoID})
		}
	}
	type videoResponse struct {
		CreativeID string
		Video      map[string]any
	}
	videos := marketingSyncMapLimited(ctx, videoRequests, marketingSyncCreativeWorkers, func(ctx context.Context, item videoRequest, _ int) videoResponse {
		video, _ := graph.object(ctx, item.VideoID, map[string]any{"fields": "id,source,picture,permalink_url"})
		return videoResponse{CreativeID: item.CreativeID, Video: video}
	})
	for _, response := range videos {
		if response.Video == nil {
			continue
		}
		creative := catalog.Creatives[response.CreativeID]
		creative["video_source"] = response.Video["source"]
		creative["video_picture"] = response.Video["picture"]
		creative["video_permalink_url"] = response.Video["permalink_url"]
	}
	catalog.Errors = deduplicateMarketingSyncErrors(catalog.Errors)
	return catalog
}

func marketingSyncCollectionWithFieldFallback(ctx context.Context, graph *marketingSyncGraphClient, path, primary, fallback string, maximum int) (marketingSyncGraphCollection, error) {
	collection, err := graph.collection(ctx, path, map[string]any{"fields": primary, "limit": 100}, maximum)
	if err != nil && marketingSyncErrorCode(err) == "meta_unsupported_parameter" && fallback != primary {
		return graph.collection(ctx, path, map[string]any{"fields": fallback, "limit": 100}, maximum)
	}
	return collection, err
}

func fetchMarketingSyncInsights(ctx context.Context, graph *marketingSyncGraphClient, accountID, level string, dateRange marketingSyncDateRange) marketingSyncInsightResult {
	identityFields := marketingSyncInsightIdentityFields(level)
	commonFields := []string{
		"date_start", "date_stop", "spend", "impressions", "reach", "clicks",
		"inline_link_clicks", "frequency", "ctr", "cpc", "cpm", "actions",
	}
	videoFields := []string{
		"video_play_actions", "video_30_sec_watched_actions", "video_p25_watched_actions",
		"video_p50_watched_actions", "video_p75_watched_actions", "video_p95_watched_actions",
		"video_p100_watched_actions", "video_thruplay_watched_actions",
	}
	baseFields := append(append([]string{}, identityFields...), commonFields...)
	result := marketingSyncInsightResult{Complete: true}
	videoUnavailable := false
	for _, chunk := range chunkMarketingSyncDateRange(dateRange, marketingSyncInsightChunkDays) {
		remaining := marketingSyncMaxGraphItems - len(result.Items)
		if remaining <= 0 {
			result.Warning = "page_limit_reached"
			result.Complete = false
			break
		}
		parameters := map[string]any{
			"level":          level,
			"time_increment": 1,
			"time_range":     marketingSyncJSONString(map[string]any{"since": chunk.fromText(), "until": chunk.toText()}),
			"limit":          100,
			"fields":         strings.Join(append(append([]string{}, baseFields...), videoFields...), ","),
		}
		videoMetricsAvailable := true
		collection, err := graph.collection(ctx, accountID+"/insights", parameters, remaining)
		if err != nil && marketingSyncErrorCode(err) == "meta_unsupported_parameter" {
			videoUnavailable = true
			videoMetricsAvailable = false
			parameters["fields"] = strings.Join(baseFields, ",")
			collection, err = graph.collection(ctx, accountID+"/insights", parameters, remaining)
		}
		if err != nil {
			result.Err = err
			result.Complete = false
			return result
		}
		for _, item := range collection.Items {
			item["_vimob_video_metrics_available"] = videoMetricsAvailable
		}
		result.Items = append(result.Items, collection.Items...)
		if collection.Truncated {
			result.Warning = "page_limit_reached"
			result.Complete = false
			break
		}
	}
	if videoUnavailable {
		if result.Warning != "" {
			result.Warning = "video_metrics_unavailable_and_page_limit_reached"
		} else {
			result.Warning = "video_metrics_unavailable"
		}
	}
	return result
}

func marketingSyncInsightSnapshotComplete(result marketingSyncInsightResult, mappedItems int) bool {
	return result.Err == nil && result.Complete && mappedItems == len(result.Items)
}

func marketingSyncInsightIdentityFields(level string) []string {
	switch level {
	case "campaign":
		return []string{"campaign_id", "campaign_name"}
	case "adset":
		return []string{"campaign_id", "campaign_name", "adset_id", "adset_name"}
	case "ad":
		return []string{"campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name"}
	default:
		return nil
	}
}

func marketingSyncPerformanceRowFromInsight(insight map[string]any, level string, target marketingSyncTarget, accountID string, account map[string]any, catalog marketingSyncEntityCatalog, fetchedAt time.Time) (marketingSyncPerformanceRow, bool) {
	campaignID := marketingSyncText(insight["campaign_id"])
	adsetID := marketingSyncText(insight["adset_id"])
	adID := marketingSyncText(insight["ad_id"])
	entityID := accountID
	switch level {
	case "campaign":
		entityID = campaignID
	case "adset":
		entityID = adsetID
	case "ad":
		entityID = adID
	}
	metricDate, err := time.Parse(time.DateOnly, marketingSyncText(insight["date_start"]))
	if err != nil || entityID == "" {
		return marketingSyncPerformanceRow{}, false
	}
	campaign := catalog.Campaigns[campaignID]
	adset := catalog.Adsets[adsetID]
	ad := catalog.Ads[adID]
	creative := marketingSyncCreativeForAd(ad, catalog)
	currency := marketingSyncText(account["currency"])
	var budgetEntity map[string]any
	if level == "campaign" {
		budgetEntity = campaign
	} else if level == "adset" || level == "ad" {
		budgetEntity = adset
		if budgetEntity == nil {
			budgetEntity = campaign
		}
	}
	budget, budgetType := marketingSyncEntityBudget(budgetEntity, currency)
	metrics := deriveMarketingSyncInsightMetrics(insight)
	videoMetricsAvailable := true
	if available, exists := insight["_vimob_video_metrics_available"].(bool); exists {
		videoMetricsAvailable = available
	}
	statusEntity := campaign
	if level == "adset" {
		statusEntity = adset
	} else if level == "ad" {
		statusEntity = ad
	}
	status := marketingSyncText(account["account_status"])
	if level != "account" {
		status = marketingSyncText(statusEntity["effective_status"])
		if status == "" {
			status = marketingSyncText(statusEntity["status"])
		}
	}
	creativeID := marketingSyncText(creative["id"])
	if creativeID == "" {
		creativeID = marketingSyncText(marketingSyncRecord(ad["creative"])["id"])
	}
	return marketingSyncPerformanceRow{
		OrganizationID: target.OrganizationID, IntegrationID: target.IntegrationID,
		ExternalAccountID: accountID, Level: level, EntityID: entityID, MetricDate: metricDate,
		CampaignID: campaignID, CampaignName: marketingSyncFirstText(insight["campaign_name"], campaign["name"]),
		AdsetID: adsetID, AdsetName: marketingSyncFirstText(insight["adset_name"], adset["name"]),
		AdID: adID, AdName: marketingSyncFirstText(insight["ad_name"], ad["name"]),
		Status: status, Objective: marketingSyncText(campaign["objective"]),
		OptimizationGoal: marketingSyncText(adset["optimization_goal"]), BuyingType: marketingSyncText(campaign["buying_type"]),
		Budget: budget, BudgetType: budgetType, Currency: currency, TimezoneName: marketingSyncText(account["timezone_name"]),
		Spend: metrics.Spend, Impressions: metrics.Impressions, Reach: metrics.Reach, Clicks: metrics.Clicks,
		LinkClicks: metrics.LinkClicks, LeadsReported: metrics.Leads, ConversationsReported: metrics.Conversations,
		ConversionsReported: metrics.Conversions, VideoViews: metrics.VideoViews,
		VideoThreeSecondViews: metrics.VideoThreeSecondViews, VideoThruplays: metrics.VideoThruplays,
		CTR: metrics.CTR, CPC: metrics.CPC, CPM: metrics.CPM, CPL: metrics.CPL,
		Frequency: metrics.Frequency, HookRate: metrics.HookRate, CreativeID: creativeID,
		CreativeURL:          marketingSyncSafeHTTPSURL(creative["image_url"]),
		CreativeVideoURL:     marketingSyncSafeHTTPSURL(creative["video_source"]),
		CreativePermalinkURL: marketingSyncSafeHTTPSURL(marketingSyncFirstValue(creative["video_permalink_url"], creative["object_url"], ad["preview_shareable_link"])),
		ThumbnailURL:         marketingSyncSafeHTTPSURL(marketingSyncFirstValue(creative["thumbnail_url"], creative["video_picture"])),
		RawActions:           metrics.RawActions, VideoMetricsAvailable: videoMetricsAvailable, FetchedAt: fetchedAt,
	}, true
}

func deriveMarketingSyncInsightMetrics(insight map[string]any) marketingSyncDerivedMetrics {
	reported := extractMarketingSyncReportedMetrics(insight)
	spend := max(0, marketingSyncNumber(insight["spend"]))
	impressions := marketingSyncNonnegativeInteger(insight["impressions"])
	var cpl *float64
	if reported.Leads > 0 {
		value := spend / float64(reported.Leads)
		cpl = &value
	}
	var hookRate *float64
	if impressions > 0 {
		value := float64(reported.VideoThreeSecondViews) / float64(impressions) * 100
		hookRate = &value
	}
	return marketingSyncDerivedMetrics{
		Spend: spend, Impressions: impressions,
		Reach: marketingSyncNonnegativeInteger(insight["reach"]), Clicks: marketingSyncNonnegativeInteger(insight["clicks"]),
		LinkClicks: marketingSyncNonnegativeInteger(insight["inline_link_clicks"]), CTR: marketingSyncNullableNumber(insight["ctr"]),
		CPC: marketingSyncNullableNumber(insight["cpc"]), CPM: marketingSyncNullableNumber(insight["cpm"]),
		CPL: cpl, Frequency: marketingSyncNullableNumber(insight["frequency"]), HookRate: hookRate,
		marketingSyncReportedMetrics: reported,
	}
}

func extractMarketingSyncReportedMetrics(insight map[string]any) marketingSyncReportedMetrics {
	actions := marketingSyncActionMap(insight["actions"])
	videoPlay := marketingSyncActionMap(insight["video_play_actions"])
	videoThirty := marketingSyncActionMap(insight["video_30_sec_watched_actions"])
	videoThruplay := marketingSyncActionMap(insight["video_thruplay_watched_actions"])
	videoViews := actions["video_view"]
	for _, value := range videoPlay {
		videoViews = max(videoViews, value)
	}
	videoThruplays := float64(0)
	for _, value := range videoThruplay {
		videoThruplays = max(videoThruplays, value)
	}
	return marketingSyncReportedMetrics{
		Leads:                 marketingSyncNonnegativeInteger(marketingSyncMaximumMatchingAction(actions, marketingSyncLeadPatterns)),
		Conversations:         marketingSyncNonnegativeInteger(marketingSyncMaximumMatchingAction(actions, marketingSyncConversationPatterns)),
		Conversions:           marketingSyncNonnegativeInteger(marketingSyncMaximumMatchingAction(actions, marketingSyncConversionPatterns)),
		VideoViews:            marketingSyncNonnegativeInteger(videoViews),
		VideoThreeSecondViews: marketingSyncNonnegativeInteger(max(actions["video_view"], videoViews)),
		VideoThruplays:        marketingSyncNonnegativeInteger(videoThruplays),
		RawActions: map[string]any{
			"actions": actions, "video_play_actions": videoPlay,
			"video_30_sec_watched_actions": videoThirty, "video_thruplay_watched_actions": videoThruplay,
			"video_p25_watched_actions":  marketingSyncActionMap(insight["video_p25_watched_actions"]),
			"video_p50_watched_actions":  marketingSyncActionMap(insight["video_p50_watched_actions"]),
			"video_p75_watched_actions":  marketingSyncActionMap(insight["video_p75_watched_actions"]),
			"video_p95_watched_actions":  marketingSyncActionMap(insight["video_p95_watched_actions"]),
			"video_p100_watched_actions": marketingSyncActionMap(insight["video_p100_watched_actions"]),
		},
	}
}

func buildMarketingSyncPaidMedia(target marketingSyncTarget, accountID string, catalog marketingSyncEntityCatalog, performance []marketingSyncPerformanceRow, syncedAt time.Time) []marketingSyncMediaRow {
	type aggregate struct {
		Spend, Impressions, Reach, Clicks, LinkClicks, Leads, Conversations, Conversions, VideoViews float64
		Currency                                                                                     string
		Rows                                                                                         int
		VideoMetricsComplete                                                                         bool
	}
	metrics := make(map[string]aggregate)
	for _, row := range performance {
		if row.Level != "ad" || row.AdID == "" {
			continue
		}
		value := metrics[row.AdID]
		if value.Rows == 0 {
			value.VideoMetricsComplete = true
		}
		value.Rows++
		value.VideoMetricsComplete = value.VideoMetricsComplete && row.VideoMetricsAvailable
		value.Spend += row.Spend
		value.Impressions += float64(row.Impressions)
		value.Reach += float64(row.Reach)
		value.Clicks += float64(row.Clicks)
		value.LinkClicks += float64(row.LinkClicks)
		value.Leads += float64(row.LeadsReported)
		value.Conversations += float64(row.ConversationsReported)
		value.Conversions += float64(row.ConversionsReported)
		if row.VideoMetricsAvailable {
			value.VideoViews += float64(row.VideoViews)
		}
		value.Currency = row.Currency
		metrics[row.AdID] = value
	}
	rows := make([]marketingSyncMediaRow, 0, len(catalog.Ads))
	for adID, ad := range catalog.Ads {
		creative := marketingSyncCreativeForAd(ad, catalog)
		campaignID := marketingSyncText(ad["campaign_id"])
		adsetID := marketingSyncText(ad["adset_id"])
		campaign := catalog.Campaigns[campaignID]
		adset := catalog.Adsets[adsetID]
		value := metrics[adID]
		mediaType := "image"
		if marketingSyncText(creative["video_id"]) != "" {
			mediaType = "video"
		}
		mediaMetrics := map[string]any{
			"spend": value.Spend, "impressions": int64(value.Impressions), "reach": int64(value.Reach),
			"clicks": int64(value.Clicks), "link_clicks": int64(value.LinkClicks), "leads": int64(value.Leads),
			"conversations": int64(value.Conversations), "conversions": int64(value.Conversions),
			"currency": nullableMarketingSyncText(value.Currency),
		}
		if value.VideoMetricsComplete {
			mediaMetrics["video_views"] = int64(value.VideoViews)
		}
		rows = append(rows, marketingSyncMediaRow{
			OrganizationID: target.OrganizationID, IntegrationID: target.IntegrationID,
			Provider: "meta", ExternalAccountID: accountID, ExternalMediaID: adID,
			SourceKind: "paid", MediaType: mediaType,
			Title: marketingSyncFirstText(creative["name"], creative["title"], ad["name"]), Caption: marketingSyncText(creative["body"]),
			CampaignID: campaignID, CampaignName: marketingSyncText(campaign["name"]),
			AdsetID: adsetID, AdsetName: marketingSyncText(adset["name"]), AdID: adID, AdName: marketingSyncText(ad["name"]),
			CreativeID: marketingSyncText(creative["id"]), ThumbnailURL: marketingSyncSafeHTTPSURL(marketingSyncFirstValue(creative["thumbnail_url"], creative["video_picture"])),
			MediaURL: marketingSyncSafeHTTPSURL(creative["image_url"]), VideoURL: marketingSyncSafeHTTPSURL(creative["video_source"]),
			PermalinkURL: marketingSyncSafeHTTPSURL(marketingSyncFirstValue(creative["video_permalink_url"], creative["object_url"], ad["preview_shareable_link"])),
			Metrics:      mediaMetrics,
			RawMetadata: map[string]any{
				"ad_status":                 nullableMarketingSyncText(marketingSyncText(ad["status"])),
				"ad_effective_status":       nullableMarketingSyncText(marketingSyncText(ad["effective_status"])),
				"objective":                 nullableMarketingSyncText(marketingSyncText(campaign["objective"])),
				"video_id":                  nullableMarketingSyncText(marketingSyncText(creative["video_id"])),
				"effective_object_story_id": nullableMarketingSyncText(marketingSyncText(creative["effective_object_story_id"])),
				"object_story_spec":         marketingSyncMapOrEmpty(creative["object_story_spec"]),
				"asset_feed_spec":           marketingSyncMapOrEmpty(creative["asset_feed_spec"]),
			},
			SyncedAt: syncedAt,
		})
	}
	return rows
}

func marketingSyncCreativeForAd(ad map[string]any, catalog marketingSyncEntityCatalog) map[string]any {
	if ad == nil {
		return nil
	}
	nested := marketingSyncRecord(ad["creative"])
	creativeID := marketingSyncText(ad["creative"])
	if nested != nil {
		creativeID = marketingSyncText(nested["id"])
	}
	if creative := catalog.Creatives[creativeID]; creative != nil {
		return creative
	}
	return nested
}

func marketingSyncEntityBudget(entity map[string]any, currency string) (*float64, string) {
	if entity == nil {
		return nil, ""
	}
	divisor := float64(100)
	zeroDecimal := map[string]struct{}{"BIF": {}, "CLP": {}, "DJF": {}, "GNF": {}, "JPY": {}, "KMF": {}, "KRW": {}, "MGA": {}, "PYG": {}, "RWF": {}, "UGX": {}, "VND": {}, "VUV": {}, "XAF": {}, "XOF": {}, "XPF": {}}
	if _, ok := zeroDecimal[strings.ToUpper(currency)]; ok {
		divisor = 1
	}
	if daily := marketingSyncNullableNumber(entity["daily_budget"]); daily != nil && *daily > 0 {
		value := *daily / divisor
		return &value, "daily"
	}
	if lifetime := marketingSyncNullableNumber(entity["lifetime_budget"]); lifetime != nil && *lifetime > 0 {
		value := *lifetime / divisor
		return &value, "lifetime"
	}
	return nil, ""
}

func marketingSyncIndexByID(items []map[string]any) map[string]map[string]any {
	result := make(map[string]map[string]any, len(items))
	for _, item := range items {
		if id := marketingSyncText(item["id"]); id != "" {
			result[id] = item
		}
	}
	return result
}

func marketingSyncActionMap(value any) map[string]float64 {
	result := make(map[string]float64)
	items, _ := value.([]any)
	for _, item := range items {
		record := marketingSyncRecord(item)
		typeName := marketingSyncText(record["action_type"])
		if typeName == "" {
			continue
		}
		result[typeName] = max(result[typeName], marketingSyncNumber(record["value"]))
	}
	return result
}

func marketingSyncMaximumMatchingAction(actions map[string]float64, patterns []*regexp.Regexp) float64 {
	maximum := float64(0)
	for actionType, value := range actions {
		for _, pattern := range patterns {
			if pattern.MatchString(actionType) {
				maximum = max(maximum, value)
				break
			}
		}
	}
	return maximum
}

func marketingSyncNullableNumber(value any) *float64 {
	if value == nil || marketingSyncText(value) == "" {
		return nil
	}
	number := marketingSyncNumber(value)
	if math.IsNaN(number) || math.IsInf(number, 0) {
		return nil
	}
	return &number
}

func marketingSyncNonnegativeInteger(value any) int64 {
	number := marketingSyncNumber(value)
	if math.IsNaN(number) || math.IsInf(number, 0) {
		return 0
	}
	return max(0, int64(math.Round(number)))
}

func marketingSyncSafeHTTPSURL(value any) string {
	text := marketingSyncText(value)
	parsed, err := url.Parse(text)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return ""
	}
	return parsed.String()
}

func marketingSyncFirstValue(values ...any) any {
	for _, value := range values {
		if marketingSyncText(value) != "" {
			return value
		}
	}
	return nil
}

func marketingSyncFirstText(values ...any) string {
	return marketingSyncText(marketingSyncFirstValue(values...))
}

func marketingSyncMapOrEmpty(value any) map[string]any {
	if record := marketingSyncRecord(value); record != nil {
		return record
	}
	return map[string]any{}
}

func marketingSyncJSONString(value any) string {
	payload, _ := jsonMarshalMarketingSync(value)
	return string(payload)
}

func jsonMarshalMarketingSync(value any) ([]byte, error) {
	// Kept behind a helper so all Graph query JSON uses one encoding path.
	return json.Marshal(value)
}
