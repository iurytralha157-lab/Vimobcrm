package authorization

import (
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type LeadResource struct {
	AssignedUserID string
	TeamID         string
}

func CanViewLead(context tenant.Context, lead LeadResource) bool {
	if context.IsSuperAdmin || context.HasRole("owner", "admin") || context.HasPermission(permissions.LeadViewAll) {
		return true
	}
	if lead.AssignedUserID != "" && lead.AssignedUserID == context.UserID && context.HasPermission(permissions.LeadViewOwn) {
		return true
	}
	if !context.HasPermission(permissions.LeadViewTeam) {
		return false
	}
	if lead.TeamID != "" {
		return context.LeadsTeam(lead.TeamID)
	}
	// Compatibility only until every historical lead has an explicit team_id.
	return lead.AssignedUserID != "" && context.LeadsUser(lead.AssignedUserID)
}

func CanOperateLead(context tenant.Context, lead LeadResource) bool {
	return CanViewLead(context, lead) && context.HasPermission(permissions.LeadOperate)
}

func CanDeleteLead(context tenant.Context, lead LeadResource) bool {
	return CanViewLead(context, lead) && context.HasPermission(permissions.LeadDelete)
}

func CanCreateLead(context tenant.Context) bool {
	return context.IsOrganizationMember() && context.HasPermission(permissions.LeadCreate)
}
