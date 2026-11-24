package meta

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
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

func readMarketingSyncObjectBatch(t *testing.T, request *http.Request) []*url.URL {
	t.Helper()
	if request.Method != http.MethodPost || request.Header.Get("Authorization") == "" || request.URL.Query().Get("appsecret_proof") == "" {
		t.Errorf("expected a signed authenticated batch envelope, got %s", request.Method)
	}
	if err := request.ParseForm(); err != nil {
		t.Errorf("decode batch form: %v", err)
		return nil
	}
	if request.URL.Query().Has("access_token") || request.PostForm.Has("access_token") {
		t.Error("batch sent its token outside the Authorization header")
	}
	var operations []marketingSyncGraphReadOperation
	if err := json.Unmarshal([]byte(request.PostForm.Get("batch")), &operations); err != nil {
		t.Errorf("decode batch operations: %v", err)
		return nil
	}
	paths := make([]*url.URL, 0, len(operations))
	for _, operation := range operations {
		path, err := url.Parse(operation.RelativeURL)
		if err != nil || operation.Method != http.MethodGet || path.IsAbs() || path.Host != "" ||
			!marketingSyncAdAccountPattern.MatchString(path.Path) || len(path.Query()) != 1 || path.Query().Get("fields") == "" {
			t.Error("batch contains an operation other than an exact object read")
			return nil
		}
		paths = append(paths, path)
	}
	return paths
}

type marketingSyncBatchFixture struct {
	Code int    `json:"code"`
	Body string `json:"body"`
}

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
		case "":
			if insightsRead.Load() != 4 {
				t.Error("paid object was read before collecting the report")
			}
			paths := readMarketingSyncObjectBatch(t, request)
			if len(paths) != 1 || paths[0].Path != "330" {
				t.Errorf("requested out-of-window paid objects: %v", paths)
				return
			}
			adReads.Add(int32(len(paths)))
			_ = json.NewEncoder(w).Encode([]marketingSyncBatchFixture{{Code: 200, Body: `{"id":"330","name":"Ad within report"}`}})
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

func TestDedicatedPaidBatchChecksExactResultsAndStopsOnInnerQuota(t *testing.T) {
	var calls atomic.Int32
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, request *http.Request) {
		if calls.Add(1) == 1 {
			_ = json.NewEncoder(w).Encode([]marketingSyncBatchFixture{{Code: 200, Body: `{"id":"110"}`}})
			return
		}
		_ = json.NewEncoder(w).Encode([]marketingSyncBatchFixture{
			{Code: 200, Body: `{"id":"110"}`},
			{Code: 200, Body: `{"id":"999"}`},
			{Code: 400, Body: `{"error":{"code":80004,"error_subcode":2446079}}`},
		})
		readMarketingSyncObjectBatch(t, request)
	})
	defer closeServer()
	graph.dedicatedPaid = true
	if _, _, err := graph.objects(t.Context(), []string{"../outside"}, marketingSyncAdFields); marketingSyncErrorCode(err) != "invalid_meta_graph_path" {
		t.Fatalf("accepted unsafe ID: %v", err)
	}
	if _, _, err := graph.objects(t.Context(), []string{"110"}, "id,access_token"); marketingSyncErrorCode(err) != "invalid_meta_graph_path" {
		t.Fatalf("accepted unapproved fields: %v", err)
	}
	ids := []string{"110", "220", "330"}
	if _, _, err := graph.objects(t.Context(), ids, marketingSyncAdFields); marketingSyncErrorCode(err) != "meta_invalid_response" {
		t.Fatalf("accepted incomplete batch: %v", err)
	}
	items, failures, err := graph.objects(t.Context(), ids, marketingSyncAdFields)
	if err != nil || len(items) != 1 || marketingSyncText(items["110"]["id"]) != "110" ||
		marketingSyncErrorCode(failures["220"]) != "meta_invalid_response" || marketingSyncErrorCode(failures["330"]) != "meta_rate_limited" {
		t.Fatalf("batch validation lost a success or accepted an invalid result: %v, %v, %v", items, failures, err)
	}
	if _, _, err := graph.objects(t.Context(), ids, marketingSyncAdFallbackFields); marketingSyncErrorCode(err) != "meta_rate_limited" || calls.Load() != 2 {
		t.Fatalf("batch continued after provider quota: %d calls, %v", calls.Load(), err)
	}
}

