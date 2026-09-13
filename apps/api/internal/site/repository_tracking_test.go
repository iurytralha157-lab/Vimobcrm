package site

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type trackingRecordingExecer struct {
	queries []string
	args    [][]any
}

func (recorder *trackingRecordingExecer) Exec(_ context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	recorder.queries = append(recorder.queries, sql)
	recorder.args = append(recorder.args, arguments)
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func TestMetadataDurationAcceptsOnlyPositiveWholeSeconds(t *testing.T) {
	t.Parallel()

	for _, value := range []any{1, 120, float64(42)} {
		if _, ok := metadataDuration(map[string]any{"duration_seconds": value}); !ok {
			t.Fatalf("expected duration %#v to be accepted", value)
		}
	}
	for _, value := range []any{nil, 0, -1, 1.5, float64(maxPublicPageDurationSeconds + 1), "12"} {
		if _, ok := metadataDuration(map[string]any{"duration_seconds": value}); ok {
			t.Fatalf("expected duration %#v to be rejected", value)
		}
	}
	if _, ok := metadataDuration(nil); ok {
		t.Fatal("missing duration must be rejected")
	}
}

func TestValidatePublicTrackingRequestMatchesThePublicContract(t *testing.T) {
	t.Parallel()

	if !validatePublicTrackingRequest(validPublicTrackingRequestForTest(), false) {
		t.Fatal("valid pageview request was rejected")
	}
	withClickIDs := validPublicTrackingRequestForTest()
	withClickIDs.GCLID = trackingStringPointer("google-click-id")
	withClickIDs.FBCLID = trackingStringPointer("facebook-click-id")
	if !validatePublicTrackingRequest(withClickIDs, false) {
		t.Fatal("bounded click ids were rejected")
	}

	tests := []struct {
		name   string
		mutate func(*PublicTrackingRequest)
	}{
		{
			name: "unknown device",
			mutate: func(request *PublicTrackingRequest) {
				request.DeviceType = trackingStringPointer("watch")
			},
		},
		{
			name: "invalid property id",
			mutate: func(request *PublicTrackingRequest) {
				request.PropertyID = trackingStringPointer("not-a-uuid")
			},
		},
		{
			name: "oversized campaign",
			mutate: func(request *PublicTrackingRequest) {
				request.UTMCampaign = trackingStringPointer(strings.Repeat("x", 301))
			},
		},
		{
			name: "oversized gclid",
			mutate: func(request *PublicTrackingRequest) {
				request.GCLID = trackingStringPointer(strings.Repeat("x", 301))
			},
		},
		{
			name: "oversized fbclid",
			mutate: func(request *PublicTrackingRequest) {
				request.FBCLID = trackingStringPointer(strings.Repeat("x", 301))
			},
		},
		{
			name: "reserved synthetic session prefix",
			mutate: func(request *PublicTrackingRequest) {
				request.SessionID = trackingStringPointer(publicContactSubmissionSessionPrefix + "forged")
			},
		},
		{
			name: "reserved synthetic session prefix after whitespace",
			mutate: func(request *PublicTrackingRequest) {
				request.SessionID = trackingStringPointer("  " + publicContactSubmissionSessionPrefix + "forged")
			},
		},
		{
			name: "click metadata on pageview",
			mutate: func(request *PublicTrackingRequest) {
				request.Metadata["action"] = "forged"
			},
		},
		{
			name: "unknown metadata",
			mutate: func(request *PublicTrackingRequest) {
				request.Metadata["token"] = "secret"
			},
		},
		{
			name: "numeric search filter",
			mutate: func(request *PublicTrackingRequest) {
				request.EventType = "property_search"
				request.Metadata["filters"] = map[string]any{"vagas": float64(2)}
			},
		},
		{
			name: "duration outside duration event",
			mutate: func(request *PublicTrackingRequest) {
				request.Metadata["duration_seconds"] = float64(30)
			},
		},
		{
			name: "duration event without duration",
			mutate: func(request *PublicTrackingRequest) {
				request.EventType = "page_duration"
			},
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			request := validPublicTrackingRequestForTest()
			testCase.mutate(&request)
			if validatePublicTrackingRequest(request, false) {
				t.Fatal("invalid public tracking request was accepted")
			}
		})
	}

	trustedGeo := validPublicTrackingRequestForTest()
	trustedGeo.Metadata["country"] = "BR"
	trustedGeo.Metadata["lat"] = -23.5505
	trustedGeo.Metadata["lng"] = -46.6333
	if validatePublicTrackingRequest(trustedGeo, false) {
		t.Fatal("client-provided geo metadata was accepted")
	}
	if !validatePublicTrackingRequest(trustedGeo, true) {
		t.Fatal("server-enriched geo metadata was rejected")
	}
}

