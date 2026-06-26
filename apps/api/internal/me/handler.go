package me

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

func (handler Handler) Show(w http.ResponseWriter, r *http.Request) {
	user, ok := httpserver.UserFromContext(r.Context())
	if !ok {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}

	tenantContext, _ := tenant.FromContext(r.Context())

	httpserver.WriteJSON(w, http.StatusOK, map[string]any{
		"user":    user,
		"context": tenantContext,
	})
}

func (handler Handler) ShowProfile(w http.ResponseWriter, r *http.Request) {
	user, ok := httpserver.UserFromContext(r.Context())
	if !ok {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing tenant context.")
		return
	}

	profile, organization, err := handler.repo.CurrentProfile(r.Context(), tenantContext)
	if err != nil {
		writeMeError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, SessionProfile{
		User:         user,
		Context:      tenantContext,
		Profile:      profile,
		Organization: organization,
	})
}

func (handler Handler) SwitchOrganization(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing tenant context.")
		return
	}

	defer r.Body.Close()
	var request SwitchOrganizationRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	if err := handler.repo.SwitchOrganization(r.Context(), tenantContext, request.OrganizationID); err != nil {
		writeMeError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func writeMeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_me_input", "Request input is invalid.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_access_denied", "You do not have access to this organization.")
	case errors.Is(err, tenant.ErrOrganizationNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "organization_not_found", "Organization was not found.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "me_operation_failed", "Unable to load current profile.")
	}
}
