-- A lead keeps the queue UUID that defined its immutable intake scope.  A
-- physical queue delete makes that scope impossible to resolve on a delayed
-- WhatsApp replay, so user-facing deletion retains an inert tombstone instead.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

alter table public.round_robins
  add column if not exists deleted_at timestamptz,
  add column if not exists tombstone_pipeline_id uuid,
  add column if not exists tombstone_stage_id uuid;

comment on column public.round_robins.deleted_at is
  'User-facing deletion marker. Deleted queues stay addressable by immutable lead intake scopes and frozen webhook snapshots.';

comment on column public.round_robins.tombstone_pipeline_id is
  'Immutable, non-FK pipeline snapshot used only by delayed intake after queue deletion.';

comment on column public.round_robins.tombstone_stage_id is
  'Immutable, non-FK stage snapshot used only by delayed intake after queue deletion.';

-- The legacy synchronizer normally repopulates target_pipeline_id from the
-- non-FK pipeline_id compatibility column.  That would undo an ON DELETE SET
-- NULL action on a tombstone and make the referenced pipeline undeletable.
create or replace function private.sync_round_robin_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rules_stage_id uuid;
begin
  if tg_op = 'UPDATE' and old.deleted_at is not null then
    return new;
  end if;

  new.rules := coalesce(new.rules, '{}'::jsonb);

  if coalesce(new.rules->>'target_stage_id', '') ~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    rules_stage_id := (new.rules->>'target_stage_id')::uuid;
  end if;

  if tg_op = 'INSERT' then
    new.target_pipeline_id := coalesce(new.target_pipeline_id, new.pipeline_id);
    new.pipeline_id := coalesce(new.pipeline_id, new.target_pipeline_id);
    new.target_stage_id := coalesce(new.target_stage_id, rules_stage_id);
    new.settings := coalesce(
      nullif(new.settings, '{}'::jsonb),
      new.rules->'settings',
      '{}'::jsonb
    );
    new.strategy := coalesce(
      nullif(new.strategy, ''),
      nullif(new.rules->>'strategy', ''),
      'simple'
    );
    new.reentry_behavior := coalesce(
      nullif(new.reentry_behavior, ''),
      nullif(new.rules->>'reentry_behavior', ''),
      'redistribute'
    );
  else
    if new.rules is distinct from old.rules then
      if new.target_stage_id is not distinct from old.target_stage_id then
        new.target_stage_id := rules_stage_id;
      end if;
      if new.settings is not distinct from old.settings then
        new.settings := coalesce(new.rules->'settings', '{}'::jsonb);
      end if;
      if new.strategy is not distinct from old.strategy then
        new.strategy := coalesce(
          nullif(new.rules->>'strategy', ''),
          'simple'
        );
      end if;
      if new.reentry_behavior is not distinct from old.reentry_behavior then
        new.reentry_behavior := coalesce(
          nullif(new.rules->>'reentry_behavior', ''),
          'redistribute'
        );
      end if;
    end if;
    new.target_pipeline_id := coalesce(new.target_pipeline_id, new.pipeline_id);
    new.pipeline_id := coalesce(new.pipeline_id, new.target_pipeline_id);
    new.settings := coalesce(new.settings, '{}'::jsonb);
    new.strategy := coalesce(nullif(new.strategy, ''), 'simple');
    new.reentry_behavior := coalesce(
      nullif(new.reentry_behavior, ''),
      'redistribute'
    );
  end if;

  new.rules := pg_catalog.jsonb_set(
    new.rules,
    '{strategy}',
    pg_catalog.to_jsonb(new.strategy),
    true
  );
  new.rules := pg_catalog.jsonb_set(
    new.rules,
    '{settings}',
    new.settings,
    true
  );
  new.rules := pg_catalog.jsonb_set(
    new.rules,
    '{reentry_behavior}',
    pg_catalog.to_jsonb(new.reentry_behavior),
    true
  );
  if new.target_stage_id is null then
    new.rules := new.rules - 'target_stage_id';
  else
    new.rules := pg_catalog.jsonb_set(
      new.rules,
      '{target_stage_id}',
      pg_catalog.to_jsonb(new.target_stage_id::text),
      true
    );
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

comment on function private.sync_round_robin_contract() is
  'round_robin_tombstone_aware_v1';

revoke all on function private.sync_round_robin_contract() from public;

alter table public.round_robins
  drop constraint if exists round_robins_deleted_queue_is_inactive;

alter table public.round_robins
  add constraint round_robins_deleted_queue_is_inactive
  check (deleted_at is null or is_active is false)
  not valid;

alter table public.round_robins
  validate constraint round_robins_deleted_queue_is_inactive;

create index if not exists idx_round_robins_live_organization_created
  on public.round_robins (organization_id, created_at desc, id desc)
  where deleted_at is null;

create index if not exists idx_whatsapp_routing_snapshots_managed_queue
  on public.whatsapp_webhook_routing_snapshots (
    organization_id,
    (snapshot->>'origin_round_robin_id')
  )
  where snapshot @> '{"managed_message_distribution":true}'::jsonb;

