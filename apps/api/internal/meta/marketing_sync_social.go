package meta

import (
	"context"
	"math"
	"strings"
	"time"
)

type marketingSyncSocialAggregate struct {
	Posts   int64
	Profile map[string]any
}

func (service *MarketingSyncService) syncMarketingInstagram(ctx context.Context, target marketingSyncTarget, dateRange marketingSyncDateRange, deadline time.Time, graphSemaphore chan struct{}) marketingSyncSocialResult {
	profileID := strings.TrimSpace(target.InstagramBusinessAccountID)
	if profileID == "" {
		return marketingSyncSocialResult{}
	}
	graph := service.newMarketingSyncGraphClient(target.AccessToken, deadline, graphSemaphore)
	profile, err := graph.object(ctx, profileID, map[string]any{
		"fields": "id,username,name,profile_picture_url,followers_count,media_count",
	})
	if err != nil {
		return marketingSyncSocialResult{Errors: []string{marketingSyncScopedError("instagram_"+profileID, err)}}
	}
	errorsList := make([]string, 0)
	mediaCollection, err := fetchMarketingSyncInstagramMedia(ctx, graph, profileID, dateRange)
	media := make([]map[string]any, 0)
	mediaCollectionComplete := false
	if err != nil {
		errorsList = append(errorsList, marketingSyncScopedError("instagram_"+profileID+"_media", err))
	} else {
		mediaCollectionComplete = !mediaCollection.Truncated
		for _, item := range mediaCollection.Items {
			date, ok := marketingSyncDateFromTimestamp(item["timestamp"])
			if ok && marketingSyncText(item["id"]) != "" && !date.Before(dateRange.From) && !date.After(dateRange.To) {
				media = append(media, item)
			}
		}
		if mediaCollection.Truncated {
			errorsList = append(errorsList, "instagram_"+profileID+":page_limit_reached")
		}
	}

	type mediaInsightResult struct {
		Payload map[string]any
		Err     error
	}
	mediaInsights := marketingSyncMapLimited(ctx, media, marketingSyncSocialWorkers, func(ctx context.Context, item map[string]any, _ int) mediaInsightResult {
		payload, err := fetchMarketingSyncInstagramMediaInsights(ctx, graph, marketingSyncText(item["id"]))
		if err != nil && marketingSyncErrorCode(err) == "meta_unsupported_parameter" {
			return mediaInsightResult{Payload: map[string]any{"data": []any{}}}
		}
		return mediaInsightResult{Payload: payload, Err: err}
	})
	for index, result := range mediaInsights {
		if result.Err != nil {
			errorsList = append(errorsList, marketingSyncScopedError("instagram_media_"+marketingSyncText(media[index]["id"]), result.Err))
			mediaInsights[index].Payload = map[string]any{"data": []any{}}
		}
	}

	profileMetricNames := []string{
		"impressions", "reach", "views", "profile_views", "website_clicks",
		"accounts_engaged", "total_interactions", "likes", "comments", "saves", "shares",
		"follows_and_unfollows",
	}
	type profileMetricResult struct {
		Metric  string
		Payload map[string]any
		Err     error
	}
	profileMetricResults := marketingSyncMapLimited(ctx, profileMetricNames, marketingSyncSocialWorkers, func(ctx context.Context, metric string, _ int) profileMetricResult {
		payload, err := fetchMarketingSyncInstagramProfileMetric(ctx, graph, profileID, metric, dateRange)
		return profileMetricResult{Metric: metric, Payload: payload, Err: err}
	})
	profilePayloads := make([]map[string]any, 0)
	for _, result := range profileMetricResults {
		if result.Err != nil {
			errorsList = append(errorsList, marketingSyncScopedError("instagram_profile_"+result.Metric, result.Err))
			continue
		}
		if result.Payload != nil {
			profilePayloads = append(profilePayloads, result.Payload)
		}
	}
	profileMetrics := collectMarketingSyncProfileMetrics(profilePayloads, dateRange)

	byDate := make(map[string]*marketingSyncSocialAggregate)
	assetRows := make([]marketingSyncMediaRow, 0, len(media))
	now := service.now().UTC()
	for index, item := range media {
		date, ok := marketingSyncDateFromTimestamp(item["timestamp"])
		if !ok {
			continue
		}
		dateText := date.Format(time.DateOnly)
		insight := mediaInsights[index].Payload
		metrics := make(map[string]any)
		likes, likesAvailable := marketingSyncNonnegativeRecordMetric(item, "like_count")
		comments, commentsAvailable := marketingSyncNonnegativeRecordMetric(item, "comments_count")
		reach, reachAvailable := marketingSyncNonnegativeMediaInsightMetric(insight, "reach")
		saves, savesAvailable := marketingSyncNonnegativeMediaInsightMetric(insight, "saved")
		shares, sharesAvailable := marketingSyncNonnegativeMediaInsightMetric(insight, "shares")
		views, viewsAvailable := marketingSyncNonnegativeMediaInsightMetric(insight, "views")
		interactions, interactionsAvailable := marketingSyncNonnegativeMediaInsightMetric(insight, "total_interactions")
		if interactionsAvailable {
			interactions = max(interactions, likes+comments+saves+shares)
		}
		for key, metric := range map[string]struct {
			value     int64
			available bool
		}{
			"reach": {reach, reachAvailable}, "interactions": {interactions, interactionsAvailable},
			"likes": {likes, likesAvailable}, "comments": {comments, commentsAvailable},
			"saves": {saves, savesAvailable}, "shares": {shares, sharesAvailable},
			"views": {views, viewsAvailable},
		} {
			if metric.available {
				metrics[key] = metric.value
			}
		}
		if mediaCollectionComplete {
			aggregate := byDate[dateText]
			if aggregate == nil {
				aggregate = &marketingSyncSocialAggregate{}
				byDate[dateText] = aggregate
			}
			aggregate.Posts++
		}

		mediaURL := marketingSyncSafeHTTPSURL(item["media_url"])
		mediaType := marketingSyncFirstText(item["media_product_type"], item["media_type"])
		videoURL := ""
		if strings.EqualFold(marketingSyncText(item["media_type"]), "VIDEO") {
			videoURL = mediaURL
		}
		publishedAt := date
		if parsed, err := time.Parse(time.RFC3339, marketingSyncText(item["timestamp"])); err == nil {
			publishedAt = parsed
		}
		assetRows = append(assetRows, marketingSyncMediaRow{
			OrganizationID: target.OrganizationID, IntegrationID: target.IntegrationID,
			Provider: "instagram", ExternalAccountID: profileID,
			ExternalMediaID: marketingSyncText(item["id"]), SourceKind: "organic", MediaType: mediaType,
			Caption: marketingSyncText(item["caption"]), ThumbnailURL: marketingSyncSafeHTTPSURL(item["thumbnail_url"]),
			MediaURL: mediaURL, VideoURL: videoURL, PermalinkURL: marketingSyncSafeHTTPSURL(item["permalink"]),
			PublishedAt: &publishedAt,
			Metrics:     metrics,
			RawMetadata: map[string]any{
				"media_type":         nullableMarketingSyncText(marketingSyncText(item["media_type"])),
				"media_product_type": nullableMarketingSyncText(marketingSyncText(item["media_product_type"])),
			},
			SyncedAt: now,
		})
	}
	if mediaCollectionComplete {
		for date := dateRange.From; !date.After(dateRange.To); date = date.AddDate(0, 0, 1) {
			dateText := date.Format(time.DateOnly)
			if byDate[dateText] == nil {
				byDate[dateText] = &marketingSyncSocialAggregate{}
			}
		}
	}
	for date, metrics := range profileMetrics {
		aggregate := byDate[date]
		if aggregate == nil {
			aggregate = &marketingSyncSocialAggregate{}
			byDate[date] = aggregate
		}
		aggregate.Profile = metrics
	}
	today := now.Format(time.DateOnly)
	if today >= dateRange.fromText() && today <= dateRange.toText() && byDate[today] == nil {
		byDate[today] = &marketingSyncSocialAggregate{}
	}

	existing, err := service.loadMarketingSyncSocialSnapshots(ctx, target, profileID, dateRange)
	if err != nil {
		errorsList = append(errorsList, marketingSyncScopedError("instagram_"+profileID+"_snapshots", err))
		existing = make(map[string]marketingSyncSocialSnapshot)
	}
	currentFollowers := marketingSyncNullableNumber(profile["followers_count"])
	socialRows := make([]marketingSyncSocialRow, 0, len(byDate))
	for dateText, aggregate := range byDate {
		date, err := time.Parse(time.DateOnly, dateText)
		if err != nil {
			continue
		}
		profileDay := aggregate.Profile
		if profileDay == nil {
			profileDay = map[string]any{}
		}
		snapshot := existing[dateText]
		followers := snapshot.Followers
		followersCurrent := dateText == today && currentFollowers != nil
		if followersCurrent {
			value := marketingSyncNonnegativeInteger(*currentFollowers)
			followers = &value
		}
		followerGrowth := snapshot.FollowerGrowth
		availability := make(map[string]any)
		if followers != nil {
			availability["followers"] = true
		}
		if value, exists := profileDay["follows_and_unfollows"]; exists && value != nil {
			followerGrowth = marketingSyncFollowerDelta(value)
			availability["follower_growth"] = true
		}
		if mediaCollectionComplete {
			availability["posts"] = true
		}
		impressions, impressionsAvailable := marketingSyncNonnegativeProfileMetric(profileDay, "impressions")
		reach, reachAvailable := marketingSyncNonnegativeProfileMetric(profileDay, "reach")
		interactions, interactionsAvailable := marketingSyncNonnegativeProfileMetric(profileDay, "total_interactions", "accounts_engaged")
		likes, likesAvailable := marketingSyncNonnegativeProfileMetric(profileDay, "likes")
		comments, commentsAvailable := marketingSyncNonnegativeProfileMetric(profileDay, "comments")
		saves, savesAvailable := marketingSyncNonnegativeProfileMetric(profileDay, "saves")
		shares, sharesAvailable := marketingSyncNonnegativeProfileMetric(profileDay, "shares")
		profileViews, profileViewsAvailable := marketingSyncNonnegativeProfileMetric(profileDay, "profile_views")
		websiteClicks, websiteClicksAvailable := marketingSyncNonnegativeProfileMetric(profileDay, "website_clicks")
		videoViews, videoViewsAvailable := marketingSyncNonnegativeProfileMetric(profileDay, "views")
		for key, available := range map[string]bool{
			"impressions": impressionsAvailable, "reach": reachAvailable,
			"interactions": interactionsAvailable, "likes": likesAvailable,
			"comments": commentsAvailable, "saves": savesAvailable, "shares": sharesAvailable,
			"profile_views": profileViewsAvailable, "website_clicks": websiteClicksAvailable,
			"video_views": videoViewsAvailable,
		} {
			if available {
				availability[key] = true
			}
		}
		socialRows = append(socialRows, marketingSyncSocialRow{
			OrganizationID: target.OrganizationID, IntegrationID: target.IntegrationID,
			ProfileID: profileID, ProfileName: marketingSyncFirstText(profile["username"], profile["name"], target.InstagramUsername),
			MetricDate: date, Followers: followers, FollowerGrowth: followerGrowth,
			Posts: aggregate.Posts, Impressions: impressions, Reach: reach,
			Interactions: interactions, Likes: likes, Comments: comments, Saves: saves, Shares: shares,
			ProfileViews: profileViews, WebsiteClicks: websiteClicks, VideoViews: videoViews,
			RawMetrics: map[string]any{
				"followers_snapshot_current": followersCurrent,
				"availability":               availability,
				"profile":                    profileDay,
				"media": map[string]any{
					"posts": aggregate.Posts, "collection_complete": mediaCollectionComplete,
				},
			},
			FetchedAt: now,
		})
	}

	socialSynced, err := service.upsertMarketingSyncSocial(ctx, socialRows)
	if err != nil {
		errorsList = append(errorsList, marketingSyncScopedError("instagram_"+profileID+"_daily", err))
	}
	mediaSynced, err := service.upsertMarketingSyncMedia(ctx, assetRows)
	if err != nil {
		errorsList = append(errorsList, marketingSyncScopedError("instagram_"+profileID+"_assets", err))
	}
	return marketingSyncSocialResult{SocialSynced: socialSynced, MediaSynced: mediaSynced, Errors: deduplicateMarketingSyncErrors(errorsList)}
}

