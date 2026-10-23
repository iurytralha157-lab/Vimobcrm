package schedule

import "github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"

// Shared by lead history and bounded activity summaries. A malformed reference
// remains protected, including a present JSON null key or a legacy alias.
func HistoryRecordSQL(kind, metadata string) string {
	return `(left(lower(btrim(` + kind + `)),7) = 'agenda_'
		or lower(btrim(` + kind + `)) in ('visit_scheduled','visit_confirmed','visit_made',
			'meeting_scheduled','meeting_held','meeting_made')
		or coalesce(` + metadata + `,'{}'::jsonb) ? 'schedule_event_id')`
}

// Keep the primary key indexed and guard the free-text reference before UUID
// conversion. Fixed aliases and placeholders must come from internal callers.
func HistoryEventIDSQL(metadata string) string {
	value := "btrim(" + metadata + "->>'schedule_event_id')"
	return `(case when jsonb_typeof(` + metadata + `->'schedule_event_id') = 'string'
		and ` + value + ` ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
		then ` + value + `::uuid else null::uuid end)`
}

// Activity summaries do not show a generic fact: they exclude protected rows
// without current full event access. Lead history separately keeps its generic
// fact and uses this predicate only for authorized actor hydration.
func HistoryReadableRecordSQL(actor tenant.Context, alias, typeField, userPlaceholder string) string {
	readable := "false"
	if CanReadHistoryDetails(actor) {
		readable = `exists (select 1 from public.schedule_events history_schedule
			where history_schedule.organization_id = ` + alias + `.organization_id
			  and history_schedule.lead_id = ` + alias + `.lead_id
			  and history_schedule.id = ` + HistoryEventIDSQL(alias+".metadata") + `
			  and ` + HistoryDetailsScopeSQL(actor, "history_schedule", userPlaceholder) + `)`
	}
	return `(not ` + HistoryRecordSQL(alias+"."+typeField, alias+".metadata") + ` or ` + readable + `)`
}
