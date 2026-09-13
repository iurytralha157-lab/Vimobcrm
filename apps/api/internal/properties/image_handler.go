package properties

import (
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (handler Handler) UploadImage(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	httpserver.WriteError(
		w,
		r,
		http.StatusGone,
		"property_image_upload_retired",
		"This upload endpoint was retired. Use the property media upload-intent and asset flow.",
	)
}
