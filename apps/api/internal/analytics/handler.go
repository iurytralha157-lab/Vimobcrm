package analytics

import (
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Handler struct {
	repo Repository
}

func NewHandler(repo Repository) Handler {
	return Handler{repo: repo}
}

func (handler Handler) MetaInsights(w http.ResponseWriter, r *http.Request) {
	items, err := handler.repo.MetaInsights(r.Context(), mustTenant(w, r), r.URL.Query())
	handler.writeRows(w, r, items, err)
}

func (handler Handler) CampaignInsights(w http.ResponseWriter, r *http.Request) {
	item, err := handler.repo.CampaignInsights(r.Context(), mustTenant(w, r), r.URL.Query())
	handler.writeObject(w, r, item, err)
}

func (handler Handler) EnterpriseKPIs(w http.ResponseWriter, r *http.Request) {
	item, err := handler.repo.EnterpriseKPIs(r.Context(), mustTenant(w, r), r.URL.Query())
	handler.writeObject(w, r, item, err)
}

func (handler Handler) DREExecutive(w http.ResponseWriter, r *http.Request) {
	item, err := handler.repo.DREExecutive(r.Context(), mustTenant(w, r), r.URL.Query())
	handler.writeObject(w, r, item, err)
}

func (handler Handler) SlaSummary(w http.ResponseWriter, r *http.Request) {
	item, err := handler.repo.SlaSummary(r.Context(), mustTenant(w, r), r.URL.Query())
	handler.writeObject(w, r, item, err)
}

func (handler Handler) SlaPerformanceByUser(w http.ResponseWriter, r *http.Request) {
	items, err := handler.repo.SlaPerformanceByUser(r.Context(), mustTenant(w, r), r.URL.Query())
	handler.writeRows(w, r, items, err)
}

func (handler Handler) TeamRanking(w http.ResponseWriter, r *http.Request) {
	item, err := handler.repo.TeamRanking(r.Context(), mustTenant(w, r), r.URL.Query())
	handler.writeObject(w, r, item, err)
}

func (handler Handler) VGVStats(w http.ResponseWriter, r *http.Request) {
	item, err := handler.repo.VGVStats(r.Context(), mustTenant(w, r), r.URL.Query())
	handler.writeObject(w, r, item, err)
}

func (handler Handler) VGVByBroker(w http.ResponseWriter, r *http.Request) {
	items, err := handler.repo.VGVByBroker(r.Context(), mustTenant(w, r), r.URL.Query())
	handler.writeRows(w, r, items, err)
}

func (handler Handler) StageVGV(w http.ResponseWriter, r *http.Request) {
	items, err := handler.repo.StageVGV(r.Context(), mustTenant(w, r), r.URL.Query())
	handler.writeRows(w, r, items, err)
}

func (handler Handler) LeaderStats(w http.ResponseWriter, r *http.Request) {
	items, err := handler.repo.LeaderStats(r.Context(), mustTenant(w, r))
	handler.writeRows(w, r, items, err)
}

func (handler Handler) TeamLeaderStats(w http.ResponseWriter, r *http.Request) {
	items, err := handler.repo.TeamLeaderStats(r.Context(), mustTenant(w, r), r.PathValue("teamId"))
	handler.writeRows(w, r, items, err)
}

func (handler Handler) LeadAnalytics(w http.ResponseWriter, r *http.Request) {
	httpserver.WriteJSON(w, http.StatusOK, map[string]any{"data": emptyLeadAnalytics()})
}

func (handler Handler) SiteSummary(w http.ResponseWriter, r *http.Request) {
	httpserver.WriteJSON(w, http.StatusOK, map[string]any{"data": emptySiteSummary()})
}

func (handler Handler) SiteDetailed(w http.ResponseWriter, r *http.Request) {
	httpserver.WriteJSON(w, http.StatusOK, map[string]any{"data": emptySiteDetailed()})
}

func (handler Handler) writeRows(w http.ResponseWriter, r *http.Request, items []map[string]any, err error) {
	if err != nil {
		httpserver.WriteError(w, r, http.StatusInternalServerError, "analytics_failed", "Unable to load analytics.")
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string][]map[string]any{"data": items})
}

func (handler Handler) writeObject(w http.ResponseWriter, r *http.Request, item map[string]any, err error) {
	if err != nil {
		httpserver.WriteError(w, r, http.StatusInternalServerError, "analytics_failed", "Unable to load analytics.")
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]map[string]any{"data": item})
}

func mustTenant(w http.ResponseWriter, r *http.Request) tenant.Context {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return tenant.Context{}
	}
	return tenantContext
}

func emptyLeadAnalytics() map[string]any {
	return map[string]any{
		"journeys":          []any{},
		"funnel":            []any{},
		"top_pages":         []any{},
		"daily_views":       []any{},
		"total_sessions":    0,
		"total_conversions": 0,
		"device_breakdown":  []any{},
		"locations":         []any{},
	}
}

func emptySiteSummary() map[string]any {
	return map[string]any{
		"totalViews":      0,
		"totalPages":      0,
		"uniquePages":     0,
		"uniqueSessions":  0,
		"avgDuration":     0,
		"desktopPct":      0,
		"mobilePct":       0,
		"tabletPct":       0,
		"directPct":       0,
		"searchPct":       0,
		"socialPct":       0,
		"campaignPct":     0,
		"conversions":     0,
		"prevViews":       0,
		"prevPages":       0,
		"prevUniquePages": 0,
		"prevAvgDuration": 0,
		"prevDesktopPct":  0,
		"prevMobilePct":   0,
		"prevConversions": 0,
	}
}

func emptySiteDetailed() map[string]any {
	return map[string]any{
		"topProperties":    []any{},
		"topPages":         []any{},
		"dailyViews":       []any{},
		"conversionRate":   0,
		"totalSessions":    0,
		"totalConversions": 0,
		"siteLeads":        0,
	}
}
