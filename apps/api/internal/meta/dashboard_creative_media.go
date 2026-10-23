package meta

import (
	"context"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

const (
	dashboardCreativeMediaTimeout      = 3 * time.Second
	dashboardCreativeMediaSuccessTTL   = 90 * time.Second
	dashboardCreativeMediaFailureTTL   = 20 * time.Second
	dashboardCreativeMediaCacheEntries = 256
)

var dashboardMetaObjectID = regexp.MustCompile(`^[0-9]{1,32}$`)

// DashboardCreativeMedia contains only browser-safe URLs. No Meta credential or
// provider error is ever returned to the dashboard.
type DashboardCreativeMedia struct {
	ThumbnailURL *string `json:"thumbnailUrl"`
	ImageURL     *string `json:"imageUrl"`
	VideoURL     *string `json:"videoUrl"`
	InstagramURL *string `json:"instagramUrl"`
	PermalinkURL *string `json:"permalinkUrl"`
}

type dashboardCreativeMediaCacheEntry struct {
	value     DashboardCreativeMedia
	expiresAt time.Time
}

type dashboardCreativeMediaFlight struct {
	done  chan struct{}
	value DashboardCreativeMedia
}

// DashboardCreativeMediaResolver performs a bounded, read-only Graph lookup
// using an active ads_read integration belonging to the requested organization.
// The caller must first verify that the creative is visible in its dashboard
// cohort; this resolver deliberately cannot authorize a dashboard row itself.
type DashboardCreativeMediaResolver struct {
	tokens    func(context.Context, string) ([]string, error)
	graphRepo Repository
	slots     chan struct{}
	now       func() time.Time
	mu        sync.Mutex
	cache     map[string]dashboardCreativeMediaCacheEntry
	inflight  map[string]*dashboardCreativeMediaFlight
}

func NewDashboardCreativeMediaResolver(database *dbpkg.Postgres, config Config) *DashboardCreativeMediaResolver {
	version := strings.TrimSpace(config.GraphVersion)
	if !marketingSyncGraphVersionPattern.MatchString(version) {
		version = marketingSyncGraphVersion
	}
	// The Meta repository supports bearer-only Graph requests when no local app
	// secret is configured. Pin the provider origin here regardless of env input.
	graphRepo := NewRepository(database, Config{
		AppSecret: config.AppSecret, GraphVersion: version, GraphBaseURL: marketingSyncGraphOrigin,
	})
	resolver := &DashboardCreativeMediaResolver{
		graphRepo: graphRepo,
		slots:     make(chan struct{}, 2),
		now:       time.Now,
		cache:     make(map[string]dashboardCreativeMediaCacheEntry),
		inflight:  make(map[string]*dashboardCreativeMediaFlight),
	}
	if database != nil {
		resolver.tokens = func(ctx context.Context, organizationID string) ([]string, error) {
			return loadDashboardCreativeMediaTokens(ctx, database.Pool(), organizationID)
		}
	}
	return resolver
}

// A short negative cache prevents a broken image from repeatedly calling the
// provider. The timeout and two global slots keep failures off the main chart.
func (resolver *DashboardCreativeMediaResolver) ResolveDashboardCreativeMedia(ctx context.Context, organizationID, creativeID, adID string) DashboardCreativeMedia {
	if resolver == nil || resolver.tokens == nil || resolver.graphRepo.client == nil ||
		!marketingSyncUUIDPattern.MatchString(organizationID) ||
		(creativeID == "" && adID == "") ||
		(creativeID != "" && !dashboardMetaObjectID.MatchString(creativeID)) ||
		(adID != "" && !dashboardMetaObjectID.MatchString(adID)) {
		return DashboardCreativeMedia{}
	}
	if ctx.Err() != nil {
		return DashboardCreativeMedia{}
	}
	organizationID = strings.ToLower(organizationID)
	cacheKey := organizationID + ":" + creativeID + ":" + adID
	now := resolver.now()
	resolver.mu.Lock()
	if cached, ok := resolver.cache[cacheKey]; ok && now.Before(cached.expiresAt) {
		resolver.mu.Unlock()
		return cached.value
	}
	flight, exists := resolver.inflight[cacheKey]
	if !exists {
		// Coalesce each organization/key once, with bounded distinct pending
		// flights as well as bounded Graph concurrency. Saturation is a preview
		// miss, never an unbounded queue of provider goroutines.
		if len(resolver.inflight) >= dashboardCreativeMediaCacheEntries {
			resolver.mu.Unlock()
			return DashboardCreativeMedia{}
		}
		flight = &dashboardCreativeMediaFlight{done: make(chan struct{})}
		resolver.inflight[cacheKey] = flight
		go resolver.resolveDashboardCreativeMediaFlight(context.WithoutCancel(ctx), cacheKey, organizationID, creativeID, adID, flight)
	}
	resolver.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, dashboardCreativeMediaTimeout)
	defer cancel()
	select {
	case <-flight.done:
		return flight.value
	case <-ctx.Done():
		return DashboardCreativeMedia{}
	}
}

