-- P0 production hardening from the July 10 incident pass.
-- Keep this migration idempotent: production received several fixes live while
-- errors were being drained from Supabase logs.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

alter table if exists public.whatsapp_sessions
  add column if not exists qr_code text,
  add column if not exists last_error text;

alter table if exists public.whatsapp_groups
  add column if not exists remote_jid text,
  add column if not exists name text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create or replace function public.sync_whatsapp_groups_compat_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.remote_jid := coalesce(new.remote_jid, new.group_jid);
  new.name := coalesce(new.name, new.subject);
  new.metadata := coalesce(new.metadata, '{}'::jsonb);
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.whatsapp_groups') is not null then
    update public.whatsapp_groups
    set remote_jid = coalesce(remote_jid, group_jid),
        name = coalesce(name, subject);

    drop trigger if exists trg_sync_whatsapp_groups_compat_columns on public.whatsapp_groups;
    create trigger trg_sync_whatsapp_groups_compat_columns
    before insert or update on public.whatsapp_groups
    for each row
    execute function public.sync_whatsapp_groups_compat_columns();

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.whatsapp_groups'::regclass
        and conname = 'whatsapp_groups_org_session_remote_jid_key'
    ) then
      alter table public.whatsapp_groups
        add constraint whatsapp_groups_org_session_remote_jid_key
        unique (organization_id, session_id, remote_jid);
    end if;
  end if;
end $$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'whatsapp_contact_identity_aliases',
    'meta_webhook_events',
    'automation_executions',
    'whatsapp_groups',
    'lead_pool_history',
    'incident_20260701_pool_redistribution_backup',
    'lead_stage_history',
    'user_roles',
    'property_sequences',
    'permissions',
    'contract_sequences',
    'ai_agent_conversations',
    'user_org_cache',
    'user_permissions',
    'commission_history',
    'conversation_ai_state',
    'email_logs',
    'organization_kpi_cache',
    'password_change_events',
    'password_change_lockouts',
    'user_mission_progress'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I add column if not exists created_at timestamptz', table_name);
      execute format('update public.%I set created_at = now() where created_at is null', table_name);
      execute format('alter table public.%I alter column created_at set default now()', table_name);
      execute format('alter table public.%I alter column created_at set not null', table_name);
    end if;
  end loop;
end $$;

do $$
begin
  if to_regclass('public.whatsapp_contact_identity_aliases') is not null then
    create index if not exists idx_whatsapp_contact_identity_aliases_created_at
      on public.whatsapp_contact_identity_aliases(created_at desc);
  end if;
  if to_regclass('public.meta_webhook_events') is not null then
    create index if not exists idx_meta_webhook_events_created_at
      on public.meta_webhook_events(created_at desc);
  end if;
  if to_regclass('public.automation_executions') is not null then
    create index if not exists idx_automation_executions_created_at
      on public.automation_executions(created_at desc);
  end if;
  if to_regclass('public.whatsapp_groups') is not null then
    create index if not exists idx_whatsapp_groups_created_at
      on public.whatsapp_groups(created_at desc);
  end if;
  if to_regclass('public.lead_pool_history') is not null then
    create index if not exists idx_lead_pool_history_created_at
      on public.lead_pool_history(created_at desc);
  end if;
  if to_regclass('public.lead_stage_history') is not null then
    create index if not exists idx_lead_stage_history_created_at
      on public.lead_stage_history(created_at desc);
  end if;
end $$;

alter table if exists public.meta_webhook_events
  add column if not exists payload jsonb;

update public.meta_webhook_events
set payload = coalesce(payload, raw_payload, '{}'::jsonb)
where payload is null;

alter table if exists public.meta_webhook_events
  alter column payload set default '{}'::jsonb,
  alter column payload set not null;

alter table if exists public.lead_timeline_events
  add column if not exists event_at timestamptz;

update public.lead_timeline_events
set event_at = coalesce(event_at, created_at, now())
where event_at is null;

alter table if exists public.lead_timeline_events
  alter column event_at set default now(),
  alter column event_at set not null;

