package meta

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func newMarketingSyncGraphTestClient(t *testing.T, handler http.HandlerFunc) (*marketingSyncGraphClient, func()) {
	t.Helper()
	server := httptest.NewServer(handler)
	service := newMarketingSyncService(nil, Config{AppSecret: "test-app-secret", GraphBaseURL: server.URL, GraphVersion: "v25.0"}, server.Client())
	// Production construction pins token-bearing calls to graph.facebook.com.
	// Tests inject their loopback origin only after that boundary.
	service.graphBaseURL = server.URL
	service.sleep = func(context.Context, time.Duration) error { return nil }
	return service.newMarketingSyncGraphClient("super-secret-token", time.Now().Add(time.Minute), make(chan struct{}, marketingSyncGraphConcurrency)), server.Close
}

func TestMarketingSyncGraphCollectionPaginatesWithBearerToken(t *testing.T) {
	var calls atomic.Int32
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, request *http.Request) {
		calls.Add(1)
		if got := request.Header.Get("Authorization"); got != "Bearer super-secret-token" {
			t.Fatalf("Authorization = %q", got)
		}
		if request.URL.Query().Get("access_token") != "" {
			t.Fatal("token must not be sent in the query string")
		}
		proof := hmac.New(sha256.New, []byte("test-app-secret"))
		_, _ = proof.Write([]byte("super-secret-token"))
		if got, want := request.URL.Query().Get("appsecret_proof"), hex.EncodeToString(proof.Sum(nil)); got != want {
			t.Fatalf("appsecret_proof = %q, want %q", got, want)
		}
		w.Header().Set("Content-Type", "application/json")
		if request.URL.Query().Get("after") == "next-page" {
			_, _ = w.Write([]byte(`{"data":[{"id":"2"}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"1"}],"paging":{"next":"https://graph.facebook.com/next","cursors":{"after":"next-page"}}}`))
	})
	defer closeServer()

	collection, err := graph.collection(context.Background(), "act_123/ads", map[string]any{"fields": "id"}, 10)
	if err != nil {
		t.Fatalf("collection() error = %v", err)
	}
	if len(collection.Items) != 2 || collection.Truncated {
		t.Fatalf("collection = %#v", collection)
	}
	if calls.Load() != 2 {
		t.Fatalf("calls = %d, want 2", calls.Load())
	}
}

func TestMarketingSyncGraphCollectionRequiresNextAndAfter(t *testing.T) {
	responses := map[string]string{
		"missing_next":  `{"data":[{"id":"1"}],"paging":{"cursors":{"after":"stale-terminal-cursor"}}}`,
		"missing_after": `{"data":[{"id":"1"}],"paging":{"next":"https://graph.facebook.com/next","cursors":{}}}`,
	}
	for name, payload := range responses {
		t.Run(name, func(t *testing.T) {
			var calls atomic.Int32
			graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(payload))
			})
			defer closeServer()

			collection, err := graph.collection(context.Background(), "act_123/ads", nil, 10)
			if err != nil {
				t.Fatalf("collection() error = %v", err)
			}
			if calls.Load() != 1 || len(collection.Items) != 1 || collection.Truncated {
				t.Fatalf("calls=%d collection=%#v", calls.Load(), collection)
			}
		})
	}
}

func TestMarketingSyncGraphRetriesRateLimitWithoutLeakingToken(t *testing.T) {
	var calls atomic.Int32
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		call := calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		if call == 1 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":{"code":4,"is_transient":true,"message":"sensitive provider detail"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"id":"act_123"}`))
	})
	defer closeServer()

	object, err := graph.object(context.Background(), "act_123", map[string]any{"fields": "id"})
	if err != nil {
		t.Fatalf("object() error = %v", err)
	}
	if marketingSyncText(object["id"]) != "act_123" || calls.Load() != 2 {
		t.Fatalf("object = %#v, calls = %d", object, calls.Load())
	}
	if strings.Contains(errString(err), "super-secret-token") || strings.Contains(errString(err), "sensitive provider detail") {
		t.Fatal("safe errors must not expose tokens or Meta messages")
	}
}