create or replace function private.round_robin_has_pending_whatsapp_intake(
  p_organization_id uuid,
  p_round_robin_id uuid
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.whatsapp_webhook_routing_snapshots as routing_snapshot
    left join public.whatsapp_webhook_routing_outcomes as routing_outcome
      on routing_outcome.organization_id = routing_snapshot.organization_id
     and routing_outcome.session_id = routing_snapshot.session_id
     and routing_outcome.provider_message_id =
       routing_snapshot.provider_message_id
     and routing_outcome.ingress_sequence = routing_snapshot.ingress_sequence
    where routing_snapshot.organization_id = p_organization_id
      and routing_snapshot.snapshot @>
        '{"managed_message_distribution":true}'::jsonb
      and routing_snapshot.snapshot->>'origin_round_robin_id' =
        p_round_robin_id::text
      and routing_outcome.provider_message_id is null
      and (
        routing_snapshot.binding_eligible
        or exists (
          select 1
          from public.whatsapp_webhook_inbox as inbox
          where inbox.organization_id = routing_snapshot.organization_id
            and inbox.session_id = routing_snapshot.session_id
            and inbox.event_key = routing_snapshot.inbox_event_key
            and inbox.status in ('pending', 'retry', 'processing', 'dead')
        )
      )
  );
$$;

revoke all on function private.round_robin_has_pending_whatsapp_intake(
  uuid, uuid
) from public, anon, authenticated;
grant execute on function private.round_robin_has_pending_whatsapp_intake(
  uuid, uuid
) to service_role;

-- The immutable snapshot is written in the ACK transaction.  Its queue lock
-- is the serialization fence against a concurrent user-facing queue delete:
-- either the snapshot commits first and deletion sees it, or deletion wins
-- and the ACK fails closed instead of accepting an unprocessable route.
create or replace function private.guard_managed_whatsapp_snapshot_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round_robin_id uuid;
  v_rule_id uuid;
  v_rule_match_value text;
begin
  if new.snapshot->>'managed_message_distribution' is distinct from 'true' then
    return new;
  end if;

  begin
    v_round_robin_id := nullif(
      pg_catalog.btrim(new.snapshot->>'origin_round_robin_id'),
      ''
    )::uuid;
    v_rule_id := nullif(
      pg_catalog.btrim(new.snapshot->>'rule_id'),
      ''
    )::uuid;
  exception
    when invalid_text_representation then
      raise exception using
        errcode = '23514',
        message = 'managed_whatsapp_snapshot_queue_invalid';
  end;

  if v_round_robin_id is null or v_rule_id is null then
    raise exception using
      errcode = '23514',
      message = 'managed_whatsapp_snapshot_context_required';
  end if;

  perform 1
  from public.round_robins as queue
  where queue.organization_id = new.organization_id
    and queue.id = v_round_robin_id
    and queue.deleted_at is null
    and coalesce(queue.is_active, true) = true
    and lower(pg_catalog.btrim(coalesce(
      queue.settings->>'require_checkin',
      'false'
    ))) not in ('true', '1', 'yes')
  for share;

  if found then
    select lower(pg_catalog.btrim(coalesce(
      nullif(rule.match_value, ''),
      rule.conditions->>'match_value',
      ''
    )))
    into v_rule_match_value
    from public.round_robin_rules as rule
    where rule.organization_id = new.organization_id
      and rule.id = v_rule_id
      and rule.round_robin_id = v_round_robin_id
      and coalesce(rule.is_active, true) = true
      and coalesce(
        nullif(rule.match_type, ''),
        rule.conditions->>'match_type',
        rule.name,
        ''
      ) = 'whatsapp_message_contains'
      and coalesce(
        nullif(pg_catalog.btrim(rule.match->>'whatsapp_session_id'), ''),
        nullif(pg_catalog.btrim(
          rule.conditions->'match'->>'whatsapp_session_id'
        ), '')
      ) = new.session_id::text
    for share;

    if found then
      perform 1
      from public.whatsapp_inbound_rules as inbound_rule
      where inbound_rule.organization_id = new.organization_id
        and inbound_rule.id = v_rule_id
        and inbound_rule.session_id = new.session_id
        and inbound_rule.target_round_robin_id = v_round_robin_id
        and coalesce(inbound_rule.is_active, true) = true
        and lower(pg_catalog.btrim(coalesce(
          inbound_rule.match_type,
          ''
        ))) = 'contains'
        and lower(pg_catalog.btrim(coalesce(
          inbound_rule.match_field,
          'message'
        ))) = 'message'
        and pg_catalog.btrim(coalesce(inbound_rule.match_value, '')) <> ''
        and lower(pg_catalog.btrim(inbound_rule.match_value)) =
          v_rule_match_value
      for share;
    end if;

    if found then
      return new;
    end if;
  end if;

  -- BEFORE INSERT also runs ahead of ON CONFLICT.  Permit the exact immutable
  -- provider replay that the uniqueness constraint will turn into a no-op,
  -- but never let a different route reuse that exception after tombstoning.
  if exists (
    select 1
    from public.whatsapp_webhook_routing_snapshots as existing
    where existing.organization_id = new.organization_id
      and existing.session_id = new.session_id
      and existing.provider_message_id = new.provider_message_id
      and existing.inbox_event_key = new.inbox_event_key
      and existing.processing_lane = new.processing_lane
      and existing.routing_key = new.routing_key
      and existing.predecessor_provider_message_id is not distinct from
        new.predecessor_provider_message_id
      and existing.binding_eligible = new.binding_eligible
      and existing.target_mode = new.target_mode
      and existing.snapshot = new.snapshot
  ) then
    return new;
  end if;

  raise exception using
    errcode = '23503',
    message = 'managed_whatsapp_snapshot_queue_not_live';
end;
$$;

revoke all on function private.guard_managed_whatsapp_snapshot_queue()
from public;

