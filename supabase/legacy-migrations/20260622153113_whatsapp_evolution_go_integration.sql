-- Vimob CRM - WhatsApp module / Evolution Go integration hardening.
-- Keeps WhatsApp data isolated by organization, session and lead visibility.

-- Align the base communications schema with the WhatsApp UI/hooks that already
-- exist in the app.
alter table public.whatsapp_sessions
  add column if not exists instance_name text,
  add column if not exists display_name text,
  add column if not exists instance_id text,
  add column if not exists owner_user_id uuid references public.users(id) on delete set null,
  add column if not exists profile_name text,
  add column if not exists profile_picture text,
  add column if not exists is_active boolean default true,
  add column if not exists is_notification_session boolean default false,
  add column if not exists advanced_settings jsonb default '{}'::jsonb;

update public.whatsapp_sessions
set instance_name = coalesce(instance_name, provider_instance_id, nullif(name, ''), 'wa_' || substr(id::text, 1, 8)),
    display_name = coalesce(display_name, nullif(name, ''), provider_instance_id, 'WhatsApp'),
    instance_id = coalesce(instance_id, provider_instance_id),
    owner_user_id = coalesce(owner_user_id, created_by),
    is_active = coalesce(is_active, true),
    is_notification_session = coalesce(is_notification_session, false),
    advanced_settings = coalesce(advanced_settings, metadata, '{}'::jsonb)
where instance_name is null
   or display_name is null
   or instance_id is null
   or owner_user_id is null
   or is_active is null
   or is_notification_session is null
   or advanced_settings is null;

alter table public.whatsapp_sessions
  alter column instance_name set not null;

alter table public.whatsapp_sessions
  drop constraint if exists whatsapp_sessions_status_check;

alter table public.whatsapp_sessions
  add constraint whatsapp_sessions_status_check
  check (status in ('disconnected', 'connecting', 'qr_ready', 'connected', 'error', 'disabled'));

create index if not exists idx_whatsapp_sessions_org_owner
  on public.whatsapp_sessions(organization_id, owner_user_id, is_active);

create index if not exists idx_whatsapp_sessions_org_notification
  on public.whatsapp_sessions(organization_id, is_notification_session)
  where is_notification_session = true;

create unique index if not exists uq_whatsapp_sessions_org_instance_name
  on public.whatsapp_sessions(organization_id, instance_name);

alter table public.whatsapp_session_access
  add column if not exists can_view boolean default true,
  add column if not exists access_mode text default 'assigned_leads_only',
  add column if not exists only_leads_access boolean default true,
  add column if not exists granted_by uuid references public.users(id) on delete set null;

update public.whatsapp_session_access
set can_view = coalesce(can_view, can_read, true),
    access_mode = coalesce(access_mode, 'assigned_leads_only'),
    only_leads_access = coalesce(only_leads_access, true)
where can_view is null
   or access_mode is null
   or only_leads_access is null;

alter table public.whatsapp_session_access
  drop constraint if exists whatsapp_session_access_mode_check;

alter table public.whatsapp_session_access
  add constraint whatsapp_session_access_mode_check
  check (access_mode in ('assigned_leads_only', 'team_leads', 'all_leads', 'full_inbox'));

create or replace function private.set_whatsapp_session_access_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  session_org_id uuid;
begin
  select ws.organization_id
    into session_org_id
  from public.whatsapp_sessions ws
  where ws.id = new.session_id;

  if session_org_id is null then
    raise exception 'Sessao WhatsApp nao encontrada para preencher organization_id.';
  end if;

  new.organization_id = coalesce(new.organization_id, session_org_id);
  new.can_view = coalesce(new.can_view, new.can_read, true);
  new.can_read = coalesce(new.can_read, new.can_view, true);
  new.can_send = coalesce(new.can_send, false);
  new.access_mode = coalesce(new.access_mode, 'assigned_leads_only');
  new.only_leads_access = coalesce(new.only_leads_access, new.access_mode <> 'full_inbox');
  new.granted_by = coalesce(new.granted_by, auth.uid());
  return new;
