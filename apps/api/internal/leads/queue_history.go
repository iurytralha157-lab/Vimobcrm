package leads

// A public response projection, never a grant or a raw private-table payload.
// The enclosing history transaction first authorizes the lead in the same
// repeatable-read snapshot. Only approved event context is exposed here.
var queueHistoryHydrationSQL = `
 select jsonb_strip_nulls(jsonb_build_object(
  'id', qe.id::text, 'organization_id', qe.organization_id::text, 'lead_id', qe.lead_id::text,
  'event_type', qe.event_type, 'created_at', qe.created_at,
  'round_robin_id', qe.round_robin_id::text, 'episode_id', qe.episode_id::text,
  'round_number', qe.round_number, 'from_user_id', qe.from_user_id::text,
  'to_user_id', qe.to_user_id::text, 'actor_id', qe.actor_id::text,
  'queue', case when queue.id is null then null else jsonb_build_object('id',queue.id::text,'name',queue.name) end,
  'from_user', case when previous_user.id is null then null else jsonb_build_object('id',previous_user.id::text,'name',previous_user.name) end,
  'to_user', case when next_user.id is null then null else jsonb_build_object('id',next_user.id::text,'name',next_user.name) end,
  'actor', case when actor.id is null then null else jsonb_build_object('id',actor.id::text,'name',actor.name) end,
  'metadata', jsonb_strip_nulls(jsonb_build_object(
   'reason',qe.metadata->'reason', 'revision',qe.metadata->'revision',
   'assignment_count',qe.metadata->'assignment_count', 'is_initial_distribution',qe.metadata->'is_initial_distribution',
   'distribution_event_id',qe.metadata->'distribution_event_id', 'assignment_log_id',qe.metadata->'assignment_log_id', 'prior_reason',qe.metadata->'prior_reason',
   'retry_count',qe.metadata->'retry_count', 'adoption_kind',qe.metadata->'adoption_kind',
   'automatic',qe.metadata->'automatic', 'stage_id',qe.metadata->'stage_id', 'stage_automation_id',qe.metadata->'stage_automation_id'
  ))
 )) as data
 from private.queue_runtime_events qe
 left join public.round_robins queue on queue.id=qe.round_robin_id and queue.organization_id=qe.organization_id
 left join public.users previous_user on previous_user.id=qe.from_user_id and ` + leadHistoryParticipantSQL("previous_user", "qe.organization_id") + `
 left join public.users next_user on next_user.id=qe.to_user_id and ` + leadHistoryParticipantSQL("next_user", "qe.organization_id") + `
 left join public.users actor on actor.id=qe.actor_id and ` + leadHistoryParticipantSQL("actor", "qe.organization_id")
