package pipelines

import (
	"encoding/json"
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

func (handler Handler) List(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	pipelines, err := handler.repo.List(r.Context(), tenantContext)
	if err != nil {
		writePipelineError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]Pipeline{"data": pipelines})
}

func (handler Handler) Create(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request CreatePipelineRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writePipelineError(w, r, err)
		return
	}

	pipeline, err := handler.repo.Create(r.Context(), tenantContext, input)
	if err != nil {
		writePipelineError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, map[string]Pipeline{"data": pipeline})
}

func (handler Handler) Update(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request UpdatePipelineRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writePipelineError(w, r, err)
		return
	}

	pipeline, err := handler.repo.Update(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writePipelineError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]Pipeline{"data": pipeline})
}

func (handler Handler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	if err := handler.repo.Delete(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writePipelineError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) ListStages(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	stages, err := handler.repo.ListStages(r.Context(), tenantContext, r.URL.Query().Get("pipelineId"))
	if err != nil {
		writePipelineError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]Stage{"data": stages})
}

func (handler Handler) CreateStage(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request CreateStageRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writePipelineError(w, r, err)
		return
	}

	stage, err := handler.repo.CreateStage(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writePipelineError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, map[string]Stage{"data": stage})
}

func (handler Handler) UpdateStage(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request UpdateStageRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writePipelineError(w, r, err)
		return
	}

	stage, err := handler.repo.UpdateStage(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writePipelineError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]Stage{"data": stage})
}

func (handler Handler) ReorderStages(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request ReorderStagesRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writePipelineError(w, r, err)
		return
	}

	stages, err := handler.repo.ReorderStages(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writePipelineError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]Stage{"data": stages})
}

func (handler Handler) DeleteStage(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	if err := handler.repo.DeleteStage(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writePipelineError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) SetDefaultRoundRobin(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request SetPipelineRoundRobinRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writePipelineError(w, r, err)
		return
	}

	pipeline, err := handler.repo.SetDefaultRoundRobin(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writePipelineError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]Pipeline{"data": pipeline})
}

func writePipelineError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_pipeline_input", err.Error())
	case errors.Is(err, ErrNoChanges):
		httpserver.WriteError(w, r, http.StatusBadRequest, "no_pipeline_changes", "No pipeline changes were provided.")
	case errors.Is(err, ErrInvalidReference):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_pipeline_reference", "One or more pipeline references do not belong to this organization.")
	case errors.Is(err, ErrHasLeads):
		httpserver.WriteError(w, r, http.StatusConflict, "pipeline_has_leads", "Move or delete related leads before deleting this item.")
	case errors.Is(err, ErrPipelineNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "pipeline_not_found", "Pipeline was not found.")
	case errors.Is(err, ErrStageNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "stage_not_found", "Stage was not found.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "pipeline_operation_failed", "Unable to complete pipeline operation.")
	}
}
