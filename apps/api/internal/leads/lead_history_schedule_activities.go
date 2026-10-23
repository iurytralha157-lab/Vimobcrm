package leads

import (
	"fmt"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Bound the visible activity list before projecting Agenda context. Materialize
// the result once so the correlated ACL lookup is not repeated per output field.
// Non-Agenda content keeps the existing canonical property redaction.
func leadHistoryScheduleActivityListSQL(actor tenant.Context, where []string, propertyVisibility string, limitIndex int) string {
	scope := leadHistoryScheduleScope{actor: actor, userPlaceholder: "$3"}
	ordinary := `jsonb_build_object(
		'id',a.id::text,'organization_id',a.organization_id::text,'lead_id',a.lead_id::text,
		'user_id',a.user_id::text,'type',a.type,'content',` + activityContentSQL("activity_property.id is not null") + `,
		'metadata',` + activityMetadataSQL(actor, "activity_property.id is not null") + `,'created_at',a.created_at,
		'user',case when u.id is null then null else jsonb_build_object('id',u.id::text,'name',u.name) end,
		'lead',case when l.id is null then null else jsonb_build_object('id',l.id::text,'name',l.name) end)`
	return `with visible_activity as materialized (
		select a.*, ` + ordinary + ` as history_document
		from public.activities a
		join public.leads l on l.id = a.lead_id
		left join public.users u on u.id = a.user_id
		left join public.properties activity_property
		  on activity_property.organization_id = a.organization_id
		 and activity_property.id::text = ` + activityPropertyReferenceSQL() + `
		 and ` + propertyVisibility + `
		where ` + strings.Join(where, " and ") + `
		order by a.created_at desc, a.id desc
		limit $` + fmt.Sprint(limitIndex) + `
	), history_activity as materialized (
		select ` + leadHistoryScheduleActivitySQL("a", "a.history_document", scope) + ` as data
		from visible_activity a
	)
	select data->>'id',data->>'organization_id',data->>'lead_id',data->>'user_id',data->>'type',
		data->>'content',(data->'metadata')::text,(data->>'created_at')::timestamptz,
		data->'user'->>'id',data->'user'->>'name',data->'lead'->>'id',data->'lead'->>'name'
	from history_activity
	order by (data->>'created_at')::timestamptz desc,data->>'id' desc`
}