func TestPublicTrackingDecoderRejectsLeadIDEvenWhenNull(t *testing.T) {
	t.Parallel()

	request := httptest.NewRequest(http.MethodPost, "/v1/public/tracking/events", strings.NewReader(`{
		"organization_id":"11111111-1111-4111-8111-111111111111",
		"event_type":"pageview",
		"page_path":"/",
		"session_id":"session-123",
		"metadata":{},
		"lead_id":null
	}`))
	response := httptest.NewRecorder()
	var payload PublicTrackingRequest
	if err := httpserver.DecodeJSON(response, request, &payload, 1<<20); err == nil {
		t.Fatal("lead_id must be an unknown public tracking field")
	}
}

func validPublicTrackingRequestForTest() PublicTrackingRequest {
	return PublicTrackingRequest{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		EventType:      "pageview",
		PagePath:       "/imoveis/AP-123",
		PageTitle:      trackingStringPointer("Imóvel AP-123"),
		Referrer:       trackingStringPointer("https://partner.example/path"),
		SessionID:      trackingStringPointer("session-123"),
		PropertyID:     trackingStringPointer("22222222-2222-4222-8222-222222222222"),
		DeviceType:     trackingStringPointer("mobile"),
		Browser:        trackingStringPointer("chrome"),
		ScreenWidth:    trackingIntPointer(390),
		ScreenHeight:   trackingIntPointer(844),
		Metadata: map[string]any{
			"os":       "iOS",
			"timezone": "America/Sao_Paulo",
		},
	}
}

func trackingStringPointer(value string) *string { return &value }

func trackingIntPointer(value int) *int { return &value }

func TestAddPublicTrackingAttributionPersistsOnlyProviderSignals(t *testing.T) {
	t.Parallel()

	metadata := map[string]any{}
	request := PublicTrackingRequest{
		GCLID:  trackingStringPointer("  raw-google-id  "),
		FBCLID: trackingStringPointer("raw-facebook-id"),
	}
	addPublicTrackingAttributionSignals(metadata, request)

	if metadata["google_ads_click"] != true || metadata["facebook_click"] != true {
		t.Fatalf("click attribution signals were not preserved: %#v", metadata)
	}
	for _, rawID := range []string{"raw-google-id", "raw-facebook-id"} {
		if strings.Contains(jsonb(metadata), rawID) {
			t.Fatalf("raw click id %q must not be persisted in tracking metadata", rawID)
		}
	}
}

func TestSanitizePublicTrackingMetadataKeepsOnlyAllowlistedFilters(t *testing.T) {
	t.Parallel()

	sanitized := sanitizePublicTrackingMetadata("property_search", map[string]any{
		"timezone": "America/Sao_Paulo",
		"city":     "forged city",
		"lat":      -23.5,
		"action":   "not valid for this event",
		"filters": map[string]any{
			"search":     " apartamento ",
			"cidade":     "São Paulo",
			"utm_source": "meta",
			"token":      "secret",
			"vagas":      2,
		},
	}, false)
	filters, ok := sanitized["filters"].(map[string]any)
	if !ok {
		t.Fatalf("sanitized filters = %#v", sanitized["filters"])
	}
	if len(filters) != 2 || filters["search"] != "apartamento" || filters["cidade"] != "São Paulo" {
		t.Fatalf("unexpected sanitized filters: %#v", filters)
	}
	for _, forbidden := range []string{"utm_source", "token", "vagas"} {
		if _, exists := filters[forbidden]; exists {
			t.Fatalf("filter %q must not be persisted: %#v", forbidden, filters)
		}
	}
	if sanitized["timezone"] != "America/Sao_Paulo" {
		t.Fatal("non-filter analytics metadata must be preserved")
	}
	if sanitized["search_term"] != "apartamento" {
		t.Fatalf("search term must be derived from the sanitized search filter: %#v", sanitized)
	}
	for _, forged := range []string{"city", "lat", "action"} {
		if _, exists := sanitized[forged]; exists {
			t.Fatalf("client metadata %q must not be accepted for property_search: %#v", forged, sanitized)
		}
	}
}

