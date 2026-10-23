package schedule

import (
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestHistoryDetailsRequiresAgendaModuleAndViewEvenForManagers(t *testing.T) {
	for _, item := range []struct {
		name            string
		actor           tenant.Context
		read, requester bool
	}{
		{"lead only", tenant.Context{Permissions: []string{permissions.LeadViewAll}}, false, false},
		{"module only", tenant.Context{EnabledModules: []string{"agenda"}}, false, false},
		{"view without module", tenant.Context{Permissions: []string{permissions.ScheduleView}}, false, false},
		{"manage only", tenant.Context{EnabledModules: []string{"agenda"}, Permissions: []string{permissions.ScheduleManage}}, false, false},
		{"viewer", tenant.Context{EnabledModules: []string{"agenda"}, Permissions: []string{permissions.ScheduleView}}, true, true},
		{"leader", tenant.Context{EnabledModules: []string{"agenda"}, IsTeamLeader: true, Permissions: []string{permissions.ScheduleView}}, true, true},
		{"admin no module", tenant.Context{MemberRole: "admin"}, false, false},
		{"owner no module", tenant.Context{MemberRole: "owner"}, false, false},
		{"superadmin no module", tenant.Context{IsSuperAdmin: true}, false, false},
		{"admin", tenant.Context{EnabledModules: []string{"agenda"}, MemberRole: "admin"}, true, false},
		{"owner", tenant.Context{EnabledModules: []string{"agenda"}, MemberRole: "owner"}, true, false},
		{"superadmin", tenant.Context{EnabledModules: []string{"agenda"}, IsSuperAdmin: true}, true, false},
	} {
		t.Run(item.name, func(t *testing.T) {
			if CanReadHistoryDetails(item.actor) != item.read || HistoryDetailsRequesterRequired(item.actor) != item.requester {
				t.Fatalf("incorrect independent Agenda gate: read=%v requester=%v", CanReadHistoryDetails(item.actor), HistoryDetailsRequesterRequired(item.actor))
			}
			sql := HistoryDetailsScopeSQL(item.actor, "history_schedule", "$9")
			if !item.read && sql != "false" {
				t.Fatal("disabled access has an event scope")
			}
			if item.read && !item.requester && sql != "true" {
				t.Fatal("manager scope unexpectedly needs an unused bind")
			}
		})
	}
}

func TestHistoryDetailsScopePreservesParticipantPublicAndActiveTeamRules(t *testing.T) {
	actor := tenant.Context{EnabledModules: []string{"agenda"}, Permissions: []string{permissions.ScheduleView}}
	sql := HistoryDetailsScopeSQL(actor, "history_schedule", "$9")
	for _, fragment := range []string{
		"history_schedule.user_id = $9::uuid", "history_assignee.user_id = $9::uuid",
		"history_assignee.organization_id = history_schedule.organization_id", "history_assignee.event_id = history_schedule.id",
		"history_schedule.visibility = 'public'", "history_schedule.visibility = 'default' and",
		strings.ReplaceAll(scheduleEventTeamLeaderScopeSQL("$9"), "se.", "history_schedule."),
	} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("missing existing Agenda rule %s", fragment)
		}
	}
	for _, forbidden := range []string{"visibility = 'private'", "lead_view", "schedule_manage", "se."} {
		if strings.Contains(sql, forbidden) {
			t.Fatalf("history expanded or mis-aliased Agenda scope %s", forbidden)
		}
	}
}
