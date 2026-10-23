package leads

import (
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func agendaHistoryTestActor() tenant.Context {
	return tenant.Context{OrganizationID: historyPageTestOrg, UserID: historyPageTestOtherOrg,
		EnabledModules: []string{"agenda"}, Permissions: []string{permissions.ScheduleView}}
}

func agendaHistoryMaxBind(sql string) int {
	maximum := 0
	for _, match := range regexp.MustCompile(`\$([0-9]+)`).FindAllStringSubmatch(sql, -1) {
		value, _ := strconv.Atoi(match[1])
		maximum = max(maximum, value)
	}
	return maximum
}

func TestAgendaHistoryQueryScopeBindsOnlyParametersActuallyUsed(t *testing.T) {
	for _, role := range []string{"user", "leader", "admin", "owner", "superadmin", "module off", "no view"} {
		t.Run(role, func(t *testing.T) {
			actor := agendaHistoryTestActor()
			switch role {
			case "leader":
				actor.IsTeamLeader = true
			case "admin", "owner":
				actor.MemberRole = role
			case "superadmin":
				actor.IsSuperAdmin = true
			case "module off":
				actor.EnabledModules = nil
			case "no view":
				actor.Permissions = nil
			}
			base := []any{actor.OrganizationID, historyPageTestLead}
			scope, args := leadHistoryScheduleQueryScope(actor, base)
			sql := `select ` + leadHistoryScheduleTimelineSQL("e", "to_jsonb(e)", scope) + ` from public.lead_timeline_events e where e.organization_id=$1::uuid and e.lead_id=$2::uuid`
			if agendaHistoryMaxBind(sql) != len(args) {
				t.Fatalf("bind count differs from generated SQL: args=%d max=%d", len(args), agendaHistoryMaxBind(sql))
			}
			_, pageArgs := leadHistoryScheduleQueryScope(actor, make([]any, 8))
			if agendaHistoryMaxBind(leadHistoryPageSQL(actor)) != len(pageArgs) {
				t.Fatal("paged query includes an extra unused requester bind")
			}
			if len(args) == 3 && args[2] != actor.UserID {
				t.Fatal("bound an actor from another context")
			}
			if !reflect.DeepEqual(base, []any{actor.OrganizationID, historyPageTestLead}) {
				t.Fatal("scope mutated caller arguments")
			}
		})
	}
}

func TestAgendaHistoryProjectionKeepsGenericFactsAndWhitelistsReadableContext(t *testing.T) {
	actor := agendaHistoryTestActor()
	scope, _ := leadHistoryScheduleQueryScope(actor, make([]any, 2))
	for _, timeline := range []bool{true, false} {
		t.Run(strconv.FormatBool(timeline), func(t *testing.T) {
			field := "type"
			if timeline {
				field = "event_type"
			}
			sql := leadHistoryScheduleProjectionSQL("e", field, "original_document", timeline, scope)
			for _, required := range []string{"history_schedule.organization_id = e.organization_id", "history_schedule.lead_id = e.lead_id",
				"history_schedule.id = (case when jsonb_typeof", "'event_title',history_schedule.title", "'start_time',", "'time_zone',", "else original_document end"} {
				if !strings.Contains(sql, required) {
					t.Fatalf("missing scoped projection %s", required)
				}
			}
			for _, forbidden := range []string{"history_schedule.id::text =", "history_schedule.description", "history_schedule.start_time", "pg_timezone_names", "'assigned_to'", "'comment'", "'outcome_notes'"} {
				if strings.Contains(sql, forbidden) {
					t.Fatalf("projection includes raw/private or expensive context %s", forbidden)
				}
			}
			generic := leadHistoryScheduleProjectionSQL("e", field, "original_document", timeline, leadHistoryScheduleScope{})
			if strings.Contains(generic, "from public.schedule_events") || !strings.Contains(generic, "'user_id',null") || !strings.Contains(generic, "'metadata','{}'::jsonb") {
				t.Fatal("generic fact leaked context or disappeared")
			}
		})
	}
}

func TestAgendaHistoryActorsAndCandidateOccurrenceDoNotUsePrivateMetadata(t *testing.T) {
	actor := agendaHistoryTestActor()
	scope, _ := leadHistoryScheduleQueryScope(actor, make([]any, 2))
	for _, pair := range [][2]string{{"e", "event_type"}, {"a", "type"}} {
		sql := leadHistoryScheduleActorSQL(pair[0], pair[1], scope)
		if !strings.Contains(sql, "history_schedule.lead_id = "+pair[0]+".lead_id") || !strings.Contains(sql, "not (left(lower(btrim(") {
			t.Fatal("actor lookup bypasses detail access")
		}
	}
	occurrence := leadHistoryPageSources[0].occurrence
	if !strings.Contains(occurrence, "then coalesce(e.created_at,'epoch'::timestamptz) else coalesce(e.event_at") {
		t.Fatal("paged Agenda cursor still reveals scheduled event_at")
	}
	if !strings.Contains(leadHistoryPageSQL(actor), "p.data->>'actor_user_id'") {
		t.Fatal("ordinary actors stopped hydrating from page projections")
	}
}

func TestAgendaHistoryListActivitiesPreservesPropertyScopeAndBoundedHydration(t *testing.T) {
	actor := agendaHistoryTestActor()
	sql := leadHistoryScheduleActivityListSQL(actor, []string{"a.organization_id=$1::uuid", "l.organization_id=$1::uuid", "l.assigned_user_id=$3::uuid"}, "PROPERTY_ACCESS_GUARD", 5)
	for _, required := range []string{"visible_activity as materialized", "limit $5", "history_activity as materialized", "PROPERTY_ACCESS_GUARD", "activity_property.id is not null", "a.history_document", "from history_activity"} {
		if !strings.Contains(sql, required) {
			t.Fatalf("activity projection lost contract %s", required)
		}
	}
	if strings.Index(sql, "limit $5") > strings.Index(sql, "history_activity as materialized") {
		t.Fatal("Agenda context hydrated before the bounded list")
	}
	if strings.Count(sql, "from public.schedule_events history_schedule") != 1 {
		t.Fatal("activity detail ACL query repeated per output field")
	}
}

func TestAgendaHistoryActivityScannerAcceptsGenericNullContentAndActor(t *testing.T) {
	at := time.Date(2026, 10, 19, 21, 0, 0, 0, time.UTC)
	for _, kind := range []string{"agenda_created", "agenda_rescheduled", "agenda_completed", "agenda_no_show", "agenda_cancelled", "agenda_commented", "agenda_updated"} {
		t.Run(kind, func(t *testing.T) {
			row := historyScopeRow{scan: func(dest ...any) error {
				if len(dest) != 12 {
					t.Fatal("activity response shape changed")
				}
				*dest[0].(*string) = "44444444-4444-4444-8444-444444444444"
				*dest[1].(*string), *dest[2].(*string) = historyPageTestOrg, historyPageTestLead
				*dest[4].(*string), *dest[6].(*string), *dest[7].(*time.Time) = kind, `{}`, at
				for _, index := range []int{3, 5, 8, 9, 10, 11} {
					if err := dest[index].(*pgtype.Text).Scan(nil); err != nil {
						return err
					}
				}
				return nil
			}}
			activity, err := scanActivity(row)
			if err != nil || activity.UserID != nil || activity.Content != nil || activity.User != nil || activity.Lead != nil || activity.Metadata == nil || len(activity.Metadata) != 0 || activity.Type != kind || activity.CreatedAt != at {
				t.Fatalf("generic activity could not be read safely: %+v %v", activity, err)
			}
		})
	}
}
