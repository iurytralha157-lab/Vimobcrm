package whatsapp

// The head lock is taken after all predecessor, route and priority predicates.
// SKIP LOCKED may therefore select another eligible route, never a successor
// whose pending/retry predecessor remains a FIFO barrier. The outer shared
// session fence is compatible with native inbound processing while excluding
// the previous exclusive session claimant and explicit cutovers.
// The first backlog session barrier already excludes every later row via the
// FIFO predicate. Apply that same bound before inspecting each row's routes.
const evolutionWebhookCandidateSessionsStart = `
			select
				ws.id as session_id,
				coalesce(cutover.active_epoch, 0) as active_epoch,
				head.id as event_id
			from public.whatsapp_sessions ws
			left join private.whatsapp_webhook_session_cutovers cutover
			  on cutover.session_id = ws.id
			left join lateral (
			  select barrier.created_at, barrier.id
			  from public.whatsapp_webhook_inbox barrier
			  where $4 = 'backlog'
			    and barrier.session_id = ws.id
			    and barrier.processing_epoch = coalesce(cutover.active_epoch, 0)
			    and barrier.processing_lane = $4
			    and barrier.status in ('pending', 'retry')
			    and barrier.attempts < barrier.max_attempts
			    and coalesce(barrier.payload #>> '{__vimob_ingress,routing_snapshot,version}', '') = '1'
			    and coalesce(nullif(barrier.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = '__session__'
			  order by barrier.created_at, barrier.id
			  limit 1
			) first_session_barrier on true
			cross join lateral (
`

const evolutionWebhookCandidateHeadProjection = `
			  select head.*
			  from (
			  select
			    wi.id,
			    wi.organization_id,
			    wi.event_key,
			    wi.event_type,
			    wi.provider,
			    wi.payload,
			    wi.created_at,
			    wi.processing_epoch,
			    wi.next_attempt_at,
			    coalesce(
			      nullif(wi.payload #>> '{__vimob_ingress,routing_key}', ''),
			      '__session__'
			    ) as routing_key
`

const evolutionWebhookCandidateHeadEligibility = `
			  where wi.session_id = ws.id
			    and wi.processing_epoch = coalesce(cutover.active_epoch, 0)
			    and wi.processing_lane = $4
			    and (wi.created_at, wi.id) <= (
			      coalesce(first_session_barrier.created_at, 'infinity'::timestamptz),
			      coalesce(first_session_barrier.id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
			    )
			    and wi.status in ('pending', 'retry')
			    and wi.edge_execution_id is null
			    and wi.attempts < wi.max_attempts
			    and coalesce(
			      wi.payload #>> '{__vimob_ingress,routing_snapshot,version}',
			      ''
			    ) = '1'
			    and ($4 <> 'live' or wi.next_attempt_at <= now())
			    and not exists (
			      select 1
			      from pg_catalog.jsonb_array_elements(
			        case
			          when pg_catalog.jsonb_typeof(wi.payload #> '{__vimob_ingress,routing_snapshot,messages}') = 'array'
			            then wi.payload #> '{__vimob_ingress,routing_snapshot,messages}'
			          else '[]'::jsonb
			        end
			      ) as routing_message(snapshot)
			      where routing_message.snapshot->>'binding_eligible' = 'true'
			        and nullif(routing_message.snapshot->>'predecessor_inbox_event_key', '') is not null
			        and routing_message.snapshot->>'predecessor_inbox_event_key' <> wi.event_key
			        and not exists (
			          select 1
			          from pg_catalog.jsonb_array_elements(
			            wi.payload #> '{__vimob_ingress,routing_snapshot,messages}'
			          ) as same_inbox_route(snapshot)
			          where same_inbox_route.snapshot->>'provider_message_id' =
			            routing_message.snapshot->>'predecessor_provider_message_id'
			        )
			        and not exists (
			          select 1
			          from public.whatsapp_webhook_inbox predecessor
				          where predecessor.organization_id = wi.organization_id
					            and predecessor.session_id = wi.session_id
					            and predecessor.processing_epoch = wi.processing_epoch
				            and predecessor.event_key = routing_message.snapshot->>'predecessor_inbox_event_key'
				            and predecessor.status = 'processed'
				        )
				        and not exists (
				          select 1
				          from public.whatsapp_webhook_routing_outcomes predecessor_outcome
				          where predecessor_outcome.organization_id = wi.organization_id
				            and predecessor_outcome.session_id = wi.session_id
				            and predecessor_outcome.provider_message_id =
				              routing_message.snapshot->>'predecessor_provider_message_id'
				        )
			    )
`