drop trigger if exists guard_managed_whatsapp_snapshot_queue
on public.whatsapp_webhook_routing_snapshots;
create trigger guard_managed_whatsapp_snapshot_queue
before insert on public.whatsapp_webhook_routing_snapshots
for each row
execute function private.guard_managed_whatsapp_snapshot_queue();

create or replace function private.guard_round_robin_tombstone_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is not null then
    -- ON DELETE SET NULL is still allowed to retire references owned by rows
    -- outside this tombstone.  Everything that defines the immutable queue
    -- identity or frozen destination remains byte-for-byte unchanged.
    if (pg_catalog.to_jsonb(new) - array[
          'target_pipeline_id',
          'target_stage_id',
          'ai_agent_id',
          'created_by'
        ]) is distinct from
       (pg_catalog.to_jsonb(old) - array[
          'target_pipeline_id',
          'target_stage_id',
          'ai_agent_id',
          'created_by'
        ])
       or (
         new.target_pipeline_id is distinct from old.target_pipeline_id
         and new.target_pipeline_id is not null
       )
       or (
         new.target_stage_id is distinct from old.target_stage_id
         and new.target_stage_id is not null
       )
       or (
         new.ai_agent_id is distinct from old.ai_agent_id
         and new.ai_agent_id is not null
       )
       or (
         new.created_by is distinct from old.created_by
         and new.created_by is not null
       ) then
      raise exception using
        errcode = '23514',
        message = 'round_robin_tombstone_immutable';
    end if;
    return new;
  end if;

  if (
    new.deleted_at is distinct from old.deleted_at
    or new.is_active is distinct from old.is_active
    or new.pipeline_id is distinct from old.pipeline_id
    or new.target_pipeline_id is distinct from old.target_pipeline_id
    or new.target_stage_id is distinct from old.target_stage_id
    or new.strategy is distinct from old.strategy
    or new.settings is distinct from old.settings
    or new.reentry_behavior is distinct from old.reentry_behavior
    or new.rules is distinct from old.rules
  ) and private.round_robin_has_pending_whatsapp_intake(
    old.organization_id,
    old.id
  ) then
    raise exception using
      errcode = '55000',
      message = 'round_robin_pending_whatsapp_intake';
  end if;

  if new.deleted_at is null then
    if new.tombstone_pipeline_id is distinct from old.tombstone_pipeline_id
       or new.tombstone_stage_id is distinct from old.tombstone_stage_id then
      raise exception using
        errcode = '23514',
        message = 'round_robin_tombstone_snapshot_managed';
    end if;
    return new;
  end if;

  if new.is_active is not false then
    raise exception using
      errcode = '23514',
      message = 'round_robin_tombstone_must_be_inactive';
  end if;

  new.tombstone_pipeline_id := coalesce(
    old.target_pipeline_id,
    old.pipeline_id
  );
  new.tombstone_stage_id := old.target_stage_id;

  return new;
end;
$$;

revoke all on function private.guard_round_robin_tombstone_state() from public;

drop trigger if exists guard_round_robin_tombstone_state on public.round_robins;
create trigger guard_round_robin_tombstone_state
before update on public.round_robins
for each row
execute function private.guard_round_robin_tombstone_state();

create or replace function private.guard_round_robin_hard_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- An organization delete legitimately owns the whole identity namespace and
  -- reaches this row through ON DELETE CASCADE after the parent disappeared.
  if not exists (
    select 1
    from public.organizations as organization
    where organization.id = old.organization_id
  ) then
    return old;
  end if;

  raise exception using
    errcode = '55000',
    message = 'round_robin_hard_delete_forbidden';
end;
$$;

revoke all on function private.guard_round_robin_hard_delete() from public;

drop trigger if exists guard_round_robin_hard_delete on public.round_robins;
create constraint trigger guard_round_robin_hard_delete
after delete on public.round_robins
deferrable initially deferred
for each row
execute function private.guard_round_robin_hard_delete();

create or replace function private.guard_round_robin_truncate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'round_robin_truncate_forbidden';
end;
$$;

revoke all on function private.guard_round_robin_truncate() from public;

drop trigger if exists guard_round_robin_truncate on public.round_robins;
create trigger guard_round_robin_truncate
before truncate on public.round_robins
for each statement
execute function private.guard_round_robin_truncate();

alter table public.round_robins
enable always trigger guard_round_robin_truncate;

-- Generic row auditing runs from AFTER DELETE triggers on several descendants
-- of organizations. During an organization cascade, those triggers execute
-- after the parent and its existing audit rows have been deleted. A new audit
-- row would therefore point at a tenant that is intentionally gone and abort
-- the whole cascade. Skip only that terminal cascade case; ordinary child
-- deletes still see their organization and remain fully audited.
create or replace function private.write_audit_log_for_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_old jsonb := case
    when tg_op in ('UPDATE', 'DELETE') then pg_catalog.to_jsonb(old)
    else null
  end;
  row_new jsonb := case
    when tg_op in ('INSERT', 'UPDATE') then pg_catalog.to_jsonb(new)
    else null
  end;
  row_diff jsonb := '{}'::jsonb;
  excluded_columns text[] := array['updated_at'];
  target_organization_id uuid;
  target_entity_id text;
  actor_user_id uuid;
  audit_action text;
  audit_entity_type text := coalesce(
    nullif(tg_argv[0], ''),
    tg_table_name
  );
  arg_index integer;
