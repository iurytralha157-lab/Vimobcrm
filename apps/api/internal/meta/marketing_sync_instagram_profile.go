package meta

import (
	"context"
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"time"
)

const instagramDailyTotalMetrics = "total_interactions,likes,comments,saves,shares,views"

func fetchMarketingSyncInstagramProfileDays(ctx context.Context, graph *marketingSyncGraphClient, profileID string, dateRange marketingSyncDateRange, now time.Time, existing map[string]marketingSyncSocialSnapshot) (map[string]*marketingSyncSocialAggregate, []string) {
	today := now.UTC().Truncate(24 * time.Hour)
	dateRange.From = laterMarketingSyncDate(dateRange.From, today.AddDate(0, 0, -marketingSyncMaxRangeDays))
	if !dateRange.To.Before(today) {
		dateRange.To = today.AddDate(0, 0, -1)
	}
	days := make(map[string]*marketingSyncSocialAggregate)
	var syncErrors []string
	if dateRange.From.After(dateRange.To) {
		return days, nil
	}

	for from := dateRange.From; !from.After(dateRange.To); from = from.AddDate(0, 0, marketingSyncInsightChunkDays) {
		to := from.AddDate(0, 0, marketingSyncInsightChunkDays-1)
		if to.After(dateRange.To) {
			to = dateRange.To
		}
		params := map[string]any{
			"metric": "reach", "period": "day", "metric_type": "time_series",
			"since": from.Unix(), "until": to.AddDate(0, 0, 1).Unix(),
		}
		payload, err := graph.object(ctx, profileID+"/insights", params)
		if err != nil {
			syncErrors = append(syncErrors, marketingSyncScopedError("instagram_profile_reach", err))
			continue
		}
		for date, metrics := range collectMarketingSyncProfileMetrics([]map[string]any{payload}, marketingSyncDateRange{From: from, To: to}) {
			days[date] = &marketingSyncSocialAggregate{Profile: metrics}
		}
	}

	// These metrics have no time-series mode. A one-day window is the only
	// way to save daily values that can be summed under arbitrary date filters.
	// Once checked, closed days are reused. Meta can lag by 48 hours.
	recheckFrom := today.AddDate(0, 0, -3)
	var pending []time.Time
	for date := dateRange.To; !date.Before(dateRange.From) && len(pending) < marketingSyncInsightChunkDays; date = date.AddDate(0, 0, -1) {
		if date.Before(recheckFrom) && existing[date.Format(time.DateOnly)].ProfileTotalsChecked {
			continue
		}
		pending = append(pending, date)
	}
	type totalsResult struct {
		metrics map[string]any
		err     error
	}
	results := marketingSyncMapLimited(ctx, pending, marketingSyncSocialWorkers, func(ctx context.Context, date time.Time, _ int) totalsResult {
		payload, err := graph.object(ctx, profileID+"/insights", map[string]any{
			"metric": instagramDailyTotalMetrics, "period": "day", "metric_type": "total_value",
			"since": date.Unix(), "until": date.AddDate(0, 0, 1).Unix() - 1,
		})
		if err != nil {
			return totalsResult{err: err}
		}
		return totalsResult{metrics: marketingSyncInstagramTotals(payload)}
	})
	for index, result := range results {
		if result.err != nil {
			syncErrors = append(syncErrors, marketingSyncScopedError("instagram_profile_daily_totals", result.err))
			continue
		}
		if result.metrics == nil {
			continue
		}
		date := pending[index].Format(time.DateOnly)
		day := days[date]
		if day == nil {
			day = &marketingSyncSocialAggregate{Profile: make(map[string]any)}
			days[date] = day
		}
		for name, value := range result.metrics {
			day.Profile[name] = value
		}
		day.ProfileTotalsChecked = true
	}
	return days, deduplicateMarketingSyncErrors(syncErrors)
}

func laterMarketingSyncDate(left, right time.Time) time.Time {
	if left.Before(right) {
		return right
	}
	return left
}

func marketingSyncInstagramTotals(payload map[string]any) map[string]any {
	data, ok := payload["data"].([]any)
	if !ok {
		return nil
	}
	totals := make(map[string]any)
	for _, item := range data {
		metric := marketingSyncRecord(item)
		name := marketingSyncText(metric["name"])
		switch name {
		case "total_interactions", "likes", "comments", "saves", "shares", "views":
			if value, ok := marketingSyncInstagramCount(marketingSyncRecord(metric["total_value"])["value"]); ok {
				totals[name] = value
			}
		}
	}
	return totals
}

