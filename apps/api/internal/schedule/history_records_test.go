package schedule

import (
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestHistoryReadableRecordKeepsOrdinaryRecordsAndFailsClosedWithoutModule(t *testing.T) {
	for _, actor := range []tenant.Context{{}, {MemberRole: "admin"}, {IsSuperAdmin: true},
		{EnabledModules: []string{"agenda"}, Permissions: []string{permissions.LeadViewAll}}} {
		sql := HistoryReadableRecordSQL(actor, "a", "type", "$4")
		if strings.Contains(sql, "from public.schedule_events") || !strings.Contains(sql, " or false)") || !strings.Contains(sql, "(not (left(lower(btrim(a.type)),7) = 'agenda_'") {
			t.Fatal("summary leaks Agenda context or removes ordinary activities")
		}
	}
}

func TestHistoryReadableRecordUsesSameOrganizationLeadAndIndexedSafeID(t *testing.T) {
	actor := tenant.Context{EnabledModules: []string{"agenda"}, Permissions: []string{permissions.ScheduleView}}
	sql := HistoryReadableRecordSQL(actor, "a", "type", "$4")
	for _, required := range []string{"history_schedule.organization_id = a.organization_id", "history_schedule.lead_id = a.lead_id",
		"history_schedule.id = " + HistoryEventIDSQL("a.metadata"), HistoryDetailsScopeSQL(actor, "history_schedule", "$4")} {
		if !strings.Contains(sql, required) {
			t.Fatalf("summary omitted canonical Agenda access %s", required)
		}
	}
	if strings.Contains(sql, "history_schedule.id::text =") {
		t.Fatal("cast disabled the schedule primary-key lookup")
	}
	if !strings.Contains(HistoryEventIDSQL("a.metadata"), "jsonb_typeof(a.metadata->'schedule_event_id') = 'string'") {
		t.Fatal("JSON references can be cast before validating their type")
	}
}