begin
  if tg_nargs > 1 then
    for arg_index in 1..(tg_nargs - 1) loop
      excluded_columns := excluded_columns || tg_argv[arg_index];
    end loop;
  end if;

  if tg_op = 'UPDATE' then
    row_diff := private.audit_jsonb_diff(
      row_old,
      row_new,
      excluded_columns
    );
    if row_diff = '{}'::jsonb then
      return null;
    end if;
  elsif tg_op = 'INSERT' then
    row_diff := private.audit_jsonb_diff(
      '{}'::jsonb,
      row_new,
      excluded_columns
    );
  elsif tg_op = 'DELETE' then
    row_diff := private.audit_jsonb_diff(
      row_old,
      '{}'::jsonb,
      excluded_columns
    );
  end if;

  target_organization_id := coalesce(
    private.safe_uuid(row_new ->> 'organization_id'),
    private.safe_uuid(row_old ->> 'organization_id')
  );
  target_entity_id := coalesce(
    row_new ->> 'id',
    row_old ->> 'id'
  );

  if tg_op = 'DELETE'
     and target_organization_id is not null
     and not exists (
       select 1
       from public.organizations as organization
       where organization.id = target_organization_id
     ) then
    return null;
  end if;

  actor_user_id := coalesce(
    private.current_audit_actor_id(),
    private.safe_uuid(row_new ->> 'created_by'),
    private.safe_uuid(row_old ->> 'created_by')
  );

  audit_action := case tg_op
    when 'INSERT' then 'create'
    when 'UPDATE' then 'update'
    when 'DELETE' then 'delete'
    else pg_catalog.lower(tg_op)
  end;

  insert into public.audit_logs (
    organization_id,
    user_id,
    action,
    entity_type,
    entity_id,
    old_data,
    new_data,
    diff,
    source,
    metadata
  )
  values (
    target_organization_id,
    actor_user_id,
    audit_action,
    audit_entity_type,
    target_entity_id,
    case when tg_op in ('UPDATE', 'DELETE') then row_old else null end,
    case when tg_op in ('INSERT', 'UPDATE') then row_new else null end,
    row_diff,
    'database_trigger',
    pg_catalog.jsonb_build_object(
      'schema', tg_table_schema,
      'table', tg_table_name,
      'operation', tg_op
    )
  );

  return null;
end;
$$;

revoke all on function private.write_audit_log_for_row()
from public, anon, authenticated;
grant execute on function private.write_audit_log_for_row()
to service_role;

comment on function private.write_audit_log_for_row() is
  'audit_org_cascade_safe_v1';

-- Managed ACK freezes a queue/rule decision before the worker creates the
-- card.  Every configuration writer must therefore serialize on the parent
-- queue and refuse to invalidate an unresolved snapshot.  The member counter
-- update is an operational effect of distribution itself and is the only
-- child update intentionally allowed while the snapshot is pending.
create or replace function private.guard_pending_managed_whatsapp_child_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_old_organization_id uuid;
  v_new_organization_id uuid;
  v_old_round_robin_id uuid;
  v_new_round_robin_id uuid;
  v_reference record;
  v_queue_column text := case
    when tg_table_name = 'whatsapp_inbound_rules'
      then 'target_round_robin_id'
    else 'round_robin_id'
  end;
begin
  if tg_op <> 'INSERT' then
    v_old := pg_catalog.to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    v_new := pg_catalog.to_jsonb(new);
  end if;

  if tg_table_name = 'round_robin_members'
     and tg_op = 'UPDATE'
     and (v_new - array['leads_count', 'updated_at']) is not distinct from
         (v_old - array['leads_count', 'updated_at']) then
    return new;
  end if;

  if v_old is not null then
    v_old_organization_id := nullif(
      v_old->>'organization_id',
      ''
    )::uuid;
    v_old_round_robin_id := nullif(
      v_old->>v_queue_column,
      ''
    )::uuid;
  end if;
  if v_new is not null then
    v_new_organization_id := nullif(
      v_new->>'organization_id',
      ''
    )::uuid;
    v_new_round_robin_id := nullif(
      v_new->>v_queue_column,
      ''
    )::uuid;
  end if;

  -- Organization deletion owns the entire tenant namespace. Its FK cascades
  -- may reach queue children before the pending routing snapshot itself, so a
  -- terminal child DELETE must not be mistaken for a live queue mutation.
  -- Ordinary queue/rule deletion still sees its organization and remains
  -- fenced until the managed snapshot has a real terminal outcome.
  if tg_op = 'DELETE'
     and v_old_organization_id is not null
     and not exists (
       select 1
       from public.organizations as organization
       where organization.id = v_old_organization_id
     ) then
    return old;
  end if;

  for v_reference in
    select distinct reference.organization_id, reference.round_robin_id
    from (
      values
        (v_old_organization_id, v_old_round_robin_id),
        (v_new_organization_id, v_new_round_robin_id)
    ) as reference(organization_id, round_robin_id)
    where reference.organization_id is not null
      and reference.round_robin_id is not null
    order by reference.organization_id, reference.round_robin_id
  loop
    perform 1
    from public.round_robins as queue
    where queue.organization_id = v_reference.organization_id
      and queue.id = v_reference.round_robin_id
    for update;

    if found and private.round_robin_has_pending_whatsapp_intake(
      v_reference.organization_id,
      v_reference.round_robin_id
    ) then
      raise exception using
        errcode = '55000',
        message = 'round_robin_pending_whatsapp_intake';
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_pending_managed_whatsapp_child_mutation()
from public;

comment on function private.guard_pending_managed_whatsapp_child_mutation() is
  'round_robin_pending_intake_org_cascade_v2';