create or replace function public.set_lead_timeline_event_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.event_at := coalesce(new.event_at, new.created_at, now());
  return new;
end;
$$;

drop trigger if exists trg_set_lead_timeline_event_at on public.lead_timeline_events;
create trigger trg_set_lead_timeline_event_at
before insert or update on public.lead_timeline_events
for each row
execute function public.set_lead_timeline_event_at();

create index if not exists idx_lead_timeline_events_event_at
  on public.lead_timeline_events(lead_id, event_at desc);

create or replace function public.set_round_robin_member_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.organization_id is null and new.round_robin_id is not null then
    select rr.organization_id
      into new.organization_id
      from public.round_robins rr
     where rr.id = new.round_robin_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_set_round_robin_member_organization_id on public.round_robin_members;
create trigger trg_set_round_robin_member_organization_id
before insert or update of round_robin_id, organization_id
on public.round_robin_members
for each row
execute function public.set_round_robin_member_organization_id();

create index if not exists idx_activities_created_at_desc
  on public.activities(created_at desc);

create index if not exists idx_whatsapp_conversations_org_session_active_recent
  on public.whatsapp_conversations(
    organization_id,
    session_id,
    last_message_at desc nulls last,
    created_at desc,
    id desc
  )
  where deleted_at is null and archived_at is null;

create index if not exists idx_leads_phone_trgm
  on public.leads using gin (phone extensions.gin_trgm_ops)
  where phone is not null;

create or replace function public.upsert_whatsapp_webhook_lead(
  p_organization_id uuid,
  p_name text,
  p_phone text,
  p_whatsapp text default null,
  p_whatsapp_avatar_url text default null,
  p_whatsapp_avatar_synced_at timestamptz default null,
  p_source_detail text default null,
  p_source_session_id uuid default null,
  p_initial_message text default null,
  p_message text default null,
  p_property_code text default null,
  p_property_id uuid default null,
  p_interest_property_id uuid default null,
  p_assigned_user_id uuid default null,
  p_assigned_at timestamptz default null,
  p_pipeline_id uuid default null,
  p_stage_id uuid default null,
  p_created_by uuid default null,
  p_first_touch_at timestamptz default null,
  p_first_touch_channel text default null,
  p_last_contact_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  name text,
  assigned_user_id uuid,
  whatsapp_avatar_url text,
  property_code text,
  property_id uuid,
  interest_property_id uuid,
  source_detail text,
  metadata jsonb,
  is_new_lead boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_last_contact_at, now());
  v_normalized_phone text := public.normalize_phone(p_phone);
  v_lead public.leads%rowtype;
  v_lock_key text;
