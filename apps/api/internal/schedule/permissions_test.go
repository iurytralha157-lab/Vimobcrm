package schedule

import (
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestSchedulePermissionAndScopeAreIndependent(t *testing.T) {
	standard := tenant.Context{UserID: "user-1", Permissions: []string{permissions.ScheduleView, permissions.ScheduleManage}}
	if !canViewSchedule(standard) || !canManageSchedule(standard) {
		t.Fatal("standard defaults should manage events in scope")
	}
	if canViewAllScheduleEvents(standard) {
		t.Fatal("schedule_manage must not grant organization-wide access")
	}

	readOnly := tenant.Context{UserID: "user-1", Permissions: []string{permissions.ScheduleView}}
	if !canViewSchedule(readOnly) || canManageSchedule(readOnly) {
		t.Fatal("read-only user should view without mutating")
	}

	admin := tenant.Context{UserID: "admin", MemberRole: "admin"}
	if !canViewSchedule(admin) || !canManageSchedule(admin) || !canViewAllScheduleEvents(admin) {
		t.Fatal("admin should have complete schedule access")
	}
}

func TestScheduleLeadVisibilityRespectsOwnPermissionAndExplicitTeam(t *testing.T) {
	query := leadVisibilitySQL("$3", "$4", "$5", false)
	if !strings.Contains(query, "(false and l.assigned_user_id = $4::uuid)") {
		t.Fatal("own-lead access should be disabled")
	}
	if !strings.Contains(query, "to_jsonb(l)->>'team_id'") {
		t.Fatal("explicit team_id should be preferred")
	}
	if !strings.Contains(query, "is null") {
		t.Fatal("legacy null team_id fallback should remain")
	}
}
