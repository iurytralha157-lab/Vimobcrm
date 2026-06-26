package leads

import (
	"net/http"

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

	filters, err := handler.repo.ListLeadMetaFilters(r.Context(), tenantContext, filter)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]LeadMetaFilters{"data": filters})
}
