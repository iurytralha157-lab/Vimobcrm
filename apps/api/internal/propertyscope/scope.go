package propertyscope

import (
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// CanRead reports whether a tenant context may read at least its own scoped
// properties. Record-level visibility must still use VisibilitySQL.
func CanRead(tenantContext tenant.Context) bool {
	return CanViewAll(tenantContext) || tenantContext.HasPermission(permissions.PropertyView)
}

// CanViewAll is deliberately narrower than legacy property_view_all aliases.
// Only property management (or roles that imply it) grants organization-wide
// visibility.
func CanViewAll(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin") ||
		tenantContext.HasPermission(permissions.PropertyManage)
}

// CanViewTeam enables the team branch of VisibilitySQL. The predicate also
// verifies active leadership and membership in the same organization.
func CanViewTeam(tenantContext tenant.Context) bool {
	return tenantContext.IsTeamLeader ||
		tenantContext.HasPermission(permissions.LeadViewTeam)
}

// VisibilitySQL returns the canonical own/team/all predicate used by every
// authenticated property consumer. Placeholders and alias must be trusted
// source constants, never request input.
func VisibilitySQL(alias string, canViewAllPlaceholder string, userIDPlaceholder string, canViewTeamPlaceholder string) string {
	return `(
		` + canViewAllPlaceholder + `::boolean
		or ` + alias + `.responsible_user_id = ` + userIDPlaceholder + `::uuid
		or ` + alias + `.created_by = ` + userIDPlaceholder + `::uuid
		or (
			` + canViewTeamPlaceholder + `::boolean
			and exists (
				select 1
				from public.team_members leader
				join public.team_members member
				  on member.organization_id = leader.organization_id
				 and member.team_id = leader.team_id
				 and member.is_active = true
				join public.organization_members leader_membership
				  on leader_membership.organization_id = leader.organization_id
				 and leader_membership.user_id = leader.user_id
				 and leader_membership.is_active = true
				 and leader_membership.deleted_at is null
				 and leader_membership.membership_generation = leader.membership_generation
				join public.organization_members member_membership
				  on member_membership.organization_id = member.organization_id
				 and member_membership.user_id = member.user_id
				 and member_membership.is_active = true
				 and member_membership.deleted_at is null
				 and member_membership.membership_generation = member.membership_generation
				where leader.organization_id = ` + alias + `.organization_id
				  and leader.user_id = ` + userIDPlaceholder + `::uuid
				  and leader.is_active = true
				  and leader.is_leader = true
				  and (member.user_id = ` + alias + `.responsible_user_id or member.user_id = ` + alias + `.created_by)
			)
		)
	)`
}