func fetchMarketingSyncInstagramMedia(ctx context.Context, graph *marketingSyncGraphClient, profileID string, dateRange marketingSyncDateRange) (marketingSyncGraphCollection, error) {
	stableFields := []string{"id", "caption", "media_type", "media_url", "thumbnail_url", "permalink", "timestamp"}
	parameters := map[string]any{
		"fields": strings.Join(append(append([]string{}, stableFields...), "media_product_type", "like_count", "comments_count"), ","),
		"since":  dateRange.fromText() + "T00:00:00Z", "until": dateRange.toText() + "T23:59:59Z", "limit": 100,
	}
	collection, err := graph.collection(ctx, profileID+"/media", parameters, marketingSyncMaxSocialMedia)
	if err != nil && marketingSyncErrorCode(err) == "meta_unsupported_parameter" {
		fallback := make(map[string]any, len(parameters))
		for key, value := range parameters {
			fallback[key] = value
		}
		fallback["fields"] = strings.Join(stableFields, ",")
		return graph.collection(ctx, profileID+"/media", fallback, marketingSyncMaxSocialMedia)
	}
	return collection, err
}

func fetchMarketingSyncInstagramMediaInsights(ctx context.Context, graph *marketingSyncGraphClient, mediaID string) (map[string]any, error) {
	metrics := []string{"reach", "saved", "shares", "total_interactions", "views"}
	payload, err := graph.object(ctx, mediaID+"/insights", map[string]any{"metric": strings.Join(metrics, ",")})
	if err == nil || marketingSyncErrorCode(err) != "meta_unsupported_parameter" {
		return payload, err
	}
	type metricResult struct {
		Payload map[string]any
		Err     error
	}
	results := marketingSyncMapLimited(ctx, metrics, 2, func(ctx context.Context, metric string, _ int) metricResult {
		payload, err := graph.object(ctx, mediaID+"/insights", map[string]any{"metric": metric})
		if err != nil && marketingSyncErrorCode(err) == "meta_unsupported_parameter" {
			err = nil
		}
		return metricResult{Payload: payload, Err: err}
	})
	data := make([]any, 0)
	for _, result := range results {
		if result.Err != nil {
			return nil, result.Err
		}
		if values, ok := result.Payload["data"].([]any); ok {
			data = append(data, values...)
		}
	}
	return map[string]any{"data": data}, nil
}

