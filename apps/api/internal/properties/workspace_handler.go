package properties

import (
	"net/http"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const propertyWorkspaceBodyLimit = 128 << 10

func (handler Handler) ShowWorkspace(w http.ResponseWriter, r *http.Request) {
	setPropertyWorkspacePrivateHeaders(w)
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	workspace, err := handler.repo.GetWorkspace(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, workspace)
}

func (handler Handler) UpsertOffer(w http.ResponseWriter, r *http.Request) {
	setPropertyWorkspacePrivateHeaders(w)
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	var input UpsertPropertyOfferInput
	if err := httpserver.DecodeJSON(w, r, &input, propertyWorkspaceBodyLimit); err != nil {
		return
	}
	offer, err := handler.repo.UpsertPropertyOffer(
		r.Context(),
		tenantContext,
		r.PathValue("id"),
		r.PathValue("offerType"),
		input,
	)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]map[string]any{"data": offer})
}

func (handler Handler) CreateKey(w http.ResponseWriter, r *http.Request) {
	setPropertyWorkspacePrivateHeaders(w)
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	var input CreatePropertyKeyInput
	if err := httpserver.DecodeJSON(w, r, &input, propertyWorkspaceBodyLimit); err != nil {
		return
	}
	key, err := handler.repo.CreatePropertyKey(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, map[string]map[string]any{"data": key})
}

func (handler Handler) MoveKey(w http.ResponseWriter, r *http.Request) {
	setPropertyWorkspacePrivateHeaders(w)
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	var input PropertyKeyMovementInput
	if err := httpserver.DecodeJSON(w, r, &input, propertyWorkspaceBodyLimit); err != nil {
		return
	}
	input.IdempotencyKey = strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	result, err := handler.repo.AppendPropertyKeyMovement(
		r.Context(),
		tenantContext,
		r.PathValue("id"),
		r.PathValue("keyId"),
		input,
	)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, map[string]PropertyKeyMovementResult{"data": result})
}

func setPropertyWorkspacePrivateHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "private, no-store")

	vary := []string{}
	seen := map[string]struct{}{}
	for _, value := range w.Header().Values("Vary") {
		for _, token := range strings.Split(value, ",") {
			token = strings.TrimSpace(token)
			if token == "" {
				continue
			}
			key := strings.ToLower(token)
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			vary = append(vary, token)
		}
	}
	for _, token := range []string{"Authorization", tenant.OrganizationHeader} {
		key := strings.ToLower(token)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		vary = append(vary, token)
	}
	w.Header().Set("Vary", strings.Join(vary, ", "))
}
