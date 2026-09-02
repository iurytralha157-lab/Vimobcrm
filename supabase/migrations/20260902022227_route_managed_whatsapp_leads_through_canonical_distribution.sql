-- A managed WhatsApp rule decides whether the inbound message may create a
-- lead and which queue receives it. From that point on, use the same canonical
-- distribution boundary as form and Meta leads so queue strategy, schedules,
-- notifications and automatic redistribution stay consistent across sources.
do $$
begin
  if to_regprocedure(
    'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamp with time zone)'
  ) is null then
    raise exception using
      errcode = '55000',
      message = 'canonical lead distribution function is required';
  end if;
end;
$$;

create or replace function public.whatsapp_webhook_has_lead_creation_context(p_metadata jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with managed_context as (
    select
      lower(btrim(coalesce(
        p_metadata->>'managed_whatsapp_message_distribution',
        'false'
      ))) in ('true', '1', 'yes') as is_managed,
      case
        when btrim(coalesce(p_metadata->>'matched_rule_id', ''))
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then btrim(p_metadata->>'matched_rule_id')::uuid
        else null
      end as rule_id,
      case
        when btrim(coalesce(p_metadata->>'whatsapp_session_id', ''))
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then btrim(p_metadata->>'whatsapp_session_id')::uuid
        else null
      end as session_id,
      case
        when btrim(coalesce(p_metadata->>'target_round_robin_id', ''))
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then btrim(p_metadata->>'target_round_robin_id')::uuid
        else null
      end as round_robin_id
  )
  select case
    when managed_context.is_managed then coalesce(
      managed_context.rule_id is not null
      and managed_context.session_id is not null
      and managed_context.round_robin_id is not null
      and exists (
        select 1
        from public.whatsapp_inbound_rules as inbound_rule
        join public.round_robin_rules as round_robin_rule
          on round_robin_rule.organization_id = inbound_rule.organization_id
         and round_robin_rule.id = inbound_rule.id
         and round_robin_rule.round_robin_id = inbound_rule.target_round_robin_id
        join public.round_robins as queue
          on queue.organization_id = round_robin_rule.organization_id
         and queue.id = round_robin_rule.round_robin_id
        join public.whatsapp_sessions as whatsapp_session
          on whatsapp_session.organization_id = inbound_rule.organization_id
         and whatsapp_session.id = inbound_rule.session_id
        where inbound_rule.id = managed_context.rule_id
          and inbound_rule.session_id = managed_context.session_id
          and queue.id = managed_context.round_robin_id
          and coalesce(
            nullif(round_robin_rule.match_type, ''),
            round_robin_rule.conditions->>'match_type',
            round_robin_rule.name,
            ''
          ) = 'whatsapp_message_contains'
          and coalesce(
            nullif(btrim(round_robin_rule.match->>'whatsapp_session_id'), ''),
            nullif(btrim(round_robin_rule.conditions->'match'->>'whatsapp_session_id'), '')
          ) = managed_context.session_id::text
          and coalesce(queue.is_active, true) = true
          and coalesce(round_robin_rule.is_active, true) = true
          and coalesce(inbound_rule.is_active, true) = true
          and whatsapp_session.provider = 'evolution_go'
          and coalesce(whatsapp_session.is_active, true) = true
          and lower(btrim(coalesce(whatsapp_session.status, ''))) not in ('deleted', 'disabled')
          and lower(btrim(coalesce(inbound_rule.match_type, ''))) = 'contains'
          and lower(btrim(coalesce(inbound_rule.match_field, 'message'))) = 'message'
          and btrim(coalesce(inbound_rule.match_value, '')) <> ''
          and lower(btrim(inbound_rule.match_value)) = lower(btrim(coalesce(
            nullif(round_robin_rule.match_value, ''),
            round_robin_rule.conditions->>'match_value',
            ''
          )))
          and lower(btrim(coalesce(queue.settings->>'require_checkin', 'false')))
            not in ('true', '1', 'yes')
      ),
      false
    )
    else coalesce(
      lower(btrim(
        p_metadata #>> '{whatsapp_attribution,source_referral,explicit_source_type}'
      )) = 'ad'
      and coalesce(
        nullif(btrim(p_metadata #>> '{whatsapp_attribution,ad_id}'), ''),
        nullif(btrim(p_metadata #>> '{whatsapp_attribution,source_id}'), ''),
        nullif(btrim(p_metadata #>> '{whatsapp_attribution,source_referral,source_id}'), '')
      ) ~ '^[0-9]{5,40}$',
      false
    )
  end
  from managed_context;
$$;

revoke all on function public.whatsapp_webhook_has_lead_creation_context(jsonb)
from public, anon, authenticated;
grant execute on function public.whatsapp_webhook_has_lead_creation_context(jsonb)
to service_role;

comment on function public.whatsapp_webhook_has_lead_creation_context(jsonb) is
'Allows automatic WhatsApp lead creation only for a verified Meta ad referral or an active managed rule bound to the exact Evolution Go session and queue; supported distribution settings are handled by the canonical queue engine.';

-- Managed routing is intake provenance. Validate it against the actual lead
-- tenant before the row exists, then keep the original rule/session/queue
-- immutable so a concurrent second first-message cannot rewrite its origin.
create or replace function private.validate_managed_whatsapp_lead_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb := coalesce(new.metadata, '{}'::jsonb);
  v_marker boolean;
  v_rule_id uuid;
  v_session_id uuid;
  v_round_robin_id uuid;
begin
  v_marker := lower(btrim(coalesce(
    v_metadata->>'managed_whatsapp_message_distribution',
    'false'
  ))) in ('true', '1', 'yes');

  if not v_marker then
    return new;
  end if;

  begin
    v_rule_id := nullif(btrim(v_metadata->>'matched_rule_id'), '')::uuid;
    v_session_id := nullif(btrim(v_metadata->>'whatsapp_session_id'), '')::uuid;
    v_round_robin_id := nullif(btrim(v_metadata->>'target_round_robin_id'), '')::uuid;
  exception
    when invalid_text_representation then
      raise exception using
        errcode = '23514',
        message = 'managed_whatsapp_context_invalid';
  end;

  if new.organization_id is null
     or lower(btrim(coalesce(new.source, ''))) <> 'whatsapp'
     or new.source_session_id is distinct from v_session_id
     or v_rule_id is null
     or v_session_id is null
     or v_round_robin_id is null
     or not exists (
       select 1
       from public.whatsapp_inbound_rules as inbound_rule
       join public.round_robin_rules as round_robin_rule
         on round_robin_rule.organization_id = inbound_rule.organization_id
        and round_robin_rule.id = inbound_rule.id
        and round_robin_rule.round_robin_id = inbound_rule.target_round_robin_id
       join public.round_robins as queue
         on queue.organization_id = round_robin_rule.organization_id
        and queue.id = round_robin_rule.round_robin_id
       join public.whatsapp_sessions as whatsapp_session
         on whatsapp_session.organization_id = inbound_rule.organization_id
        and whatsapp_session.id = inbound_rule.session_id
       cross join lateral (
         select btrim(coalesce(
           nullif(round_robin_rule.match_value, ''),
           round_robin_rule.conditions->>'match_value',
           ''
         )) as keyword
       ) as normalized
       where inbound_rule.organization_id = new.organization_id
         and inbound_rule.id = v_rule_id
         and inbound_rule.session_id = v_session_id
         and inbound_rule.target_round_robin_id = v_round_robin_id
         and coalesce(queue.is_active, true) = true
         and coalesce(round_robin_rule.is_active, true) = true
         and coalesce(inbound_rule.is_active, true) = true
         and whatsapp_session.provider = 'evolution_go'
         and coalesce(whatsapp_session.is_active, true) = true
         and lower(btrim(coalesce(whatsapp_session.status, '')))
           not in ('deleted', 'disabled')
         and coalesce(
           nullif(round_robin_rule.match_type, ''),
           round_robin_rule.conditions->>'match_type',
           round_robin_rule.name,
           ''
         ) = 'whatsapp_message_contains'
         and coalesce(
           nullif(btrim(round_robin_rule.match->>'whatsapp_session_id'), ''),
           nullif(btrim(round_robin_rule.conditions->'match'->>'whatsapp_session_id'), '')
         ) = v_session_id::text
         and lower(btrim(coalesce(inbound_rule.match_type, ''))) = 'contains'
         and lower(btrim(coalesce(inbound_rule.match_field, 'message'))) = 'message'
         and normalized.keyword <> ''
         and lower(btrim(coalesce(inbound_rule.match_value, '')))
           = lower(normalized.keyword)
         and lower(btrim(coalesce(queue.settings->>'require_checkin', 'false')))
           not in ('true', '1', 'yes')
         and position(
           lower(normalized.keyword)
           in lower(coalesce(nullif(new.initial_message, ''), new.message, ''))
         ) > 0
     ) then
    raise exception using
      errcode = '23514',
      message = 'managed_whatsapp_context_invalid';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_managed_whatsapp_lead_insert()
from public, anon, authenticated, service_role;

drop trigger if exists validate_managed_whatsapp_lead_insert on public.leads;
create trigger validate_managed_whatsapp_lead_insert
before insert on public.leads
for each row
execute function private.validate_managed_whatsapp_lead_insert();

create or replace function private.preserve_managed_whatsapp_lead_intake()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_metadata jsonb := coalesce(old.metadata, '{}'::jsonb);
  v_new_metadata jsonb := coalesce(new.metadata, '{}'::jsonb);
  v_old_marker boolean;
  v_new_marker boolean;
  v_key text;
begin
  v_old_marker := lower(btrim(coalesce(
    v_old_metadata->>'managed_whatsapp_message_distribution',
    'false'
  ))) in ('true', '1', 'yes');
  v_new_marker := lower(btrim(coalesce(
    v_new_metadata->>'managed_whatsapp_message_distribution',
    'false'
  ))) in ('true', '1', 'yes');

  if not v_old_marker and not v_new_marker then
    return new;
  end if;

  if jsonb_typeof(v_old_metadata) <> 'object'
     or jsonb_typeof(v_new_metadata) <> 'object' then
    raise exception using
      errcode = '23514',
      message = 'managed_whatsapp_metadata_must_be_object';
  end if;

  if new.organization_id is distinct from old.organization_id then
    raise exception using
      errcode = '23514',
      message = 'managed_whatsapp_organization_immutable';
  end if;

  foreach v_key in array array[
    'managed_whatsapp_message_distribution',
    'matched_rule_id',
    'whatsapp_session_id',
    'target_round_robin_id',
    'target_team_id'
  ]
  loop
    v_new_metadata := v_new_metadata - v_key;
    if v_old_metadata ? v_key then
      v_new_metadata := v_new_metadata
        || jsonb_build_object(v_key, v_old_metadata->v_key);
    end if;
  end loop;

  new.metadata := v_new_metadata;
  new.source := old.source;
  new.source_session_id := old.source_session_id;
  new.initial_message := old.initial_message;
  return new;
end;
$$;

revoke all on function private.preserve_managed_whatsapp_lead_intake()
from public, anon, authenticated, service_role;

drop trigger if exists preserve_managed_whatsapp_lead_intake on public.leads;
create trigger preserve_managed_whatsapp_lead_intake
before update of organization_id, source, source_session_id, initial_message, metadata
on public.leads
for each row
execute function private.preserve_managed_whatsapp_lead_intake();

create or replace function public.handle_managed_whatsapp_message_lead(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_marker boolean;
  v_rule_id_text text;
  v_rule_id uuid;
  v_session_id_text text;
  v_session_id uuid;
  v_target_queue_id_text text;
  v_target_queue_id uuid;
  v_resolved_queue_id uuid;
  v_keyword text;
  v_result jsonb;
begin
  select lead.*
    into v_lead
    from public.leads as lead
   where lead.id = p_lead_id
   for update;

  if not found then
    return jsonb_build_object('handled', false, 'success', false, 'reason', 'lead_not_found');
  end if;

  v_marker := lower(btrim(coalesce(
    v_lead.metadata->>'managed_whatsapp_message_distribution',
    'false'
  ))) in ('true', '1', 'yes');

  if not v_marker then
    return jsonb_build_object('handled', false, 'reason', 'not_managed');
  end if;

  insert into public.lead_timeline_events (
    lead_id, organization_id, user_id, event_type, title, description, metadata
  )
  select
    v_lead.id,
    v_lead.organization_id,
    null,
    'lead_created',
    'Lead criado',
    'Lead recebido no sistema',
    jsonb_build_object(
      'source', v_lead.source,
      'source_label', 'WhatsApp',
      'source_session_id', v_lead.source_session_id,
      'matched_rule_id', v_lead.metadata->>'matched_rule_id'
    )
  where not exists (
    select 1
      from public.lead_timeline_events as timeline
     where timeline.organization_id = v_lead.organization_id
       and timeline.lead_id = v_lead.id
       and timeline.event_type = 'lead_created'
  );

  if not public.whatsapp_webhook_has_lead_creation_context(
    coalesce(v_lead.metadata, '{}'::jsonb)
  ) then
    return jsonb_build_object(
      'handled', true,
      'success', false,
      'reason', 'managed_whatsapp_session_invalid'
    );
  end if;

  v_rule_id_text := btrim(coalesce(v_lead.metadata->>'matched_rule_id', ''));
  v_session_id_text := btrim(coalesce(v_lead.metadata->>'whatsapp_session_id', ''));
  v_target_queue_id_text := btrim(coalesce(v_lead.metadata->>'target_round_robin_id', ''));

  if v_rule_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_session_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_target_queue_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object(
      'handled', true,
      'success', false,
      'reason', 'managed_whatsapp_context_invalid'
    );
  end if;

  v_rule_id := v_rule_id_text::uuid;
  v_session_id := v_session_id_text::uuid;
  v_target_queue_id := v_target_queue_id_text::uuid;

  select
    queue.id,
    normalized.keyword
    into v_resolved_queue_id, v_keyword
    from public.round_robin_rules as round_robin_rule
    join public.whatsapp_inbound_rules as inbound_rule
      on inbound_rule.organization_id = round_robin_rule.organization_id
     and inbound_rule.id = round_robin_rule.id
     and inbound_rule.target_round_robin_id = round_robin_rule.round_robin_id
    join public.whatsapp_sessions as whatsapp_session
      on whatsapp_session.organization_id = inbound_rule.organization_id
     and whatsapp_session.id = inbound_rule.session_id
    join public.round_robins as queue
      on queue.organization_id = round_robin_rule.organization_id
     and queue.id = round_robin_rule.round_robin_id
    cross join lateral (
      select btrim(coalesce(
        nullif(round_robin_rule.match_value, ''),
        round_robin_rule.conditions->>'match_value',
        ''
      )) as keyword
    ) as normalized
   where round_robin_rule.organization_id = v_lead.organization_id
     and round_robin_rule.id = v_rule_id
     and round_robin_rule.round_robin_id = v_target_queue_id
     and inbound_rule.session_id = v_session_id
     and v_lead.source_session_id = v_session_id
     and lower(btrim(coalesce(v_lead.source, ''))) = 'whatsapp'
     and coalesce(queue.is_active, true) = true
     and coalesce(round_robin_rule.is_active, true) = true
     and coalesce(inbound_rule.is_active, true) = true
     and whatsapp_session.provider = 'evolution_go'
     and coalesce(whatsapp_session.is_active, true) = true
     and lower(btrim(coalesce(whatsapp_session.status, ''))) not in ('deleted', 'disabled')
     and coalesce(
       nullif(round_robin_rule.match_type, ''),
       round_robin_rule.conditions->>'match_type',
       round_robin_rule.name,
       ''
     ) = 'whatsapp_message_contains'
     and coalesce(
       nullif(btrim(round_robin_rule.match->>'whatsapp_session_id'), ''),
       nullif(btrim(round_robin_rule.conditions->'match'->>'whatsapp_session_id'), '')
     ) = v_session_id::text
     and lower(btrim(coalesce(inbound_rule.match_type, ''))) = 'contains'
     and lower(btrim(coalesce(inbound_rule.match_field, 'message'))) = 'message'
     and normalized.keyword <> ''
     and lower(btrim(coalesce(inbound_rule.match_value, ''))) = lower(normalized.keyword)
     and lower(btrim(coalesce(queue.settings->>'require_checkin', 'false')))
       not in ('true', '1', 'yes')
     and position(
       lower(normalized.keyword)
       in lower(coalesce(nullif(v_lead.initial_message, ''), v_lead.message, ''))
     ) > 0
   limit 1;

  if not found then
    insert into public.round_robin_logs (
      organization_id, round_robin_id, lead_id, rule_matched, reason, metadata
    ) values (
      v_lead.organization_id,
      v_target_queue_id,
      v_lead.id,
      v_rule_id,
      'managed_whatsapp_rule_mismatch',
      jsonb_build_object(
        'managed_whatsapp_message_distribution', true,
        'whatsapp_session_id', v_session_id
      )
    );

    return jsonb_build_object(
      'handled', true,
      'success', false,
      'reason', 'managed_whatsapp_rule_mismatch',
      'round_robin_id', v_target_queue_id
    );
  end if;

  v_result := private.distribute_lead(
    v_lead.organization_id,
    v_lead.id,
    'managed-whatsapp:' || v_lead.id::text || ':' || v_rule_id::text,
    v_resolved_queue_id,
    true,
    'whatsapp',
    coalesce(v_lead.created_at, clock_timestamp())
  );

  update public.round_robin_logs as distribution_log
     set rule_matched = coalesce(distribution_log.rule_matched, v_rule_id),
         metadata = coalesce(distribution_log.metadata, '{}'::jsonb) || jsonb_build_object(
           'managed_whatsapp_message_distribution', true,
           'matched_rule_id', v_rule_id,
           'whatsapp_session_id', v_session_id,
           'keyword', v_keyword
         )
   where distribution_log.organization_id = v_lead.organization_id
     and distribution_log.round_robin_id = v_resolved_queue_id
     and distribution_log.lead_id = v_lead.id
     and distribution_log.metadata->>'distribution_event_id' = v_result->>'distribution_event_id';

  return jsonb_build_object(
    'handled', true,
    'matched_rule_id', v_rule_id,
    'keyword', v_keyword
  ) || coalesce(v_result, '{}'::jsonb);
end;
$$;

revoke all on function public.handle_managed_whatsapp_message_lead(uuid)
from public, anon, authenticated;
grant execute on function public.handle_managed_whatsapp_message_lead(uuid)
to service_role;

comment on function public.handle_managed_whatsapp_message_lead(uuid) is
'Revalidates the exact WhatsApp session and initial-message rule, then delegates assignment to private.distribute_lead for ordinary queue schedules, strategies and redistribution.';
