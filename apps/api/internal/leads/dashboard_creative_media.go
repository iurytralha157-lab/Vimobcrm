package leads

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/meta"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var dashboardCreativeMediaKeyPattern = regexp.MustCompile(`^(creative|ad):[0-9]{1,32}$`)
var dashboardCreativeMediaLookupSlots = make(chan struct{}, 2)

type dashboardCreativeMediaResolver interface {
	ResolveDashboardCreativeMedia(context.Context, string, string, string) meta.DashboardCreativeMedia
}

type dashboardCreativeMediaCandidate struct {
	creativeID   string
	adID         string
	thumbnailURL *string
	imageURL     *string
}

func (handler Handler) WithDashboardCreativeMediaResolver(resolver dashboardCreativeMediaResolver) Handler {
	handler.creativeMediaResolver = resolver
	return handler
}

// ShowDashboardCreativeMedia is only called after a recorded thumbnail fails in
// the browser. It checks the same visible-card and entry filters as the creative
// ranking, but looks for one key rather than aggregating all creatives again.
func (handler Handler) ShowDashboardCreativeMedia(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := dashboardTenantContext(w, r)
	if !ok {
		return
	}
	filter, err := ParseDashboardFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	key := strings.TrimSpace(r.URL.Query().Get("key"))
	if !dashboardCreativeMediaKeyPattern.MatchString(key) {
		writeLeadError(w, r, ErrInvalidInput)
		return
	}
	// Serializing the short existence lookup prevents a burst of failed browser
	// images from occupying every database connection in a local preview.
	select {
	case dashboardCreativeMediaLookupSlots <- struct{}{}:
		defer func() { <-dashboardCreativeMediaLookupSlots }()
	case <-r.Context().Done():
		return
	}

	lookupCtx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	candidate, found, err := handler.repo.FindVisibleDashboardCreativeMediaKey(lookupCtx, tenantContext, filter, key)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	if !found {
		httpserver.WriteError(w, r, http.StatusNotFound, "creative_not_found", "Creative not found in the visible dashboard results.")
		return
	}

	media := meta.DashboardCreativeMedia{}
	if handler.creativeMediaResolver != nil {
		media = handler.creativeMediaResolver.ResolveDashboardCreativeMedia(r.Context(), tenantContext.OrganizationID, candidate.creativeID, candidate.adID)
	}
	// If Meta cannot return a current URL, a later arrival for the same
	// filtered creative may still carry a different usable snapshot. This is
	// only a link fallback; it never changes lead or campaign attribution.
	if media.ThumbnailURL == nil {
		media.ThumbnailURL = dashboardBestThumbnailURL(candidate.thumbnailURL, candidate.imageURL)
		media.ImageURL = candidate.imageURL
	}
	w.Header().Set("Cache-Control", "private, no-store")
	httpserver.WriteJSON(w, http.StatusOK, map[string]meta.DashboardCreativeMedia{"data": media})
}

func (repo Repository) FindVisibleDashboardCreativeMediaKey(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter, key string) (dashboardCreativeMediaCandidate, bool, error) {
	query, args, err := repo.buildDashboardCreativeMediaKeyQuery(tenantContext, filter, key)
	if err != nil {
		return dashboardCreativeMediaCandidate{}, false, err
	}
	var creativeID, adID, thumbnailURL, imageURL pgtype.Text
	err = repo.db.Pool().QueryRow(ctx, query, args...).Scan(&creativeID, &adID, &thumbnailURL, &imageURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return dashboardCreativeMediaCandidate{}, false, nil
	}
	if err != nil {
		return dashboardCreativeMediaCandidate{}, false, err
	}
	return dashboardCreativeMediaCandidate{
		creativeID: creativeID.String, adID: adID.String,
		thumbnailURL: dashboardSafeHistoricalMediaURL(pipelineTextPtr(thumbnailURL)),
		imageURL:     dashboardSafeHistoricalMediaURL(pipelineTextPtr(imageURL)),
	}, true, nil
}

func dashboardSafeHistoricalMediaURL(raw *string) *string {
	safe := dashboardSafeCreativeURL(raw)
	if safe == nil {
		return nil
	}
	parsed, err := url.Parse(*safe)
	if err != nil || parsed.Port() != "" {
		return nil
	}
	for key := range parsed.Query() {
		lower := strings.ToLower(key)
		if strings.Contains(lower, "token") || strings.Contains(lower, "secret") || strings.Contains(lower, "proof") {
			return nil
		}
	}
	return safe
}

func (repo Repository) buildDashboardCreativeMediaKeyQuery(tenantContext tenant.Context, filter DashboardFilter, key string) (string, []any, error) {
	if !dashboardCreativeMediaKeyPattern.MatchString(key) {
		return "", nil, ErrInvalidInput
	}
	cte, entryWhere, args, err := repo.buildDashboardEntriesCTE(tenantContext, filter)
	if err != nil {
		return "", nil, err
	}
	parts := strings.SplitN(key, ":", 2)
	args = append(args, parts[1])
	keyClause := fmt.Sprintf("entry.creative_id = $%d", len(args))
	if parts[0] == "ad" {
		keyClause = fmt.Sprintf("entry.creative_id is null and entry.ad_id = $%d", len(args))
	}
	query := cte + `
		select entry.creative_id, entry.ad_id,
			entry.creative_thumbnail_url, entry.creative_url
		from entries entry
		where ` + entryWhere + `
		  and (lower(entry.provider) = 'meta'
		       or (lower(entry.meta_source_type) = 'meta_lead_ads' and entry.meta_leadgen_id is not null))
		  and ` + keyClause + `
		order by (entry.creative_thumbnail_url is not null or entry.creative_url is not null) desc,
			entry.occurred_at desc, entry.entry_id desc
		limit 1
	`
	return query, args, nil
}
