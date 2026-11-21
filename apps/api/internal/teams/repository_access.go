package teams

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ensureCanManageAvailability(ctx context.Context, q queryRowExecutor, tenantContext tenant.Context, teamMemberID string) error {
	if canManageTeams(tenantContext) {
		return nil
	}
	if !tenantContext.IsTeamLeader {
		return tenant.ErrOrganizationAccessDenied
	}
	if !tenantContext.HasPermission(permissions.TeamManage) {
		return tenant.ErrOrganizationAccessDenied
	}

	var teamID string
	err := q.QueryRow(ctx, `
		select tm.team_id::text
		from public.team_members tm
		join public.teams t on t.id = tm.team_id
		join public.organization_members om
		  on om.organization_id = tm.organization_id
		 and om.user_id = tm.user_id
		 and om.is_active = true
		 and om.deleted_at is null
		 and om.membership_generation = tm.membership_generation
		where tm.organization_id = $1::uuid
		  and tm.id = $2::uuid
		  and t.organization_id = $1::uuid
		  and coalesce(tm.is_active, true) = true
		  and coalesce(t.is_active, true) = true
	`, tenantContext.OrganizationID, teamMemberID).Scan(&teamID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrTeamMemberNotFound
	}
	if err != nil {
		return err
	}
	if !tenantContext.LeadsTeam(teamID) {
		return tenant.ErrOrganizationAccessDenied
	}
	return nil
}

func canManageTeams(tenantContext tenant.Context) bool {
	if tenantContext.IsSuperAdmin || tenantContext.HasRole("owner", "admin") {
		return true
	}
	if tenantContext.IsTeamLeader {
		return false
	}

	return tenantContext.HasPermission(permissions.TeamManage)
}

func canRecoverTeamCreation(tenantContext tenant.Context, teamID string) bool {
	return canManageTeams(tenantContext) || (tenantContext.HasPermission(permissions.TeamManage) && tenantContext.LeadsTeam(teamID))
}

func canViewAllTeams(tenantContext tenant.Context) bool {
	if canManageTeams(tenantContext) {
		return true
	}
	if !tenantContext.HasPermission(permissions.TeamView) {
		return false
	}
	if tenantContext.HasRole("manager") {
		return true
	}

	// Team leaders keep a deliberately scoped view of the teams they lead.
	// A manager retains organization-wide read visibility when also assigned
	// as a team leader, while mutations remain restricted to led teams.
	return !tenantContext.IsTeamLeader
}

func canManageTeamPipeline(tenantContext tenant.Context, teamID string) bool {
	if tenantContext.IsSuperAdmin || tenantContext.HasRole("owner", "admin") {
		return true
	}
	if !tenantContext.HasPermission(permissions.PipelineManage) {
		return false
	}
	if tenantContext.IsTeamLeader {
		return tenantContext.LeadsTeam(teamID)
	}
	return true
}

func canViewTeam(tenantContext tenant.Context, teamID string) bool {
	return canViewAllTeams(tenantContext) || tenantContext.LeadsTeam(teamID)
}

func canReadTeamAvailability(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin || tenantContext.HasRole("owner", "admin") || tenantContext.HasPermission(permissions.TeamView)
}
