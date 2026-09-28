package leads

import (
	"github.com/vimob-crm/vimob-crm/apps/api/internal/authorization"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// leadOperationCapability uses the same resource boundary as write endpoints.
// A team leader may read a broker's lead from another team without being able
// to change that lead.
func leadOperationCapability(tenantContext tenant.Context, assignedUserID string, teamID string) bool {
	return authorization.CanOperateLead(tenantContext, authorization.LeadResource{
		AssignedUserID: assignedUserID,
		TeamID:         teamID,
	})
}

func withLeadOperationCapability(tenantContext tenant.Context, lead Lead) Lead {
	canOperate := leadOperationCapability(tenantContext, lead.AssignedUserID, lead.TeamID)
	lead.CanOperate = &canOperate
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
	lead.CanOperate = leadOperationCapability(tenantContext, assignedUserID, teamID)
	return lead
}