end;
$$;

drop trigger if exists set_whatsapp_session_access_defaults on public.whatsapp_session_access;
create trigger set_whatsapp_session_access_defaults
before insert or update on public.whatsapp_session_access
for each row execute function private.set_whatsapp_session_access_defaults();

alter table public.whatsapp_conversations
  add column if not exists metadata jsonb default '{}'::jsonb;

create index if not exists idx_whatsapp_conversations_org_lead
  on public.whatsapp_conversations(organization_id, lead_id)
  where lead_id is not null and deleted_at is null;

create index if not exists idx_whatsapp_conversations_org_remote
  on public.whatsapp_conversations(organization_id, remote_jid)
  where deleted_at is null;

create or replace function private.set_whatsapp_conversation_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  session_org_id uuid;
  lead_org_id uuid;
  lead_assignee uuid;
begin
  if new.session_id is not null then
    select ws.organization_id
      into session_org_id
    from public.whatsapp_sessions ws
    where ws.id = new.session_id;
  end if;

  if new.lead_id is not null then
    select l.organization_id, l.assigned_user_id
      into lead_org_id, lead_assignee
    from public.leads l
    where l.id = new.lead_id;
  end if;

  new.organization_id = coalesce(new.organization_id, session_org_id, lead_org_id);
  new.assigned_user_id = coalesce(new.assigned_user_id, lead_assignee);
  new.metadata = coalesce(new.metadata, '{}'::jsonb);
  new.is_group = coalesce(new.is_group, false);
  new.unread_count = coalesce(new.unread_count, 0);

  if new.organization_id is null then
    raise exception 'Nao foi possivel definir organization_id da conversa WhatsApp.';
  end if;

  return new;
end;
$$;

drop trigger if exists set_whatsapp_conversation_defaults on public.whatsapp_conversations;
create trigger set_whatsapp_conversation_defaults
before insert or update on public.whatsapp_conversations
for each row execute function private.set_whatsapp_conversation_defaults();

alter table public.whatsapp_messages
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists reaction_to_message_id text,
  add column if not exists reaction_emoji text,
  add column if not exists reaction_sender_jid text,
  add column if not exists reaction_sender_name text;

alter table public.whatsapp_groups
  add column if not exists group_jid text,
  add column if not exists subject text,
  add column if not exists description text,
  add column if not exists invite_link text,
  add column if not exists participants jsonb default '[]'::jsonb,
  add column if not exists owner_jid text,
  add column if not exists is_announce boolean default false;

update public.whatsapp_groups
set group_jid = coalesce(group_jid, remote_jid),
    subject = coalesce(subject, name),
    participants = coalesce(participants, '[]'::jsonb),
    is_announce = coalesce(is_announce, false)
where group_jid is null
   or subject is null
   or participants is null
   or is_announce is null;

create unique index if not exists uq_whatsapp_groups_session_group_jid
  on public.whatsapp_groups(session_id, group_jid)
  where session_id is not null and group_jid is not null;

alter table public.whatsapp_labels
  add column if not exists session_id uuid references public.whatsapp_sessions(id) on delete cascade,
  add column if not exists remote_label_id text,
  add column if not exists predefined boolean default false;

alter table public.whatsapp_labels
  drop constraint if exists whatsapp_labels_unique;

update public.whatsapp_labels
set remote_label_id = coalesce(remote_label_id, id::text),
    predefined = coalesce(predefined, false)
where remote_label_id is null
   or predefined is null;

create unique index if not exists uq_whatsapp_labels_org_global_name
  on public.whatsapp_labels(organization_id, name)
  where session_id is null;

create unique index if not exists uq_whatsapp_labels_session_name
  on public.whatsapp_labels(session_id, name)
  where session_id is not null;

