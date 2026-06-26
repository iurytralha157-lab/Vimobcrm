package stageconfig

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

func (handler Handler) ListAutomations(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	automations, err := handler.repo.ListAutomations(r.Context(), tenantContext, r.URL.Query().Get("stageId"))
	if err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]StageAutomation]{Data: automations})
}

func (handler Handler) CreateAutomation(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	var request StageAutomationRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	input, err := request.Validate(true)
	if err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	automation, err := handler.repo.CreateAutomation(r.Context(), tenantContext, input)
	if err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[StageAutomation]{Data: automation})
}

func (handler Handler) UpdateAutomation(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	var request StageAutomationRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	input, err := request.Validate(false)
	if err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	automation, err := handler.repo.UpdateAutomation(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[StageAutomation]{Data: automation})
}

func (handler Handler) DeleteAutomation(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	if err := handler.repo.DeleteAutomation(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) ToggleAutomation(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	var request StageAutomationStatusRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	automation, err := handler.repo.ToggleAutomation(r.Context(), tenantContext, r.PathValue("id"), request.IsActive)
	if err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[StageAutomation]{Data: automation})
}

func (handler Handler) ListOperationalConfigs(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	configs, err := handler.repo.ListOperationalConfigs(
		r.Context(),
		tenantContext,
		r.URL.Query().Get("pipelineId"),
		r.URL.Query().Get("stageId"),
	)
	if err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]StageOperationalConfig]{Data: configs})
}

func (handler Handler) UpsertOperationalConfig(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	var request StageOperationalConfigRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	input, err := request.Validate()
	if err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	config, err := handler.repo.UpsertOperationalConfig(r.Context(), tenantContext, input)
	if err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[StageOperationalConfig]{Data: config})
}

func (handler Handler) ListPipelineSLASettings(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListPipelineSLASettings(r.Context(), tenantContext, r.URL.Query().Get("pipelineId"))
	if err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) UpsertPipelineSLASettings(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	var request map[string]any
	if !decodeJSON(w, r, &request) {
		return
	}
	item, err := handler.repo.UpsertPipelineSLASettings(r.Context(), tenantContext, request)
	if err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func organizationContext(w http.ResponseWriter, r *http.Request) (tenant.Context, bool) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return tenant.Context{}, false
	}
	return tenantContext, true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	defer r.Body.Close()
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return false
	}
	return true
}

func writeStageConfigError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_stage_config_input", err.Error())
	case errors.Is(err, ErrNoChanges):
		httpserver.WriteError(w, r, http.StatusBadRequest, "no_stage_config_changes", "No changes were provided.")
	case errors.Is(err, ErrNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "stage_config_not_found", "Stage config resource was not found.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "stage_config_operation_failed", "Unable to complete stage config operation.")
	}
}
