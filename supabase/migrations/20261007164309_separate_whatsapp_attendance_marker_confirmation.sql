-- The attendance entry remains an immutable capture/send authorization. Only
-- an accepted human outbound may create the separate, visible CRM marker.
-- Existing timeline rows and attendance entries are untouched.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

create table public.whatsapp_attendance_marker_confirmations (
  entry_id uuid primary key
    references public.whatsapp_attendance_entries(id) on delete no action,
  organization_id uuid not null,
  lead_id uuid not null,
  conversation_id uuid not null,
  session_id uuid not null,
  user_id uuid not null,
  message_id uuid not null,
  confirmed_at timestamptz not null,
  marker_kind text not null
    check (marker_kind in ('started', 'joined')),
  constraint whatsapp_attendance_marker_message_key
    unique (organization_id, message_id)
);

comment on table public.whatsapp_attendance_marker_confirmations is
'Backend-only, append-only proof of the first accepted human WhatsApp outbound for one immutable attendance entry. The message UUID is an audit snapshot so message retention cannot erase this proof.';

alter table public.whatsapp_attendance_marker_confirmations
  enable row level security;

revoke all privileges on table public.whatsapp_attendance_marker_confirmations
  from public, anon, authenticated, service_role;
grant select, insert on table public.whatsapp_attendance_marker_confirmations
  to service_role;

-- Older API replicas still try to write the marker immediately on joining.
-- Suppress such new events at the database boundary. The accepted-send helper
-- writes the confirmation first and then its timeline event in one transaction.
-- Historical timeline rows are not rewritten or hidden.
create or replace function private.guard_unconfirmed_whatsapp_attendance_marker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type <> 'whatsapp_attendance_joined' then
    return new;
  end if;

  if not exists (
    select 1
    from public.whatsapp_attendance_marker_confirmations as proof
    where proof.entry_id::text = new.metadata->>'attendance_entry_id'
      and proof.organization_id = new.organization_id
      and proof.lead_id = new.lead_id
      and proof.user_id = new.user_id
      and proof.user_id = new.actor_user_id
      and proof.message_id::text = new.metadata->>'confirmed_message_id'
      and proof.marker_kind = new.metadata->>'marker_kind'
      and proof.confirmed_at = new.event_at
  ) then
    return null;
  end if;

  if exists (
    select 1
    from public.lead_timeline_events as existing
    where existing.organization_id = new.organization_id
      and existing.lead_id = new.lead_id
      and existing.event_type = 'whatsapp_attendance_joined'
      and existing.metadata->>'attendance_entry_id' =
          new.metadata->>'attendance_entry_id'
  ) then
    return null;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_unconfirmed_whatsapp_attendance_marker()
  from public, anon, authenticated, service_role;

create trigger zz_guard_unconfirmed_whatsapp_attendance_marker
before insert on public.lead_timeline_events
for each row
execute function private.guard_unconfirmed_whatsapp_attendance_marker();

commit;
