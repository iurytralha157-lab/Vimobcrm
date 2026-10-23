package stageconfig

import (
	"encoding/json"
	"errors"
	"io"
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
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	automations, err := handler.repo.ListAutomations(r.Context(), tenantContext, r.URL.Query().Get("stageId"))
	if err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	available := false
	if len(automations) > 0 {
		available = automations[0].InactivityRuntimeAvailable
	} else {
		available, err = handler.repo.InactivityRuntimeAvailable(r.Context())
		if err != nil {
			writeStageConfigError(w, r, err)
			return
		}
	}
	httpserver.WriteJSON(w, http.StatusOK, StageAutomationsEnvelope{Data: automations, InactivityRuntimeAvailable: available})
}

func (handler Handler) CreateAutomation(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	var request StageAutomationRequest
	if err := httpserver.DecodeJSON(w, r, &request, 1<<20); err != nil {
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
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	var request StageAutomationRequest
	if err := httpserver.DecodeJSON(w, r, &request, 1<<20); err != nil {
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
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	if !canManageStageConfig(tenantContext) {
		writeStageConfigError(w, r, tenant.ErrOrganizationAccessDenied)
		return
	}
	var request StageAutomationDeleteRequest
	if r.Body != nil {
		defer r.Body.Close()
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
		decoder.DisallowUnknownFields()
		// Missing revisions from old DELETE clients fail closed with the same
		// conflict contract as edits; malformed or multiple JSON values are 400.
		if err := decoder.Decode(&request); err != nil && !errors.Is(err, io.EOF) {
			httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
			return
		}
		var trailing any
		if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
			httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
			return
		}
	}
	input, err := request.Validate()
	if err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	if err := handler.repo.DeleteAutomation(r.Context(), tenantContext, r.PathValue("id"), input); err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) ToggleAutomation(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	var request StageAutomationStatusRequest
	if err := httpserver.DecodeJSON(w, r, &request, 1<<20); err != nil {
		return
	}
	input, err := request.Validate()
	if err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	automation, err := handler.repo.ToggleAutomation(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[StageAutomation]{Data: automation})
}

func (handler Handler) ListOperationalConfigs(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
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
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	var request StageOperationalConfigRequest
	if err := httpserver.DecodeJSON(w, r, &request, 1<<20); err != nil {
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
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
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
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	var request map[string]any
	if err := httpserver.DecodeJSON(w, r, &request, 1<<20); err != nil {
		return
	}
	item, err := handler.repo.UpsertPipelineSLASettings(r.Context(), tenantContext, request)
	if err != nil {
		writeStageConfigError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func writeStageConfigError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrStageAutomationChanged):
		httpserver.WriteError(w, r, http.StatusConflict, "stage_automation_changed", "Esta automação foi alterada. Atualize os dados e revise seu rascunho antes de salvar.")
	case errors.Is(err, ErrInactivityConfigurationChanged):
		httpserver.WriteError(w, r, http.StatusConflict, "stage_inactivity_changed", "Esta regra foi alterada. Atualize os dados e revise seu rascunho antes de salvar.")
	case errors.Is(err, ErrInactivityRuntimeNotReady):
		httpserver.WriteError(w, r, http.StatusServiceUnavailable, "stage_inactivity_unavailable", "A regra de inatividade ainda não está disponível neste ambiente. Sua configuração não foi alterada.")
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
