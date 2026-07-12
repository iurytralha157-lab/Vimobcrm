package tenant

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
)

const OrganizationHeader = "X-Organization-ID"

type Resolver interface {
	Resolve(ctx context.Context, userID string, requestedOrganizationID string) (Context, error)
}

func Attach(repo Resolver, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := httpserver.UserFromContext(r.Context())
		if !ok {
			httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
			return
		}

		tenantContext, err := repo.Resolve(r.Context(), user.ID, strings.TrimSpace(r.Header.Get(OrganizationHeader)))
		if err != nil {
			writeTenantError(w, r, err)
			return
		}

		next.ServeHTTP(w, r.WithContext(ContextWithTenant(r.Context(), tenantContext)))
	})
}

func RequireOrganization(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tenantContext, ok := FromContext(r.Context())
		if !ok || tenantContext.OrganizationID == "" {
			httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
			return
		}

		next.ServeHTTP(w, r)
	})
}

func RequireFinancialAccess(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tenantContext, ok := FromContext(r.Context())
		if !ok || tenantContext.OrganizationID == "" {
			httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
			return
		}

		if !CanUseFinancialModule(tenantContext) {
			httpserver.WriteError(w, r, http.StatusForbidden, "financial_module_unavailable", "Financial module is available only for Vetter Co.")
			return
		}

		next.ServeHTTP(w, r)
	})
}

func CanUseFinancialModule(tenantContext Context) bool {
	allowedIDs := strings.Split(os.Getenv("FINANCIAL_ORGANIZATION_IDS"), ",")
	for _, id := range allowedIDs {
		if strings.EqualFold(strings.TrimSpace(id), strings.TrimSpace(tenantContext.OrganizationID)) {
			return true
		}
	}

	return normalizeFinancialOrganizationName(tenantContext.OrganizationName) == "vetter co"
}

func normalizeFinancialOrganizationName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.TrimSuffix(value, ".")
	value = strings.Join(strings.Fields(value), " ")
	return value
}

func RequirePermission(permission string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tenantContext, ok := FromContext(r.Context())
		if !ok || !tenantContext.HasPermission(permission) {
			httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
			return
		}

		next.ServeHTTP(w, r)
	})
}

func writeTenantError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrUserProfileNotFound):
		httpserver.WriteError(w, r, http.StatusForbidden, "profile_not_found", "User profile was not found.")
	case errors.Is(err, ErrUserInactive):
		httpserver.WriteError(w, r, http.StatusForbidden, "user_inactive", "User is inactive.")
	case errors.Is(err, ErrInvalidOrganizationID):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_organization_id", "Organization id is invalid.")
	case errors.Is(err, ErrOrganizationRequired):
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
	case errors.Is(err, ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_access_denied", "You do not have access to this organization.")
	case errors.Is(err, ErrOrganizationNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "organization_not_found", "Organization was not found.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "tenant_resolution_failed", "Unable to resolve tenant context.")
	}
}
