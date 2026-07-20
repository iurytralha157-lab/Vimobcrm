-- Additive audit and presence foundation.
--
-- This migration does not change existing product flows. It adds:
-- - durable user activity sessions for online/last-seen reporting;
-- - reusable audit diff helpers;
-- - database-triggered audit rows for teams and distribution queues;
-- - a private Realtime audit feed wake-up for future admin screens.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.audit_logs
  add column if not exists diff jsonb,
  add column if not exists source text not null default 'app',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_audit_logs_entity_created
  on public.audit_logs(organization_id, entity_type, entity_id, created_at desc);

create table if not exists public.user_activity_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  session_id text not null,
  status text not null default 'online',
  current_path text,
  current_page_title text,
  connected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disconnected_at timestamptz,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_activity_sessions_session_id_check check (
    char_length(btrim(session_id)) between 8 and 160
  ),
  constraint user_activity_sessions_status_check check (
    status in ('online', 'idle', 'offline')
  ),
  constraint user_activity_sessions_unique unique (organization_id, user_id, session_id)
);

create index if not exists idx_user_activity_sessions_org_last_seen
  on public.user_activity_sessions(organization_id, last_seen_at desc);

create index if not exists idx_user_activity_sessions_org_online
  on public.user_activity_sessions(organization_id, last_seen_at desc)
  where disconnected_at is null;

create index if not exists idx_user_activity_sessions_user_connected
  on public.user_activity_sessions(user_id, connected_at desc);

drop trigger if exists set_updated_at_user_activity_sessions on public.user_activity_sessions;
create trigger set_updated_at_user_activity_sessions
before update on public.user_activity_sessions
for each row execute function private.set_updated_at();

alter table public.user_activity_sessions enable row level security;
revoke all on public.user_activity_sessions from anon, authenticated;
grant select, insert, update on public.user_activity_sessions to authenticated;
grant all on public.user_activity_sessions to service_role;

drop policy if exists "users and admins read activity sessions" on public.user_activity_sessions;
create policy "users and admins read activity sessions"
on public.user_activity_sessions
for select
to authenticated
using (
  user_id = (select auth.uid())
  or private.has_org_role(organization_id, array['owner', 'admin', 'manager'])
);

drop policy if exists "users create own activity sessions" on public.user_activity_sessions;
create policy "users create own activity sessions"
on public.user_activity_sessions
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and private.is_org_member(organization_id)
);

drop policy if exists "users update own activity sessions" on public.user_activity_sessions;
create policy "users update own activity sessions"
on public.user_activity_sessions
for update
to authenticated
using (
  user_id = (select auth.uid())
  and private.is_org_member(organization_id)
)
with check (
  user_id = (select auth.uid())
  and private.is_org_member(organization_id)
);

create or replace function private.current_audit_actor_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.safe_uuid(nullif(current_setting('app.current_user_id', true), '')),
    private.safe_uuid(nullif(current_setting('request.jwt.claim.sub', true), '')),
    (select auth.uid())
  );
$$;

revoke all on function private.current_audit_actor_id() from public, anon, authenticated;
grant execute on function private.current_audit_actor_id() to service_role;

create or replace function private.audit_jsonb_diff(
  p_old jsonb,
  p_new jsonb,
  p_excluded_columns text[] default array[]::text[]
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with keys(key) as (
    select jsonb_object_keys(coalesce(p_old, '{}'::jsonb))
    union
    select jsonb_object_keys(coalesce(p_new, '{}'::jsonb))
  )
  select coalesce(
    jsonb_object_agg(
      key,
      jsonb_build_object('old', p_old -> key, 'new', p_new -> key)
      order by key
    ),
    '{}'::jsonb
  )
  from keys
  where not (key = any(p_excluded_columns))
    and (p_old -> key) is distinct from (p_new -> key);
$$;

revoke all on function private.audit_jsonb_diff(jsonb, jsonb, text[]) from public, anon, authenticated;
grant execute on function private.audit_jsonb_diff(jsonb, jsonb, text[]) to service_role;

create or replace function private.write_audit_log_for_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  row_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  row_diff jsonb := '{}'::jsonb;
  excluded_columns text[] := array['updated_at'];
  target_organization_id uuid;
  target_entity_id text;
  actor_user_id uuid;
  audit_action text;
  audit_entity_type text := coalesce(nullif(tg_argv[0], ''), tg_table_name);
  arg_index integer;
begin
  if tg_nargs > 1 then
    for arg_index in 1..(tg_nargs - 1) loop
      excluded_columns := excluded_columns || tg_argv[arg_index];
    end loop;
  end if;

  if tg_op = 'UPDATE' then
    row_diff := private.audit_jsonb_diff(row_old, row_new, excluded_columns);
    if row_diff = '{}'::jsonb then
      return null;
    end if;
  elsif tg_op = 'INSERT' then
    row_diff := private.audit_jsonb_diff('{}'::jsonb, row_new, excluded_columns);
  elsif tg_op = 'DELETE' then
    row_diff := private.audit_jsonb_diff(row_old, '{}'::jsonb, excluded_columns);
  end if;

  target_organization_id := coalesce(
    private.safe_uuid(row_new ->> 'organization_id'),
    private.safe_uuid(row_old ->> 'organization_id')
  );
  target_entity_id := coalesce(row_new ->> 'id', row_old ->> 'id');
  actor_user_id := coalesce(
    private.current_audit_actor_id(),
    private.safe_uuid(row_new ->> 'created_by'),
    private.safe_uuid(row_old ->> 'created_by')
  );

  audit_action := case tg_op
    when 'INSERT' then 'create'
    when 'UPDATE' then 'update'
    when 'DELETE' then 'delete'
    else lower(tg_op)
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
    jsonb_build_object(
      'schema', tg_table_schema,
      'table', tg_table_name,
      'operation', tg_op
    )
  );

  return null;