begin
  if p_organization_id is null then
    raise exception 'p_organization_id is required' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_phone, '')), '') is null then
    raise exception 'p_phone is required' using errcode = '22023';
  end if;

  v_lock_key := p_organization_id::text || ':' || coalesce(v_normalized_phone, btrim(p_phone));
  perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

  select l.*
    into v_lead
    from public.leads l
   where l.organization_id = p_organization_id
     and public.normalize_phone(l.phone) = v_normalized_phone
     and l.phone is not null
     and btrim(l.phone) <> ''
   order by coalesce(l.updated_at, l.created_at) desc, l.created_at desc, l.id desc
   limit 1
   for update;

  if found then
    update public.leads l
       set whatsapp_avatar_url = case
             when p_whatsapp_avatar_url is not null and nullif(l.whatsapp_avatar_url, '') is null then p_whatsapp_avatar_url
             else l.whatsapp_avatar_url
           end,
           whatsapp_avatar_synced_at = case
             when p_whatsapp_avatar_url is not null and nullif(l.whatsapp_avatar_url, '') is null then coalesce(p_whatsapp_avatar_synced_at, v_now)
             else l.whatsapp_avatar_synced_at
           end,
           property_code = coalesce(nullif(l.property_code, ''), p_property_code),
           property_id = coalesce(l.property_id, p_property_id),
           interest_property_id = coalesce(l.interest_property_id, p_interest_property_id),
           source_detail = coalesce(nullif(l.source_detail, ''), p_source_detail),
           source_session_id = coalesce(l.source_session_id, p_source_session_id),
           first_touch_at = coalesce(l.first_touch_at, p_first_touch_at),
           first_touch_channel = coalesce(nullif(l.first_touch_channel, ''), p_first_touch_channel),
           last_contact_at = v_now,
           metadata = coalesce(l.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
           updated_at = v_now
     where l.id = v_lead.id
     returning l.* into v_lead;

    id := v_lead.id;
    name := v_lead.name;
    assigned_user_id := v_lead.assigned_user_id;
    whatsapp_avatar_url := v_lead.whatsapp_avatar_url;
    property_code := v_lead.property_code;
    property_id := v_lead.property_id;
    interest_property_id := v_lead.interest_property_id;
    source_detail := v_lead.source_detail;
    metadata := v_lead.metadata;
    is_new_lead := false;
    return next;
    return;
  end if;

  insert into public.leads (
    organization_id,
    name,
    phone,
    whatsapp_avatar_url,
    whatsapp_avatar_synced_at,
    source,
    source_detail,
    source_session_id,
    initial_message,
    message,
    property_code,
    property_id,
    interest_property_id,
    assigned_user_id,
    assigned_at,
    pipeline_id,
    stage_id,
    created_by,
    first_touch_at,
    first_touch_channel,
    last_contact_at,
    metadata
  ) values (
    p_organization_id,
    coalesce(nullif(btrim(p_name), ''), p_phone),
    p_phone,
    p_whatsapp_avatar_url,
    p_whatsapp_avatar_synced_at,
    'whatsapp',
    p_source_detail,
    p_source_session_id,
    p_initial_message,
    p_message,
    p_property_code,
    p_property_id,
    p_interest_property_id,
    p_assigned_user_id,
    p_assigned_at,
    p_pipeline_id,
    p_stage_id,
    p_created_by,
    p_first_touch_at,
    p_first_touch_channel,
    v_now,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_lead;

  id := v_lead.id;
  name := v_lead.name;
  assigned_user_id := v_lead.assigned_user_id;
  whatsapp_avatar_url := v_lead.whatsapp_avatar_url;
  property_code := v_lead.property_code;
  property_id := v_lead.property_id;
  interest_property_id := v_lead.interest_property_id;
  source_detail := v_lead.source_detail;
  metadata := v_lead.metadata;
  is_new_lead := true;
  return next;
exception
  when unique_violation then
    select l.*
      into v_lead
      from public.leads l
     where l.organization_id = p_organization_id
       and public.normalize_phone(l.phone) = v_normalized_phone
       and l.phone is not null
       and btrim(l.phone) <> ''
     order by coalesce(l.updated_at, l.created_at) desc, l.created_at desc, l.id desc
     limit 1;

    if not found then
      raise;
    end if;

    id := v_lead.id;
    name := v_lead.name;
    assigned_user_id := v_lead.assigned_user_id;
    whatsapp_avatar_url := v_lead.whatsapp_avatar_url;
    property_code := v_lead.property_code;
    property_id := v_lead.property_id;
    interest_property_id := v_lead.interest_property_id;
    source_detail := v_lead.source_detail;
    metadata := v_lead.metadata;
    is_new_lead := false;
    return next;
end;
$$;

grant execute on function public.upsert_whatsapp_webhook_lead(
  uuid,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  uuid,
  text,
  text,
  text,
  uuid,
  uuid,
  uuid,
  timestamptz,
  uuid,
  uuid,
  uuid,
  timestamptz,
  text,
  timestamptz,
  jsonb
) to service_role;

do $$
begin
  if to_regprocedure('public.vimob_users_share_active_org(uuid)') is not null then
    grant execute on function public.vimob_users_share_active_org(uuid) to anon;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'whatsapp_conversations'
  ) then
    alter publication supabase_realtime drop table public.whatsapp_conversations;
  end if;

  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'whatsapp_messages'
  ) then
    alter publication supabase_realtime drop table public.whatsapp_messages;
  end if;
end $$;

notify pgrst, 'reload schema';
