package leadscope

import (
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func CanRead(tenantContext tenant.Context) bool {
	return CanViewAll(tenantContext) || CanViewOwn(tenantContext) || CanViewTeam(tenantContext)
}

func CanViewAll(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin") ||
		tenantContext.HasPermission(permissions.LeadViewAll)
}

func CanViewOwn(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission(permissions.LeadViewOwn)
}

func CanViewTeam(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission(permissions.LeadViewTeam)
}

// VisibilitySQL mirrors the resource-level CanViewLead contract. A leader can
// see a lead from the recorded team or any lead assigned to a broker in a team
// they lead. Alias and placeholders must be trusted source constants, never
// request input.
func VisibilitySQL(alias string, canViewAllPlaceholder string, userIDPlaceholder string, canViewTeamPlaceholder string, canViewOwn bool) string {
	canViewOwnSQL := "false"
	if canViewOwn {
		canViewOwnSQL = "true"
	}
	return `(
		` + canViewAllPlaceholder + `::boolean
		or (` + canViewOwnSQL + ` and ` + alias + `.assigned_user_id = ` + userIDPlaceholder + `::uuid)
		or (
			` + canViewTeamPlaceholder + `::boolean
			and (
				(
					nullif(to_jsonb(` + alias + `)->>'team_id', '') is not null
					and exists (
						select 1 from public.team_members leader
						join public.teams team
						  on team.id = leader.team_id
						 and team.organization_id = leader.organization_id
						 and coalesce(team.is_active, true) = true
						where leader.organization_id = ` + alias + `.organization_id
						  and leader.user_id = ` + userIDPlaceholder + `::uuid
						  and leader.team_id::text = to_jsonb(` + alias + `)->>'team_id'
						  and leader.is_active = true
						  and leader.is_leader = true
					)
				)
				or (
					` + alias + `.assigned_user_id is not null
					and exists (
						select 1
						from public.team_members leader
						join public.teams team
						  on team.id = leader.team_id
						 and team.organization_id = leader.organization_id
						 and coalesce(team.is_active, true) = true
						join public.team_members member
						  on member.organization_id = leader.organization_id
						 and member.team_id = leader.team_id
						 and member.is_active = true
						join public.users broker
						  on broker.id = member.user_id
						 and coalesce(broker.is_active, false) = true
						join public.organization_members broker_membership
						  on broker_membership.organization_id = member.organization_id
						 and broker_membership.user_id = member.user_id
						 and coalesce(broker_membership.is_active, false) = true
						 and broker_membership.deleted_at is null
						where leader.organization_id = ` + alias + `.organization_id
						  and leader.user_id = ` + userIDPlaceholder + `::uuid
						  and leader.is_active = true
						  and leader.is_leader = true
						  and member.user_id = ` + alias + `.assigned_user_id
					)
				)
			)
		)
	)`
}
