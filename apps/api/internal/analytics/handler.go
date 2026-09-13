package analytics

import (
	"errors"
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
	if err != nil {
		status, code, message := marketingAnalyticsErrorResponse(err)
		httpserver.WriteError(w, r, status, code, message)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]map[string]any{"data": item})
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
	item, err := handler.repo.LeadAnalytics(r.Context(), mustTenant(w, r), r.URL.Query())
	handler.writeObject(w, r, item, err)
}

func (handler Handler) SiteSummary(w http.ResponseWriter, r *http.Request) {
	item, err := handler.repo.SiteSummary(r.Context(), mustTenant(w, r), r.URL.Query())
	handler.writeObject(w, r, item, err)
}

func (handler Handler) SiteDetailed(w http.ResponseWriter, r *http.Request) {
	item, err := handler.repo.SiteDetailed(r.Context(), mustTenant(w, r), r.URL.Query())
	handler.writeObject(w, r, item, err)
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
		if errors.Is(err, ErrInvalidInput) {
			httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_analytics_filters", "Analytics filters are invalid.")
			return
		}
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
