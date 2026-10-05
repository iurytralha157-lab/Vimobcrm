package meta

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
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
