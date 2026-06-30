-- Align the new Supabase project with the API contract used by the Vimob backend.
-- This migration is intentionally additive and backfills from existing relations.

alter table if exists public.notifications
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists public.organization_sites
  add column if not exists watermark_size integer default 120,
  add column if not exists watermark_position text default 'bottom-right';

alter table if exists public.stages
  add column if not exists organization_id uuid,
  add column if not exists is_won boolean not null default false,
  add column if not exists is_lost boolean not null default false,
  add column if not exists sla_hours integer,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.stages s
set organization_id = p.organization_id
from public.pipelines p
where s.organization_id is null
  and p.id = s.pipeline_id;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stages'
      and column_name = 'organization_id'
      and is_nullable = 'YES'
  ) and not exists (
    select 1 from public.stages where organization_id is null
  ) then
    alter table public.stages alter column organization_id set not null;
  end if;
end $$;

alter table if exists public.team_pipelines
  add column if not exists organization_id uuid;

update public.team_pipelines tp
set organization_id = coalesce(t.organization_id, p.organization_id)
from public.teams t, public.pipelines p
where tp.organization_id is null
  and t.id = tp.team_id
  and p.id = tp.pipeline_id;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'team_pipelines'
      and column_name = 'organization_id'
      and is_nullable = 'YES'
  ) and not exists (
    select 1 from public.team_pipelines where organization_id is null
  ) then
    alter table public.team_pipelines alter column organization_id set not null;
  end if;
end $$;

alter table if exists public.whatsapp_session_access
  add column if not exists organization_id uuid,
  add column if not exists can_read boolean default true;

update public.whatsapp_session_access access
set organization_id = ws.organization_id,
    can_read = coalesce(access.can_read, access.can_view, true)
from public.whatsapp_sessions ws
where access.organization_id is null
  and ws.id = access.session_id;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'whatsapp_session_access'
      and column_name = 'organization_id'
      and is_nullable = 'YES'
  ) and not exists (
    select 1 from public.whatsapp_session_access where organization_id is null
  ) then
    alter table public.whatsapp_session_access alter column organization_id set not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'whatsapp_session_access'
      and column_name = 'can_read'
      and is_nullable = 'YES'
  ) then
    update public.whatsapp_session_access
    set can_read = coalesce(can_read, can_view, true)
    where can_read is null;

    alter table public.whatsapp_session_access alter column can_read set default true;
    alter table public.whatsapp_session_access alter column can_read set not null;
  end if;
end $$;

alter table if exists public.whatsapp_messages
  add column if not exists organization_id uuid,
  add column if not exists lead_id uuid,
  add column if not exists sender_user_id uuid,
  add column if not exists created_at timestamptz not null default now();

update public.whatsapp_messages wm
set organization_id = coalesce(
      (select wc.organization_id from public.whatsapp_conversations wc where wc.id = wm.conversation_id),
      (select ws.organization_id from public.whatsapp_sessions ws where ws.id = wm.session_id)
    ),
    lead_id = coalesce(
      wm.lead_id,
      (select wc.lead_id from public.whatsapp_conversations wc where wc.id = wm.conversation_id)
    )
where wm.organization_id is null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'whatsapp_messages'
      and column_name = 'organization_id'
      and is_nullable = 'YES'
  ) and not exists (
    select 1 from public.whatsapp_messages where organization_id is null
  ) then
    alter table public.whatsapp_messages alter column organization_id set not null;
  end if;
end $$;

create index if not exists idx_stages_organization_pipeline
  on public.stages (organization_id, pipeline_id, position);

create index if not exists idx_team_pipelines_organization
  on public.team_pipelines (organization_id, team_id, pipeline_id);

create index if not exists idx_whatsapp_session_access_organization
  on public.whatsapp_session_access (organization_id, session_id, user_id);

create index if not exists idx_whatsapp_messages_organization_conversation
  on public.whatsapp_messages (organization_id, conversation_id, sent_at desc);