drop trigger if exists guard_00_round_robin_pending_intake
on public.round_robin_rules;
create trigger guard_00_round_robin_pending_intake
before insert or update or delete on public.round_robin_rules
for each row
execute function private.guard_pending_managed_whatsapp_child_mutation();

drop trigger if exists guard_00_round_robin_pending_intake
on public.round_robin_members;
create trigger guard_00_round_robin_pending_intake
before insert or update or delete on public.round_robin_members
for each row
execute function private.guard_pending_managed_whatsapp_child_mutation();

drop trigger if exists guard_00_round_robin_pending_intake
on public.whatsapp_inbound_rules;
create trigger guard_00_round_robin_pending_intake
before insert or update or delete on public.whatsapp_inbound_rules
for each row
execute function private.guard_pending_managed_whatsapp_child_mutation();

create or replace function private.guard_live_round_robin_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_round_robin_id uuid;
begin
  v_round_robin_id := nullif(
    pg_catalog.to_jsonb(new)->>tg_argv[0],
    ''
  )::uuid;
  if v_round_robin_id is null then
    return new;
  end if;

  v_organization_id := nullif(
    pg_catalog.to_jsonb(new)->>'organization_id',
    ''
  )::uuid;

  perform 1
  from public.round_robins as queue
  where queue.id = v_round_robin_id
    and (
      v_organization_id is null
      or queue.organization_id = v_organization_id
    )
    and queue.deleted_at is null
  for key share;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'round_robin_reference_not_live';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_live_round_robin_reference() from public;

drop trigger if exists guard_live_round_robin_pipeline_reference on public.pipelines;
create trigger guard_live_round_robin_pipeline_reference
before insert or update of default_round_robin_id, organization_id on public.pipelines
for each row
execute function private.guard_live_round_robin_reference('default_round_robin_id');

drop trigger if exists guard_live_round_robin_portal_reference on public.portal_integrations;
create trigger guard_live_round_robin_portal_reference
before insert or update of default_round_robin_id, organization_id on public.portal_integrations
for each row
execute function private.guard_live_round_robin_reference('default_round_robin_id');

drop trigger if exists guard_live_round_robin_meta_form_reference on public.meta_form_configs;
create trigger guard_live_round_robin_meta_form_reference
before insert or update of round_robin_id, organization_id on public.meta_form_configs
for each row
execute function private.guard_live_round_robin_reference('round_robin_id');

drop trigger if exists guard_live_round_robin_whatsapp_reference on public.whatsapp_inbound_rules;
create trigger guard_live_round_robin_whatsapp_reference
before insert or update of target_round_robin_id, organization_id on public.whatsapp_inbound_rules
for each row
execute function private.guard_live_round_robin_reference('target_round_robin_id');

drop trigger if exists guard_live_round_robin_redistribution_job on public.lead_redistribution_jobs;
create trigger guard_live_round_robin_redistribution_job
before insert or update of round_robin_id, organization_id on public.lead_redistribution_jobs
for each row
execute function private.guard_live_round_robin_reference('round_robin_id');

drop trigger if exists guard_live_round_robin_member on public.round_robin_members;
create trigger guard_live_round_robin_member
before insert or update of round_robin_id, organization_id on public.round_robin_members
for each row
execute function private.guard_live_round_robin_reference('round_robin_id');

drop trigger if exists guard_live_round_robin_rule on public.round_robin_rules;
create trigger guard_live_round_robin_rule
before insert or update of round_robin_id, organization_id on public.round_robin_rules
for each row
execute function private.guard_live_round_robin_reference('round_robin_id');

-- Browser/Data API callers use the backend endpoints.  Keeping direct DML
-- grants would bypass the canonical parent-queue lock order and the API's
-- conflict response while a managed ACK is unresolved.
revoke insert, update, delete, truncate
on public.round_robins, public.round_robin_rules,
   public.round_robin_members, public.whatsapp_inbound_rules
from anon, authenticated;

-- The backend tombstones queues with UPDATE and removes their child routing
-- rows explicitly. It never needs a direct queue DELETE or TRUNCATE grant.
-- Keep privileged Data API calls from bypassing the immutable identity row;
-- the owner-only trigger remains a final defense for maintenance sessions.
revoke delete, truncate on public.round_robins from service_role;

drop policy if exists vimob_round_robins_live_rows_only on public.round_robins;
create policy vimob_round_robins_live_rows_only
on public.round_robins
as restrictive
for all
to anon, authenticated
using (deleted_at is null)
with check (deleted_at is null);

-- A delayed frozen queue may be inactive by the time a CTWA lead is created.
-- Preserve its original destination without making the queue eligible for new
-- routing.  The name sorts before tr_ensure_lead_pipeline so the queue target
-- wins over the organization's generic default pipeline.
create or replace function private.hydrate_lead_destination_from_intake_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_destination_fallback boolean := false;
  v_candidate_pipeline_id uuid;
  v_candidate_stage_id uuid;
  v_pipeline_id uuid;
  v_stage_id uuid;
