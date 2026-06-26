package automations

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

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
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	items, err := handler.repo.List(r.Context(), tenantContext)
	if err != nil {
		writeAutomationError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]Automation]{Data: items})
}

func (handler Handler) Create(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	defer r.Body.Close()
	var request CreateRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeAutomationError(w, r, err)
		return
	}

	item, err := handler.repo.Create(r.Context(), tenantContext, input)
	if err != nil {
		writeAutomationError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, Envelope[Automation]{Data: item})
}

func (handler Handler) Show(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	item, err := handler.repo.Get(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeAutomationError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[AutomationWithNodes]{Data: item})
}

func (handler Handler) Update(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	defer r.Body.Close()
	var request UpdateRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeAutomationError(w, r, err)
		return
	}

	item, err := handler.repo.Update(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeAutomationError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[Automation]{Data: item})
}

func (handler Handler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	if err := handler.repo.Delete(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeAutomationError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) Duplicate(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	item, err := handler.repo.Duplicate(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeAutomationError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, Envelope[Automation]{Data: item})
}

func (handler Handler) SaveFlow(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	defer r.Body.Close()
	var request SaveFlowRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeAutomationError(w, r, err)
		return
	}

	nodes, err := handler.repo.SaveFlow(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeAutomationError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string][]AutomationNode]{Data: map[string][]AutomationNode{"nodes": nodes}})
}

func (handler Handler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	items, err := handler.repo.ListTemplates(r.Context(), tenantContext)
	if err != nil {
		writeAutomationError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]AutomationTemplate]{Data: items})
}

func (handler Handler) CreateTemplate(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	defer r.Body.Close()
	var request CreateTemplateRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeAutomationError(w, r, err)
		return
	}

	item, err := handler.repo.CreateTemplate(r.Context(), tenantContext, input)
	if err != nil {
		writeAutomationError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, Envelope[AutomationTemplate]{Data: item})
}

func (handler Handler) DeleteTemplate(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	if err := handler.repo.DeleteTemplate(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeAutomationError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) ListExecutions(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 200 {
			writeAutomationError(w, r, ErrInvalidInput)
			return
		}
		limit = value
	}

	items, err := handler.repo.ListExecutions(r.Context(), tenantContext, ExecutionFilter{
		AutomationID: strings.TrimSpace(r.URL.Query().Get("automationId")),
		Limit:        limit,
	})
	if err != nil {
		writeAutomationError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]AutomationExecution]{Data: items})
}

func (handler Handler) CancelExecution(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	if err := handler.repo.CancelExecution(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeAutomationError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) Start(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	defer r.Body.Close()
	var request StartRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeAutomationError(w, r, err)
		return
	}

	result, err := handler.repo.Start(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeAutomationError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, Envelope[StartResult]{Data: result})
}

func organizationContext(w http.ResponseWriter, r *http.Request) (tenant.Context, bool) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return tenant.Context{}, false
	}

	return tenantContext, true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return err
	}

	return nil
}

func writeAutomationError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_automation_input", "Automation input is invalid.")
	case errors.Is(err, ErrAutomationMisconfigured):
		httpserver.WriteError(w, r, http.StatusBadRequest, "automation_misconfigured", "Automation does not have a start path configured.")
	case errors.Is(err, ErrAutomationNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "automation_not_found", "Automation was not found.")
	case errors.Is(err, ErrTemplateNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "automation_template_not_found", "Automation template was not found.")
	case errors.Is(err, ErrExecutionNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "automation_execution_not_found", "Automation execution was not found.")
	case errors.Is(err, ErrAutomationMediaNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "automation_media_not_found", "Automation media was not found.")
	case errors.Is(err, ErrAutomationStorageNotConfigured):
		httpserver.WriteError(w, r, http.StatusInternalServerError, "automation_storage_not_configured", "Automation storage is not configured.")
	case errors.Is(err, ErrAutomationStorage):
		httpserver.WriteError(w, r, http.StatusBadGateway, "automation_storage_failed", "Automation storage operation failed.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "automation_operation_failed", "Unable to complete automation operation.")
	}
}
