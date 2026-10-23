package leads

import (
	"fmt"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/schedule"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type leadHistoryScheduleScope struct {
	actor           tenant.Context
	userPlaceholder string
}

func leadHistoryScheduleQueryScope(actor tenant.Context, args []any) (leadHistoryScheduleScope, []any) {
	scope := leadHistoryScheduleScope{actor: actor}
	if schedule.HistoryDetailsRequesterRequired(actor) {
		args = append(args, actor.UserID)
		scope.userPlaceholder = fmt.Sprintf("$%d", len(args))
	}
	return scope, args
}

// Classification is also used by the independent Data API policy. Treat a
// malformed reference as protected; never let it fall back to original text.
func leadHistoryScheduleRecordSQL(kind, metadata string) string {
	return schedule.HistoryRecordSQL(kind, metadata)
}

func leadHistoryScheduleTypeSQL(kind string) string {
	normalized := "lower(btrim(" + kind + "))"
	return `(case when ` + normalized + ` in (
		'agenda_created','agenda_rescheduled','agenda_completed','agenda_no_show',
		'agenda_cancelled','agenda_commented','agenda_updated','visit_scheduled',
		'visit_confirmed','visit_made','meeting_scheduled','meeting_held','meeting_made')
		then ` + normalized + ` else 'agenda_updated' end)`
}

// Guard the RHS cast instead of casting the indexed schedule primary key.
// JSON arrays, booleans, objects, null and malformed IDs fail closed safely.
func leadHistoryScheduleIDSQL(metadata string) string {
	return schedule.HistoryEventIDSQL(metadata)
}

func leadHistoryScheduleOccurrenceSQL(alias, kind, ordinary string) string {
	return `(case when ` + leadHistoryScheduleRecordSQL(alias+"."+kind, alias+".metadata") + `
		then coalesce(` + alias + `.created_at,'epoch'::timestamptz) else ` + ordinary + ` end)`
}

func leadHistoryScheduleTimelineSQL(alias, ordinary string, scope leadHistoryScheduleScope) string {
	return leadHistoryScheduleProjectionSQL(alias, "event_type", ordinary, true, scope)
}

func leadHistoryScheduleActivitySQL(alias, ordinary string, scope leadHistoryScheduleScope) string {
	return leadHistoryScheduleProjectionSQL(alias, "type", ordinary, false, scope)
}

func leadHistoryScheduleProjectionSQL(alias, typeField, ordinary string, timeline bool, scope leadHistoryScheduleScope) string {
	kind := leadHistoryScheduleTypeSQL(alias + "." + typeField)
	identity := `'id',` + alias + `.id::text,'organization_id',` + alias + `.organization_id::text,
		'lead_id',` + alias + `.lead_id::text,'created_at',` + alias + `.created_at,`
	fields := `'type',` + kind + `,'content',null,'user_id',null,'user',null,`
	if timeline {
		fields = `'event_type',` + kind + `,'event_at',` + alias + `.created_at,
			'title',null,'description',null,'user_id',null,'actor_user_id',null,'actor',null,`
	}
	generic := `jsonb_build_object(` + identity + fields + `'metadata','{}'::jsonb)`
	protected := generic
	if schedule.CanReadHistoryDetails(scope.actor) {
		fullFields := `'type',` + kind + `,'content',null,
			'user_id',` + alias + `.user_id::text,'user',(` + ordinary + `)->'user','lead',(` + ordinary + `)->'lead',`
		if timeline {
			fullFields = `'event_type',` + kind + `,'event_at',` + alias + `.created_at,
				'title',null,'description',null,'user_id',` + alias + `.user_id::text,
				'actor_user_id',` + alias + `.actor_user_id::text,'actor',(` + ordinary + `)->'actor',`
		}
		full := `jsonb_build_object(` + identity + fullFields + `'metadata',jsonb_strip_nulls(jsonb_build_object(
			'schedule_event_id',history_schedule.id::text,'event_title',history_schedule.title,
			'event_type',history_schedule.event_type,'start_time',` + leadHistoryScheduleStartTimeSQL(alias+".metadata") + `,
			'time_zone',` + leadHistoryScheduleTimeZoneSQL("history_schedule.organization_id") + `)))`
		// Both identifiers are required. A lead move, deletion, malformed ID or
		// stale cross-organization reference gives only the generic fact.
		protected = `coalesce((select ` + full + ` from public.schedule_events history_schedule
			where history_schedule.organization_id = ` + alias + `.organization_id
			  and history_schedule.lead_id = ` + alias + `.lead_id
			  and history_schedule.id = ` + leadHistoryScheduleIDSQL(alias+".metadata") + `
			  and ` + schedule.HistoryDetailsScopeSQL(scope.actor, "history_schedule", scope.userPlaceholder) + `
			limit 1),` + generic + `)`
	}
	return `(case when ` + leadHistoryScheduleRecordSQL(alias+"."+typeField, alias+".metadata") + `
		then ` + protected + ` else ` + ordinary + ` end)`
}

// Used only for actor hydration, never to remove the generic history fact.
func leadHistoryScheduleActorSQL(alias, typeField string, scope leadHistoryScheduleScope) string {
	return schedule.HistoryReadableRecordSQL(scope.actor, alias, typeField, scope.userPlaceholder)
}

func leadHistoryScheduleTimeZoneSQL(organization string) string {
	return `coalesce((select nullif(btrim(settings.timezone),'') from public.organization_attention_settings settings
		where settings.organization_id = ` + organization + ` limit 1),'America/Sao_Paulo')`
}
