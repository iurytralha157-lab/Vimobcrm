package meta

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const dashboardCreativeMediaTestOrg = "11111111-1111-4111-8111-111111111111"

func TestDashboardCreativeMediaPrefersFreshEffectiveImageAndSafeLinks(t *testing.T) {
	ad := map[string]any{"preview_shareable_link": "https://facebook.com/adpreview"}
	creative := map[string]any{
		"effective_image_url":     "https://cdn.example.test/fresh.jpg?oe=123",
		"image_url":               "https://cdn.example.test/image.jpg",
		"thumbnail_url":           "https://cdn.example.test/old.jpg",
		"instagram_permalink_url": "https://instagram.com/p/example/",
	}
	media := dashboardCreativeMediaFromGraph(ad, creative)
	if media.ThumbnailURL == nil || *media.ThumbnailURL != "https://cdn.example.test/fresh.jpg?oe=123" {
		t.Fatalf("fresh image was not preferred over recorded-style thumbnail: %#v", media.ThumbnailURL)
	}
	if media.PermalinkURL == nil || *media.PermalinkURL != "https://facebook.com/adpreview" {
		t.Fatalf("ad preview link was lost: %#v", media.PermalinkURL)
	}
	creative["effective_image_url"] = "https://cdn.example.test/unsafe.jpg?access_token=secret"
	media = dashboardCreativeMediaFromGraph(ad, creative)
	if media.ThumbnailURL == nil || *media.ThumbnailURL != "https://cdn.example.test/image.jpg" {
		t.Fatalf("unsafe first URL should fall back to the next safe image: %#v", media.ThumbnailURL)
	}
}

func TestDashboardCreativeMediaRejectsUnsafeURLsAndIDs(t *testing.T) {
	for _, raw := range []string{
		"http://cdn.example.test/a.jpg", "https://user:password@cdn.example.test/a.jpg",
		"https://cdn.example.test:444/a.jpg", "https://cdn.example.test/a.jpg?access_token=secret",
		"https://cdn.example.test/a.jpg?appsecret_proof=value", "javascript:alert(1)",
		"https://cdn.example.test/a.jpg#access_token=secret", "https://cdn.example.test/a.jpg#appsecret_proof=value",
		"https://cdn.example.test/a.jpg#section", "https://cdn.example.test/a.jpg#",
	} {
		if got := dashboardCreativeMediaSafeURL(raw); got != nil {
			t.Errorf("unsafe URL accepted: %s", raw)
		}
	}
	resolver := NewDashboardCreativeMediaResolver(nil, Config{AppSecret: "test-app-secret", GraphBaseURL: "https://attacker.invalid"})
	if resolver.graphRepo.config.GraphBaseURL != marketingSyncGraphOrigin {
		t.Fatal("token-bearing Graph requests must be pinned to the Meta origin")
	}
	var called atomic.Int32
	resolver.tokens = func(context.Context, string) ([]string, error) {
		called.Add(1)
		return nil, nil
	}
	for _, input := range []struct{ org, creativeID, adID string }{
		{"not-an-organization", "123", ""},
		{dashboardCreativeMediaTestOrg, "../../etc/passwd", ""},
		{dashboardCreativeMediaTestOrg, "", "123?access_token=steal"},
	} {
		if media := resolver.ResolveDashboardCreativeMedia(context.Background(), input.org, input.creativeID, input.adID); media.ThumbnailURL != nil {
			t.Fatal("invalid lookup returned media")
		}
	}
	if called.Load() != 0 {
		t.Fatal("invalid IDs reached token lookup")
	}
}

func TestDashboardCreativeMediaFragmentRejectionPreservesSignedSafeFallback(t *testing.T) {
	safe := "https://cdn.example.test/image%23part.jpg?oh=public-signature&oe=123"
	media := dashboardCreativeMediaFromGraph(
		map[string]any{"preview_shareable_link": "https://facebook.com/adpreview#access_token=secret"},
		map[string]any{
			"effective_image_url":     "https://cdn.example.test/image.jpg#appsecret_proof=secret",
			"image_url":               safe,
			"instagram_permalink_url": "https://instagram.com/p/example/",
		},
	)
	if media.ThumbnailURL == nil || *media.ThumbnailURL != safe ||
		media.PermalinkURL == nil || *media.PermalinkURL != "https://instagram.com/p/example/" {
		t.Fatal("fragment rejection lost the next safe signed image or link fallback")
	}
}

