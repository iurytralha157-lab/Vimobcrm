package presence

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const freshnessWindow = 3 * time.Minute

type Lister interface {
	List(ctx context.Context, scope ListScope, freshSince time.Time) ([]User, error)
}

type Handler struct {
	repo Lister
	now  func() time.Time
}

func NewHandler(repo Lister) Handler {
	return Handler{
		repo: repo,
		now:  time.Now,
	}
}

func (handler Handler) List(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")

	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}
	if !tenantContext.HasPermission(permissions.UsersPresenceView) {
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "Permission denied.")
		return
	}
	if !canViewTeamPresence(tenantContext) {
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "Permission denied.")
		return
	}

	generatedAt := handler.now().UTC()
	users, err := handler.repo.List(
		r.Context(),
		presenceListScope(tenantContext),
		generatedAt.Add(-freshnessWindow),
	)
	if err != nil {
		slog.ErrorContext(r.Context(), "list user presence", "error", err)
		httpserver.WriteError(w, r, http.StatusInternalServerError, "user_presence_failed", "Failed to list user presence.")
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Response{Data: newData(users, generatedAt)})
}

func canViewTeamPresence(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin") ||
		tenantContext.IsTeamLeader
}

func presenceListScope(tenantContext tenant.Context) ListScope {
	scope := ListScope{OrganizationID: tenantContext.OrganizationID}
	if tenantContext.IsSuperAdmin || tenantContext.HasRole("owner", "admin") {
		return scope
	}

	scope.RestrictToUserIDs = true
	if !tenantContext.IsTeamLeader {
		return scope
	}

	seen := make(map[string]struct{}, len(tenantContext.LedUserIDs)+1)
	for _, userID := range append([]string{tenantContext.UserID}, tenantContext.LedUserIDs...) {
		userID = strings.TrimSpace(userID)
		if userID == "" {
			continue
		}
		key := strings.ToLower(userID)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		scope.UserIDs = append(scope.UserIDs, userID)
	}

	return scope
}