func TestDedicatedPaidCatalogBatchesOnlyDistinctPeriodIDs(t *testing.T) {
	var calls, active atomic.Int32
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, request *http.Request) {
		calls.Add(1)
		if active.Add(1) != 1 {
			t.Error("catalog batches overlapped within the same account")
		}
		defer active.Add(-1)
		time.Sleep(5 * time.Millisecond)
		paths := readMarketingSyncObjectBatch(t, request)
		if len(paths) > marketingSyncGraphObjectBatchSize {
			t.Errorf("requests exceed budget: %d", len(paths))
		}
		responses := make([]marketingSyncBatchFixture, 0, len(paths))
		for _, operation := range paths {
			if operation.Query().Get("fields") != marketingSyncCampaignFields {
				t.Error("batch mixed incompatible object types")
			}
			responses = append(responses, marketingSyncBatchFixture{Code: 200, Body: fmt.Sprintf(`{"id":%q}`, operation.Path)})
		}
		_ = json.NewEncoder(w).Encode(responses)
	})
	defer closeServer()
	graph.dedicatedPaid = true
	var rows []map[string]any
	for index := range marketingSyncGraphObjectBatchSize + 1 {
		rows = append(rows, map[string]any{"campaign_id": fmt.Sprint(100 + index), "date_start": "2026-10-05"})
	}
	rows = append(rows, rows[0], map[string]any{"campaign_id": "999", "date_start": "2026-10-04"})
	day := time.Date(2026, time.October, 5, 0, 0, 0, 0, time.UTC)
	catalog := fetchMarketingSyncInsightCatalog(t.Context(), graph, "act_999", marketingSyncDateRange{From: day, To: day}, []marketingSyncInsightResult{{Items: rows}})
	if len(catalog.Campaigns) != marketingSyncGraphObjectBatchSize+1 || len(catalog.Errors) != 0 || calls.Load() != 2 {
		t.Fatalf("period catalog = %d items, %v; calls = %d", len(catalog.Campaigns), catalog.Errors, calls.Load())
	}
}

func TestDedicatedPaidBatchDoesNotFollowPostRedirects(t *testing.T) {
	var followed atomic.Bool
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		followed.Store(true)
	}))
	defer target.Close()
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, request *http.Request) {
		readMarketingSyncObjectBatch(t, request)
		w.Header().Set("Location", target.URL)
		w.WriteHeader(http.StatusTemporaryRedirect)
	})
	defer closeServer()
	graph.dedicatedPaid = true
	if _, _, err := graph.objects(t.Context(), []string{"110"}, marketingSyncAdFields); err == nil || followed.Load() {
		t.Fatalf("batch redirect was followed: %v, %v", followed.Load(), err)
	}
}

func TestDedicatedPaidMediaSurvivesUnrelatedCatalogFailure(t *testing.T) {
	var campaignFallback, adsetFallback, creativeHydrated atomic.Bool
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, request *http.Request) {
		path := strings.TrimPrefix(request.URL.Path, "/v25.0/")
		switch path {
		case "act_999":
			_, _ = fmt.Fprint(w, `{"id":"act_999","currency":"BRL"}`)
		case "act_999/insights":
			if request.URL.Query().Get("level") == "ad" {
				_, _ = fmt.Fprint(w, `{"data":[{"date_start":"2026-10-05","campaign_id":"110","adset_id":"220","ad_id":"330","spend":"10"},{"date_start":"2026-10-05","ad_id":"331","spend":"5"}]}`)
				return
			}
			_, _ = fmt.Fprint(w, `{"data":[]}`)
		case "":
			var responses []marketingSyncBatchFixture
			for _, operation := range readMarketingSyncObjectBatch(t, request) {
				inner := marketingSyncBatchFixture{Code: 200}
				fields := operation.Query().Get("fields")
				switch operation.Path {
				case "110":
					if !creativeHydrated.Load() {
						t.Error("optional campaign metadata preceded the paid creative")
					}
					if fields == marketingSyncCampaignFallbackFields {
						campaignFallback.Store(true)
						inner.Body = `{"id":"110","name":"Campaign"}`
					} else {
						inner = marketingSyncBatchFixture{Code: 400, Body: `{"error":{"code":100}}`}
					}
				case "220":
					if fields == marketingSyncAdsetFallbackFields {
						adsetFallback.Store(true)
						inner = marketingSyncBatchFixture{Code: 400, Body: `{"error":{"code":200}}`}
					} else {
						w.WriteHeader(http.StatusInternalServerError)
						_, _ = fmt.Fprint(w, `{"error":{"code":100}}`)
						return
					}
				case "330":
					inner.Body = `{"id":"330","campaign_id":"110","adset_id":"220","creative":{"id":"440"}}`
				case "331":
					inner.Body = `{"id":"331"}`
				default:
					t.Errorf("unexpected batched object %s", operation.Path)
				}
				responses = append(responses, inner)
			}
			_ = json.NewEncoder(w).Encode(responses)
		case "440":
			creativeHydrated.Store(true)
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