func TestDashboardCreativeMediaUsesOrgTokenAndCachesGraphResult(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "Bearer test-user-token" ||
			strings.Contains(r.URL.RawQuery, "test-user-token") ||
			r.URL.Query().Get("appsecret_proof") == "" ||
			!strings.HasSuffix(r.URL.Path, "/123") {
			t.Error("Graph request lost token isolation or appsecret proof")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"123","creative":{"id":"456","effective_image_url":"https://cdn.example.test/fresh.jpg"}}`))
	}))
	defer server.Close()
	resolver := NewDashboardCreativeMediaResolver(nil, Config{AppSecret: "test-app-secret"})
	resolver.graphRepo.config.GraphBaseURL = server.URL // test server only; production construction pins Meta.
	resolver.graphRepo.client = server.Client()
	var tokenLookups atomic.Int32
	resolver.tokens = func(_ context.Context, orgID string) ([]string, error) {
		tokenLookups.Add(1)
		if orgID != dashboardCreativeMediaTestOrg {
			t.Fatal("token lookup used the wrong organization")
		}
		return []string{"test-user-token"}, nil
	}
	first := resolver.ResolveDashboardCreativeMedia(context.Background(), dashboardCreativeMediaTestOrg, "456", "123")
	second := resolver.ResolveDashboardCreativeMedia(context.Background(), dashboardCreativeMediaTestOrg, "456", "123")
	if first.ThumbnailURL == nil || *first.ThumbnailURL != "https://cdn.example.test/fresh.jpg" ||
		second.ThumbnailURL == nil || *second.ThumbnailURL != *first.ThumbnailURL {
		t.Fatalf("fresh Graph image missing: %#v %#v", first, second)
	}
	if calls.Load() != 1 || tokenLookups.Load() != 1 {
		t.Fatalf("cache did not prevent repeat Graph work: graph=%d tokens=%d", calls.Load(), tokenLookups.Load())
	}
	resolver.now = func() time.Time { return time.Now().Add(dashboardCreativeMediaSuccessTTL + time.Second) }
	_ = resolver.ResolveDashboardCreativeMedia(context.Background(), dashboardCreativeMediaTestOrg, "456", "123")
	if calls.Load() != 2 {
		t.Fatal("expired media cache did not refresh")
	}
}

func TestDashboardCreativeMediaAllowsBearerOnlyWhenLocalAppSecretIsAbsent(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "Bearer test-user-token" || r.URL.Query().Has("appsecret_proof") {
			t.Error("bearer-only request leaked token or added unavailable proof")
		}
		_, _ = w.Write([]byte(`{"id":"123","effective_image_url":"https://cdn.example.test/current.jpg"}`))
	}))
	defer server.Close()
	resolver := NewDashboardCreativeMediaResolver(nil, Config{})
	resolver.graphRepo.config.GraphBaseURL = server.URL // test transport only.
	resolver.graphRepo.client = server.Client()
	resolver.tokens = func(context.Context, string) ([]string, error) { return []string{"test-user-token"}, nil }
	media := resolver.ResolveDashboardCreativeMedia(context.Background(), dashboardCreativeMediaTestOrg, "123", "")
	if calls.Load() != 1 || media.ThumbnailURL == nil || *media.ThumbnailURL != "https://cdn.example.test/current.jpg" {
		t.Fatalf("bearer-only Graph lookup did not return current image: calls=%d", calls.Load())
	}
}

func TestDashboardCreativeMediaTokenQueryIsScopedAndBounded(t *testing.T) {
	for _, fragment := range []string{
		"integration.organization_id = $1::uuid", "integration.user_access_token_secret_ref",
		"secret.id = integration.user_access_token_secret_ref", "array['ads_read']::text[]",
		"integration.is_connected", "integration.token_expires_at", "limit 2",
	} {
		if !strings.Contains(dashboardCreativeMediaTokenQuery, fragment) {
			t.Errorf("token query missing %q", fragment)
		}
	}
	if strings.Contains(strings.ToLower(dashboardCreativeMediaTokenQuery), "update ") || strings.Contains(strings.ToLower(dashboardCreativeMediaTokenQuery), "insert ") {
		t.Fatal("media lookup must never write to the database")
	}
}

func TestDashboardCreativeMediaCoalescesConcurrentKeysWithinEachOrganization(t *testing.T) {
	otherOrg := "22222222-2222-4222-8222-222222222222"
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		image := "https://cdn.example.test/first-org.jpg"
		if r.Header.Get("Authorization") == "Bearer second-org-token" {
			image = "https://cdn.example.test/second-org.jpg"
		}
		_, _ = w.Write([]byte(`{"id":"123","effective_image_url":"` + image + `"}`))
	}))
	defer server.Close()
	resolver := NewDashboardCreativeMediaResolver(nil, Config{})
	resolver.graphRepo.config.GraphBaseURL, resolver.graphRepo.client = server.URL, server.Client()
	started := make(chan struct{}, 2)
	release := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	var tokenLookups atomic.Int32
	resolver.tokens = func(ctx context.Context, orgID string) ([]string, error) {
		tokenLookups.Add(1)
		started <- struct{}{}
		select {
		case <-release:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		if orgID == otherOrg {
			return []string{"second-org-token"}, nil
		}
		return []string{"first-org-token"}, nil
	}
	var callers sync.WaitGroup
	for i := 0; i < 16; i++ {
		orgID, expected := dashboardCreativeMediaTestOrg, "https://cdn.example.test/first-org.jpg"
		if i%2 == 1 {
			orgID, expected = otherOrg, "https://cdn.example.test/second-org.jpg"
		}
		callers.Add(1)
		go func() {
			defer callers.Done()
			media := resolver.ResolveDashboardCreativeMedia(context.Background(), orgID, "123", "")
			if media.ThumbnailURL == nil || *media.ThumbnailURL != expected {
				t.Errorf("organization %s received another scope's preview: %#v", orgID, media)
			}
		}()
	}
	for i := 0; i < 2; i++ {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("both organization lookups did not start")
		}
	}
	releaseOnce.Do(func() { close(release) })
	callers.Wait()
	if calls.Load() != 2 || tokenLookups.Load() != 2 {
		t.Fatalf("expected one shared lookup per organization: graph=%d tokens=%d", calls.Load(), tokenLookups.Load())
	}
}

func TestDashboardCreativeMediaCallerCancellationDoesNotCancelSharedLookup(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	resolver := NewDashboardCreativeMediaResolver(nil, Config{})
	resolver.tokens = func(ctx context.Context, _ string) ([]string, error) {
		close(started)
		select {
		case <-release:
			return nil, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	firstCtx, cancel := context.WithCancel(context.Background())
	first := make(chan DashboardCreativeMedia, 1)
	go func() {
		first <- resolver.ResolveDashboardCreativeMedia(firstCtx, dashboardCreativeMediaTestOrg, "123", "")
	}()
	<-started
	cancel()
	select {
	case <-first:
	case <-time.After(time.Second):
		t.Fatal("canceled caller kept waiting")
	}
	resolver.mu.Lock()
	flight := resolver.inflight[dashboardCreativeMediaTestOrg+":123:"]
	resolver.mu.Unlock()
	if flight == nil {
		t.Fatal("caller cancellation prematurely completed the shared lookup")
	}
	second := make(chan DashboardCreativeMedia, 1)
	go func() {
		second <- resolver.ResolveDashboardCreativeMedia(context.Background(), dashboardCreativeMediaTestOrg, "123", "")
	}()
	select {
	case <-flight.done:
		t.Fatal("shared provider context was canceled by its first caller")
	default:
	}
	releaseOnce.Do(func() { close(release) })
	select {
	case <-second:
	case <-time.After(time.Second):
		t.Fatal("remaining caller was stranded after shared work completed")
	}
}

func TestDashboardCreativeMediaBoundsDistinctFlightsAndProviderQueue(t *testing.T) {
	resolver := NewDashboardCreativeMediaResolver(nil, Config{})
	var tokenLookups atomic.Int32
	resolver.tokens = func(context.Context, string) ([]string, error) { tokenLookups.Add(1); return nil, nil }
	for i := 0; i < dashboardCreativeMediaCacheEntries; i++ {
		resolver.inflight[strings.Repeat("x", i+1)] = &dashboardCreativeMediaFlight{done: make(chan struct{})}
	}
	_ = resolver.ResolveDashboardCreativeMedia(context.Background(), dashboardCreativeMediaTestOrg, "123", "")
	if tokenLookups.Load() != 0 || len(resolver.inflight) != dashboardCreativeMediaCacheEntries {
		t.Fatal("saturated pending flight map must reject additional distinct provider work")
	}
	for i := 0; i < cap(resolver.slots); i++ {
		resolver.slots <- struct{}{}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	started := time.Now()
	_ = resolver.lookupDashboardCreativeMedia(ctx, dashboardCreativeMediaTestOrg, "123", "")
	if time.Since(started) > time.Second || tokenLookups.Load() != 0 {
		t.Fatal("provider queue did not honor its deadline before token lookup")
	}
}

func TestDashboardCreativeMediaProviderPanicReleasesSharedFlight(t *testing.T) {
	resolver := NewDashboardCreativeMediaResolver(nil, Config{})
	resolver.tokens = func(context.Context, string) ([]string, error) { panic("synthetic provider adapter panic") }
	media := resolver.ResolveDashboardCreativeMedia(context.Background(), dashboardCreativeMediaTestOrg, "123", "")
	resolver.mu.Lock()
	remaining := len(resolver.inflight)
	resolver.mu.Unlock()
	if remaining != 0 || media.ThumbnailURL != nil {
		t.Fatal("provider panic stranded the flight or returned unsafe media")
	}
}
