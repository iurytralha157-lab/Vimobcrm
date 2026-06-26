package leads

import (
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (handler Handler) ShowDashboardStats(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParseDashboardFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	stats, err := handler.repo.GetDashboardStats(r.Context(), tenantContext, filter)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]DashboardStats{"data": stats})
}

func (handler Handler) ShowDashboardFunnel(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParseDashboardFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	data, err := handler.repo.GetDashboardFunnel(r.Context(), tenantContext, filter)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]FunnelDataPoint{"data": data})
}

func (handler Handler) ShowDashboardSources(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParseDashboardFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	data, err := handler.repo.GetDashboardSources(r.Context(), tenantContext, filter)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]SourceDataPoint{"data": data})
}

func (handler Handler) ShowDashboardTopBrokers(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParseDashboardFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	data, err := handler.repo.GetDashboardTopBrokers(r.Context(), tenantContext, filter)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]TopBrokersResult{"data": data})
}

func (handler Handler) ListDashboardUpcomingTasks(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParseDashboardFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	data, err := handler.repo.GetDashboardUpcomingTasks(r.Context(), tenantContext, filter)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]UpcomingTask{"data": data})
}

func (handler Handler) ShowDashboardDealsEvolution(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParseDashboardFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	data, err := handler.repo.GetDashboardDealsEvolution(r.Context(), tenantContext, filter)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]DealsEvolutionPoint{"data": data})
}

func (handler Handler) ShowDashboardExtraCounts(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParseDashboardFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	data, err := handler.repo.GetDashboardExtraCounts(r.Context(), tenantContext, filter)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]DashboardExtraCounts{"data": data})
}

func (handler Handler) ListDashboardRecentActivities(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParseDashboardFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	data, err := handler.repo.GetDashboardRecentActivities(r.Context(), tenantContext, filter.Limit)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]RecentActivity{"data": data})
}

func (handler Handler) ListDashboardTeamLeadIDs(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParseDashboardFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	leadIDs, err := handler.repo.GetDashboardTeamLeadIDs(r.Context(), tenantContext, filter)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, DashboardTeamLeadIDsResponse{LeadIDs: leadIDs})
}
