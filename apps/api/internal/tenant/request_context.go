package tenant

import (
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
)

func RequireOrganizationContext(
	w http.ResponseWriter,
	r *http.Request,
) (Context, bool) {
	tenantContext, ok := FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(
			w,
			r,
			http.StatusForbidden,
			"organization_required",
			"Organization context is required.",
		)
		return Context{}, false
	}
	return tenantContext, true
}
