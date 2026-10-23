package authorization

import (
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestPrivateQueuePoolAudienceOverridesBroadLeadScope(t *testing.T) {
	allowed, denied := true, false
	context := tenant.Context{UserID: "actor", MemberRole: "admin"}
	if CanViewLead(context, LeadResource{QueuePoolReadAccess: &denied}) {
		t.Fatal("broad scope bypassed the definitive pool audience")
	}
	if !CanViewLead(tenant.Context{UserID: "member"}, LeadResource{QueuePoolReadAccess: &allowed}) {
		t.Fatal("authorized queue member cannot view the pool")
	}
	if !CanViewLead(context, LeadResource{}) {
		t.Fatal("legacy non-pool admin scope changed")
	}
}

func TestPrivateQueuePoolDoesNotGrantOrdinaryMutation(t *testing.T) {
	allowed := true
	context := tenant.Context{UserID: "actor", MemberRole: "admin", Permissions: []string{permissions.LeadOperate, permissions.LeadDelete}}
	pool := LeadResource{QueuePoolReadAccess: &allowed}
	if CanOperateLead(context, pool) || CanDeleteLead(context, pool) || CanUseLeadForMutation(context, pool) {
		t.Fatal("pool read audience widened generic mutation; use atomic claim first")
	}
}
