package leads

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (handler Handler) ListEnrichments(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	ids := parseLeadEnrichmentIDs(r)
	if len(ids) > maxLeadEnrichmentIDs {
		writeLeadError(w, r, fmt.Errorf("%w: too many lead ids", ErrInvalidInput))
		return
	}

	enrichments, err := handler.repo.ListEnrichments(r.Context(), tenantContext, ids)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]LeadEnrichment{"data": enrichments})
}

func parseLeadEnrichmentIDs(r *http.Request) []string {
	values := r.URL.Query()
	ids := []string{}
	for _, raw := range values["id"] {
		ids = append(ids, splitLeadEnrichmentIDs(raw)...)
	}
	for _, raw := range values["ids"] {
		ids = append(ids, splitLeadEnrichmentIDs(raw)...)
	}

	return ids
}

func splitLeadEnrichmentIDs(value string) []string {
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
