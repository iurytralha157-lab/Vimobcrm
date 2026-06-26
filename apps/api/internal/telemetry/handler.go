package telemetry

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

func (handler Handler) CreateErrorEvent(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}

	defer r.Body.Close()
	var request CreateErrorEventRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeTelemetryError(w, r, err)
		return
	}

	event, err := handler.repo.Create(r.Context(), tenantContext, input)
	if err != nil {
		writeTelemetryError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, map[string]ErrorEvent{"data": event})
}

func (handler Handler) ListErrorEvents(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || !tenantContext.IsSuperAdmin {
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "Only super admins can read error events.")
		return
	}

	filter, err := ParseListFilter(r.URL.Query())
	if err != nil {
		writeTelemetryError(w, r, err)
		return
	}

	response, err := handler.repo.List(r.Context(), filter)
	if err != nil {
		writeTelemetryError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, response)
}

func (handler Handler) ResolveErrorEvent(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || !tenantContext.IsSuperAdmin {
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "Only super admins can resolve error events.")
		return
	}

	defer r.Body.Close()
	var request ResolveErrorEventRequest
	if r.ContentLength != 0 {
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<14))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
			return
		}
	}

	event, err := handler.repo.Resolve(r.Context(), r.PathValue("id"), tenantContext.UserID, request.Validate())
	if err != nil {
		writeTelemetryError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]ErrorEvent{"data": event})
}

func writeTelemetryError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_telemetry_input", err.Error())
	case errors.Is(err, ErrEventNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "error_event_not_found", "Error event was not found.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "telemetry_operation_failed", "Unable to complete telemetry operation.")
	}
}