func TestMarketingSyncGraphClassifiesTokenFailureSafely(t *testing.T) {
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"code":190,"error_subcode":463,"message":"expired token super-secret-token"}}`))
	})
	defer closeServer()

	_, err := graph.object(context.Background(), "act_123", nil)
	if marketingSyncErrorCode(err) != "meta_access_token_invalid" {
		t.Fatalf("error code = %q, error = %v", marketingSyncErrorCode(err), err)
	}
	if strings.Contains(err.Error(), "super-secret-token") || strings.Contains(err.Error(), "expired token") {
		t.Fatalf("unsafe error = %q", err)
	}
}

func TestMarketingSyncGraphRejectsRepeatedCursor(t *testing.T) {
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[],"paging":{"next":"https://graph.facebook.com/next","cursors":{"after":"same"}}}`))
	})
	defer closeServer()

	_, err := graph.collection(context.Background(), "act_123/ads", nil, 10)
	if marketingSyncErrorCode(err) != "meta_repeated_paging_cursor" {
		t.Fatalf("error code = %q, error = %v", marketingSyncErrorCode(err), err)
	}
}

func TestMarketingSyncGraphDoesNotForwardAuthorizationAcrossRedirect(t *testing.T) {
	var redirected atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		redirected.Add(1)
		if request.Header.Get("Authorization") != "" {
			t.Fatal("Authorization was forwarded to redirect destination")
		}
		_, _ = w.Write([]byte(`{"id":"unexpected"}`))
	}))
	defer destination.Close()

	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		http.Redirect(w, &http.Request{}, destination.URL, http.StatusTemporaryRedirect)
	})
	defer closeServer()

	_, err := graph.object(context.Background(), "act_123", nil)
	if err == nil {
		t.Fatal("object() error = nil, want redirect rejection")
	}
	if redirected.Load() != 0 {
		t.Fatalf("redirect destination calls = %d", redirected.Load())
	}
}

