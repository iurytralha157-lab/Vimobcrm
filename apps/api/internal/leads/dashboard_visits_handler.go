package leads

import (
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
)

func (handler Handler) ShowDashboardVisits(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := dashboardTenantContext(w, r)
	if !ok {
		return
	}
	filter, err := ParseDashboardFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	data, err := handler.repo.GetDashboardVisits(r.Context(), tenantContext, filter)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]DashboardVisits{"data": data})
}
