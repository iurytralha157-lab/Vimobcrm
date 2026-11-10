package leads

import (
	"github.com/vimob-crm/vimob-crm/apps/api/internal/authorization"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func canProgressLeadSnapshot(actor tenant.Context, current leadSnapshot) bool {
	return !isQueuePoolSnapshot(current) && authorization.CanProgressLead(actor, authorization.LeadResource{
		AssignedUserID: current.AssignedUserID,
		TeamID:         current.TeamID,
	})
}

func withLeadOperationCapability(tenantContext tenant.Context, lead Lead) Lead {
	resource := authorization.LeadResource{
		AssignedUserID:      lead.AssignedUserID,
		TeamID:              lead.TeamID,
		QueuePoolReadAccess: lead.QueuePoolReadAccess,
	}
	canOperate := authorization.CanOperateLead(tenantContext, resource)
	canProgress := authorization.CanProgressLead(tenantContext, resource)
	lead.CanOperate = &canOperate
	lead.CanProgress = &canProgress
	return lead
}

func withPipelineLeadOperationCapability(tenantContext tenant.Context, lead PipelineBoardLead) PipelineBoardLead {
	assignedUserID := ""
	if lead.AssignedUserID != nil {
		assignedUserID = *lead.AssignedUserID
	}
	teamID := ""
	if lead.TeamID != nil {
		teamID = *lead.TeamID
	}
	if lead.QueuePool == nil {
		resource := authorization.LeadResource{AssignedUserID: assignedUserID, TeamID: teamID}
		lead.CanOperate = authorization.CanOperateLead(tenantContext, resource)
		lead.CanProgress = authorization.CanProgressLead(tenantContext, resource)
	} else {
		lead.CanOperate, lead.CanProgress = false, false
	}
	return lead
}
