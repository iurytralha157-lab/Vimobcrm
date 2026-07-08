package properties

import (
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestCanCreatePropertyOwners(t *testing.T) {
	userContext := tenant.Context{
		UserID:         "user-1",
		OrganizationID: "org-1",
		MemberRole:     "user",
	}

	if !canCreatePropertyOwners(userContext) {
		t.Fatal("regular organization users should be able to create property owners")
	}

	if !canCreateProperties(userContext) {
		t.Fatal("regular organization users should be able to create properties")
	}

	if canManageProperties(userContext) {
		t.Fatal("regular organization users should not receive full property management access")
	}
}

func TestCanCreatePropertyOwnersRequiresOrganizationMember(t *testing.T) {
	if canCreatePropertyOwners(tenant.Context{UserID: "user-1", MemberRole: "user"}) {
		t.Fatal("users without organization context should not create property owners")
	}

	if canCreatePropertyOwners(tenant.Context{OrganizationID: "org-1", MemberRole: "user"}) {
		t.Fatal("organization context without user should not create property owners")
	}

	if canCreateProperties(tenant.Context{UserID: "user-1", MemberRole: "user"}) {
		t.Fatal("users without organization context should not create properties")
	}

	if canCreateProperties(tenant.Context{OrganizationID: "org-1", MemberRole: "user"}) {
		t.Fatal("organization context without user should not create properties")
	}
}

func TestCanAssignPropertiesRequiresManagerPermission(t *testing.T) {
	userContext := tenant.Context{
		UserID:         "user-1",
		OrganizationID: "org-1",
		MemberRole:     "user",
	}
	if canAssignProperties(userContext) {
		t.Fatal("regular users should not transfer properties to other owners")
	}

	adminContext := tenant.Context{
		UserID:         "admin-1",
		OrganizationID: "org-1",
		MemberRole:     "admin",
	}
	if !canAssignProperties(adminContext) {
		t.Fatal("admins should be able to transfer property responsibility")
	}

	customPermissionContext := tenant.Context{
		UserID:         "manager-1",
		OrganizationID: "org-1",
		MemberRole:     "user",
		Permissions:    []string{"property_assign"},
	}
	if !canAssignProperties(customPermissionContext) {
		t.Fatal("explicit property_assign permission should allow transfers")
	}
}
