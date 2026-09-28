package leads

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (handler Handler) ShowPipelineBoard(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParsePipelineBoardFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	stages, err := handler.repo.GetPipelineBoard(r.Context(), tenantContext, filter)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]PipelineBoardStage{"data": stages})
}

func (handler Handler) ListPipelineStageLeads(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParsePipelineBoardFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	response, err := handler.repo.ListPipelineStageLeads(r.Context(), tenantContext, filter)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, response)
}

func (handler Handler) ListPipelineStageCounts(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParsePipelineBoardFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	counts, err := handler.repo.CountPipelineStageLeads(r.Context(), tenantContext, filter)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, PipelineStageCountsResponse{Data: counts})
}

func (handler Handler) ListLeadMetaFilters(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParsePipelineBoardFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	entryMode := false
	if raw := strings.TrimSpace(r.URL.Query().Get("entryMode")); raw != "" {
		entryMode, err = strconv.ParseBool(raw)
		if err != nil {
			writeLeadError(w, r, ErrInvalidInput)
			return
		}
	}
	if entryMode {
		// Keep the existing pipeline/contact response unchanged. The dashboard
		// opts into options from its own entry cohort after stats confirms support.
		values := r.URL.Query()
		values.Set("pageId", filter.FilterPage)
		dashboardFilter, parseErr := ParseDashboardFilter(values)
		if parseErr != nil {
			writeLeadError(w, r, parseErr)
			return
		}
		filters, listErr := handler.repo.ListDashboardEntryFilterOptions(r.Context(), tenantContext, dashboardFilter)
		if listErr != nil {
			writeLeadError(w, r, listErr)
			return
		}
		httpserver.WriteJSON(w, http.StatusOK, map[string]LeadMetaFilters{"data": filters})
		return
	}

	filters, err := handler.repo.ListLeadMetaFilters(r.Context(), tenantContext, filter)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]LeadMetaFilters{"data": filters})
}