create unique index if not exists uq_whatsapp_labels_session_remote_label
  on public.whatsapp_labels(session_id, remote_label_id)
  where session_id is not null and remote_label_id is not null;

create or replace function private.set_whatsapp_chat_label_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  conversation_org_id uuid;
begin
  select wc.organization_id
    into conversation_org_id
  from public.whatsapp_conversations wc
  where wc.id = new.conversation_id;

  if conversation_org_id is null then
    raise exception 'Conversa WhatsApp nao encontrada para preencher label.';
  end if;

  new.organization_id = coalesce(new.organization_id, conversation_org_id);
  return new;
end;
$$;

drop trigger if exists set_whatsapp_chat_label_defaults on public.whatsapp_chat_labels;
create trigger set_whatsapp_chat_label_defaults
before insert or update on public.whatsapp_chat_labels
for each row execute function private.set_whatsapp_chat_label_defaults();

alter table public.whatsapp_inbound_rules
  add column if not exists match_field text default 'message',
  add column if not exists match_value text,
  add column if not exists source_label text,
  add column if not exists campaign_label text,
  add column if not exists target_user_id uuid references public.users(id) on delete set null,
  add column if not exists target_team_id uuid references public.teams(id) on delete set null,
  add column if not exists target_pipeline_id uuid references public.pipelines(id) on delete set null,
  add column if not exists target_stage_id uuid references public.stages(id) on delete set null,
  add column if not exists target_round_robin_id uuid references public.round_robins(id) on delete set null;

alter table public.whatsapp_inbound_rules
  alter column action_type set default 'create_lead';

update public.whatsapp_inbound_rules
set match_field = coalesce(match_field, 'message'),
    match_value = coalesce(match_value, conditions->>'value'),
    source_label = coalesce(source_label, action_config->>'source_label'),
    campaign_label = coalesce(campaign_label, action_config->>'campaign_label'),
    target_user_id = coalesce(
      target_user_id,
      case when action_config->>'target_user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (action_config->>'target_user_id')::uuid
      end
    ),
    target_team_id = coalesce(
      target_team_id,
      case when action_config->>'target_team_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (action_config->>'target_team_id')::uuid
      end
    ),
    target_pipeline_id = coalesce(
      target_pipeline_id,
      case when action_config->>'target_pipeline_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (action_config->>'target_pipeline_id')::uuid
      end
    ),
    target_stage_id = coalesce(
      target_stage_id,
      case when action_config->>'target_stage_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (action_config->>'target_stage_id')::uuid
      end
    ),
    target_round_robin_id = coalesce(
      target_round_robin_id,
      case when action_config->>'target_round_robin_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (action_config->>'target_round_robin_id')::uuid
      end
    )
where true;

create table if not exists public.whatsapp_inbound_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid references public.whatsapp_sessions(id) on delete set null,
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  matched_rule_id uuid references public.whatsapp_inbound_rules(id) on delete set null,
  assigned_user_id uuid references public.users(id) on delete set null,
  match_details jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_inbound_logs_org_created
  on public.whatsapp_inbound_logs(organization_id, created_at desc);

alter table public.whatsapp_inbound_logs enable row level security;
grant select, insert, update, delete on public.whatsapp_inbound_logs to authenticated;

