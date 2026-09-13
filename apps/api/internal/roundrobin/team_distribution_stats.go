package roundrobin

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var ErrTeamDistributionStatsNotFound = errors.New("team distribution stats team not found")

type TeamDistributionStats struct {
	TotalEvents          int64     `json:"totalEvents"`
	UniqueLeads          int64     `json:"uniqueLeads"`
	RedistributionEvents int64     `json:"redistributionEvents"`
	Coverage             string    `json:"coverage"`
	CompleteSince        time.Time `json:"completeSince"`
}

const teamDistributionStatsQuery = `
	with scoped_team as (
	  select team.created_at
	  from public.teams as team
	  where team.organization_id = $1::uuid
	    and team.id = $2::uuid
	)
	select
	  exists (select 1 from scoped_team) as team_exists,
	  (select scoped_team.created_at from scoped_team) as team_created_at,
	  count(event.round_robin_log_id)::bigint as total_events,
	  count(distinct event.lead_id)::bigint as unique_leads,
	  count(event.round_robin_log_id) filter (
	    where event.event_kind = 'redistribution'
	  )::bigint as redistribution_events,
	  coverage.coverage,
	  coverage.complete_since
	from private.team_distribution_event_coverage as coverage
	left join private.team_distribution_events as event
	  on event.organization_id = $1::uuid
	 and event.team_id = $2::uuid
	where coverage.scope = 'global'
	group by coverage.coverage, coverage.complete_since
`

func (repo Repository) TeamDistributionStats(
	ctx context.Context,
	tenantContext tenant.Context,
	teamID string,
) (TeamDistributionStats, error) {
	normalizedTeamID, ok := normalizeUUID(teamID)
	if !ok {
		return TeamDistributionStats{}, ErrInvalidInput
	}
	if !canViewTeamDistributionStats(tenantContext, normalizedTeamID) {
		return TeamDistributionStats{}, tenant.ErrOrganizationAccessDenied
	}

	var (
		teamExists    bool
		teamCreatedAt pgtype.Timestamptz
		stats         TeamDistributionStats
	)
	err := repo.db.Pool().QueryRow(
		ctx,
		teamDistributionStatsQuery,
		tenantContext.OrganizationID,
		normalizedTeamID,
	).Scan(
		&teamExists,
		&teamCreatedAt,
		&stats.TotalEvents,
		&stats.UniqueLeads,
		&stats.RedistributionEvents,
		&stats.Coverage,
		&stats.CompleteSince,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return TeamDistributionStats{}, ErrTeamDistributionStatsNotFound
	}
	if err != nil {
		return TeamDistributionStats{}, err
	}
	if !teamExists {
		return TeamDistributionStats{}, ErrTeamDistributionStatsNotFound
	}
	var createdAt *time.Time
	if teamCreatedAt.Valid {
		createdAt = &teamCreatedAt.Time
	}
	stats.Coverage = resolveTeamDistributionCoverage(
		stats.Coverage,
		stats.CompleteSince,
		createdAt,
	)

	return stats, nil
}

func canViewTeamDistributionStats(tenantContext tenant.Context, teamID string) bool {
	if tenantContext.IsSuperAdmin || tenantContext.HasRole("owner", "admin") {
		return true
	}
	if !tenantContext.HasPermission(permissions.TeamView) {
		return false
	}
	if tenantContext.IsTeamLeader {
		return tenantContext.LeadsTeam(teamID)
	}
	return tenantContext.HasPermission(permissions.TeamManage)
}

func resolveTeamDistributionCoverage(
	globalCoverage string,
	completeSince time.Time,
	teamCreatedAt *time.Time,
) string {
	if globalCoverage == "complete" ||
		(teamCreatedAt != nil && !teamCreatedAt.Before(completeSince)) {
		return "complete"
	}
	return "partial"
}
