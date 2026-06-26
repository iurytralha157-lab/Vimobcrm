package users

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
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

func (handler Handler) ListUserOrganizations(w http.ResponseWriter, r *http.Request) {
	user, ok := httpserver.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}

	items, err := handler.repo.ListUserOrganizations(r.Context(), user.ID)
	if err != nil {
		writeUserError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]UserOrganization]{Data: items})
}

func (handler Handler) ListOrganizationUsers(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	users, err := handler.repo.ListOrganizationUsers(r.Context(), tenantContext)
	if err != nil {
		writeUserError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]User]{Data: users})
}

func (handler Handler) CreateOrganizationUser(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	defer r.Body.Close()
	var request CreateUserRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}

	input, err := normalizeCreateUserInput(request)
	if err != nil {
		writeUserError(w, r, err)
		return
	}

	result, err := handler.repo.CreateOrganizationUser(r.Context(), tenantContext, input)
	if err != nil {
		writeUserError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, result)
}

func (handler Handler) UpdateOrganizationUser(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	defer r.Body.Close()
	var request UpdateUserRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}

	input, err := normalizeUpdateUserInput(request)
	if err != nil {
		writeUserError(w, r, err)
		return
	}

	user, err := handler.repo.UpdateOrganizationUser(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeUserError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, MutateUserResult{Success: true, User: user})
}

func (handler Handler) DeleteOrganizationUser(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}

	if err := handler.repo.DeleteOrganizationUser(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeUserError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, DeleteUserResult{Success: true})
}

func (handler Handler) ListSummaries(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	ids := parseSummaryIDs(r)
	if len(ids) > maxSummaryIDs {
		writeUserError(w, r, fmt.Errorf("%w: too many user ids", ErrInvalidInput))
		return
	}

	summaries, err := handler.repo.ListSummaries(r.Context(), tenantContext, ids)
	if err != nil {
		writeUserError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]Summary{"data": summaries})
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

func parseSummaryIDs(r *http.Request) []string {
	values := r.URL.Query()
	ids := []string{}
	for _, raw := range values["id"] {
		ids = append(ids, splitSummaryIDs(raw)...)
	}
	for _, raw := range values["ids"] {
		ids = append(ids, splitSummaryIDs(raw)...)
	}

	return ids
}

func splitSummaryIDs(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}

	return out
}

func writeUserError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_user_input", err.Error())
	case errors.Is(err, ErrUserNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "user_not_found", "User was not found.")
	case errors.Is(err, ErrUserConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "user_conflict", "User already exists.")
	case errors.Is(err, ErrAuthAdminNotConfigured):
		httpserver.WriteError(w, r, http.StatusInternalServerError, "auth_admin_not_configured", "Auth admin is not configured.")
	case errors.Is(err, ErrAuthAdminOperation):
		httpserver.WriteError(w, r, http.StatusBadGateway, "auth_admin_operation_failed", "Auth admin operation failed.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		slog.Error("user operation failed", "error", err)
		httpserver.WriteError(w, r, http.StatusInternalServerError, "user_operation_failed", "Unable to complete user operation.")
	}
}
