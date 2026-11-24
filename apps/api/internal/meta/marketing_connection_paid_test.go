package meta

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type marketingConnectionPaidDB struct {
	marketingSyncLockTestDB
	reconciled  []string
	performance int
	media       int
}

func (*marketingConnectionPaidDB) QueryRow(context.Context, string, ...any) pgx.Row {
	return marketingConnectionRunRow{}
}

type marketingConnectionRunRow struct{}

func (marketingConnectionRunRow) Scan(values ...any) error {
	*values[0].(*string) = "11111111-1111-4111-8111-111111111111"
	return nil
}

func (database *marketingConnectionPaidDB) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	if strings.Contains(query, "delete from public.marketing_performance_daily") {
		database.reconciled = append(database.reconciled, args[3].(string))
	}
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func (database *marketingConnectionPaidDB) SendBatch(_ context.Context, batch *pgx.Batch) pgx.BatchResults {
	for _, query := range batch.QueuedQueries {
		if strings.Contains(query.SQL, "insert into public.marketing_performance_daily") {
			database.performance++
		}
		if strings.Contains(query.SQL, "insert into public.marketing_media_assets") {
			database.media++
		}
	}
	return marketingConnectionPaidBatch{}
}

type marketingConnectionPaidBatch struct{ pgx.BatchResults }

func (marketingConnectionPaidBatch) Exec() (pgconn.CommandTag, error) {
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func (marketingConnectionPaidBatch) Close() error { return nil }

func TestDedicatedPaidSyncHydratesOnlyAdsInTheInsightWindow(t *testing.T) {
	var insightsRead, adReads atomic.Int32
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, request *http.Request) {
		path := strings.TrimPrefix(request.URL.Path, "/v25.0/")
		switch path {
		case "act_999":
			_, _ = fmt.Fprint(w, `{"id":"act_999","currency":"BRL"}`)
		case "act_999/insights":
			insightsRead.Add(1)
			switch request.URL.Query().Get("level") {
			case "ad":
				_, _ = fmt.Fprint(w, `{"data":[{"ad_id":"330","account_id":"999","date_start":"2026-10-05","spend":"10"},{"ad_id":"331","account_id":"999","date_start":"2026-10-04"},{"ad_id":"332","account_id":"888","date_start":"2026-10-05"}]}`)
			default:
				_, _ = fmt.Fprint(w, `{"data":[]}`)
			}
		case "330":
			if insightsRead.Load() != 4 {
				t.Error("paid object was read before collecting the report")
			}
			adReads.Add(1)
			_, _ = fmt.Fprint(w, `{"id":"330","name":"Ad within report"}`)
		default:
			t.Errorf("unexpected Graph call %s", path)
			w.WriteHeader(http.StatusNotFound)
		}
	})
	defer closeServer()
	database := &marketingConnectionPaidDB{}
	graph.service.db = database
	day := time.Date(2026, time.October, 5, 0, 0, 0, 0, time.UTC)
	result := graph.service.syncMarketingAdAccount(t.Context(), marketingSyncTarget{AccountWide: true, AccessToken: "test-token"},
		"act_999", marketingSyncDateRange{From: day, To: day}, time.Now().Add(time.Minute), graph.semaphore)
	if adReads.Load() != 1 || result.Synced != 1 || database.performance != 1 {
		t.Fatalf("ad reads=%d, paid rows=%d, result=%+v", adReads.Load(), database.performance, result)
	}
	if len(database.reconciled) != 3 {
		t.Fatalf("expected only complete levels to be reconciled, got %v", database.reconciled)
	}
	for _, level := range database.reconciled {
		if level == "ad" {
			t.Fatal("incomplete ad report was used to reconcile existing facts")
		}
	}
}