func fetchMarketingSyncInstagramProfileMetric(ctx context.Context, graph *marketingSyncGraphClient, profileID, metric string, dateRange marketingSyncDateRange) (map[string]any, error) {
	parameters := map[string]any{"metric": metric, "period": "day", "since": dateRange.fromText(), "until": dateRange.toText()}
	payload, err := graph.object(ctx, profileID+"/insights", parameters)
	if err != nil && marketingSyncErrorCode(err) == "meta_unsupported_parameter" {
		// total_value is a lifetime or range aggregate and cannot be assigned to
		// one metric_date without fabricating a daily value.
		return nil, nil
	}
	return payload, err
}

func collectMarketingSyncProfileMetrics(payloads []map[string]any, dateRange marketingSyncDateRange) map[string]map[string]any {
	result := make(map[string]map[string]any)
	for _, payload := range payloads {
		data, _ := payload["data"].([]any)
		for _, value := range data {
			metric := marketingSyncRecord(value)
			name := marketingSyncText(metric["name"])
			if name == "" {
				continue
			}
			values, _ := metric["values"].([]any)
			if len(values) > 0 {
				for _, raw := range values {
					record := marketingSyncRecord(raw)
					date, ok := marketingSyncMetricDate(record["end_time"], dateRange)
					if !ok {
						continue
					}
					if result[date] == nil {
						result[date] = make(map[string]any)
					}
					result[date][name] = record["value"]
				}
				continue
			}
			// Deliberately ignore total_value: it is not a daily observation.
		}
	}
	return result
}