begin
  if new.origin_round_robin_id is null
     or new.pipeline_id is not null
     or new.stage_id is not null then
    return new;
  end if;

  select
    case
      when queue.deleted_at is not null then queue.tombstone_pipeline_id
      else coalesce(queue.target_pipeline_id, queue.pipeline_id)
    end,
    case
      when queue.deleted_at is not null then queue.tombstone_stage_id
      else queue.target_stage_id
    end
  into v_candidate_pipeline_id, v_candidate_stage_id
  from public.round_robins as queue
  where queue.organization_id = new.organization_id
    and queue.id = new.origin_round_robin_id;

  select pipeline.id
  into v_pipeline_id
  from public.pipelines as pipeline
  where pipeline.organization_id = new.organization_id
    and pipeline.id = v_candidate_pipeline_id
    and coalesce(pipeline.is_active, true) = true;

  if v_pipeline_id is not null then
    select stage.id
    into v_stage_id
    from public.stages as stage
    where stage.organization_id = new.organization_id
      and stage.pipeline_id = v_pipeline_id
      and stage.id = v_candidate_stage_id
      and coalesce(stage.is_active, true) = true
    ;

    if v_stage_id is null then
      select stage.id
      into v_stage_id
      from public.stages as stage
      where stage.organization_id = new.organization_id
        and stage.pipeline_id = v_pipeline_id
        and coalesce(stage.is_active, true) = true
      order by stage.position asc, stage.created_at asc, stage.id asc
      limit 1;
    end if;
  end if;

  if v_pipeline_id is null or v_stage_id is null then
    v_destination_fallback := true;
    select pipeline.id, first_stage.id
    into v_pipeline_id, v_stage_id
    from public.pipelines as pipeline
    join lateral (
      select stage.id
      from public.stages as stage
      where stage.organization_id = pipeline.organization_id
        and stage.pipeline_id = pipeline.id
        and coalesce(stage.is_active, true) = true
      order by stage.position asc, stage.created_at asc, stage.id asc
      limit 1
    ) as first_stage on true
    where pipeline.organization_id = new.organization_id
      and coalesce(pipeline.is_active, true) = true
    order by
      coalesce(pipeline.is_default, false) desc,
      coalesce(pipeline.position, 0) asc,
      pipeline.created_at asc,
      pipeline.id asc
    limit 1;

    if v_pipeline_id is null or v_stage_id is null then
      raise exception using
        errcode = '23514',
        message = 'round_robin_tombstone_destination_unavailable';
    end if;
  end if;

  new.pipeline_id := v_pipeline_id;
  new.stage_id := v_stage_id;
  if v_destination_fallback then
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      || pg_catalog.jsonb_build_object(
        'round_robin_tombstone_destination_fallback',
        pg_catalog.jsonb_build_object(
          'round_robin_id', new.origin_round_robin_id,
          'snapshot_pipeline_id', v_candidate_pipeline_id,
          'snapshot_stage_id', v_candidate_stage_id,
          'pipeline_id', v_pipeline_id,
          'stage_id', v_stage_id,
          'recorded_at', pg_catalog.clock_timestamp()
        )
      );
  end if;
  return new;
end;
$$;

revoke all on function private.hydrate_lead_destination_from_intake_queue() from public;

drop trigger if exists hydrate_round_robin_destination_before_lead_insert on public.leads;
create trigger hydrate_round_robin_destination_before_lead_insert
before insert on public.leads
for each row
execute function private.hydrate_lead_destination_from_intake_queue();

