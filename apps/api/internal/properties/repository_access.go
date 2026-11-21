package properties

import (
	"fmt"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func basePropertyWhere(tenantContext tenant.Context) ([]any, []string) {
	return []any{tenantContext.OrganizationID}, []string{"p.organization_id = $1::uuid"}
}

func addScopedPropertyVisibility(args []any, where []string, tenantContext tenant.Context, alias string, requestedScope string) ([]any, []string) {
	forceOwn := requestedScope == "own"
	args = append(
		args,
		canViewAllProperties(tenantContext) && !forceOwn,
		tenantContext.UserID,
		canViewTeamProperties(tenantContext) && !forceOwn,
	)
	canViewAllIndex := len(args) - 2
	userIDIndex := len(args) - 1
	canViewTeamIndex := len(args)
	where = append(where, propertyVisibilitySQL(
		fmt.Sprintf("$%d", canViewAllIndex),
		fmt.Sprintf("$%d", userIDIndex),
		fmt.Sprintf("$%d", canViewTeamIndex),
		alias,
	))
	return args, where
}

func propertyVisibilitySQL(canViewAllPlaceholder string, userIDPlaceholder string, canViewTeamPlaceholder string, alias string) string {
	return propertyscope.VisibilitySQL(alias, canViewAllPlaceholder, userIDPlaceholder, canViewTeamPlaceholder)
}

func canViewAllProperties(tenantContext tenant.Context) bool {
	return propertyscope.CanViewAll(tenantContext)
}

func canViewTeamProperties(tenantContext tenant.Context) bool {
	return propertyscope.CanViewTeam(tenantContext)
}

func canManageProperties(tenantContext tenant.Context) bool {
	return propertyscope.CanViewAll(tenantContext)
}

func canCreateProperties(tenantContext tenant.Context) bool {
	return canManageProperties(tenantContext)
}

func canCreatePropertyOwners(tenantContext tenant.Context) bool {
	return canManageProperties(tenantContext)
}

func canAssignProperties(tenantContext tenant.Context) bool {
	return canManageProperties(tenantContext)
}

func isPropertyAssignmentChange(input propertyRequest, current propertySnapshot) bool {
	if value, ok := input["created_by"]; ok && !sameOptionalUUID(value, current.CreatorID) {
		return true
	}
	if value, ok := input["responsible_user_id"]; ok && !sameOptionalUUID(value, current.ResponsibleUserID) {
		return true
	}
	if value, ok := input["cadastrado_por"]; ok && !sameOptionalUUID(value, current.ResponsibleUserID) {
		return true
	}
	return false
}

func sameOptionalUUID(value any, current string) bool {
	var next string
	switch typed := value.(type) {
	case nil:
		next = ""
	case string:
		next = strings.TrimSpace(typed)
	default:
		next = strings.TrimSpace(fmt.Sprint(typed))
	}
	return next == strings.TrimSpace(current)
}

func canEditProperty(tenantContext tenant.Context, creatorID string, responsibleUserID string) bool {
	return canManageProperties(tenantContext)
}

func canUpdatePropertyAvailability(tenantContext tenant.Context, input propertyRequest) bool {
	return canManageProperties(tenantContext) && isPropertyAvailabilityUpdate(input)
}

func isPropertyAvailabilityUpdate(input propertyRequest) bool {
	if len(input) == 0 {
		return false
	}

	for key := range input {
		switch key {
		case "status":
			status, ok := input[key].(string)
			if !ok || !isQuickPropertyStatus(status) {
				return false
			}
		case "published_on_site":
		default:
			return false
		}
	}

	return true
}

func isQuickPropertyStatus(status string) bool {
	switch status {
	case "active", "reserved", "sold", "rented":
		return true
	default:
		return false
	}
}

func canDeleteProperties(tenantContext tenant.Context) bool {
	return canManageProperties(tenantContext)
}