func TestDedicatedPaidClientStopsAfterMetaBusinessQuota(t *testing.T) {
	var calls atomic.Int32
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusBadRequest)
		_, _ = fmt.Fprint(w, `{"error":{"code":80000,"error_subcode":2446079}}`)
	})
	defer closeServer()
	graph.dedicatedPaid = true
	for range 2 {
		if _, err := graph.object(t.Context(), "act_999/insights", nil); marketingSyncErrorCode(err) != "meta_rate_limited" {
			t.Fatalf("error = %v, expected provider rate limit", err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("provider calls = %d, expected no retries or new network calls", calls.Load())
	}
}

func TestDedicatedPaidMediaSurvivesUnrelatedCatalogFailure(t *testing.T) {
	var campaignFallback, adsetFallback atomic.Bool
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, request *http.Request) {
		path := strings.TrimPrefix(request.URL.Path, "/v25.0/")
		fields := request.URL.Query().Get("fields")
		switch path {
		case "act_999":
			_, _ = fmt.Fprint(w, `{"id":"act_999","currency":"BRL"}`)
		case "act_999/insights":
			if request.URL.Query().Get("level") == "ad" {
				_, _ = fmt.Fprint(w, `{"data":[{"date_start":"2026-10-05","campaign_id":"110","adset_id":"220","ad_id":"330","spend":"10"},{"date_start":"2026-10-05","ad_id":"331","spend":"5"}]}`)
				return
			}
			_, _ = fmt.Fprint(w, `{"data":[]}`)
		case "110":
			if fields == marketingSyncCampaignFallbackFields {
				campaignFallback.Store(true)
				_, _ = fmt.Fprint(w, `{"id":"110","name":"Campaign"}`)
				return
			}
			w.WriteHeader(http.StatusBadRequest)
			_, _ = fmt.Fprint(w, `{"error":{"code":100}}`)
		case "220":
			w.WriteHeader(http.StatusBadRequest)
			if fields == marketingSyncAdsetFallbackFields {
				adsetFallback.Store(true)
				_, _ = fmt.Fprint(w, `{"error":{"code":200}}`)
				return
			}
			_, _ = fmt.Fprint(w, `{"error":{"code":100}}`)
		case "330":
			_, _ = fmt.Fprint(w, `{"id":"330","campaign_id":"110","adset_id":"220","creative":{"id":"440"}}`)
		case "331":
			_, _ = fmt.Fprint(w, `{"id":"331"}`)
		case "440":
			_, _ = fmt.Fprint(w, `{"id":"440","name":"Creative","image_url":"https://images.example.com/creative.jpg"}`)
		default:
			t.Errorf("unexpected Graph call %s", path)
			w.WriteHeader(http.StatusNotFound)
		}
	})
	defer closeServer()
	database := &marketingConnectionPaidDB{}
	graph.service.db = database
	day := time.Date(2026, time.October, 5, 0, 0, 0, 0, time.UTC)
	result := graph.service.syncMarketingAdAccount(t.Context(), marketingSyncTarget{AccountWide: true, AccessToken: "test-token"},
		"act_999", marketingSyncDateRange{From: day, To: day}, time.Now().Add(time.Minute), graph.semaphore)
	if !campaignFallback.Load() || !adsetFallback.Load() || result.Synced != 2 || result.MediaSynced != 1 || database.media != 1 {
		t.Fatalf("campaign fallback=%v, ad set fallback=%v, media writes=%d, result=%+v",
			campaignFallback.Load(), adsetFallback.Load(), database.media, result)
	}
}

func TestDedicatedPaidInsightsRequireAnArrayOfObjects(t *testing.T) {
	for _, fixture := range []struct {
		body       string
		wantStatus string
	}{
		{`{"paging":{}}`, "meta_invalid_response"},
		{`{"data":{}}`, "meta_invalid_response"},
		{`{"data":[7]}`, "meta_invalid_response"},
		{`{"data":[]}`, ""},
	} {
		t.Run(fixture.body, func(t *testing.T) {
			graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
				_, _ = fmt.Fprint(w, fixture.body)
			})
			defer closeServer()
			graph.dedicatedPaid = true
			day := time.Date(2026, time.October, 5, 0, 0, 0, 0, time.UTC)
			result := fetchMarketingSyncInsights(t.Context(), graph, "act_999", "ad", marketingSyncDateRange{From: day, To: day})
			if fixture.wantStatus == "" {
				if !marketingSyncInsightSnapshotComplete(result, 0) {
					t.Fatalf("real empty report is incomplete: %+v", result)
				}
			} else if marketingSyncErrorCode(result.Err) != fixture.wantStatus || marketingSyncInsightSnapshotComplete(result, 0) {
				t.Fatalf("malformed provider response counted as complete: %+v", result)
			}
		})
	}
}

func TestDedicatedSyncStartsInstagramWhileAdsAreWaiting(t *testing.T) {
	instagramStarted := make(chan struct{}, 1)
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, request *http.Request) {
		switch strings.TrimPrefix(request.URL.Path, "/v25.0/") {
		case "act_999":
			select {
			case <-instagramStarted:
				_, _ = fmt.Fprint(w, `{"id":"act_999","currency":"BRL"}`)
			case <-time.After(2 * time.Second):
				t.Error("Instagram waited for the account report to finish")
				w.WriteHeader(http.StatusForbidden)
				_, _ = fmt.Fprint(w, `{"error":{"code":200}}`)
			}
		case "act_999/insights":
			_, _ = fmt.Fprint(w, `{"data":[]}`)
		case "550":
			instagramStarted <- struct{}{}
			w.WriteHeader(http.StatusForbidden)
			_, _ = fmt.Fprint(w, `{"error":{"code":200}}`)
		default:
			t.Errorf("unexpected Graph call %s", request.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	})
	defer closeServer()
	service := graph.service
	service.db = &marketingConnectionPaidDB{}
	service.acquireOrganizationLock = func(context.Context, string) (func(), bool, error) {
		return func() {}, true, nil
	}
	result, err := service.SyncConnection(t.Context(), MarketingConnectionSyncRequest{
		MarketingSyncRequest: validMarketingSyncLockTestRequest(),
		AccessToken:          "test-token",
		AdAccounts:           []string{"999"},
		Instagram:            []MarketingConnectionInstagram{{ID: "550", PageID: "600"}},
	})
	if err != nil || len(result.Errors) != 1 || result.Errors[0] != "instagram_550:meta_permission_denied" {
		t.Fatalf("expected the independently reported Instagram failure, got %+v, %v", result, err)
	}
}