func marketingSyncMediaInsightValue(payload map[string]any, metricName string) any {
	value, _ := marketingSyncMediaInsightMetric(payload, metricName)
	return value
}

func marketingSyncMediaInsightMetric(payload map[string]any, metricName string) (any, bool) {
	data, _ := payload["data"].([]any)
	for _, value := range data {
		metric := marketingSyncRecord(value)
		if marketingSyncText(metric["name"]) != metricName {
			continue
		}
		if total := marketingSyncRecord(metric["total_value"]); total != nil {
			value, exists := total["value"]
			return value, exists && value != nil
		}
		if values, ok := metric["values"].([]any); ok && len(values) > 0 {
			value, exists := marketingSyncRecord(values[0])["value"]
			return value, exists && value != nil
		}
	}
	return nil, false
}

func marketingSyncNonnegativeMediaInsightMetric(payload map[string]any, metricName string) (int64, bool) {
	value, available := marketingSyncMediaInsightMetric(payload, metricName)
	if !available {
		return 0, false
	}
	return marketingSyncNonnegativeInteger(value), true
}

func marketingSyncNonnegativeRecordMetric(record map[string]any, key string) (int64, bool) {
	value, available := record[key]
	if !available || value == nil || marketingSyncText(value) == "" {
		return 0, false
	}
	return marketingSyncNonnegativeInteger(value), true
}