-- Extend lead visibility with lead_view_team for team leaders. This is used by
-- WhatsApp conversation policies as well as lead policies that call this helper.
create or replace function private.can_access_lead(target_organization_id uuid, assigned_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.is_super_admin()
    or private.has_permission(target_organization_id, 'lead_view_all')
    or assigned_user_id = auth.uid()
    or exists (
      select 1
      from public.organization_members om
      where om.organization_id = target_organization_id
        and om.user_id = auth.uid()
        and om.is_active = true
        and om.role in ('owner', 'admin', 'manager')
    )
    or (
      assigned_user_id is not null
      and private.has_permission(target_organization_id, 'lead_view_team')
      and exists (
        select 1
        from public.team_members leader
        join public.team_members member
          on member.organization_id = leader.organization_id
         and member.team_id = leader.team_id
         and member.is_active = true
        where leader.organization_id = target_organization_id
          and leader.user_id = auth.uid()
          and leader.is_active = true
          and leader.is_leader = true
          and member.user_id = assigned_user_id
      )
    );
$$;

create or replace function private.can_manage_whatsapp_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.whatsapp_sessions ws
    where ws.id = p_session_id
      and (
        private.is_super_admin()
        or ws.owner_user_id = auth.uid()
        or private.has_permission(ws.organization_id, 'whatsapp_manage')
        or private.has_permission(ws.organization_id, 'settings_manage')
        or private.has_org_role(ws.organization_id, array['owner', 'admin'])
      )
  );
$$;

create or replace function private.can_access_whatsapp_session(
  p_session_id uuid,
  p_require_send boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.whatsapp_sessions ws
    where ws.id = p_session_id
      and ws.is_active is not false
      and (
        private.can_manage_whatsapp_session(ws.id)
        or exists (
          select 1
          from public.whatsapp_session_access access
          where access.session_id = ws.id
            and access.user_id = auth.uid()
            and coalesce(access.can_view, access.can_read, true) = true
            and (p_require_send is false or coalesce(access.can_send, false) = true)
        )
      )
  );
$$;

create or replace function private.can_view_whatsapp_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.whatsapp_conversations wc
    left join public.whatsapp_sessions ws on ws.id = wc.session_id
    left join public.leads l on l.id = wc.lead_id
    where wc.id = p_conversation_id
      and wc.deleted_at is null
      and private.is_org_member(wc.organization_id)
      and (
        private.can_manage_whatsapp_session(wc.session_id)
        or (
          wc.lead_id is not null
          and private.can_access_lead(wc.organization_id, l.assigned_user_id)
        )
        or exists (
          select 1
          from public.whatsapp_session_access access
          where access.session_id = wc.session_id
            and access.user_id = auth.uid()
            and coalesce(access.can_view, access.can_read, true) = true
            and (
              access.access_mode = 'full_inbox'
              or (access.access_mode = 'all_leads' and wc.lead_id is not null)
              or (
                access.access_mode in ('assigned_leads_only', 'team_leads')
                and wc.lead_id is not null
                and private.can_access_lead(wc.organization_id, l.assigned_user_id)
              )
            )
        )
      )
  );
$$;

create or replace function private.can_send_whatsapp_conversation(
  p_conversation_id uuid,
  p_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.whatsapp_conversations wc
    join public.whatsapp_sessions ws on ws.id = p_session_id
    where wc.id = p_conversation_id
      and wc.deleted_at is null
      and wc.organization_id = ws.organization_id
      and private.can_access_whatsapp_session(ws.id, true)
      and private.can_view_whatsapp_conversation(wc.id)
  );
$$;

grant execute on function private.can_access_lead(uuid, uuid) to authenticated;
grant execute on function private.can_manage_whatsapp_session(uuid) to authenticated;
grant execute on function private.can_access_whatsapp_session(uuid, boolean) to authenticated;
grant execute on function private.can_view_whatsapp_conversation(uuid) to authenticated;
grant execute on function private.can_send_whatsapp_conversation(uuid, uuid) to authenticated;

-- Replace broad organization-member WhatsApp policies with least-privilege rules.
do $$
declare
  t text;
