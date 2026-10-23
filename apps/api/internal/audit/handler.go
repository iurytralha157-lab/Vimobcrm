package audit

import (
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
	if !ok {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}
	if !canListSensitiveAuditLogs(tenantContext) {
		httpserver.WriteError(w, r, http.StatusForbidden, "audit_access_denied", "You do not have access to audit logs.")
		return
	}

	filter, err := ParseListFilter(r.URL.Query())
	if err != nil {
		writeAuditError(w, r, err)
		return
	}

	response, err := handler.repo.List(r.Context(), tenantContext, filter)
	if err != nil {
		writeAuditError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, response)
}

func canListSensitiveAuditLogs(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		(tenantContext.OrganizationID != "" && tenantContext.HasRole("owner", "admin"))
}

func (Handler) RejectClientCreate(w http.ResponseWriter, r *http.Request) {
	httpserver.WriteError(w, r, http.StatusGone, "client_audit_write_retired", "Audit events must be recorded by the server operation.")
}

func writeAuditError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_audit_input", err.Error())
	case errors.Is(err, tenant.ErrOrganizationRequired):
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_access_denied", "You do not have access to this organization.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "audit_operation_failed", "Unable to complete audit operation.")
	}
}
