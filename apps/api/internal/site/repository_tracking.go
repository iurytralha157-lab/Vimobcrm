package site

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/publicingress"
)

const maxPublicPageDurationSeconds = 24 * 60 * 60

type publicTrackingEventWrite struct {
	organizationID string
	eventType      string
	pagePath       string
	pageTitle      any
	referrer       any
	sessionID      string
	deviceType     any
	browser        any
	screenWidth    *int
	screenHeight   *int
	utmSource      any
	utmMedium      any
	utmCampaign    any
	propertyID     any
	duration       any
	metadataRaw    string
}

type publicSessionStartStore interface {
	execer
	siteQueryer
}

func (repo Repository) CreatePublicTrackingEvent(ctx context.Context, request PublicTrackingRequest) error {
	if !validatePublicTrackingRequest(request, request.LocationEnriched) {
		return ErrInvalidInput
	}
	organizationID, ok := normalizeUUID(request.OrganizationID)
	if !ok {
		return ErrInvalidInput
	}
	if err := repo.ensurePublicSiteActive(ctx, organizationID); err != nil {
		return err
	}
	eventType := request.EventType
	pagePath := sanitizePublicPagePath(request.PagePath)
	request.Referrer = sanitizePublicNavigationPointer(request.Referrer, 2000)
	sessionID := strings.TrimSpace(optionalStringValue(request.SessionID))
	metadata := sanitizePublicTrackingMetadata(eventType, request.Metadata, request.LocationEnriched)
	addPublicTrackingAttributionSignals(metadata, request)
	metadataRaw := jsonb(metadata)
	if len(metadataRaw) > 16*1024 {
		return ErrInvalidInput
	}
	var duration any
	if eventType == "page_duration" {
		durationSeconds, hasDuration := metadataDuration(metadata)
		if !hasDuration {
			return ErrInvalidInput
		}
		duration = durationSeconds
	}

	allowed, err := publicingress.Allow(
		ctx,
		repo.db.Pool(),
		"site_tracking",
		[]string{organizationID, request.ClientIP},
		240,
		time.Minute,
	)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrPublicRateLimited
	}

	var propertyID any
	if request.PropertyID != nil && strings.TrimSpace(*request.PropertyID) != "" {
		normalizedPropertyID, ok := normalizeUUID(*request.PropertyID)
		if !ok {
			return ErrInvalidInput
		}
		var valid bool
		if err := repo.db.Pool().QueryRow(ctx, `
			select exists(select 1 from public.properties as p
			  where p.id = $1::uuid and p.organization_id = $2::uuid
			    and `+publicPropertyStandaloneEligibilitySQL("p")+`
			    and `+publicPropertyActiveSQL()+`)
		`, normalizedPropertyID, organizationID).Scan(&valid); err != nil {
			return err
		}
		if !valid {
			return ErrInvalidInput
		}
		propertyID = normalizedPropertyID
	}

	var recent int
	if err := repo.db.Pool().QueryRow(ctx, `
		select count(*) from public.site_analytics_events
		where organization_id = $1::uuid and session_id = $2
		  and created_at >= now() - interval '1 minute'
	`, organizationID, sessionID).Scan(&recent); err != nil {
		return err
	}
	if recent >= 120 {
		return ErrPublicRateLimited
	}

	return persistPublicTrackingEvent(ctx, repo.db.Pool(), publicTrackingEventWrite{
		organizationID: organizationID,
		eventType:      eventType,
		pagePath:       pagePath,
		pageTitle:      optionalText(request.PageTitle),
		referrer:       optionalText(request.Referrer),
		sessionID:      sessionID,
		deviceType:     optionalText(request.DeviceType),
		browser:        optionalText(request.Browser),
		screenWidth:    request.ScreenWidth,
		screenHeight:   request.ScreenHeight,
		utmSource:      optionalText(request.UTMSource),
		utmMedium:      optionalText(request.UTMMedium),
		utmCampaign:    optionalText(request.UTMCampaign),
		propertyID:     propertyID,
		duration:       duration,
		metadataRaw:    metadataRaw,
	})
}

func persistPublicTrackingEvent(ctx context.Context, db *pgxpool.Pool, event publicTrackingEventWrite) error {
	if event.eventType == "page_duration" {
		return accumulatePublicPageDuration(ctx, db, event)
	}
	if event.eventType == "session_start" {
		return appendPublicSessionStart(ctx, db, event)
	}
	return appendPublicTrackingEvent(ctx, db, event)
}

