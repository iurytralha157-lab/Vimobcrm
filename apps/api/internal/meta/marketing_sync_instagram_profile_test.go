package meta

import (
	"fmt"
	"net/http"
	"strconv"
	"sync/atomic"
	"testing"
)

func TestInstagramProfileDaysUseDailyTotalWindowsAndRetainRealZero(t *testing.T) {
	var reachCalls, totalCalls atomic.Int32
	firstDate := mustMarketingSyncDate(t, "2026-11-14")
	lastDate := mustMarketingSyncDate(t, "2026-11-17")
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, request *http.Request) {
		query := request.URL.Query()
		since, _ := strconv.ParseInt(query.Get("since"), 10, 64)
		until, _ := strconv.ParseInt(query.Get("until"), 10, 64)
		if query.Get("period") != "day" {
			t.Error("expected daily observations")
		}
		switch query.Get("metric_type") {
		case "time_series":
			reachCalls.Add(1)
			if query.Get("metric") != "reach" || since != firstDate.Unix() || until != lastDate.AddDate(0, 0, 1).Unix() {
				t.Errorf("unexpected reach window: %v", query)
			}
			_, _ = fmt.Fprint(w, `{"data":[{"name":"reach","values":[{"end_time":"2026-11-16T08:00:00+0000","value":12}]}]}`)
		case "total_value":
			totalCalls.Add(1)
			if query.Get("metric") != instagramDailyTotalMetrics || until-since != 86_399 || since == firstDate.Unix() {
				t.Errorf("unexpected interactions window: %v", query)
			}
			_, _ = fmt.Fprint(w, `{"data":[{"name":"likes","total_value":{"value":0}},{"name":"comments","total_value":{"value":3}},{"name":"saves","total_value":{}},{"name":"shares","values":[{"value":99}]},{"name":"views","total_value":{"value":"unknown"}}]}`)
		default:
			t.Errorf("unexpected insight request: %v", query)
			w.WriteHeader(http.StatusBadRequest)
		}
	})
	defer closeServer()
	existing := map[string]marketingSyncSocialSnapshot{"2026-11-14": {ProfileTotalsChecked: true}}
	days, syncErrors := fetchMarketingSyncInstagramProfileDays(t.Context(), graph, "123", marketingSyncDateRange{From: firstDate, To: lastDate}, mustMarketingSyncDate(t, "2026-11-20"), existing)
	if len(syncErrors) != 0 || totalCalls.Load() != 3 || reachCalls.Load() != 1 || len(days) != 3 {
		t.Fatalf("checked days = %#v, calls = %d; sync errors = %v", days, totalCalls.Load(), syncErrors)
	}
	day := days["2026-11-16"]
	if !day.ProfileTotalsChecked || day.Profile["likes"] != int64(0) || day.Profile["comments"] != int64(3) || marketingSyncInteger(day.Profile["reach"]) != 12 || len(day.Profile) != 3 {
		t.Fatalf("expected observations with a real zero, got %#v", day)
	}
}

func TestInstagramAudienceUsesProviderBreakdownsAndObservations(t *testing.T) {
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, request *http.Request) {
		query := request.URL.Query()
		if query.Get("period") != "lifetime" || query.Has("since") || query.Has("until") {
			t.Errorf("unexpected audience window: %v", query)
		}
		switch query.Get("metric") {
		case "follower_demographics":
			if query.Get("metric_type") != "total_value" || query.Get("timeframe") != "this_month" {
				t.Errorf("unexpected demographic request: %v", query)
			}
			if query.Get("breakdown") == "city" {
				_, _ = fmt.Fprint(w, `{"data":[]}`)
				return
			}
			_, _ = fmt.Fprint(w, `{"data":[{"name":"follower_demographics","total_value":{"breakdowns":[{"dimension_keys":["timeframe","age"],"results":[{"dimension_values":["THIS_MONTH","25-34"],"value":105}]}]}}]}`)
		case "online_followers":
			_, _ = fmt.Fprint(w, `{"data":[{"name":"online_followers","values":[{"value":{"12":30,"13":45}},{"value":{"12":40}}]}]}`)
		default:
			t.Errorf("unexpected audience request: %v", query)
			w.WriteHeader(http.StatusBadRequest)
		}
	})
	defer closeServer()
	now := mustMarketingSyncDate(t, "2026-11-20")
	profile, syncErrors := fetchMarketingSyncInstagramAudience(t.Context(), graph, "123", now)
	audience := marketingSyncRecord(profile["audience"])
	wantAge := marketingSyncAudienceCount{Label: "25-34", Value: 105}
	if len(syncErrors) > 0 || profile["audience_checked"] != true || audience["fetchedAt"] != now || audience["age"].([]marketingSyncAudienceCount)[0] != wantAge || audience["city"] != nil {
		t.Fatalf("expected available demographics only: %#v, %v", profile, syncErrors)
	}
	hours := audience["online"].([]marketingSyncAudienceCount)
	if len(hours) != 2 || hours[0] != (marketingSyncAudienceCount{Label: "12:00", Value: 35}) || hours[1].Value != 45 {
		t.Fatalf("expected an hourly average over returned observations: %#v", hours)
	}
}

func TestInstagramProfileRateLimitStopsAdditionalRequests(t *testing.T) {
	var calls atomic.Int32
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusBadRequest)
		_, _ = fmt.Fprint(w, `{"error":{"code":80002}}`)
	})
	defer closeServer()
	graph.instagram = true
	for range 2 {
		_, err := graph.object(t.Context(), "123/insights", nil)
		if err == nil || marketingSyncErrorCode(err) != "meta_rate_limited" {
			t.Fatalf("expected rate limit error, got %v", err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("rate limited profile got %d requests", calls.Load())
	}
}

func TestInstagramProfileInsightsOutsideRetentionAreSkipped(t *testing.T) {
	now := mustMarketingSyncDate(t, "2026-11-20")
	from := now.AddDate(0, 0, -100)
	to := now.AddDate(0, 0, -91)
	days, syncErrors := fetchMarketingSyncInstagramProfileDays(t.Context(), nil, "123", marketingSyncDateRange{From: from, To: to}, now, nil)
	if len(days) > 0 || len(syncErrors) > 0 {
		t.Fatalf("expected no observations outside the provider window, got %v, %v", days, syncErrors)
	}
}