end;
$$;

revoke all on function private.write_audit_log_for_row() from public, anon, authenticated;
grant execute on function private.write_audit_log_for_row() to service_role;

drop trigger if exists audit_teams_changes on public.teams;
create trigger audit_teams_changes
after insert or update or delete on public.teams
for each row execute function private.write_audit_log_for_row('team');

drop trigger if exists audit_team_members_changes on public.team_members;
create trigger audit_team_members_changes
after insert or update or delete on public.team_members
for each row execute function private.write_audit_log_for_row('team_member');

drop trigger if exists audit_team_pipelines_changes on public.team_pipelines;
create trigger audit_team_pipelines_changes
after insert or delete on public.team_pipelines
for each row execute function private.write_audit_log_for_row('team_pipeline');

drop trigger if exists audit_member_availability_changes on public.member_availability;
create trigger audit_member_availability_changes
after insert or update or delete on public.member_availability
for each row execute function private.write_audit_log_for_row('team_member_availability');

drop trigger if exists audit_round_robins_changes on public.round_robins;
create trigger audit_round_robins_changes
after insert or update or delete on public.round_robins
for each row execute function private.write_audit_log_for_row('distribution_queue', 'current_position');

drop trigger if exists audit_round_robin_members_changes on public.round_robin_members;
create trigger audit_round_robin_members_changes
after insert or update or delete on public.round_robin_members
for each row execute function private.write_audit_log_for_row('distribution_queue_member', 'leads_count');

drop trigger if exists audit_round_robin_rules_changes on public.round_robin_rules;
create trigger audit_round_robin_rules_changes
after insert or update or delete on public.round_robin_rules
for each row execute function private.write_audit_log_for_row('distribution_queue_rule');

create or replace function private.can_receive_audit_broadcast(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  topic_organization_id uuid;
begin
  if split_part(p_topic, ':', 1) <> 'audit' then
    return false;
  end if;

  topic_organization_id := private.safe_uuid(split_part(p_topic, ':', 2));
  if topic_organization_id is null then
    return false;
  end if;

  return p_topic = 'audit:' || topic_organization_id::text || ':feed'
    and private.has_org_role(topic_organization_id, array['owner', 'admin', 'manager']);
end;
$$;

revoke all on function private.can_receive_audit_broadcast(text) from public, anon;
grant execute on function private.can_receive_audit_broadcast(text) to authenticated, service_role;

create or replace function private.can_use_organization_presence(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  topic_organization_id uuid;
begin
  if split_part(p_topic, ':', 1) <> 'presence' then
    return false;
  end if;

  topic_organization_id := private.safe_uuid(split_part(p_topic, ':', 2));
  if topic_organization_id is null then
    return false;
  end if;

  return p_topic = 'presence:' || topic_organization_id::text || ':online'
    and private.is_org_member(topic_organization_id);
end;
$$;

revoke all on function private.can_use_organization_presence(text) from public, anon;
grant execute on function private.can_use_organization_presence(text) to authenticated, service_role;

-- `realtime.messages` is owned by the managed `supabase_realtime_admin`
-- role and cannot be altered by normal project migrations. Reuse the
-- existing authorized private-broadcast policy installed by the WhatsApp
-- Realtime foundation, extending its predicate to the audit topic. Presence
-- remains optional; durable online status comes from user_activity_sessions.
create or replace function private.can_receive_whatsapp_broadcast(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  topic_organization_id uuid;
  topic_lead_id uuid;
begin
  if split_part(p_topic, ':', 1) = 'audit' then
    return private.can_receive_audit_broadcast(p_topic);
  end if;

  if split_part(p_topic, ':', 1) <> 'whatsapp' then
    return false;
  end if;

  topic_organization_id := private.safe_uuid(split_part(p_topic, ':', 2));
  if topic_organization_id is null then
    return false;
  end if;

  if split_part(p_topic, ':', 3) = 'inbox' then
    return p_topic = 'whatsapp:' || topic_organization_id::text || ':inbox'
      and private.is_org_member(topic_organization_id);
  end if;

  if split_part(p_topic, ':', 3) <> 'lead' then
    return false;
  end if;

  topic_lead_id := private.safe_uuid(split_part(p_topic, ':', 4));
  if topic_lead_id is null
     or p_topic <> 'whatsapp:' || topic_organization_id::text || ':lead:' || topic_lead_id::text then
    return false;
  end if;

  return exists (
    select 1
    from public.leads as lead
    where lead.id = topic_lead_id
      and lead.organization_id = topic_organization_id
      and private.can_access_lead(lead.organization_id, lead.assigned_user_id)
  );
end;
$$;

revoke all on function private.can_receive_whatsapp_broadcast(text)
  from public, anon;
grant execute on function private.can_receive_whatsapp_broadcast(text)
  to authenticated, service_role;

create or replace function private.broadcast_audit_log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is null then
    return null;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object(
        'auditId', new.id,
        'organizationId', new.organization_id,
        'actorUserId', new.user_id,
        'action', new.action,
        'entityType', new.entity_type,
        'entityId', new.entity_id,
        'createdAt', new.created_at
      ),
      'audit.log.created',
      'audit:' || new.organization_id::text || ':feed',
      true
    );
  exception when others then
    return null;
  end;

  return null;
end;
$$;

revoke all on function private.broadcast_audit_log_change() from public, anon, authenticated;
grant execute on function private.broadcast_audit_log_change() to service_role;

drop trigger if exists audit_log_private_broadcast on public.audit_logs;
create trigger audit_log_private_broadcast
after insert on public.audit_logs
for each row execute function private.broadcast_audit_log_change();

commit;