do $$
begin
  if exists (
    select 1
    from (
      values
        ('deleted_at'::text, 'timestamp with time zone'::text),
        ('tombstone_pipeline_id'::text, 'uuid'::text),
        ('tombstone_stage_id'::text, 'uuid'::text)
    ) as expected(attname, type_name)
    left join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = 'public.round_robins'::regclass
     and attribute.attname = expected.attname
     and not attribute.attisdropped
    left join pg_catalog.pg_attrdef as attribute_default
      on attribute_default.adrelid = attribute.attrelid
     and attribute_default.adnum = attribute.attnum
    where attribute.attnum is null
       or pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
            is distinct from expected.type_name
       or attribute.attnotnull
       or attribute_default.adbin is not null
  ) then
    raise exception 'round_robin tombstone column contract drifted';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.round_robins'::regclass
      and conname = 'round_robins_deleted_queue_is_inactive'
      and convalidated
      and pg_catalog.pg_get_constraintdef(oid, true) =
        'CHECK (deleted_at IS NULL OR is_active IS FALSE)'
  ) then
    raise exception 'round_robin tombstone constraint drifted';
  end if;

  if pg_catalog.obj_description(
       'private.sync_round_robin_contract()'::regprocedure,
       'pg_proc'
     ) is distinct from 'round_robin_tombstone_aware_v1' then
    raise exception 'round_robin synchronizer tombstone fence drifted';
  end if;

  if (
    select count(*)
    from (
      values
        (
          'public.round_robins'::regclass,
          'guard_round_robin_tombstone_state'::text,
          'private.guard_round_robin_tombstone_state()'::regprocedure,
          19::smallint
        ),
        (
          'public.round_robins'::regclass,
          'guard_round_robin_hard_delete'::text,
          'private.guard_round_robin_hard_delete()'::regprocedure,
          9::smallint
        ),
        (
          'public.leads'::regclass,
          'hydrate_round_robin_destination_before_lead_insert'::text,
          'private.hydrate_lead_destination_from_intake_queue()'::regprocedure,
          7::smallint
        ),
        (
          'public.whatsapp_webhook_routing_snapshots'::regclass,
          'guard_managed_whatsapp_snapshot_queue'::text,
          'private.guard_managed_whatsapp_snapshot_queue()'::regprocedure,
          7::smallint
        ),
        (
          'public.round_robin_rules'::regclass,
          'guard_00_round_robin_pending_intake'::text,
          'private.guard_pending_managed_whatsapp_child_mutation()'::regprocedure,
          31::smallint
        ),
        (
          'public.round_robin_members'::regclass,
          'guard_00_round_robin_pending_intake'::text,
          'private.guard_pending_managed_whatsapp_child_mutation()'::regprocedure,
          31::smallint
        ),
        (
          'public.whatsapp_inbound_rules'::regclass,
          'guard_00_round_robin_pending_intake'::text,
          'private.guard_pending_managed_whatsapp_child_mutation()'::regprocedure,
          31::smallint
        )
    ) as expected(relation_id, trigger_name, function_id, trigger_type)
    join pg_catalog.pg_trigger as trigger
      on trigger.tgrelid = expected.relation_id
     and trigger.tgname = expected.trigger_name
     and trigger.tgfoid = expected.function_id
     and trigger.tgtype = expected.trigger_type
     and trigger.tgenabled = 'O'
     and not trigger.tgisinternal
  ) <> 7 then
    raise exception 'round_robin tombstone trigger contract drifted';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    where trigger.tgrelid = 'public.round_robins'::regclass
      and trigger.tgname = 'guard_round_robin_hard_delete'
      and trigger.tgfoid =
        'private.guard_round_robin_hard_delete()'::regprocedure
      and trigger.tgtype = 9
      and trigger.tgconstraint <> 0
      and trigger.tgdeferrable
      and trigger.tginitdeferred
      and trigger.tgenabled = 'O'
      and not trigger.tgisinternal
  ) then
    raise exception 'round_robin hard-delete deferral contract drifted';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    where trigger.tgrelid = 'public.round_robins'::regclass
      and trigger.tgname = 'guard_round_robin_truncate'
      and trigger.tgfoid =
        'private.guard_round_robin_truncate()'::regprocedure
      and trigger.tgtype = 34
      and trigger.tgconstraint = 0
      and not trigger.tgdeferrable
      and not trigger.tginitdeferred
      and trigger.tgenabled = 'A'
      and not trigger.tgisinternal
  ) then
    raise exception 'round_robin truncate guard drifted';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc
    where oid =
      'private.round_robin_has_pending_whatsapp_intake(uuid,uuid)'::regprocedure
      and prosecdef
      and provolatile = 'v'
  ) then
    raise exception 'round_robin pending-intake fresh-snapshot fence drifted';
  end if;

  if pg_catalog.obj_description(
       'private.guard_pending_managed_whatsapp_child_mutation()'::regprocedure,
       'pg_proc'
     ) is distinct from 'round_robin_pending_intake_org_cascade_v2'
     or pg_catalog.pg_get_functiondef(
       'private.guard_pending_managed_whatsapp_child_mutation()'::regprocedure
     ) not like '%tg_op = ''DELETE''%'
     or pg_catalog.pg_get_functiondef(
       'private.guard_pending_managed_whatsapp_child_mutation()'::regprocedure
     ) not like '%from public.organizations as organization%' then
    raise exception 'round_robin pending-intake organization-cascade fence drifted';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_roles as owner_role
      on owner_role.oid = function_definition.proowner
    where function_definition.oid =
        'private.write_audit_log_for_row()'::regprocedure
      and function_definition.prosecdef
      and function_definition.provolatile = 'v'
      and function_definition.proconfig =
        array['search_path=""']::text[]
      and owner_role.rolbypassrls
      and pg_catalog.obj_description(
        function_definition.oid,
        'pg_proc'
      ) = 'audit_org_cascade_safe_v1'
      and pg_catalog.pg_get_functiondef(function_definition.oid) like
        '%target_organization_id is not null%'
      and pg_catalog.pg_get_functiondef(function_definition.oid) like
        '%from public.organizations as organization%'
  ) then
    raise exception 'audit organization-cascade guard drifted';
  end if;

  if pg_catalog.has_function_privilege(
       'public',
       'private.write_audit_log_for_row()',
       'execute'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'private.write_audit_log_for_row()',
       'execute'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'private.write_audit_log_for_row()',
       'execute'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'private.write_audit_log_for_row()',
       'execute'
     ) then
    raise exception 'audit organization-cascade function ACL drifted';
  end if;

  if (
    select pg_catalog.count(*)
    from (
      values
        (
          'public.member_availability'::regclass,
          'audit_member_availability_changes'::text,
          29::smallint
        ),
        (
          'public.round_robin_members'::regclass,
          'audit_round_robin_members_changes'::text,
          29::smallint
        ),
        (
          'public.round_robin_rules'::regclass,
          'audit_round_robin_rules_changes'::text,
          29::smallint
        ),
        (
          'public.round_robins'::regclass,
          'audit_round_robins_changes'::text,
          29::smallint
        ),
        (
          'public.team_members'::regclass,
          'audit_team_members_changes'::text,
          29::smallint
        ),
        (
          'public.team_pipelines'::regclass,
          'audit_team_pipelines_changes'::text,
          13::smallint
        ),
        (
          'public.teams'::regclass,
          'audit_teams_changes'::text,
          29::smallint
        )
    ) as expected(relation_id, trigger_name, trigger_type)
    join pg_catalog.pg_trigger as trigger_definition
      on trigger_definition.tgrelid = expected.relation_id
     and trigger_definition.tgname = expected.trigger_name
     and trigger_definition.tgfoid =
       'private.write_audit_log_for_row()'::regprocedure
     and trigger_definition.tgtype = expected.trigger_type
     and trigger_definition.tgenabled = 'O'
     and not trigger_definition.tgisinternal
  ) <> 7 then
    raise exception 'audit descendant trigger contract drifted';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'round_robins'
      and policyname = 'vimob_round_robins_live_rows_only'
      and permissive = 'RESTRICTIVE'
      and cmd = 'ALL'
      and roles @> array['anon', 'authenticated']::name[]
      and pg_catalog.cardinality(roles) = 2
      and qual = '(deleted_at IS NULL)'
      and with_check = '(deleted_at IS NULL)'
  ) then
    raise exception 'round_robin tombstone RLS guard drifted';
  end if;

  if (
    select count(*)
    from (
      values
        (
          'public.pipelines'::regclass,
          'guard_live_round_robin_pipeline_reference'::text,
          'default_round_robin_id'::text
        ),
        (
          'public.portal_integrations'::regclass,
          'guard_live_round_robin_portal_reference'::text,
          'default_round_robin_id'::text
        ),
        (
          'public.meta_form_configs'::regclass,
          'guard_live_round_robin_meta_form_reference'::text,
          'round_robin_id'::text
        ),
        (
          'public.whatsapp_inbound_rules'::regclass,
          'guard_live_round_robin_whatsapp_reference'::text,
          'target_round_robin_id'::text
        ),
        (
          'public.lead_redistribution_jobs'::regclass,
          'guard_live_round_robin_redistribution_job'::text,
          'round_robin_id'::text
        ),
        (
          'public.round_robin_members'::regclass,
          'guard_live_round_robin_member'::text,
          'round_robin_id'::text
        ),
        (
          'public.round_robin_rules'::regclass,
          'guard_live_round_robin_rule'::text,
          'round_robin_id'::text
        )
    ) as expected(relation_id, trigger_name, reference_column)
    join pg_catalog.pg_trigger as trigger
      on trigger.tgrelid = expected.relation_id
     and trigger.tgname = expected.trigger_name
     and trigger.tgfoid =
       'private.guard_live_round_robin_reference()'::regprocedure
     and trigger.tgtype = 23
     and trigger.tgenabled = 'O'
     and trigger.tgnargs = 1
     and pg_catalog.encode(trigger.tgargs, 'escape') =
       expected.reference_column || E'\\000'
     and not trigger.tgisinternal
    where (
      select pg_catalog.count(*) = 2
        and pg_catalog.bool_and(
          attribute.attname = any(array[
            expected.reference_column,
            'organization_id'
          ])
        )
      from pg_catalog.unnest(trigger.tgattr::smallint[]) as update_column(attnum)
      join pg_catalog.pg_attribute as attribute
        on attribute.attrelid = trigger.tgrelid
       and attribute.attnum = update_column.attnum
    )
  ) <> 7 then
    raise exception 'round_robin live-reference guard contract drifted';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index as index_definition
    where index_definition.indexrelid =
      'public.idx_round_robins_live_organization_created'::regclass
      and index_definition.indrelid = 'public.round_robins'::regclass
      and index_definition.indisvalid
      and index_definition.indisready
      and pg_catalog.pg_get_indexdef(
        index_definition.indexrelid,
        0,
        true
      ) = 'CREATE INDEX idx_round_robins_live_organization_created ON round_robins USING btree (organization_id, created_at DESC, id DESC) WHERE deleted_at IS NULL'
      and pg_catalog.pg_get_expr(
        index_definition.indpred,
        index_definition.indrelid,
        true
      ) = 'deleted_at IS NULL'
  ) then
    raise exception 'round_robin live index contract drifted';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index as index_definition
    where index_definition.indexrelid =
      'public.idx_whatsapp_routing_snapshots_managed_queue'::regclass
      and index_definition.indrelid =
        'public.whatsapp_webhook_routing_snapshots'::regclass
      and index_definition.indisvalid
      and index_definition.indisready
      and pg_catalog.pg_get_expr(
        index_definition.indpred,
        index_definition.indrelid,
        true
      ) = 'snapshot @> ''{"managed_message_distribution": true}''::jsonb'
      and pg_catalog.pg_get_indexdef(
        index_definition.indexrelid,
        0,
        true
      ) like
        'CREATE INDEX idx_whatsapp_routing_snapshots_managed_queue ON whatsapp_webhook_routing_snapshots USING btree (organization_id, (snapshot ->> %origin_round_robin_id%)) WHERE %'
  ) then
    raise exception 'managed WhatsApp queue snapshot index contract drifted';
  end if;

  if exists (
    select 1
    from (
      values
        ('anon'::text),
        ('authenticated'::text)
    ) as checked_role(role_name)
    cross join (
      values
        ('public.round_robins'::text),
        ('public.round_robin_rules'::text),
        ('public.round_robin_members'::text),
        ('public.whatsapp_inbound_rules'::text)
    ) as checked_table(table_name)
    cross join (
      values
        ('INSERT'::text),
        ('UPDATE'::text),
        ('DELETE'::text),
        ('TRUNCATE'::text)
    ) as checked_privilege(privilege_name)
    where pg_catalog.has_table_privilege(
      checked_role.role_name,
      checked_table.table_name,
      checked_privilege.privilege_name
    )
  ) then
    raise exception 'round_robin direct mutation privilege was not revoked';
  end if;

  if pg_catalog.has_table_privilege(
       'service_role',
       'public.round_robins',
       'delete'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'public.round_robins',
       'truncate'
     ) then
    raise exception 'round_robin service-role destructive privilege was not revoked';
  end if;
end;
$$;

commit;
