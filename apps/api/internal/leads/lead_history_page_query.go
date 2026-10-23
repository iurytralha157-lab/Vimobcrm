package leads

import (
	"fmt"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type leadHistoryPageSource struct {
	rank       int
	table      string
	alias      string
	leadFilter string
	occurrence string
	hydrate    string
}

var leadHistoryPageSources = []leadHistoryPageSource{
	{1, "lead_timeline_events", "e", "e.lead_id = $2::uuid", leadHistoryScheduleOccurrenceSQL("e", "event_type", "coalesce(e.event_at, e.created_at, 'epoch'::timestamptz)"), `
		select jsonb_strip_nulls(to_jsonb(e) || jsonb_build_object('metadata',
			(coalesce(e.metadata, '{}'::jsonb) - 'message_fingerprint') || jsonb_strip_nulls(jsonb_build_object(
				'from_stage', coalesce(e.metadata->>'from_stage', e.metadata->>'old_stage_name', old_stage.name),
				'to_stage', coalesce(e.metadata->>'to_stage', e.metadata->>'new_stage_name', new_stage.name),
				'old_stage_name', coalesce(e.metadata->>'old_stage_name', e.metadata->>'from_stage', old_stage.name),
				'new_stage_name', coalesce(e.metadata->>'new_stage_name', e.metadata->>'to_stage', new_stage.name)
			)))) as data
		from public.lead_timeline_events e
		left join public.stages old_stage on old_stage.organization_id = e.organization_id
			and old_stage.id::text = coalesce(e.metadata->>'old_stage_id', e.metadata->>'from_stage_id')
		left join public.stages new_stage on new_stage.organization_id = e.organization_id
			and new_stage.id::text = coalesce(e.metadata->>'new_stage_id', e.metadata->>'to_stage_id')`},
	{2, "activities", "a", "a.lead_id = $2::uuid", "coalesce(a.created_at, 'epoch'::timestamptz)", `
		select jsonb_strip_nulls(to_jsonb(a) || jsonb_build_object(
			'user', case when u.id is null then null else jsonb_build_object('id', u.id::text, 'name', u.name, 'avatar_url', u.avatar_url) end,
			'metadata', coalesce(a.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
				'from_stage', coalesce(a.metadata->>'from_stage', a.metadata->>'old_stage_name', old_stage.name),
				'to_stage', coalesce(a.metadata->>'to_stage', a.metadata->>'new_stage_name', new_stage.name),
				'old_stage_name', coalesce(a.metadata->>'old_stage_name', a.metadata->>'from_stage', old_stage.name),
				'new_stage_name', coalesce(a.metadata->>'new_stage_name', a.metadata->>'to_stage', new_stage.name)
			)))) as data
		from public.activities a
		left join public.users u on u.id = a.user_id and ` + leadHistoryParticipantSQL("u", "a.organization_id") + `
		left join public.stages old_stage on old_stage.organization_id = a.organization_id
			and old_stage.id::text = coalesce(a.metadata->>'old_stage_id', a.metadata->>'from_stage_id')
		left join public.stages new_stage on new_stage.organization_id = a.organization_id
			and new_stage.id::text = coalesce(a.metadata->>'new_stage_id', a.metadata->>'to_stage_id')`},
	{3, "lead_entry_events", "e", "e.lead_id = $2::uuid", "coalesce(e.created_at, 'epoch'::timestamptz)", `
		select jsonb_strip_nulls(to_jsonb(e) || jsonb_build_object(
			'metadata', e.metadata - 'message_fingerprint', 'payload', e.payload - 'message_fingerprint')) as data
		from public.lead_entry_events e`},
	{4, "round_robin_logs", "rrl", "rrl.lead_id = $2::uuid", "coalesce(rrl.created_at, 'epoch'::timestamptz)", `
		select jsonb_strip_nulls(to_jsonb(rrl) || jsonb_build_object(
			'queue', case when rr.id is null then null else jsonb_build_object('id', rr.id::text, 'name', rr.name) end,
			'assigned_user', case when u.id is null then null else jsonb_build_object('id', u.id::text, 'name', u.name, 'avatar_url', u.avatar_url) end)) as data
		from public.round_robin_logs rrl
		left join public.round_robins rr on rr.id = rrl.round_robin_id and rr.organization_id = rrl.organization_id
		left join public.users u on u.id = rrl.assigned_user_id and ` + leadHistoryParticipantSQL("u", "rrl.organization_id")},
	{5, "assignments_log", "al", "al.lead_id = $2::uuid", "coalesce(al.created_at, 'epoch'::timestamptz)", `
		select jsonb_strip_nulls(jsonb_build_object(
			'id', al.id::text, 'organization_id', al.organization_id::text, 'lead_id', al.lead_id::text,
			'old_user_id', al.old_user_id::text, 'new_user_id', al.new_user_id::text,
			'reason', al.reason, 'created_by', al.created_by::text, 'created_at', al.created_at,
			'round_robin_id', al.round_robin_id::text, 'assigned_at', al.assigned_at,
			'old_user', case when old_user.id is null then null else jsonb_build_object('id', old_user.id::text, 'name', old_user.name, 'avatar_url', old_user.avatar_url) end,
			'new_user', case when new_user.id is null then null else jsonb_build_object('id', new_user.id::text, 'name', new_user.name, 'avatar_url', new_user.avatar_url) end,
			'actor', case when actor.id is null then null else jsonb_build_object('id', actor.id::text, 'name', actor.name, 'avatar_url', actor.avatar_url) end)) as data
		from public.assignments_log al
		left join public.users old_user on old_user.id = al.old_user_id and ` + leadHistoryParticipantSQL("old_user", "al.organization_id") + `
		left join public.users new_user on new_user.id = al.new_user_id and ` + leadHistoryParticipantSQL("new_user", "al.organization_id") + `
		left join public.users actor on actor.id = al.created_by and ` + leadHistoryParticipantSQL("actor", "al.organization_id")},
	{6, "audit_logs", "al", "al.entity_type = 'lead' and al.entity_id::text = $2::text", "coalesce(al.created_at, 'epoch'::timestamptz)", `
		select jsonb_strip_nulls(jsonb_build_object(
			'id', al.id::text, 'organization_id', al.organization_id::text, 'user_id', al.user_id::text,
			'action', al.action, 'entity_type', al.entity_type, 'entity_id', al.entity_id::text, 'created_at', al.created_at,
			'actor', case when u.id is null then null else jsonb_build_object('id', u.id::text, 'name', u.name, 'avatar_url', u.avatar_url) end))
			|| jsonb_build_object('old_data', (coalesce(al.old_data, '{}'::jsonb) #- '{metadata,profile,cpf}') #- '{metadata,profile,rg}',
			'new_data', (coalesce(al.new_data, '{}'::jsonb) #- '{metadata,profile,cpf}') #- '{metadata,profile,rg}') as data
		from public.audit_logs al
		left join public.users u on u.id = al.user_id and ` + leadHistoryParticipantSQL("u", "al.organization_id")},
	{7, "private.queue_runtime_events", "qe", "qe.lead_id = $2::uuid", "coalesce(qe.created_at, 'epoch'::timestamptz)", queueHistoryHydrationSQL},
}

// Fixed internal SQL fragments only: organization, lead, cursor and limits are parameters.
// Each source contributes at most pageSize+1 identifiers before any JSON hydration.
func leadHistoryPageSQL(actors ...tenant.Context) string {
	var actor tenant.Context
	if len(actors) > 0 {
		actor = actors[0]
	}
	scope, _ := leadHistoryScheduleQueryScope(actor, make([]any, 8))
	candidates := make([]string, 0, len(leadHistoryPageSources))
	hydrations := make([]string, 0, len(leadHistoryPageSources))
	for _, source := range leadHistoryPageSources {
		hydration := source.hydrate
		if source.rank == 1 || source.rank == 2 {
			// These are fixed internal SELECT templates, never user SQL. Wrap
			// only their projection so candidates, limits and joins stay intact.
			projection, suffix, _ := strings.Cut(hydration, " as data")
			projection = strings.TrimPrefix(strings.TrimSpace(projection), "select ")
			if source.rank == 1 {
				projection = leadHistoryScheduleTimelineSQL(source.alias, projection, scope)
			} else {
				projection = leadHistoryScheduleActivitySQL(source.alias, projection, scope)
			}
			hydration = "select " + projection + " as data" + suffix
		}
		table := "public." + source.table
		if strings.Contains(source.table, ".") {
			table = source.table // Fixed internal descriptor; never request input.
		}
		candidates = append(candidates, fmt.Sprintf(`(
			select %s as occurred_at, %s.id, %d::integer as source_rank
			from %s %s
			where %s.organization_id = $1::uuid and %s
			  and coalesce(%s.created_at, 'epoch'::timestamptz) <= $3::timestamptz
			  and ($4::timestamptz is null or (%s, %s.id, %d::integer) < ($4::timestamptz, $5::uuid, $6::integer))
			order by occurred_at desc, %s.id desc
			limit $8::integer
		)`, source.occurrence, source.alias, source.rank, table, source.alias,
			source.alias, source.leadFilter, source.alias, source.occurrence, source.alias, source.rank, source.alias))
		hydrations = append(hydrations, fmt.Sprintf(`
			select p.occurred_at, p.id, p.source_rank, document.data
			from page_rows p
			cross join lateral (%s
				where %s.organization_id = $1::uuid and %s and %s.id = p.id
			) document
			where p.source_rank = %d`, hydration, source.alias, source.leadFilter, source.alias, source.rank))
	}
	return `with page_ids as materialized (
		select occurred_at, id, source_rank from (` + strings.Join(candidates, " union all ") + `) bounded_sources
		order by occurred_at desc, id desc, source_rank desc limit $8::integer
	), page_rows as materialized (
		select * from page_ids order by occurred_at desc, id desc, source_rank desc limit $7::integer
	), hydrated_page as materialized (` + strings.Join(hydrations, " union all ") + `), ` + leadHistoryPageContextSQL + `
	select jsonb_build_object(
		'events', coalesce((select jsonb_agg(jsonb_build_object(
			'sourceRank', source_rank, 'occurredAt', occurred_at, 'id', id::text, 'data', data)
			order by occurred_at desc, id desc, source_rank desc) from hydrated_page), '[]'::jsonb),
		'hasOlder', (select count(*) > $7::integer from page_ids),
		'lead', coalesce((select data from lead_context), '{}'::jsonb),
		'leadMeta', coalesce((select data from meta_context), '{}'::jsonb),
		'users', coalesce((select jsonb_agg(jsonb_build_object('id', u.id::text,
			'name', coalesce(nullif(u.name, ''), u.email, 'Usuario'), 'avatar_url', u.avatar_url) order by u.name, u.id)
			from public.users u join user_ids on u.id = user_ids.id
			where ` + leadHistoryParticipantSQL("u", "$1::uuid") + `), '[]'::jsonb),
		'canonicalPresence', ` + leadHistoryPageCanonicalPresenceSQL + `
	)`
}