type marketingSyncAudienceCount struct {
	Label string  `json:"label"`
	Value float64 `json:"value"`
}

func fetchMarketingSyncInstagramAudience(ctx context.Context, graph *marketingSyncGraphClient, profileID string, now time.Time) (map[string]any, []string) {
	var syncErrors []string
	audience := make(map[string]any)
	for _, dimension := range []string{"age", "city"} {
		payload, err := graph.object(ctx, profileID+"/insights", map[string]any{
			"metric": "follower_demographics", "period": "lifetime", "metric_type": "total_value",
			"timeframe": "this_month", "breakdown": dimension,
		})
		if err != nil {
			if marketingSyncErrorCode(err) != "meta_unsupported_parameter" {
				syncErrors = append(syncErrors, marketingSyncScopedError("instagram_audience_"+dimension, err))
			}
			continue
		}
		if counts := marketingSyncInstagramDemographics(payload, dimension); len(counts) > 0 {
			audience[dimension] = counts
		}
	}
	payload, err := graph.object(ctx, profileID+"/insights", map[string]any{"metric": "online_followers", "period": "lifetime"})
	if err != nil {
		if marketingSyncErrorCode(err) != "meta_unsupported_parameter" {
			syncErrors = append(syncErrors, marketingSyncScopedError("instagram_audience_online", err))
		}
	} else if counts := marketingSyncInstagramOnlineHours(payload); len(counts) > 0 {
		audience["online"] = counts
	}
	profile := make(map[string]any)
	if len(syncErrors) == 0 {
		profile["audience_checked"] = true
	}
	if len(audience) > 0 {
		audience["fetchedAt"] = now
		profile["audience"] = audience
	}
	return profile, syncErrors
}

func marketingSyncInstagramDemographics(payload map[string]any, dimension string) []marketingSyncAudienceCount {
	data, _ := payload["data"].([]any)
	for _, item := range data {
		metric := marketingSyncRecord(item)
		if marketingSyncText(metric["name"]) != "follower_demographics" {
			continue
		}
		breakdowns, _ := marketingSyncRecord(metric["total_value"])["breakdowns"].([]any)
		for _, item := range breakdowns {
			breakdown := marketingSyncRecord(item)
			keys, _ := breakdown["dimension_keys"].([]any)
			for index, key := range keys {
				if key == dimension {
					return marketingSyncInstagramDimensionCounts(breakdown, index)
				}
			}
		}
	}
	return nil
}

func marketingSyncInstagramDimensionCounts(breakdown map[string]any, index int) []marketingSyncAudienceCount {
	results, _ := breakdown["results"].([]any)
	var counts []marketingSyncAudienceCount
	for _, item := range results[:min(len(results), 45)] {
		result := marketingSyncRecord(item)
		labels, _ := result["dimension_values"].([]any)
		if index >= len(labels) {
			continue
		}
		label, _ := labels[index].(string)
		label = strings.TrimSpace(label)
		value, ok := marketingSyncInstagramCount(result["value"])
		if label != "" && len(label) <= 200 && ok {
			counts = append(counts, marketingSyncAudienceCount{Label: label, Value: float64(value)})
		}
	}
	return counts
}

func marketingSyncInstagramOnlineHours(payload map[string]any) []marketingSyncAudienceCount {
	data, _ := payload["data"].([]any)
	var totals, samples [24]int64
	for _, item := range data {
		metric := marketingSyncRecord(item)
		if marketingSyncText(metric["name"]) != "online_followers" {
			continue
		}
		days, _ := metric["values"].([]any)
		for _, day := range days {
			for hour, raw := range marketingSyncRecord(marketingSyncRecord(day)["value"]) {
				index, err := strconv.Atoi(hour)
				count, ok := marketingSyncInstagramCount(raw)
				if err == nil && index >= 0 && index < len(totals) && ok {
					totals[index] += count
					samples[index]++
				}
			}
		}
	}
	var result []marketingSyncAudienceCount
	for hour, count := range samples {
		if count > 0 {
			label := time.Date(2000, 1, 1, hour, 0, 0, 0, time.UTC).Format("15:04")
			result = append(result, marketingSyncAudienceCount{Label: label, Value: float64(totals[hour]) / float64(count)})
		}
	}
	return result
}

func marketingSyncInstagramCount(value any) (int64, bool) {
	switch value.(type) {
	case int, int64, float64, json.Number:
		number := marketingSyncNumber(value)
		if number >= 0 && number < math.MaxInt64 && math.Trunc(number) == number {
			return int64(number), true
		}
	}
	return 0, false
}
