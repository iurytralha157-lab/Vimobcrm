package leads

import (
	"errors"
	"fmt"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestManualReentryPoolScopeRequiresClaim(t *testing.T) {
	for _, role := range []string{"admin", "user"} {
		actor := tenant.Context{OrganizationID: "organization", UserID: "actor", UserRole: role, MemberRole: role,
			Permissions: []string{permissions.LeadViewOwn, permissions.LeadOperate, permissions.LeadCreate, permissions.LeadImport}}
		for _, importing := range []bool{false, true} {
			for _, access := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/import=%t/audience=%t", role, importing, access), func(t *testing.T) {
					want := ErrLeadNotFound
					if access {
						want = ErrQueuePoolConflict
					}
					err := authorizeLeadReentry(actor, createInput{ImportMode: importing}, existingLeadMatch{AssignedUserID: actor.UserID, QueuePoolReadAccess: &access})
					if !errors.Is(err, want) {
						t.Fatalf("pooled reentry error=%v, want %v", err, want)
					}
				})
			}
			if err := authorizeLeadReentry(actor, createInput{ImportMode: importing}, existingLeadMatch{AssignedUserID: actor.UserID}); err != nil {
				t.Fatalf("nil pool projection must preserve ordinary owned reentry: role=%s import=%t error=%v", role, importing, err)
			}
		}
	}
}
