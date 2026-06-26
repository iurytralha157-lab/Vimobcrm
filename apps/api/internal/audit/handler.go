package audit

import (
	"encoding/json"
	"errors"
	"net"
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

func (handler Handler) List(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
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

func (handler Handler) Create(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}

	defer r.Body.Close()
	var request CreateRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate(remoteIP(r))
	if err != nil {
		writeAuditError(w, r, err)
		return
	}

	if err := handler.repo.Create(r.Context(), tenantContext, input); err != nil {
		writeAuditError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, map[string]bool{"ok": true})
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

func remoteIP(r *http.Request) string {
	for _, header := range []string{"X-Forwarded-For", "X-Real-IP"} {
		value := strings.TrimSpace(r.Header.Get(header))
		if value == "" {
			continue
		}
		if index := strings.Index(value, ","); index >= 0 {
			value = strings.TrimSpace(value[:index])
		}
		if net.ParseIP(value) != nil {
			return value
		}
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && net.ParseIP(host) != nil {
		return host
	}
	if net.ParseIP(strings.TrimSpace(r.RemoteAddr)) != nil {
		return strings.TrimSpace(r.RemoteAddr)
	}
	return ""
}
