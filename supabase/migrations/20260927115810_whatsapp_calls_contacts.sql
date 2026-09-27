-- WhatsApp calls are deliberately separate from the legacy telephony skeleton.
-- The provider identity is scoped to one connected Evolution Go session.
create table if not exists public.whatsapp_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.whatsapp_sessions(id) on delete cascade,
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  operator_user_id uuid references public.users(id) on delete set null,
  answer_claim_token uuid,
  answer_claimed_at timestamptz,
  provider_call_id text not null,
  remote_jid text not null,
  direction text not null check (direction in ('incoming', 'outgoing')),
  state text not null check (state in (
    'incoming', 'outgoing', 'ringing', 'active',
    'end_pending', 'reject_pending', 'outcome_unknown',
    'rejected', 'ended', 'failed'
  )),
  source text not null default 'meowcaller',
  reason text,
  offered_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  last_event_at timestamptz not null,
  recording_status text not null default 'unavailable'
    check (recording_status in ('unavailable', 'pending', 'ready', 'partial', 'failed')),
  recording_provider_status text
    check (recording_provider_status in ('complete', 'partial', 'failed')),
  recording_incoming_path text,
  recording_outgoing_path text,
  recording_error text,
  recording_manifest jsonb not null default '[]'::jsonb,
  recording_attempts integer not null default 0,
  recording_next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_calls_provider_identity unique (session_id, provider_call_id),
  constraint whatsapp_calls_provider_id_nonempty check (length(btrim(provider_call_id)) between 1 and 256),
  constraint whatsapp_calls_remote_jid_nonempty check (length(btrim(remote_jid)) between 1 and 256)
);

create index if not exists whatsapp_calls_session_recent_idx
  on public.whatsapp_calls (organization_id, session_id, last_event_at desc, id desc);
create index if not exists whatsapp_calls_global_history_idx
  on public.whatsapp_calls (organization_id, created_at desc, id desc);
create index if not exists whatsapp_calls_lead_recent_idx
  on public.whatsapp_calls (organization_id, lead_id, last_event_at desc, id desc)
  where lead_id is not null;
create index if not exists whatsapp_calls_active_owner_idx
  on public.whatsapp_calls (organization_id, session_id, last_event_at desc)
  where state in ('incoming', 'outgoing', 'ringing', 'active',
                  'end_pending', 'reject_pending', 'outcome_unknown');
create index if not exists whatsapp_calls_recording_pending_idx
  on public.whatsapp_calls (created_at, id)
  where recording_status = 'pending';

create or replace function private.validate_whatsapp_call_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  check_conversation boolean;
  check_lead boolean;
  check_operator boolean;
begin
  if tg_op = 'INSERT' then
    check_conversation := new.conversation_id is not null;
    check_lead := new.lead_id is not null;
    check_operator := new.operator_user_id is not null;
  else
    check_conversation := new.conversation_id is distinct from old.conversation_id;
    check_lead := new.lead_id is distinct from old.lead_id;
    check_operator := new.operator_user_id is distinct from old.operator_user_id;
  end if;

  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
      or new.session_id is distinct from old.session_id
      or new.provider_call_id is distinct from old.provider_call_id
      or new.remote_jid is distinct from old.remote_jid
      or new.direction is distinct from old.direction
      or (old.conversation_id is not null and new.conversation_id is not null
          and new.conversation_id is distinct from old.conversation_id)
      or (old.lead_id is not null and new.lead_id is not null
          and new.lead_id is distinct from old.lead_id) then
      raise exception 'whatsapp_call_identity_immutable' using errcode = '23514';
    end if;
  end if;

  if not exists (
    select 1 from public.whatsapp_sessions s
    where s.id = new.session_id
      and s.organization_id = new.organization_id
      and s.provider = 'evolution_go'
  ) then
    raise exception 'whatsapp_call_session_scope_mismatch' using errcode = '23514';
  end if;

  if check_conversation and new.conversation_id is not null and not exists (
    select 1 from public.whatsapp_conversations c
    where c.id = new.conversation_id
      and c.organization_id = new.organization_id
      and c.session_id = new.session_id
      and coalesce(c.is_group, false) = false
      and (
        c.remote_jid = new.remote_jid
        or exists (
          select 1 from public.whatsapp_contact_identity_aliases alias
          where alias.organization_id = new.organization_id
            and alias.session_id = new.session_id
            and alias.alias_jid = new.remote_jid
            and alias.canonical_jid = c.remote_jid
        )
      )
  ) then
    raise exception 'whatsapp_call_conversation_scope_mismatch' using errcode = '23514';
  end if;

  if check_lead and new.lead_id is not null and (
    not exists (
      select 1 from public.leads l
      where l.id = new.lead_id and l.organization_id = new.organization_id
    )
    or new.conversation_id is null
    or not exists (
      select 1 from public.whatsapp_conversations c
      where c.id = new.conversation_id
        and c.organization_id = new.organization_id
        and c.session_id = new.session_id
        and c.lead_id = new.lead_id
    )
  ) then
    raise exception 'whatsapp_call_lead_scope_mismatch' using errcode = '23514';
  end if;

  if check_operator and new.operator_user_id is not null and not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id
      and m.user_id = new.operator_user_id
  ) then
    raise exception 'whatsapp_call_operator_scope_mismatch' using errcode = '23514';
  end if;

  if new.recording_incoming_path is not null
     and new.recording_incoming_path not like
       new.organization_id::text || '/' || new.session_id::text || '/' || new.id::text || '/%' then
    raise exception 'whatsapp_call_recording_path_scope_mismatch' using errcode = '23514';
  end if;
  if new.recording_outgoing_path is not null
     and new.recording_outgoing_path not like
       new.organization_id::text || '/' || new.session_id::text || '/' || new.id::text || '/%' then
    raise exception 'whatsapp_call_recording_path_scope_mismatch' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists validate_whatsapp_call_scope on public.whatsapp_calls;
create trigger validate_whatsapp_call_scope
before insert or update on public.whatsapp_calls
for each row execute function private.validate_whatsapp_call_scope();

alter table public.whatsapp_calls enable row level security;
revoke all on public.whatsapp_calls from public, anon, authenticated;
grant all on public.whatsapp_calls to service_role;

-- Call visibility also depends on lead permissions in the CRM API. Browser
-- clients therefore read through that API; direct SELECT/Realtime access
-- cannot reproduce its complete authorization boundary.
drop policy if exists whatsapp_calls_owner_select on public.whatsapp_calls;

-- Lead history uses whatsapp_calls.id as lead_timeline_events.id. The existing
-- timeline primary key makes retries idempotent without indexing that large
-- live table during rollout.

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'whatsapp-call-recordings',
  'whatsapp-call-recordings',
  false,
  268435456,
  array['audio/wav']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Storage writes and signed reads are performed only by the CRM service after
-- session/lead authorization. No authenticated storage.objects policy exists
-- for this bucket.
