package authorization

import (
	"github.com/vimob-crm/vimob-crm/apps/api/internal/leadscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type LeadResource struct {
	AssignedUserID string
	TeamID         string
}

func CanViewLead(context tenant.Context, lead LeadResource) bool {
	if leadscope.CanViewAll(context) {
		return true
	}
	if lead.AssignedUserID != "" && lead.AssignedUserID == context.UserID && leadscope.CanViewOwn(context) {
		return true
	}
	if !leadscope.CanViewTeam(context) {
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