const evolutionWebhookLiveHeadOrder = `
			    and not exists (
			      select 1
			      from public.whatsapp_webhook_inbox older
			      where older.session_id = wi.session_id
			        and older.processing_epoch = wi.processing_epoch
			        and older.processing_lane = wi.processing_lane
			        and older.status in ('pending', 'retry')
			        and older.attempts < older.max_attempts
			        and coalesce(
			          older.payload #>> '{__vimob_ingress,routing_snapshot,version}',
			          ''
			        ) = '1'
			        and (older.created_at, older.id) < (wi.created_at, wi.id)
			        and (
			          coalesce(nullif(older.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = '__session__'
			          or coalesce(nullif(wi.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = '__session__'
			          or coalesce(nullif(older.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') =
			             coalesce(nullif(wi.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__')
			        )
			    )
`

const evolutionWebhookCandidateSessionsEnd = `
			  ) head
			  join public.whatsapp_webhook_inbox claim_head on claim_head.id = head.id
` + evolutionWebhookCandidatePriorityQuery + `
			  order by head.created_at, head.id
			  limit 1
			  for update of claim_head skip locked
			) head
			where (nullif(btrim($3), '') is null or ws.id > nullif(btrim($3), '')::uuid)
			  and coalesce(ws.is_active, true) = true
			  and coalesce(ws.status, '') <> 'deleted'
			order by ws.id
			limit $1
			for share of ws skip locked
`

const evolutionWebhookCandidateSessionsQuery = evolutionWebhookCandidateSessionsStart +
	evolutionWebhookCandidateHeadProjection + `
			  from public.whatsapp_webhook_inbox wi
` + evolutionWebhookCandidateHeadEligibility + evolutionWebhookLiveHeadOrder + evolutionWebhookCandidateSessionsEnd

// Reserve the first waiting row per backlog route before filtering on due time,
// Edge execution, or dependencies. Those filters can block a head, but must not
// let its successor pass. The session-control head also waits for earlier
// heads on other routes. Keep the live lookup on its existing ordered path.
const evolutionWebhookBacklogCandidateSessionsQuery = evolutionWebhookCandidateSessionsStart + `
			  with route_heads as materialized (
			    select distinct on (routing_key)
			      waiting.id, waiting.created_at,
			      coalesce(nullif(waiting.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') as routing_key
			    from public.whatsapp_webhook_inbox waiting
			    where waiting.session_id = ws.id
			      and waiting.processing_epoch = coalesce(cutover.active_epoch, 0)
			      and waiting.processing_lane = $4
			      and waiting.status in ('pending', 'retry')
			      and waiting.attempts < waiting.max_attempts
			      and coalesce(waiting.payload #>> '{__vimob_ingress,routing_snapshot,version}', '') = '1'
			      and (waiting.created_at, waiting.id) <= (
			        coalesce(first_session_barrier.created_at, 'infinity'::timestamptz),
			        coalesce(first_session_barrier.id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
			      )
			    order by routing_key, waiting.created_at, waiting.id
			  )
` + evolutionWebhookCandidateHeadProjection + `
			  from route_heads route_head
			  join public.whatsapp_webhook_inbox wi on wi.id = route_head.id
` + evolutionWebhookCandidateHeadEligibility + `
			    and (
			      route_head.routing_key <> '__session__'
			      or wi.id = (select earliest.id from route_heads earliest order by earliest.created_at, earliest.id limit 1)
			    )
` + evolutionWebhookCandidateSessionsEnd