begin
  foreach t in array array[
    'whatsapp_sessions',
    'whatsapp_session_access',
    'whatsapp_conversations',
    'whatsapp_messages',
    'whatsapp_groups',
    'whatsapp_labels',
    'whatsapp_chat_labels',
    'whatsapp_message_templates',
    'whatsapp_inbound_rules',
    'whatsapp_inbound_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', 'members read ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'communication admins manage ' || t, t);
  end loop;
end $$;

drop policy if exists "whatsapp sessions select accessible" on public.whatsapp_sessions;
create policy "whatsapp sessions select accessible"
on public.whatsapp_sessions
for select
to authenticated
using (private.can_access_whatsapp_session(id, false));

drop policy if exists "whatsapp sessions insert own org" on public.whatsapp_sessions;
create policy "whatsapp sessions insert own org"
on public.whatsapp_sessions
for insert
to authenticated
with check (
  private.is_org_member(organization_id)
  and owner_user_id = auth.uid()
);

drop policy if exists "whatsapp sessions manage allowed" on public.whatsapp_sessions;
create policy "whatsapp sessions manage allowed"
on public.whatsapp_sessions
for update
to authenticated
using (private.can_manage_whatsapp_session(id))
with check (private.can_manage_whatsapp_session(id));

drop policy if exists "whatsapp sessions delete allowed" on public.whatsapp_sessions;
create policy "whatsapp sessions delete allowed"
on public.whatsapp_sessions
for delete
to authenticated
using (private.can_manage_whatsapp_session(id));

drop policy if exists "whatsapp access select allowed" on public.whatsapp_session_access;
create policy "whatsapp access select allowed"
on public.whatsapp_session_access
for select
to authenticated
using (user_id = auth.uid() or private.can_manage_whatsapp_session(session_id));

drop policy if exists "whatsapp access manage allowed" on public.whatsapp_session_access;
create policy "whatsapp access manage allowed"
on public.whatsapp_session_access
for all
to authenticated
using (private.can_manage_whatsapp_session(session_id))
with check (private.can_manage_whatsapp_session(session_id));

drop policy if exists "whatsapp conversations select allowed" on public.whatsapp_conversations;
create policy "whatsapp conversations select allowed"
on public.whatsapp_conversations
for select
to authenticated
using (private.can_view_whatsapp_conversation(id));

drop policy if exists "whatsapp conversations insert allowed" on public.whatsapp_conversations;
create policy "whatsapp conversations insert allowed"
on public.whatsapp_conversations
for insert
to authenticated
with check (
  private.is_org_member(organization_id)
  and (session_id is null or private.can_access_whatsapp_session(session_id, true))
);

drop policy if exists "whatsapp conversations update allowed" on public.whatsapp_conversations;
create policy "whatsapp conversations update allowed"
on public.whatsapp_conversations
for update
to authenticated
using (private.can_view_whatsapp_conversation(id))
with check (private.is_org_member(organization_id));

drop policy if exists "whatsapp messages select allowed" on public.whatsapp_messages;
create policy "whatsapp messages select allowed"
on public.whatsapp_messages
for select
to authenticated
using (private.can_view_whatsapp_conversation(conversation_id));

drop policy if exists "whatsapp messages insert outbound allowed" on public.whatsapp_messages;
create policy "whatsapp messages insert outbound allowed"
on public.whatsapp_messages
for insert
to authenticated
with check (
  from_me = true
  and private.can_send_whatsapp_conversation(conversation_id, session_id)
);

drop policy if exists "whatsapp messages update visible allowed" on public.whatsapp_messages;
create policy "whatsapp messages update visible allowed"
on public.whatsapp_messages
for update
to authenticated
using (private.can_view_whatsapp_conversation(conversation_id))
with check (private.can_view_whatsapp_conversation(conversation_id));

drop policy if exists "whatsapp groups select allowed" on public.whatsapp_groups;
create policy "whatsapp groups select allowed"
on public.whatsapp_groups
for select
to authenticated
using (private.can_access_whatsapp_session(session_id, false));

drop policy if exists "whatsapp groups manage allowed" on public.whatsapp_groups;
create policy "whatsapp groups manage allowed"
on public.whatsapp_groups
for all
to authenticated
using (private.can_access_whatsapp_session(session_id, true))
with check (private.can_access_whatsapp_session(session_id, true));

drop policy if exists "whatsapp labels select allowed" on public.whatsapp_labels;
create policy "whatsapp labels select allowed"
on public.whatsapp_labels
for select
to authenticated
using (
  (session_id is not null and private.can_access_whatsapp_session(session_id, false))
  or private.has_permission(organization_id, 'whatsapp_manage')
);

drop policy if exists "whatsapp labels manage allowed" on public.whatsapp_labels;
create policy "whatsapp labels manage allowed"
on public.whatsapp_labels
for all
to authenticated
using (
  (session_id is not null and private.can_access_whatsapp_session(session_id, true))
  or private.has_permission(organization_id, 'whatsapp_manage')
)
with check (
  (session_id is not null and private.can_access_whatsapp_session(session_id, true))
  or private.has_permission(organization_id, 'whatsapp_manage')
);

drop policy if exists "whatsapp chat labels select allowed" on public.whatsapp_chat_labels;
create policy "whatsapp chat labels select allowed"
on public.whatsapp_chat_labels
for select
to authenticated
using (private.can_view_whatsapp_conversation(conversation_id));

drop policy if exists "whatsapp chat labels manage allowed" on public.whatsapp_chat_labels;
create policy "whatsapp chat labels manage allowed"
on public.whatsapp_chat_labels
for all
to authenticated
using (private.can_view_whatsapp_conversation(conversation_id))
with check (private.can_view_whatsapp_conversation(conversation_id));

drop policy if exists "whatsapp templates select allowed" on public.whatsapp_message_templates;
create policy "whatsapp templates select allowed"
on public.whatsapp_message_templates
for select
to authenticated
using (private.is_org_member(organization_id));

drop policy if exists "whatsapp templates manage allowed" on public.whatsapp_message_templates;
create policy "whatsapp templates manage allowed"
on public.whatsapp_message_templates
for all
to authenticated
using (
  private.has_permission(organization_id, 'whatsapp_manage')
  or private.has_permission(organization_id, 'settings_manage')
)
with check (
  private.has_permission(organization_id, 'whatsapp_manage')
  or private.has_permission(organization_id, 'settings_manage')
);

drop policy if exists "whatsapp inbound rules select allowed" on public.whatsapp_inbound_rules;
create policy "whatsapp inbound rules select allowed"
on public.whatsapp_inbound_rules
for select
to authenticated
using (
  private.has_permission(organization_id, 'whatsapp_manage')
  or private.has_permission(organization_id, 'settings_manage')
);

drop policy if exists "whatsapp inbound rules manage allowed" on public.whatsapp_inbound_rules;
create policy "whatsapp inbound rules manage allowed"
on public.whatsapp_inbound_rules
for all
to authenticated
using (
  private.has_permission(organization_id, 'whatsapp_manage')
  or private.has_permission(organization_id, 'settings_manage')
)
with check (
  private.has_permission(organization_id, 'whatsapp_manage')
  or private.has_permission(organization_id, 'settings_manage')
);

drop policy if exists "whatsapp inbound logs select allowed" on public.whatsapp_inbound_logs;
create policy "whatsapp inbound logs select allowed"
on public.whatsapp_inbound_logs
for select
to authenticated
using (
  private.has_permission(organization_id, 'whatsapp_manage')
  or private.has_permission(organization_id, 'settings_manage')
);

drop policy if exists "whatsapp inbound logs manage allowed" on public.whatsapp_inbound_logs;
create policy "whatsapp inbound logs manage allowed"
on public.whatsapp_inbound_logs
for all
to authenticated
using (
  private.has_permission(organization_id, 'whatsapp_manage')
  or private.has_permission(organization_id, 'settings_manage')
)
with check (
  private.has_permission(organization_id, 'whatsapp_manage')
  or private.has_permission(organization_id, 'settings_manage')
);
