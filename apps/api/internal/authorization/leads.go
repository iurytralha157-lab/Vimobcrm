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
	return (lead.TeamID != "" && context.LeadsTeam(lead.TeamID)) ||
		(lead.AssignedUserID != "" && context.LeadsUser(lead.AssignedUserID))
}

func CanOperateLead(context tenant.Context, lead LeadResource) bool {
	return canMutateLead(context, lead) && context.HasPermission(permissions.LeadOperate)
}

func CanDeleteLead(context tenant.Context, lead LeadResource) bool {
	return canMutateLead(context, lead) && context.HasPermission(permissions.LeadDelete)
}

// CanUseLeadForMutation checks the original resource scope when a caller has
// already checked the permission for its specific write operation.
func CanUseLeadForMutation(context tenant.Context, lead LeadResource) bool {
	return canMutateLead(context, lead)
}

// A leader's broader broker-based visibility must not expand the existing
// mutation boundary for leads recorded under another team.
func canMutateLead(context tenant.Context, lead LeadResource) bool {
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
	return lead.AssignedUserID != "" && context.LeadsUser(lead.AssignedUserID)
}

func CanCreateLead(context tenant.Context) bool {
	return context.IsOrganizationMember() && context.HasPermission(permissions.LeadCreate)
}