func appendPublicSessionStart(ctx context.Context, db *pgxpool.Pool, event publicTrackingEventWrite) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	if err := ensurePublicSessionStart(ctx, tx, event); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func ensurePublicSessionStart(ctx context.Context, db publicSessionStartStore, event publicTrackingEventWrite) error {
	if _, err := db.Exec(ctx, `
		select pg_advisory_xact_lock(
			hashtextextended($1::text || chr(31) || $2::text, 0)
		)
	`, event.organizationID, event.sessionID); err != nil {
		return err
	}

	var exists bool
	if err := db.QueryRow(ctx, `
		select exists(
			select 1
			from public.site_analytics_events
			where organization_id = $1::uuid
			  and session_id = $2
			  and event_type = 'session_start'
		)
	`, event.organizationID, event.sessionID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		if err := appendPublicTrackingEvent(ctx, db, event); err != nil {
			return err
		}
	}
	return nil
}

func appendPublicTrackingEvent(ctx context.Context, db execer, event publicTrackingEventWrite) error {
	_, err := db.Exec(ctx, `
		insert into public.site_analytics_events (
			organization_id,
			event_type,
			page_path,
			page_title,
			referrer,
			session_id,
			device_type,
			browser,
			screen_width,
			screen_height,
			utm_source,
			utm_medium,
			utm_campaign,
			property_id,
			lead_id,
			duration_seconds,
			metadata
		)
		values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::uuid, $15::uuid, $16, $17::jsonb)
	`, trackingEventArguments(event)...)
	return err
}