func (resolver *DashboardCreativeMediaResolver) resolveDashboardCreativeMediaFlight(ctx context.Context, cacheKey, organizationID, creativeID, adID string, flight *dashboardCreativeMediaFlight) {
	ctx, cancel := context.WithTimeout(ctx, dashboardCreativeMediaTimeout)
	defer cancel()
	var result DashboardCreativeMedia
	defer func() {
		// A provider adapter panic must release its flight and cannot crash the
		// API from this shared goroutine or strand every waiter for the key.
		if recover() != nil {
			result = DashboardCreativeMedia{}
		}
		resolver.mu.Lock()
		defer resolver.mu.Unlock()
		if len(resolver.cache) >= dashboardCreativeMediaCacheEntries {
			for key := range resolver.cache {
				delete(resolver.cache, key)
				break
			}
		}
		ttl := dashboardCreativeMediaFailureTTL
		if result.ThumbnailURL != nil {
			ttl = dashboardCreativeMediaSuccessTTL
		}
		resolver.cache[cacheKey] = dashboardCreativeMediaCacheEntry{value: result, expiresAt: resolver.now().Add(ttl)}
		flight.value = result
		delete(resolver.inflight, cacheKey)
		close(flight.done)
	}()
	result = resolver.lookupDashboardCreativeMedia(ctx, organizationID, creativeID, adID)
}

func (resolver *DashboardCreativeMediaResolver) lookupDashboardCreativeMedia(ctx context.Context, organizationID, creativeID, adID string) DashboardCreativeMedia {
	select {
	case resolver.slots <- struct{}{}:
		defer func() { <-resolver.slots }()
	case <-ctx.Done():
		return DashboardCreativeMedia{}
	}

	var result DashboardCreativeMedia
	if tokens, err := resolver.tokens(ctx, organizationID); err == nil {
		for _, token := range tokens {
			if strings.TrimSpace(token) == "" {
				continue
			}
			if adID != "" {
				ad, err := resolver.graphRepo.metaGraphGet(ctx, adID, token, marketingSyncAdFields)
				if err != nil && ctx.Err() == nil {
					ad, err = resolver.graphRepo.metaGraphGet(ctx, adID, token, metaAdWithCreativeFields)
				}
				if err == nil {
					result = dashboardCreativeMediaFromGraph(ad, marketingSyncRecord(ad["creative"]))
				}
			}
			if result.ThumbnailURL == nil && creativeID != "" {
				creative, err := resolver.graphRepo.metaGraphGet(ctx, creativeID, token, marketingSyncCreativeFields)
				if err != nil && ctx.Err() == nil {
					creative, err = resolver.graphRepo.metaGraphGet(ctx, creativeID, token, marketingSyncCreativeFallbackFields)
				}
				if err == nil {
					result = dashboardCreativeMediaFromGraph(nil, creative)
				}
			}
			if result.ThumbnailURL != nil || ctx.Err() != nil {
				break
			}
		}
	}

	return result
}

