package cadences

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

func (handler Handler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	templates, err := handler.repo.ListTemplates(r.Context(), tenantContext)
	if err != nil {
		writeCadenceError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]Template]{Data: templates})
}

func (handler Handler) CreateTask(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	var request TaskRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	task, err := handler.repo.CreateTask(r.Context(), tenantContext, request)
	if err != nil {
		writeCadenceError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[TaskTemplate]{Data: task})
}

func (handler Handler) UpdateTask(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	var request UpdateTaskRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	task, err := handler.repo.UpdateTask(r.Context(), tenantContext, r.PathValue("id"), request)
	if err != nil {
		writeCadenceError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[TaskTemplate]{Data: task})
}

func (handler Handler) DeleteTask(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	if err := handler.repo.DeleteTask(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeCadenceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
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

func writeCadenceError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_cadence_input", "Cadence input is invalid.")
	case errors.Is(err, ErrCadenceNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "cadence_not_found", "Cadence resource was not found.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied), errors.Is(err, ErrCadenceForbidden):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "cadence_operation_failed", "Unable to complete cadence operation.")
	}
}
