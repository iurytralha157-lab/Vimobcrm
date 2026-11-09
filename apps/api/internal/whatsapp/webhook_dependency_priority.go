package whatsapp

// Evaluate availability and live priority before choosing the one session head.
// A blocked route may not hide an eligible dependency root in another route;
// each route's existing older-row barrier still enforces FIFO.
// A live FIFO successor cannot reserve priority ahead of its own blocked head.
const evolutionWebhookCandidatePriorityQuery = `
			  where head.next_attempt_at <= now()
			    and not exists (
			      select 1 from public.whatsapp_webhook_inbox active
			      where active.session_id = ws.id
			        and active.processing_epoch = coalesce(cutover.active_epoch, 0)
			        and active.status = 'processing'
			        and (
			          coalesce(nullif(active.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = '__session__'
			          or head.routing_key = '__session__'
			          or coalesce(nullif(active.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = head.routing_key
			        )
			    )
			    and (
			      $4 <> 'backlog'
			      or not exists (
			        select 1 from public.whatsapp_webhook_inbox live_due
			        where live_due.session_id = ws.id
			          and live_due.processing_epoch = coalesce(cutover.active_epoch, 0)
			          and live_due.processing_lane = 'live'
			          and live_due.status in ('pending', 'retry')
			          and live_due.attempts < live_due.max_attempts
			          and coalesce(live_due.payload #>> '{__vimob_ingress,routing_snapshot,version}', '') = '1'
			          and live_due.next_attempt_at <= now()
			          and not exists (
			            select 1 from public.whatsapp_webhook_inbox older_live
			            where older_live.session_id = live_due.session_id
			              and older_live.processing_epoch = live_due.processing_epoch
			              and older_live.processing_lane = live_due.processing_lane
			              and older_live.status in ('pending', 'retry')
			              and older_live.attempts < older_live.max_attempts
			              and coalesce(older_live.payload #>> '{__vimob_ingress,routing_snapshot,version}', '') = '1'
			              and (older_live.created_at, older_live.id) < (live_due.created_at, live_due.id)
			              and (
			                coalesce(nullif(older_live.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = '__session__'
			                or coalesce(nullif(live_due.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = '__session__'
			                or coalesce(nullif(older_live.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') =
			                   coalesce(nullif(live_due.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__')
			              )
			          )
			          and not exists (
			            select 1 from pg_catalog.jsonb_array_elements(
			              case when pg_catalog.jsonb_typeof(
			                live_due.payload #> '{__vimob_ingress,routing_snapshot,messages}'
			              ) = 'array'
			              then live_due.payload #> '{__vimob_ingress,routing_snapshot,messages}'
			              else '[]'::jsonb end
			            ) as routing_message(snapshot)
			            where routing_message.snapshot->>'binding_eligible' = 'true'
			              and nullif(routing_message.snapshot->>'predecessor_inbox_event_key', '') is not null
			              and routing_message.snapshot->>'predecessor_inbox_event_key' <> live_due.event_key
			              and not exists (
			                select 1 from pg_catalog.jsonb_array_elements(
			                  live_due.payload #> '{__vimob_ingress,routing_snapshot,messages}'
			                ) as same_inbox_route(snapshot)
			                where same_inbox_route.snapshot->>'provider_message_id' =
			                  routing_message.snapshot->>'predecessor_provider_message_id'
			              )
			              and not exists (
			                select 1 from public.whatsapp_webhook_inbox predecessor
			                where predecessor.organization_id = live_due.organization_id
			                  and predecessor.session_id = live_due.session_id
			                  and predecessor.processing_epoch = live_due.processing_epoch
			                  and predecessor.event_key = routing_message.snapshot->>'predecessor_inbox_event_key'
			                  and predecessor.status = 'processed'
			              )
			              and not exists (
			                select 1 from public.whatsapp_webhook_routing_outcomes predecessor_outcome
			                where predecessor_outcome.organization_id = live_due.organization_id
			                  and predecessor_outcome.session_id = live_due.session_id
			                  and predecessor_outcome.provider_message_id =
			                    routing_message.snapshot->>'predecessor_provider_message_id'
			              )
			          )
			      )
			      or (
			        head.event_type = 'message'
			        and head.provider = 'evolution_go'
			        and head.routing_key <> '__session__'
			        and case when pg_catalog.jsonb_typeof(
			          head.payload #> '{__vimob_ingress,routing_snapshot,messages}'
			        ) = 'array'
			        then pg_catalog.jsonb_array_length(
			          head.payload #> '{__vimob_ingress,routing_snapshot,messages}'
			        ) else 0 end = 1
			        and not exists (
			          select 1 from public.whatsapp_webhook_inbox live_session_control
			          where live_session_control.session_id = ws.id
			            and live_session_control.processing_epoch = head.processing_epoch
			            and live_session_control.processing_lane = 'live'
			            and live_session_control.status in ('pending', 'retry')
			            and live_session_control.attempts < live_session_control.max_attempts
			            and live_session_control.next_attempt_at <= now()
			            and coalesce(live_session_control.payload #>> '{__vimob_ingress,routing_snapshot,version}', '') = '1'
			            and coalesce(nullif(live_session_control.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = '__session__'
			        )
			        and exists (
			          select 1 from public.whatsapp_webhook_inbox live_dependent
			          cross join lateral pg_catalog.jsonb_array_elements(
			            case when pg_catalog.jsonb_typeof(
			              live_dependent.payload #> '{__vimob_ingress,routing_snapshot,messages}'
			            ) = 'array'
			            then live_dependent.payload #> '{__vimob_ingress,routing_snapshot,messages}'
			            else '[]'::jsonb end
			          ) dependent_route(snapshot)
			          where live_dependent.organization_id = head.organization_id
			            and live_dependent.session_id = ws.id
			            and live_dependent.processing_epoch = head.processing_epoch
			            and live_dependent.processing_lane = 'live'
			            and live_dependent.event_type = 'message'
			            and live_dependent.provider = 'evolution_go'
			            and live_dependent.status in ('pending', 'retry')
			            and live_dependent.edge_execution_id is null
			            and live_dependent.attempts < live_dependent.max_attempts
			            and live_dependent.next_attempt_at <= now()
			            and live_dependent.created_at > head.created_at
			            and coalesce(live_dependent.payload #>> '{__vimob_ingress,routing_snapshot,version}', '') = '1'
			            and case when pg_catalog.jsonb_typeof(
			              live_dependent.payload #> '{__vimob_ingress,routing_snapshot,messages}'
			            ) = 'array'
			            then pg_catalog.jsonb_array_length(
			              live_dependent.payload #> '{__vimob_ingress,routing_snapshot,messages}'
			            ) else 0 end = 1
			            and coalesce(nullif(live_dependent.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = head.routing_key
			            and dependent_route.snapshot->>'binding_eligible' = 'true'
			            and exists (
` + transitiveEvolutionWebhookDependencyQuery + `
			            )
			            and not exists (
			              select 1 from public.whatsapp_webhook_inbox older_live
			              where older_live.session_id = live_dependent.session_id
			                and older_live.processing_epoch = live_dependent.processing_epoch
			                and older_live.processing_lane = 'live'
			                and older_live.status in ('pending', 'retry')
			                and older_live.attempts < older_live.max_attempts
			                and coalesce(older_live.payload #>> '{__vimob_ingress,routing_snapshot,version}', '') = '1'
			                and (older_live.created_at, older_live.id) < (live_dependent.created_at, live_dependent.id)
			                and (
			                  coalesce(nullif(older_live.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = '__session__'
			                  or coalesce(nullif(older_live.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = head.routing_key
			                )
			            )
			        )
			      )
			    )
`