func TestMarketingSyncGraphHonorsGlobalConcurrencyLimit(t *testing.T) {
	var active atomic.Int32
	var maximum atomic.Int32
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		current := active.Add(1)
		defer active.Add(-1)
		for {
			previous := maximum.Load()
			if current <= previous || maximum.CompareAndSwap(previous, current) {
				break
			}
		}
		time.Sleep(25 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"ok"}`))
	})
	defer closeServer()

	items := []string{"1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"}
	errorsList := marketingSyncMapLimited(context.Background(), items, len(items), func(ctx context.Context, item string, _ int) error {
		_, err := graph.object(ctx, item, nil)
		return err
	})
	for _, err := range errorsList {
		if err != nil {
			t.Fatalf("object() error = %v", err)
		}
	}
	if maximum.Load() > marketingSyncGraphConcurrency {
		t.Fatalf("maximum concurrency = %d, limit = %d", maximum.Load(), marketingSyncGraphConcurrency)
	}
	if maximum.Load() < 2 {
		t.Fatalf("maximum concurrency = %d, expected parallel requests", maximum.Load())
	}
}

func TestMarketingSyncGraphStopsAtDeadline(t *testing.T) {
	var calls atomic.Int32
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		_, _ = w.Write([]byte(`{"id":"unexpected"}`))
	})
	defer closeServer()
	graph.deadline = time.Now().Add(-time.Second)

	_, err := graph.object(context.Background(), "act_123", nil)
	if marketingSyncErrorCode(err) != "sync_runtime_exceeded" {
		t.Fatalf("error code = %q, error = %v", marketingSyncErrorCode(err), err)
	}
	if calls.Load() != 0 {
		t.Fatalf("HTTP calls = %d, want 0", calls.Load())
	}
}

func TestMarketingSyncGraphFailsClosedWithoutAppSecret(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		_, _ = w.Write([]byte(`{"id":"unexpected"}`))
	}))
	defer server.Close()
	service := newMarketingSyncService(nil, Config{GraphVersion: "v25.0"}, server.Client())
	service.graphBaseURL = server.URL
	graph := service.newMarketingSyncGraphClient("super-secret-token", time.Now().Add(time.Minute), make(chan struct{}, 1))

	_, err := graph.object(context.Background(), "act_123", nil)
	if marketingSyncErrorCode(err) != "meta_app_secret_missing" {
		t.Fatalf("error code=%q error=%v", marketingSyncErrorCode(err), err)
	}
	if calls.Load() != 0 {
		t.Fatalf("HTTP calls=%d, want 0", calls.Load())
	}
}

func TestFetchMarketingSyncInsightsFallsBackAndChunksRange(t *testing.T) {
	var requests atomic.Int32
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		w.Header().Set("Content-Type", "application/json")
		fields := request.URL.Query().Get("fields")
		if strings.Contains(fields, "video_play_actions") {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"code":100}}`))
			return
		}
		var timeRange map[string]string
		if err := json.Unmarshal([]byte(request.URL.Query().Get("time_range")), &timeRange); err != nil {
			t.Fatalf("invalid time_range: %v", err)
		}
		_, _ = w.Write([]byte(`{"data":[{"date_start":"` + timeRange["since"] + `","spend":"1"}]}`))
	})
	defer closeServer()

	result := fetchMarketingSyncInsights(context.Background(), graph, "act_123", "account", marketingSyncDateRange{
		From: mustMarketingSyncDate(t, "2026-01-01"),
		To:   mustMarketingSyncDate(t, "2026-03-01"),
	})
	if result.Err != nil {
		t.Fatalf("fetch insights error = %v", result.Err)
	}
	if len(result.Items) != 2 || result.Warning != "video_metrics_unavailable" || !result.Complete {
		t.Fatalf("result = %#v", result)
	}
	for _, item := range result.Items {
		if available, ok := item["_vimob_video_metrics_available"].(bool); !ok || available {
			t.Fatalf("fallback item availability = %#v", item["_vimob_video_metrics_available"])
		}
	}
	if requests.Load() != 4 {
		t.Fatalf("requests = %d, want 4 (primary + fallback per 30-day chunk)", requests.Load())
	}
}

func TestInstagramMediaFieldFallbackPreservesRangeAndLimit(t *testing.T) {
	var calls atomic.Int32
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, request *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		query := request.URL.Query()
		if query.Get("since") != "2026-07-01T00:00:00Z" || query.Get("until") != "2026-07-31T23:59:59Z" || query.Get("limit") != "100" {
			t.Fatalf("fallback lost bounded parameters: %s", request.URL.RawQuery)
		}
		if strings.Contains(query.Get("fields"), "like_count") {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"code":100}}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"media-1","timestamp":"2026-07-20T10:00:00Z"}]}`))
	})
	defer closeServer()

	collection, err := fetchMarketingSyncInstagramMedia(context.Background(), graph, "ig-1", marketingSyncDateRange{
		From: mustMarketingSyncDate(t, "2026-07-01"),
		To:   mustMarketingSyncDate(t, "2026-07-31"),
	})
	if err != nil || calls.Load() != 2 || len(collection.Items) != 1 {
		t.Fatalf("calls=%d collection=%#v error=%v", calls.Load(), collection, err)
	}
}

func TestInstagramMediaInsightFallbackPropagatesTokenFailure(t *testing.T) {
	graph, closeServer := newMarketingSyncGraphTestClient(t, func(w http.ResponseWriter, request *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		metric := request.URL.Query().Get("metric")
		w.WriteHeader(http.StatusBadRequest)
		if metric == "reach" {
			_, _ = w.Write([]byte(`{"error":{"code":190}}`))
			return
		}
		_, _ = w.Write([]byte(`{"error":{"code":100}}`))
	})
	defer closeServer()

	_, err := fetchMarketingSyncInstagramMediaInsights(context.Background(), graph, "media-1")
	if marketingSyncErrorCode(err) != "meta_access_token_invalid" {
		t.Fatalf("error code = %q, error = %v", marketingSyncErrorCode(err), err)
	}
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