func TestSanitizePublicTrackingMetadataIsEventScoped(t *testing.T) {
	t.Parallel()

	input := map[string]any{
		"duration_seconds": float64(42),
		"action":           "open_whatsapp_lead_form",
		"placement":        "property",
		"token":            "secret",
		"city":             "forged city",
		"lat":              -23.5,
	}

	pageView := sanitizePublicTrackingMetadata("pageview", input, false)
	if len(pageView) != 0 {
		t.Fatalf("pageview accepted unrelated client metadata: %#v", pageView)
	}
	cta := sanitizePublicTrackingMetadata("cta_click", input, false)
	if cta["action"] != "open_whatsapp_lead_form" || cta["placement"] != "property" {
		t.Fatalf("CTA metadata lost declared fields: %#v", cta)
	}
	for _, forbidden := range []string{"duration_seconds", "token", "city", "lat"} {
		if _, exists := cta[forbidden]; exists {
			t.Fatalf("CTA metadata accepted %q: %#v", forbidden, cta)
		}
	}
	duration := sanitizePublicTrackingMetadata("page_duration", input, false)
	if duration["duration_seconds"] != 42 {
		t.Fatalf("page duration lost valid duration: %#v", duration)
	}
}

func TestSanitizePublicTrackingMetadataKeepsGeoOnlyAfterServerEnrichment(t *testing.T) {
	t.Parallel()

	metadata := map[string]any{
		"city":    "São Paulo",
		"region":  "SP",
		"country": "BR",
		"lat":     -23.5505,
		"lng":     -46.6333,
	}
	withoutTrust := sanitizePublicTrackingMetadata("pageview", metadata, false)
	if len(withoutTrust) != 0 {
		t.Fatalf("untrusted location metadata was persisted: %#v", withoutTrust)
	}
	withTrust := sanitizePublicTrackingMetadata("pageview", metadata, true)
	if withTrust["city"] != "São Paulo" || withTrust["country"] != "BR" || withTrust["lat"] != -23.5505 {
		t.Fatalf("server-enriched location was not preserved: %#v", withTrust)
	}
}

func TestAppendPublicTrackingEventKeepsNonDurationEventsAppendOnly(t *testing.T) {
	t.Parallel()

	recorder := &trackingRecordingExecer{}
	pageView := trackingTestEvent("pageview", 0)
	if err := appendPublicTrackingEvent(context.Background(), recorder, pageView); err != nil {
		t.Fatalf("persist pageview: %v", err)
	}
	if len(recorder.queries) != 1 || strings.Contains(recorder.queries[0], "updated_duration") {
		t.Fatal("non-duration events must remain append-only")
	}
	if len(recorder.args[0]) != 17 {
		t.Fatalf("append-only arguments = %#v", recorder.args[0])
	}
}