func marketingSyncNonnegativeProfileMetric(profile map[string]any, names ...string) (int64, bool) {
	for _, name := range names {
		value, available := profile[name]
		if !available || value == nil {
			continue
		}
		return marketingSyncNonnegativeInteger(value), true
	}
	return 0, false
}

func marketingSyncMetricDate(value any, dateRange marketingSyncDateRange) (string, bool) {
	text := marketingSyncText(value)
	if len(text) < len(time.DateOnly) {
		return "", false
	}
	date, err := time.Parse(time.DateOnly, text[:len(time.DateOnly)])
	if err != nil || date.Before(dateRange.From) || date.After(dateRange.To) {
		return "", false
	}
	return date.Format(time.DateOnly), true
}

func marketingSyncDateFromTimestamp(value any) (time.Time, bool) {
	text := marketingSyncText(value)
	if len(text) < len(time.DateOnly) {
		return time.Time{}, false
	}
	date, err := time.Parse(time.DateOnly, text[:len(time.DateOnly)])
	return date, err == nil
}

func marketingSyncFollowerDelta(value any) int64 {
	record := marketingSyncRecord(value)
	if record == nil {
		return int64(math.Round(marketingSyncNumber(value)))
	}
	follows := marketingSyncNumber(marketingSyncFirstValue(record["follows"], record["follow"]))
	unfollows := marketingSyncNumber(marketingSyncFirstValue(record["unfollows"], record["unfollow"]))
	return int64(math.Round(follows - unfollows))
}