// The query reuses the same token eligibility as Marketing Sync, but reads at
// most two user tokens and does not touch any sync or media tables.
const dashboardCreativeMediaTokenQuery = `
	select secret.decrypted_secret
	from public.meta_integrations integration
	join vault.decrypted_secrets secret
	  on secret.id = integration.user_access_token_secret_ref
	where integration.organization_id = $1::uuid
	  and coalesce(integration.is_connected, false) = true
	  and coalesce(integration.token_status, 'active') = 'active'
	  and (integration.token_expires_at is null or integration.token_expires_at > now() + interval '5 minutes')
	  and coalesce(integration.granted_scopes, array[]::text[]) @> array['ads_read']::text[]
	  and nullif(secret.decrypted_secret, '') is not null
	order by integration.updated_at desc, integration.created_at desc
	limit 2
`

type dashboardCreativeMediaQueryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func loadDashboardCreativeMediaTokens(ctx context.Context, db dashboardCreativeMediaQueryer, organizationID string) ([]string, error) {
	rows, err := db.Query(ctx, dashboardCreativeMediaTokenQuery, organizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tokens := make([]string, 0, 2)
	for rows.Next() {
		var token string
		if err := rows.Scan(&token); err != nil {
			return nil, err
		}
		tokens = append(tokens, token)
	}
	return tokens, rows.Err()
}

func dashboardCreativeMediaFromGraph(ad, creative map[string]any) DashboardCreativeMedia {
	if len(creative) == 0 {
		return DashboardCreativeMedia{}
	}
	story := marketingSyncRecord(creative["object_story_spec"])
	link := marketingSyncRecord(story["link_data"])
	photo := marketingSyncRecord(story["photo_data"])
	video := marketingSyncRecord(story["video_data"])
	image := dashboardCreativeMediaFirstSafeURL(
		creative["effective_image_url"], creative["image_url"],
		link["picture"], photo["url"], video["image_url"],
	)
	thumbnail := image
	if thumbnail == nil {
		thumbnail = dashboardCreativeMediaFirstSafeURL(
			creative["thumbnail_url"], video["thumbnail_url"],
		)
	}
	return DashboardCreativeMedia{
		ThumbnailURL: thumbnail,
		ImageURL:     image,
		VideoURL:     dashboardCreativeMediaFirstSafeURL(creative["video_source"]),
		InstagramURL: dashboardCreativeMediaFirstSafeURL(creative["instagram_permalink_url"]),
		PermalinkURL: dashboardCreativeMediaFirstSafeURL(
			ad["preview_shareable_link"], creative["video_permalink_url"], creative["instagram_permalink_url"],
		),
	}
}

func dashboardCreativeMediaFirstSafeURL(values ...any) *string {
	for _, value := range values {
		if safe := dashboardCreativeMediaSafeURL(marketingSyncText(value)); safe != nil {
			return safe
		}
	}
	return nil
}

func dashboardCreativeMediaSafeURL(raw string) *string {
	return SafeDashboardCreativeURL(raw)
}

// SafeDashboardCreativeURL is shared by recorded snapshots and Graph results.
// Keep credentials, explicit ports, fragments and secret-bearing query parameters out of
// every media response, including its first render and historical fallback.
func SafeDashboardCreativeURL(raw string) *string {
	value := strings.TrimSpace(raw)
	if value == "" || len(value) > 4096 || strings.Contains(value, "#") {
		return nil
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || parsed.Port() != "" {
		return nil
	}
	query, err := url.ParseQuery(parsed.RawQuery)
	if err != nil {
		return nil
	}
	for key := range query {
		lower := strings.ToLower(key)
		if strings.Contains(lower, "token") || strings.Contains(lower, "secret") || strings.Contains(lower, "proof") {
			return nil
		}
	}
	return &value
}