func accumulatePublicPageDuration(ctx context.Context, db *pgxpool.Pool, event publicTrackingEventWrite) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	// The lock must be acquired in a separate statement. Under READ COMMITTED,
	// the following statement gets a fresh snapshot and sees a concurrent first
	// heartbeat that committed while this transaction waited for the lock.
	if _, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(
			hashtextextended(
				$1::text || chr(31) || $2::text || chr(31) || $3::text,
				0
			)
		)
	`, event.organizationID, event.sessionID, event.pagePath); err != nil {
		return err
	}

	arguments := append(trackingEventArguments(event), maxPublicPageDurationSeconds)
	if _, err := tx.Exec(ctx, `
		with tracking_timezone as materialized (
			select coalesce(
				(
					select nullif(btrim(settings.timezone), '')
					from public.organization_attention_settings as settings
					where settings.organization_id = $1::uuid
				),
				'America/Sao_Paulo'
			) as timezone_name
		), local_day as materialized (
			select
				date_trunc('day', now() at time zone timezone_name)
					at time zone timezone_name as starts_at
			from tracking_timezone
		), duration_window as materialized (
			select
				starts_at
				+ floor(extract(epoch from (now() - starts_at)) / 3600)
					* interval '1 hour' as starts_at
			from local_day
		), session_attribution as materialized (
			select
				coalesce(bool_or(
					metadata->>'google_ads_click' = 'true'
					or nullif(btrim(metadata->>'gclid'), '') is not null
				), false) as google_ads_click,
				coalesce(bool_or(
					metadata->>'facebook_click' = 'true'
					or nullif(btrim(metadata->>'fbclid'), '') is not null
				), false) as facebook_click
			from public.site_analytics_events
			where organization_id = $1::uuid
			  and session_id = $6
		), attribution_metadata as materialized (
			select
				($17::jsonb - 'gclid' - 'fbclid')
				|| case when google_ads_click
					then '{"google_ads_click":true}'::jsonb else '{}'::jsonb end
				|| case when facebook_click
					then '{"facebook_click":true}'::jsonb else '{}'::jsonb end as value
			from session_attribution
		), latest_duration as materialized (
			select analytics_event.id
			from public.site_analytics_events as analytics_event
			where analytics_event.organization_id = $1::uuid
			  and analytics_event.session_id = $6
			  and analytics_event.page_path = $3
			  and analytics_event.event_type = 'page_duration'
			  and analytics_event.created_at >= (select starts_at from duration_window)
			order by analytics_event.created_at desc, analytics_event.id desc
			limit 1
			for update of analytics_event
		), updated_duration as (
			update public.site_analytics_events as analytics_event
			set last_seen_at = now(),
				duration_seconds = least(
					$18,
					coalesce(analytics_event.duration_seconds, 0) + $16
				),
				metadata = jsonb_set(
					(coalesce(analytics_event.metadata, '{}'::jsonb) - 'gclid' - 'fbclid')
						|| ((select value from attribution_metadata) - 'duration_seconds'),
					'{duration_seconds}',
					to_jsonb(least(
						$18,
						coalesce(analytics_event.duration_seconds, 0) + $16
					)),
					true
				)
			where analytics_event.id = (select id from latest_duration)
			returning analytics_event.id
		)
		insert into public.site_analytics_events (
			organization_id,
			event_type,
			page_path,
			page_title,
			referrer,
			session_id,
			device_type,
			browser,
			screen_width,
			screen_height,
			utm_source,
			utm_medium,
			utm_campaign,
			property_id,
			lead_id,
			duration_seconds,
			metadata,
			last_seen_at
		)
		select $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::uuid, $15::uuid, $16,
		       (select value from attribution_metadata), now()
		where not exists (select 1 from updated_duration)
	`, arguments...); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func trackingEventArguments(event publicTrackingEventWrite) []any {
	return []any{
		event.organizationID,
		event.eventType,
		event.pagePath,
		event.pageTitle,
		event.referrer,
		event.sessionID,
		event.deviceType,
		event.browser,
		event.screenWidth,
		event.screenHeight,
		event.utmSource,
		event.utmMedium,
		event.utmCampaign,
		event.propertyID,
		nil,
		event.duration,
		event.metadataRaw,
	}
}

func isAllowedPublicTrackingEvent(eventType string) bool {
	switch eventType {
	case "pageview", "page_view", "session_start", "page_duration", "property_search", "property_view", "favorite", "whatsapp_click", "cta_click":
		return true
	default:
		return false
	}
}

func validatePublicTrackingRequest(request PublicTrackingRequest, locationEnriched bool) bool {
	if _, ok := normalizeUUID(request.OrganizationID); !ok {
		return false
	}
	if !isAllowedPublicTrackingEvent(request.EventType) {
		return false
	}
	if strings.TrimSpace(request.PagePath) == "" || len([]rune(strings.TrimSpace(request.PagePath))) > 2000 {
		return false
	}
	if !validOptionalTrimmedText(request.PageTitle, 300) ||
		!validOptionalTrimmedText(request.Referrer, 2000) ||
		!validRequiredTrimmedText(request.SessionID, 1, 160) ||
		!validOptionalTrimmedText(request.UTMSource, 300) ||
		!validOptionalTrimmedText(request.UTMMedium, 300) ||
		!validOptionalTrimmedText(request.UTMCampaign, 300) ||
		!validOptionalTrimmedText(request.GCLID, 300) ||
		!validOptionalTrimmedText(request.FBCLID, 300) {
		return false
	}
	if strings.HasPrefix(strings.TrimSpace(optionalStringValue(request.SessionID)), publicContactSubmissionSessionPrefix) {
		return false
	}
	if request.PropertyID != nil {
		if _, ok := normalizeUUID(*request.PropertyID); !ok {
			return false
		}
	}
	if request.DeviceType != nil {
		switch *request.DeviceType {
		case "desktop", "mobile", "tablet":
		default:
			return false
		}
	}
	if request.Browser != nil {
		switch *request.Browser {
		case "chrome", "firefox", "safari", "edge", "other":
		default:
			return false
		}
	}
	if request.ScreenWidth != nil && (*request.ScreenWidth < 0 || *request.ScreenWidth > 100000) {
		return false
	}
	if request.ScreenHeight != nil && (*request.ScreenHeight < 0 || *request.ScreenHeight > 100000) {
		return false
	}
	return validatePublicTrackingMetadata(request.EventType, request.Metadata, locationEnriched)
}

func validatePublicTrackingMetadata(eventType string, metadata map[string]any, locationEnriched bool) bool {
	if raw, err := json.Marshal(metadata); err != nil || len(raw) > 16*1024 {
		return false
	}
	for key, value := range metadata {
		switch key {
		case "os":
			if !validPublicTrackingMetadataText(value, 80) {
				return false
			}
		case "timezone":
			if !validPublicTrackingMetadataText(value, 100) {
				return false
			}
		case "duration_seconds":
			if eventType != "page_duration" {
				return false
			}
			if _, ok := metadataDuration(metadata); !ok {
				return false
			}
		case "filters":
			if eventType != "property_search" || !validatePublicTrackingFilters(value) {
				return false
			}
		case "action":
			if (eventType != "cta_click" && eventType != "whatsapp_click") || !validPublicTrackingMetadataText(value, 120) {
				return false
			}
		case "placement":
			if (eventType != "cta_click" && eventType != "whatsapp_click") || !validPublicTrackingMetadataText(value, 80) {
				return false
			}
		case "city", "region", "country":
			if !locationEnriched || !validPublicTrackingMetadataText(value, 120) {
				return false
			}
		case "lat":
			coordinate, ok := value.(float64)
			if !locationEnriched || !ok || coordinate < -90 || coordinate > 90 {
				return false
			}
		case "lng":
			coordinate, ok := value.(float64)
			if !locationEnriched || !ok || coordinate < -180 || coordinate > 180 {
				return false
			}
		default:
			return false
		}
	}
	if eventType == "page_duration" {
		_, ok := metadataDuration(metadata)
		return ok
	}
	return true
}

func addPublicTrackingAttributionSignals(target map[string]any, request PublicTrackingRequest) {
	if strings.TrimSpace(optionalStringValue(request.GCLID)) != "" {
		target["google_ads_click"] = true
	}
	if strings.TrimSpace(optionalStringValue(request.FBCLID)) != "" {
		target["facebook_click"] = true
	}
}

func validatePublicTrackingFilters(value any) bool {
	filters, ok := value.(map[string]any)
	if !ok {
		return false
	}
	for key, value := range filters {
		allowed := false
		for _, candidate := range publicTrackingFilterKeys {
			if key == candidate {
				allowed = true
				break
			}
		}
		if !allowed || !validPublicTrackingMetadataText(value, 300) {
			return false
		}
	}
	return true
}

func validPublicTrackingMetadataText(value any, maximumRunes int) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	text = strings.TrimSpace(text)
	return text != "" && len([]rune(text)) <= maximumRunes
}

func metadataDuration(metadata map[string]any) (int, bool) {
	value, ok := metadata["duration_seconds"]
	if !ok {
		return 0, false
	}
	switch typed := value.(type) {
	case float64:
		if typed >= 1 && typed <= maxPublicPageDurationSeconds && math.Trunc(typed) == typed {
			return int(typed), true
		}
	case int:
		if typed >= 1 && typed <= maxPublicPageDurationSeconds {
			return typed, true
		}
	}
	return 0, false
}

func sanitizePublicTrackingClientMetadata(eventType string, metadata map[string]any) map[string]any {
	sanitized := map[string]any{}
	copyPublicTrackingText(sanitized, metadata, "os", 80)
	copyPublicTrackingText(sanitized, metadata, "timezone", 100)

	switch strings.TrimSpace(eventType) {
	case "page_duration":
		if duration, ok := metadataDuration(metadata); ok {
			sanitized["duration_seconds"] = duration
		}
	case "property_search":
		filters := sanitizePublicTrackingFilters(metadata["filters"])
		if len(filters) > 0 {
			sanitized["filters"] = filters
			if search, ok := filters["search"].(string); ok {
				sanitized["search_term"] = search
			}
		}
	case "cta_click", "whatsapp_click":
		copyPublicTrackingText(sanitized, metadata, "action", 120)
		copyPublicTrackingText(sanitized, metadata, "placement", 80)
	}
	return sanitized
}

func sanitizePublicTrackingMetadata(eventType string, metadata map[string]any, locationEnriched bool) map[string]any {
	sanitized := sanitizePublicTrackingClientMetadata(eventType, metadata)
	if !locationEnriched {
		return sanitized
	}

	copyPublicTrackingText(sanitized, metadata, "city", 120)
	copyPublicTrackingText(sanitized, metadata, "region", 120)
	copyPublicTrackingText(sanitized, metadata, "country", 120)
	if latitude, ok := metadata["lat"].(float64); ok && latitude >= -90 && latitude <= 90 {
		sanitized["lat"] = latitude
	}
	if longitude, ok := metadata["lng"].(float64); ok && longitude >= -180 && longitude <= 180 {
		sanitized["lng"] = longitude
	}
	return sanitized
}

func sanitizePublicTrackingFilters(rawFilters any) map[string]any {
	filters, ok := rawFilters.(map[string]any)
	if !ok {
		return nil
	}
	allowedFilters := make(map[string]any, len(publicTrackingFilterKeys))
	for _, key := range publicTrackingFilterKeys {
		copyPublicTrackingText(allowedFilters, filters, key, 300)
	}
	return allowedFilters
}

func copyPublicTrackingText(destination map[string]any, source map[string]any, key string, maximumRunes int) {
	value, ok := source[key].(string)
	value = strings.TrimSpace(value)
	if !ok || value == "" {
		return
	}
	runes := []rune(value)
	if len(runes) > maximumRunes {
		value = string(runes[:maximumRunes])
	}
	destination[key] = value
}

var publicTrackingFilterKeys = [...]string{
	"search",
	"cidade",
	"bairro",
	"tipo",
	"finalidade",
	"min_price",
	"max_price",
	"quartos",
	"suites",
	"banheiros",
	"vagas",
}

func jsonb(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return `{}`
	}
	return string(raw)
}
