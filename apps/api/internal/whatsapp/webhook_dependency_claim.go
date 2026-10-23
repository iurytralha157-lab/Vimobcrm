package whatsapp

// Scoped to the candidate session/route and its oldest live dependent. This
// proves that a FIFO-eligible backlog route head is an unresolved ancestor;
// it never skips that route's older-row barrier or declares a predecessor completed.
//
// Walk at most 32 pending/retry backlog links. Ambiguous envelopes, a future
// retry, a dead/missing ancestor, changed epoch/tenant/route, or invalid ordering
// cannot grant the exception. Exact row locks and completion provenance remain
// the responsibility of the existing claim/completion queries.
const transitiveEvolutionWebhookDependencyQuery = `
			with recursive dependency_chain as (
			  select live_dependent.id, live_dependent.event_key,
			    live_dependent.created_at, dependent_route.snapshot,
			    0 as depth, array[live_dependent.id] as visited
			  union all
			  select dependency_predecessor.id, dependency_predecessor.event_key,
			    dependency_predecessor.created_at, predecessor_route.snapshot,
			    descendant.depth + 1, descendant.visited || dependency_predecessor.id
			  from dependency_chain descendant
			  join public.whatsapp_webhook_inbox dependency_predecessor
			    on dependency_predecessor.organization_id = head.organization_id
			   and dependency_predecessor.session_id = ws.id
			   and dependency_predecessor.processing_epoch = head.processing_epoch
			   and dependency_predecessor.event_key =
			     nullif(descendant.snapshot->>'predecessor_inbox_event_key', '')
			  cross join lateral pg_catalog.jsonb_array_elements(
			    case when pg_catalog.jsonb_typeof(
			      dependency_predecessor.payload #> '{__vimob_ingress,routing_snapshot,messages}'
			    ) = 'array'
			    then dependency_predecessor.payload #> '{__vimob_ingress,routing_snapshot,messages}'
			    else '[]'::jsonb end
			  ) predecessor_route(snapshot)
			  where descendant.depth < 32
			    and not (dependency_predecessor.id = any(descendant.visited))
			    and dependency_predecessor.processing_lane = 'backlog'
			    and dependency_predecessor.event_type = 'message'
			    and dependency_predecessor.provider = 'evolution_go'
			    and dependency_predecessor.status in ('pending', 'retry')
			    and dependency_predecessor.edge_execution_id is null
			    and dependency_predecessor.attempts < dependency_predecessor.max_attempts
			    and dependency_predecessor.next_attempt_at <= now()
			    and coalesce(
			      dependency_predecessor.payload #>> '{__vimob_ingress,routing_snapshot,version}', ''
			    ) = '1'
			    and case when pg_catalog.jsonb_typeof(
			      dependency_predecessor.payload #> '{__vimob_ingress,routing_snapshot,messages}'
			    ) = 'array'
			    then pg_catalog.jsonb_array_length(
			      dependency_predecessor.payload #> '{__vimob_ingress,routing_snapshot,messages}'
			    ) else 0 end = 1
			    and coalesce(nullif(
			      dependency_predecessor.payload #>> '{__vimob_ingress,routing_key}', ''
			    ), '__session__') = head.routing_key
			    and predecessor_route.snapshot->>'binding_eligible' = 'true'
			    and nullif(predecessor_route.snapshot->>'provider_message_id', '') =
			      nullif(descendant.snapshot->>'predecessor_provider_message_id', '')
			    and (dependency_predecessor.created_at, dependency_predecessor.id) <
			      (descendant.created_at, descendant.id)
			    and not exists (
			      select 1 from public.whatsapp_webhook_routing_outcomes dependency_outcome
			      where dependency_outcome.organization_id = head.organization_id
			        and dependency_outcome.session_id = ws.id
			        and dependency_outcome.provider_message_id =
			          predecessor_route.snapshot->>'provider_message_id'
			    )
			)
			select 1 from dependency_chain ancestor
			where ancestor.id = head.id and ancestor.depth > 0
`