func TestPublicPageDurationHeartbeatsAccumulateAgainstDatabase(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DB_TESTS") != "1" {
		t.Skip("set VIMOB_RUN_DB_TESTS=1 to run database integration tests")
	}
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		t.Fatal("DATABASE_URL is required")
	}
	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse DATABASE_URL: %v", err)
	}
	if host := parsedURL.Hostname(); host != "localhost" && host != "127.0.0.1" && host != "::1" {
		t.Skip("DATABASE_URL must point to a local PostgreSQL instance")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL: databaseURL, MaxConns: 4, HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect database: %v", err)
	}
	t.Cleanup(postgres.Close)

	pool := postgres.Pool()
	var organizationID string
	if err := pool.QueryRow(ctx, `select id::text from public.organizations order by created_at limit 1`).Scan(&organizationID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			t.Skip("local database has no organization fixture")
		}
		t.Fatalf("select organization: %v", err)
	}

	sessionID := "tracking-test-" + time.Now().UTC().Format("20060102150405.000000000")
	sessionStartID := sessionID + "-session-start"
	previousWindowSessionID := sessionID + "-previous-window"
	t.Cleanup(func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = pool.Exec(cleanupContext, `
			delete from public.site_analytics_events
			where organization_id = $1::uuid and session_id = any($2::text[])
		`, organizationID, []string{sessionID, sessionStartID, previousWindowSessionID})
	})

	sessionStart := trackingTestEvent("session_start", 0)
	sessionStart.organizationID = organizationID
	sessionStart.sessionID = sessionStartID
	var sessionStartWaitGroup sync.WaitGroup
	sessionStartErrors := make(chan error, 2)
	for range 2 {
		sessionStartWaitGroup.Add(1)
		go func() {
			defer sessionStartWaitGroup.Done()
			sessionStartErrors <- persistPublicTrackingEvent(ctx, pool, sessionStart)
		}()
	}
	sessionStartWaitGroup.Wait()
	close(sessionStartErrors)
	for err := range sessionStartErrors {
		if err != nil {
			t.Fatalf("persist concurrent session start: %v", err)
		}
	}
	var sessionStartCount int
	if err := pool.QueryRow(ctx, `
		select count(*)::int
		from public.site_analytics_events
		where organization_id = $1::uuid and session_id = $2 and event_type = 'session_start'
	`, organizationID, sessionStartID).Scan(&sessionStartCount); err != nil {
		t.Fatalf("count session starts: %v", err)
	}
	if sessionStartCount != 1 {
		t.Fatalf("concurrent session starts = %d, want 1", sessionStartCount)
	}

	first := trackingTestEvent("page_duration", 7)
	first.organizationID = organizationID
	first.sessionID = sessionID
	first.metadataRaw = trackingMetadata(t, 7, "first")
	second := trackingTestEvent("page_duration", 11)
	second.organizationID = organizationID
	second.sessionID = sessionID
	second.metadataRaw = trackingMetadata(t, 11, "second")

	var heartbeatWaitGroup sync.WaitGroup
	heartbeatErrors := make(chan error, 2)
	for _, heartbeat := range []publicTrackingEventWrite{first, second} {
		heartbeatWaitGroup.Add(1)
		go func(event publicTrackingEventWrite) {
			defer heartbeatWaitGroup.Done()
			heartbeatErrors <- persistPublicTrackingEvent(ctx, pool, event)
		}(heartbeat)
	}
	heartbeatWaitGroup.Wait()
	close(heartbeatErrors)
	for err := range heartbeatErrors {
		if err != nil {
			t.Fatalf("persist concurrent heartbeat: %v", err)
		}
	}

	var rowCount, totalDuration, metadataDuration int
	var metadataMarker string
	if err := pool.QueryRow(ctx, `
		select count(*)::int,
		       coalesce(sum(duration_seconds), 0)::int,
		       coalesce(max((metadata->>'duration_seconds')::int), 0),
		       coalesce(max(metadata->>'marker'), '')
		from public.site_analytics_events
		where organization_id = $1::uuid
		  and session_id = $2
		  and page_path = $3
		  and event_type = 'page_duration'
	`, organizationID, sessionID, first.pagePath).Scan(
		&rowCount,
		&totalDuration,
		&metadataDuration,
		&metadataMarker,
	); err != nil {
		t.Fatalf("read accumulated duration: %v", err)
	}
	if rowCount != 1 || totalDuration != 18 || metadataDuration != 18 {
		t.Fatalf(
			"two concurrent heartbeats produced rows=%d total=%d metadata_duration=%d marker=%q",
			rowCount,
			totalDuration,
			metadataDuration,
			metadataMarker,
		)
	}

	var immutableCreatedAt time.Time
	if err := pool.QueryRow(ctx, `
		select created_at
		from public.site_analytics_events
		where organization_id = $1::uuid and session_id = $2 and event_type = 'page_duration'
	`, organizationID, sessionID).Scan(&immutableCreatedAt); err != nil {
		t.Fatalf("read immutable event time: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		update public.site_analytics_events
		set last_seen_at = now() - interval '10 minutes',
		    metadata = metadata || '{"gclid":"legacy-google-id","fbclid":"legacy-facebook-id"}'::jsonb
		where organization_id = $1::uuid and session_id = $2 and event_type = 'page_duration'
	`, organizationID, sessionID); err != nil {
		t.Fatalf("age heartbeat fixture: %v", err)
	}
	activityRefresh := trackingTestEvent("page_duration", 1)
	activityRefresh.organizationID = organizationID
	activityRefresh.sessionID = sessionID
	activityRefresh.metadataRaw = trackingMetadata(t, 1, "activity-refresh")
	if err := persistPublicTrackingEvent(ctx, pool, activityRefresh); err != nil {
		t.Fatalf("persist activity refresh heartbeat: %v", err)
	}
	var refreshedRecently, createdAtUnchanged bool
	if err := pool.QueryRow(ctx, `
		select bool_and(last_seen_at >= now() - interval '1 minute'),
		       bool_and(created_at = $3::timestamptz)
		from public.site_analytics_events
		where organization_id = $1::uuid and session_id = $2 and event_type = 'page_duration'
	`, organizationID, sessionID, immutableCreatedAt).Scan(&refreshedRecently, &createdAtUnchanged); err != nil {
		t.Fatalf("read refreshed heartbeat recency: %v", err)
	}
	if !refreshedRecently {
		t.Fatal("duration heartbeat did not refresh live-visitor recency")
	}
	if !createdAtUnchanged {
		t.Fatal("duration heartbeat changed immutable event time")
	}
	var refreshedKeepsSignals, refreshedOmitsRawIDs bool
	if err := pool.QueryRow(ctx, `
		select metadata->>'google_ads_click' = 'true'
		       and metadata->>'facebook_click' = 'true',
		       not metadata ? 'gclid' and not metadata ? 'fbclid'
		from public.site_analytics_events
		where organization_id = $1::uuid and session_id = $2 and event_type = 'page_duration'
	`, organizationID, sessionID).Scan(&refreshedKeepsSignals, &refreshedOmitsRawIDs); err != nil {
		t.Fatalf("read refreshed heartbeat attribution: %v", err)
	}
	if !refreshedKeepsSignals || !refreshedOmitsRawIDs {
		t.Fatalf(
			"refreshed heartbeat attribution keep_signals=%t omit_raw_ids=%t, want both true",
			refreshedKeepsSignals,
			refreshedOmitsRawIDs,
		)
	}

	capped := trackingTestEvent("page_duration", maxPublicPageDurationSeconds)
	capped.organizationID = organizationID
	capped.sessionID = sessionID
	capped.metadataRaw = trackingMetadata(t, maxPublicPageDurationSeconds, "capped")
	if err := persistPublicTrackingEvent(ctx, pool, capped); err != nil {
		t.Fatalf("persist capped heartbeat: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		select count(*)::int, coalesce(sum(duration_seconds), 0)::int,
		       coalesce(max((metadata->>'duration_seconds')::int), 0)
		from public.site_analytics_events
		where organization_id = $1::uuid
		  and session_id = $2
		  and page_path = $3
		  and event_type = 'page_duration'
	`, organizationID, sessionID, first.pagePath).Scan(
		&rowCount,
		&totalDuration,
		&metadataDuration,
	); err != nil {
		t.Fatalf("read capped duration: %v", err)
	}
	if rowCount != 1 || totalDuration != maxPublicPageDurationSeconds || metadataDuration != maxPublicPageDurationSeconds {
		t.Fatalf(
			"duration cap produced rows=%d total=%d metadata_duration=%d",
			rowCount,
			totalDuration,
			metadataDuration,
		)
	}

	pageView := trackingTestEvent("pageview", 0)
	pageView.organizationID = organizationID
	pageView.sessionID = sessionID
	if err := persistPublicTrackingEvent(ctx, pool, pageView); err != nil {
		t.Fatalf("persist first pageview: %v", err)
	}
	if err := persistPublicTrackingEvent(ctx, pool, pageView); err != nil {
		t.Fatalf("persist second pageview: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		select count(*)::int
		from public.site_analytics_events
		where organization_id = $1::uuid and session_id = $2 and event_type = 'pageview'
	`, organizationID, sessionID).Scan(&rowCount); err != nil {
		t.Fatalf("count pageviews: %v", err)
	}
	if rowCount != 2 {
		t.Fatalf("append-only pageviews = %d, want 2", rowCount)
	}

	previousWindow := trackingTestEvent("page_duration", 7)
	previousWindow.organizationID = organizationID
	previousWindow.sessionID = previousWindowSessionID
	previousWindow.metadataRaw = trackingMetadata(t, 7, "previous-window")
	attributionSource := trackingTestEvent("pageview", 0)
	attributionSource.organizationID = organizationID
	attributionSource.sessionID = previousWindowSessionID
	attributionSource.metadataRaw = `{"gclid":"legacy-google-id","fbclid":"legacy-facebook-id"}`
	if err := persistPublicTrackingEvent(ctx, pool, attributionSource); err != nil {
		t.Fatalf("persist attribution source: %v", err)
	}
	if err := persistPublicTrackingEvent(ctx, pool, previousWindow); err != nil {
		t.Fatalf("persist previous-window heartbeat: %v", err)
	}
	var databaseNow time.Time
	var organizationTimezone string
	if err := pool.QueryRow(ctx, `
		select now(), coalesce(
		  (
		    select nullif(btrim(settings.timezone), '')
		    from public.organization_attention_settings as settings
		    where settings.organization_id = $1::uuid
		  ),
		  'America/Sao_Paulo'
		)
	`, organizationID).Scan(&databaseNow, &organizationTimezone); err != nil {
		t.Fatalf("read organization tracking clock: %v", err)
	}
	location, err := time.LoadLocation(organizationTimezone)
	if err != nil {
		t.Fatalf("load organization timezone %q: %v", organizationTimezone, err)
	}
	localNow := databaseNow.In(location)
	dayStart := time.Date(
		localNow.Year(),
		localNow.Month(),
		localNow.Day(),
		0,
		0,
		0,
		0,
		location,
	)
	windowStart := dayStart.Add(
		time.Duration(databaseNow.Sub(dayStart)/time.Hour) * time.Hour,
	)
	if _, err := pool.Exec(ctx, `
		update public.site_analytics_events
		set created_at = $3::timestamptz - interval '1 second',
		    last_seen_at = $3::timestamptz - interval '1 second'
		where organization_id = $1::uuid
		  and session_id = $2
		  and event_type = 'page_duration'
	`, organizationID, previousWindowSessionID, windowStart); err != nil {
		t.Fatalf("move heartbeat to previous aggregation window: %v", err)
	}

	currentWindow := trackingTestEvent("page_duration", 11)
	currentWindow.organizationID = organizationID
	currentWindow.sessionID = previousWindowSessionID
	currentWindow.metadataRaw = trackingMetadata(t, 11, "current-window")
	if err := persistPublicTrackingEvent(ctx, pool, currentWindow); err != nil {
		t.Fatalf("persist current-window heartbeat: %v", err)
	}

	var oldDuration, newDuration int
	if err := pool.QueryRow(ctx, `
		select count(*)::int,
		       coalesce(max(duration_seconds) filter (where created_at < $4::timestamptz), 0)::int,
		       coalesce(max(duration_seconds) filter (where created_at >= $4::timestamptz), 0)::int
		from public.site_analytics_events
		where organization_id = $1::uuid
		  and session_id = $2
		  and page_path = $3
		  and event_type = 'page_duration'
	`, organizationID, previousWindowSessionID, previousWindow.pagePath, windowStart).Scan(
		&rowCount,
		&oldDuration,
		&newDuration,
	); err != nil {
		t.Fatalf("read stable duration windows: %v", err)
	}
	if rowCount != 2 || oldDuration != 7 || newDuration != 11 {
		t.Fatalf(
			"duration windows rows=%d old=%d new=%d, want rows=2 old=7 new=11",
			rowCount,
			oldDuration,
			newDuration,
		)
	}
	var durationRowsKeepSignals, durationRowsOmitRawIDs bool
	if err := pool.QueryRow(ctx, `
		select bool_and(
		         metadata->>'google_ads_click' = 'true'
		         and metadata->>'facebook_click' = 'true'
		       ),
		       bool_and(not metadata ? 'gclid' and not metadata ? 'fbclid')
		from public.site_analytics_events
		where organization_id = $1::uuid
		  and session_id = $2
		  and event_type = 'page_duration'
	`, organizationID, previousWindowSessionID).Scan(
		&durationRowsKeepSignals,
		&durationRowsOmitRawIDs,
	); err != nil {
		t.Fatalf("read duration attribution signals: %v", err)
	}
	if !durationRowsKeepSignals || !durationRowsOmitRawIDs {
		t.Fatalf(
			"duration attribution privacy keep_signals=%t omit_raw_ids=%t, want both true",
			durationRowsKeepSignals,
			durationRowsOmitRawIDs,
		)
	}
}

func trackingTestEvent(eventType string, duration int) publicTrackingEventWrite {
	var persistedDuration any
	if duration > 0 {
		persistedDuration = duration
	}
	return publicTrackingEventWrite{
		organizationID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
		eventType:      eventType,
		pagePath:       "/imoveis/teste",
		sessionID:      "tracking-test-session",
		duration:       persistedDuration,
		metadataRaw:    `{}`,
	}
}

func trackingMetadata(t *testing.T, duration int, marker string) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"duration_seconds": duration,
		"marker":           marker,
	})
	if err != nil {
		t.Fatalf("marshal metadata: %v", err)
	}
	return string(raw)
}
