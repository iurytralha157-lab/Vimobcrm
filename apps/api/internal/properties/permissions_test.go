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

func TestPropertyAssignmentChangeDetection(t *testing.T) {
	current := propertySnapshot{
		CreatorID:         "creator-1",
		ResponsibleUserID: "responsible-1",
	}

	if isPropertyAssignmentChange(propertyRequest{
		"responsible_user_id": "responsible-2",
	}, current) != true {
		t.Fatal("changing responsible_user_id should be detected")
	}

	if isPropertyAssignmentChange(propertyRequest{
		"responsible_user_id": "responsible-1",
	}, current) {
		t.Fatal("unchanged responsible_user_id should not be treated as transfer")
	}

	if isPropertyAssignmentChange(propertyRequest{
		"cadastrado_por": "responsible-2",
	}, current) != true {
		t.Fatal("changing legacy cadastrado_por should be detected as transfer")
	}
}

func TestCanEditPropertyHonorsOrganizationPolicy(t *testing.T) {
	userContext := tenant.Context{
		UserID:         "user-1",
		OrganizationID: "org-1",
		MemberRole:     "user",
	}

	if !canEditProperty(userContext, "other-user", "another-user", "everyone") {
		t.Fatal("regular organization users should edit property details when policy is everyone")
	}

	if canEditProperty(userContext, "other-user", "another-user", "responsible_or_admin") {
		t.Fatal("regular organization users should not edit another user's property under restricted policy")
	}
}

func TestCanUpdatePropertyAvailabilityAllowsOnlyStatusAndPublication(t *testing.T) {
	userContext := tenant.Context{
		UserID:         "user-1",
		OrganizationID: "org-1",
		MemberRole:     "user",
	}

	if !canUpdatePropertyAvailability(userContext, propertyRequest{
		"status":            "reserved",
		"published_on_site": false,
	}) {
		t.Fatal("regular organization users should update property availability fields")
	}

	if canUpdatePropertyAvailability(userContext, propertyRequest{
		"status": "reserved",
		"title":  "Changed title",
	}) {
		t.Fatal("availability update must not allow property detail fields")
	}

	if canUpdatePropertyAvailability(userContext, propertyRequest{
		"status": "archived",
	}) {
		t.Fatal("availability update must not allow archival statuses")
	}

	if canUpdatePropertyAvailability(tenant.Context{UserID: "user-1"}, propertyRequest{
		"status": "reserved",
	}) {
		t.Fatal("availability update requires organization context")
	}
}
