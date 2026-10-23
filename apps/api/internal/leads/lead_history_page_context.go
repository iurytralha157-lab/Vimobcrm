package leads

// Context is small and repeated on each page. User lookup is restricted to
// references on this page and the lead's two contextual actors.
var leadHistoryPageContextSQL = `lead_context as (
	select jsonb_strip_nulls(jsonb_build_object(
		'id', l.id::text, 'source', l.source, 'utm_source', l.utm_source,
		'assigned_user_id', l.assigned_user_id::text, 'assigned_at', l.assigned_at,
		'first_response_at', l.first_response_at, 'first_response_seconds', l.first_response_seconds,
		'first_response_channel', l.first_response_channel, 'first_response_is_automation', l.first_response_is_automation,
		'first_response_actor', case when response_actor.id is null then null else jsonb_build_object(
			'id', response_actor.id::text, 'name', response_actor.name, 'avatar_url', response_actor.avatar_url) end,
		'created_at', l.created_at,
		'assigned_user', case when assigned_user.id is null then null else jsonb_build_object(
			'id', assigned_user.id::text, 'name', assigned_user.name, 'avatar_url', assigned_user.avatar_url) end
	)) as data
	from public.leads l
	left join public.users assigned_user on assigned_user.id = l.assigned_user_id and ` + leadHistoryParticipantSQL("assigned_user", "l.organization_id") + `
	left join public.users response_actor on response_actor.id = l.first_response_actor_user_id
		and ` + leadHistoryParticipantSQL("response_actor", "l.organization_id") + `
	where l.organization_id = $1::uuid and l.id = $2::uuid
	limit 1
), meta_context as (
	select jsonb_strip_nulls(jsonb_build_object(
		'id', lm.id::text, 'lead_id', lm.lead_id::text, 'page_id', lm.page_id,
		'form_id', lm.form_id, 'form_name', lm.form_name, 'ad_id', lm.ad_id, 'ad_name', lm.ad_name,
		'adset_id', lm.adset_id, 'adset_name', lm.adset_name, 'campaign_id', lm.campaign_id, 'campaign_name', lm.campaign_name,
		'platform', lm.platform, 'source_type', lm.source_type, 'creative_url', lm.creative_url,
		'creative_video_url', lm.creative_video_url, 'creative_instagram_url', lm.creative_instagram_url,
		'raw_payload', coalesce(lm.raw_payload, lm.payload, '{}'::jsonb), 'created_at', lm.created_at
	)) as data
	from public.lead_meta lm
	where lm.organization_id = $1::uuid and lm.lead_id = $2::uuid
		and coalesce(lm.created_at, 'epoch'::timestamptz) <= $3::timestamptz
	order by lm.updated_at desc nulls last, lm.created_at desc nulls last, lm.id desc
	limit 1
), user_references as (
	select reference.id from hydrated_page p
	cross join lateral (values (p.data->>'user_id'), (p.data->>'actor_user_id'),
		(p.data->>'assigned_user_id'), (p.data->>'old_user_id'), (p.data->>'new_user_id'), (p.data->>'created_by'),
		(p.data->'metadata'->>'user_id'), (p.data->'metadata'->>'to_user_id'), (p.data->'metadata'->>'from_user_id'),
		(p.data->'metadata'->>'assigned_user_id'), (p.data->'old_data'->>'assigned_user_id'),
		(p.data->'new_data'->>'assigned_user_id')) reference(id)
	union all select data->>'assigned_user_id' from lead_context
	union all select data->'first_response_actor'->>'id' from lead_context
), user_ids as (
	select distinct case
		when lower(btrim(id)) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
		then lower(btrim(id))::uuid else null
	end as id from user_references
)`

// Existence across the complete insertion-time fence prevents the first page
// from inventing a fallback just because its canonical event is on an older page.
const leadHistoryPageCanonicalPresenceSQL = `jsonb_build_object(
	'leadCreated', (
		exists (select 1 from public.lead_timeline_events e
			where e.organization_id = $1::uuid and e.lead_id = $2::uuid and e.event_type = 'lead_created'
			and coalesce(e.created_at, 'epoch'::timestamptz) <= $3::timestamptz)
		or exists (select 1 from public.activities a
			where a.organization_id = $1::uuid and a.lead_id = $2::uuid and a.type = 'lead_created'
			and coalesce(a.created_at, 'epoch'::timestamptz) <= $3::timestamptz)
	), 'firstResponse', (
		exists (select 1 from public.lead_timeline_events e
			where e.organization_id = $1::uuid and e.lead_id = $2::uuid and e.event_type = 'first_response'
			and coalesce(e.created_at, 'epoch'::timestamptz) <= $3::timestamptz)
		or exists (select 1 from public.activities a
			where a.organization_id = $1::uuid and a.lead_id = $2::uuid and a.type = 'first_response'
			and coalesce(a.created_at, 'epoch'::timestamptz) <= $3::timestamptz)
	), 'assignment', (
		exists (select 1 from public.lead_timeline_events e
			where e.organization_id = $1::uuid and e.lead_id = $2::uuid and e.event_type in ('lead_assigned', 'assignee_changed')
			and coalesce(e.created_at, 'epoch'::timestamptz) <= $3::timestamptz)
		or exists (select 1 from public.activities a
			where a.organization_id = $1::uuid and a.lead_id = $2::uuid and a.type = 'assignee_changed'
			and coalesce(a.created_at, 'epoch'::timestamptz) <= $3::timestamptz)
		or exists (select 1 from public.assignments_log al
			where al.organization_id = $1::uuid and al.lead_id = $2::uuid
			and coalesce(al.created_at, 'epoch'::timestamptz) <= $3::timestamptz)
		or exists (select 1 from public.round_robin_logs rrl
			where rrl.organization_id = $1::uuid and rrl.lead_id = $2::uuid
			and coalesce(rrl.created_at, 'epoch'::timestamptz) <= $3::timestamptz)
		or exists (select 1 from private.queue_runtime_events qe
			where qe.organization_id=$1::uuid and qe.lead_id=$2::uuid
			and qe.event_type in ('assigned','manual_claim','stage_rule_assigned')
			and qe.created_at <= $3::timestamptz)
	)
)`
