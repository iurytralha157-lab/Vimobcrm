package properties

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const maxPropertySummaryIDs = 100

func (handler Handler) ShowPropertyCaptor(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	captor, err := handler.repo.GetPropertyCaptor(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]*PropertyCaptor{"data": captor})
}

func (handler Handler) ShowPropertySiteInfo(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	site, err := handler.repo.GetPropertySiteInfo(r.Context(), tenantContext)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]*PropertySiteInfo{"data": site})
}

func (handler Handler) ListPropertySummaries(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	ids := parsePropertySummaryIDs(r)
	if len(ids) > maxPropertySummaryIDs {
		writePropertyError(w, r, fmt.Errorf("%w: too many property ids", ErrInvalidInput))
		return
	}

	summaries, err := handler.repo.ListPropertySummaries(r.Context(), tenantContext, ids)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]PropertySummary{"data": summaries})
}

func parsePropertySummaryIDs(r *http.Request) []string {
	values := r.URL.Query()
	ids := []string{}
	for _, raw := range values["id"] {
		ids = append(ids, splitPropertySummaryIDs(raw)...)
	}
	for _, raw := range values["ids"] {
		ids = append(ids, splitPropertySummaryIDs(raw)...)
	}

	return ids
}

func splitPropertySummaryIDs(value string) []string {
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
