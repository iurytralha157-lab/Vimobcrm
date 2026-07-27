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
	if canAssignAnyScheduleUser(standard) {
		t.Fatal("schedule_manage must not grant organization-wide assignment")
	}

	readOnly := tenant.Context{UserID: "user-1", Permissions: []string{permissions.ScheduleView}}
	if !canViewSchedule(readOnly) || canManageSchedule(readOnly) {
		t.Fatal("read-only user should view without mutating")
	}

	admin := tenant.Context{UserID: "admin", MemberRole: "admin"}
	if !canViewSchedule(admin) || !canManageSchedule(admin) || !canViewAllScheduleEvents(admin) {
		t.Fatal("admin should have complete schedule access")
	}
	if !canAssignAnyScheduleUser(admin) {
		t.Fatal("admin should assign any active organization user")
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

func TestScheduleParticipantKeepsEventAccessAfterLeadTransfer(t *testing.T) {
	query := scheduleEventLeadVisibilitySQL("false", "$2", "$3", "$4", "$5", false)
	if !strings.Contains(query, "se.user_id = $2::uuid") {
		t.Fatal("event owner should keep access independently from the linked lead")
	}
	if !strings.Contains(query, "participant.user_id = $2::uuid") {
		t.Fatal("explicit event assignee should keep access independently from the linked lead")
	}
	if !strings.Contains(query, "l.assigned_user_id = $4::uuid") {
		t.Fatal("non-participants should still depend on lead visibility")
	}
}

func TestSchedulePropertyVisibilityRequiresPropertyPermission(t *testing.T) {
	standard := tenant.Context{UserID: "user-1", Permissions: []string{permissions.ScheduleView, permissions.ScheduleManage}}
	if canViewProperties(standard) {
		t.Fatal("schedule permissions must not grant property visibility")
	}

	viewer := tenant.Context{UserID: "user-1", Permissions: []string{permissions.PropertyView}}
	if !canViewProperties(viewer) {
		t.Fatal("property_view should grant catalog visibility under the unified permission catalog")
	}
}

func TestScheduleVisibilityMasksDefaultForNonParticipants(t *testing.T) {
	query := scheduleEventsQuery("true")
	if !strings.Contains(query, "and not base.is_team_leader") {
		t.Fatal("default events should expose only busy time to non-participants")
	}
	if strings.Contains(query, "(base.visibility = 'public' and not base.is_participant and not base.is_manager) as is_masked") {
		t.Fatal("public events should expose their permitted details")
	}
	if !strings.Contains(query, "where base.visibility <> 'private'") {
		t.Fatal("private events should remain hidden from non-participants")
	}
}

func TestScheduleDefaultVisibilityIsOrganizationWide(t *testing.T) {
	scope := scheduleEventListScopeSQL("$2", "$3")
	if !strings.Contains(scope, "se.visibility in ('default', 'public')") {
		t.Fatal("default and public events should be listed for every organization user with schedule access")
	}
	if !strings.Contains(scope, scheduleEventScopeSQL("$2", "$3")) {
		t.Fatal("private events should keep the regular schedule scope")
	}

	leadScope := scheduleEventListLeadVisibilitySQL("$3", "$2", "$4", "$5", "$6", true)
	if !strings.Contains(leadScope, "se.visibility in ('default', 'public')") {
		t.Fatal("organization-wide default and public events must not depend on lead access")
	}
	if !strings.Contains(leadScope, scheduleEventLeadVisibilitySQL("$3", "$2", "$4", "$5", "$6", true)) {
		t.Fatal("private events should keep the regular lead visibility rules")
	}
}

func TestScheduleTeamLeaderSeesDefaultDetailsButNotPrivateEvents(t *testing.T) {
	query := scheduleEventsQuery("true")
	leaderScope := scheduleEventTeamLeaderScopeSQL("$2")

	if !strings.Contains(query, leaderScope+" as is_team_leader") {
		t.Fatal("schedule query should identify leaders for the event owner's or assignee's team")
	}
	if !strings.Contains(query, "and not base.is_team_leader") {
		t.Fatal("team leaders should receive default event details instead of a masked busy block")
	}
	if strings.Contains(query, "or base.is_team_leader") {
		t.Fatal("team leadership alone must not expose private events")
	}
}
