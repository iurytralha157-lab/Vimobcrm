package ai

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Handler struct {
	repo    Repository
	service Service
}

func NewHandler(repo Repository, service Service) Handler {
	return Handler{repo: repo, service: service}
}

func (handler Handler) ListAgents(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || !tenantContext.IsSuperAdmin {
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
		return
	}
	items, err := handler.repo.ListAgents(r.Context(), tenantContext)
	if err != nil {
		writeAIError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]Agent]{Data: items})
}

func (handler Handler) CreateAgent(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || !tenantContext.IsSuperAdmin {
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
		return
	}
	defer r.Body.Close()
	var input AgentInput
	if err := decodeJSON(w, r, &input); err != nil {
		return
	}
	item, err := handler.repo.CreateAgent(r.Context(), tenantContext, input)
	if err != nil {
		writeAIError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[Agent]{Data: item})
}

func (handler Handler) UpdateAgent(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || !tenantContext.IsSuperAdmin {
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
		return
	}
	defer r.Body.Close()
	var input AgentInput
	if err := decodeJSON(w, r, &input); err != nil {
		return
	}
	item, err := handler.repo.UpdateAgent(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeAIError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Agent]{Data: item})
}

func (handler Handler) DeleteAgent(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || !tenantContext.IsSuperAdmin {
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
		return
	}
	if err := handler.repo.DeleteAgent(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeAIError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) Run(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}
	defer r.Body.Close()
	var request RunRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	item, err := handler.service.Run(r.Context(), tenantContext, request)
	if err != nil {
		writeAIError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[RunResponse]{Data: item})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return err
	}
	return nil
}

func writeAIError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_ai_input", "AI input is invalid.")
	case errors.Is(err, ErrAgentNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "ai_agent_not_found", "AI agent was not found.")
	case errors.Is(err, ErrPermission), errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "ai_operation_failed", "Unable to complete AI operation.")
	}
}
