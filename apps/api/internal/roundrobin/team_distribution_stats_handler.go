package roundrobin

import (
	"errors"
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (handler Handler) GetTeamDistributionStats(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	stats, err := handler.repo.TeamDistributionStats(
		r.Context(),
		tenantContext,
		r.PathValue("teamId"),
	)
	if err != nil {
		writeTeamDistributionStatsError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]TeamDistributionStats{"data": stats})
}

func writeTeamDistributionStatsError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, ErrTeamDistributionStatsNotFound) {
		httpserver.WriteError(w, r, http.StatusNotFound, "team_not_found", "Team was not found.")
		return
	}
	writeRoundRobinError(w, r, err)
}
