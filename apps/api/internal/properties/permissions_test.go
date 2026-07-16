package properties

import (
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestCanCreatePropertyOwners(t *testing.T) {
	userContext := tenant.Context{
		UserID:         "user-1",
		OrganizationID: "org-1",
		MemberRole:     "user",
	}

	if canCreatePropertyOwners(userContext) {
		t.Fatal("property_view alone must not create property owners")
	}

	if canCreateProperties(userContext) {
		t.Fatal("property_view alone must not create properties")
	}

	if canManageProperties(userContext) {
		t.Fatal("regular organization users should not receive full property management access")
	}

	managerContext := tenant.Context{
		UserID:         "user-2",
		OrganizationID: "org-1",
		MemberRole:     "user",
		Permissions:    []string{"property_manage"},
	}
	if !canCreatePropertyOwners(managerContext) || !canCreateProperties(managerContext) {
		t.Fatal("property_manage must allow creating properties and owners")
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
		Permissions:    []string{"property_manage"},
	}
	if !canAssignProperties(customPermissionContext) {
		t.Fatal("property_manage permission should allow transfers")
	}
}

func TestPropertyVisibilitySQLIncludesOwnAndTeamPredicates(t *testing.T) {
	clause := propertyVisibilitySQL("$2", "$3", "$4", "p")
	if !strings.Contains(clause, "p.responsible_user_id = $3::uuid") {
		t.Fatalf("scoped visibility must include responsible properties: %s", clause)
	}
	if !strings.Contains(clause, "p.created_by = $3::uuid") {
		t.Fatalf("scoped visibility must include properties created by the user: %s", clause)
	}
	if !strings.Contains(clause, "public.team_members leader") {
		t.Fatalf("team leaders must be scoped through team membership: %s", clause)
	}
}

func TestCanViewAllPropertiesHonorsExplicitPermission(t *testing.T) {
	managerContext := tenant.Context{
		UserID:         "manager-1",
		OrganizationID: "org-1",
		MemberRole:     "manager",
	}
	if canViewAllProperties(managerContext) {
		t.Fatal("manager role must not bypass the effective permission set")
	}

	userContext := tenant.Context{
		UserID:         "user-1",
		OrganizationID: "org-1",
		MemberRole:     "user",
	}
	if canViewAllProperties(userContext) {
		t.Fatal("regular users should not see all organization properties")
	}

	viewAllContext := tenant.Context{
		UserID:         "user-2",
		OrganizationID: "org-1",
		MemberRole:     "user",
		Permissions:    []string{"property_view_all"},
	}
	if !canViewAllProperties(viewAllContext) {
		t.Fatal("property_view_all permission should allow full property visibility")
	}
}

func TestCanViewTeamPropertiesHonorsTeamLeaderScope(t *testing.T) {
	if !canViewTeamProperties(tenant.Context{IsTeamLeader: true}) {
		t.Fatal("team leaders should be allowed to see team-scoped properties")
	}

	if !canViewTeamProperties(tenant.Context{Permissions: []string{"lead_view_team"}}) {
		t.Fatal("lead_view_team permission should allow team-scoped properties")
	}

	if canViewTeamProperties(tenant.Context{MemberRole: "user"}) {
		t.Fatal("regular users should not see team-scoped properties")
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

func TestCanEditPropertyRequiresPropertyManage(t *testing.T) {
	userContext := tenant.Context{
		UserID:         "user-1",
		OrganizationID: "org-1",
		MemberRole:     "user",
	}

	if canEditProperty(userContext, "other-user", "another-user") {
		t.Fatal("regular organization users should not edit another user's property details")
	}

	if canEditProperty(userContext, "user-1", "another-user") {
		t.Fatal("ownership must not bypass a denied property_manage permission")
	}

	if canEditProperty(userContext, "other-user", "user-1") {
		t.Fatal("responsibility must not bypass a denied property_manage permission")
	}

	adminContext := tenant.Context{
		UserID:         "admin-1",
		OrganizationID: "org-1",
		MemberRole:     "admin",
	}
	if !canEditProperty(adminContext, "other-user", "another-user") {
		t.Fatal("property managers should edit any organization property")
	}
}

func TestCanUpdatePropertyAvailabilityAllowsOnlyStatusAndPublication(t *testing.T) {
	userContext := tenant.Context{
		UserID:         "user-1",
		OrganizationID: "org-1",
		MemberRole:     "user",
		Permissions:    []string{"property_manage"},
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

	if canUpdatePropertyAvailability(tenant.Context{
		UserID:         "user-2",
		OrganizationID: "org-1",
		MemberRole:     "user",
	}, propertyRequest{"status": "reserved"}) {
		t.Fatal("availability update requires property_manage")
	}
}
