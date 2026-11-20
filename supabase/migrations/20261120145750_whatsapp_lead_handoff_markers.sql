-- Chat-only proof of the first accepted human outbound after an actual lead handoff.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create table private.whatsapp_lead_handoffs (
  id uuid primary key default gen_random_uuid(),
  ordinal bigint generated always as identity,
  organization_id uuid not null,
  lead_id uuid not null references public.leads(id) on delete cascade,
  previous_user_id uuid,
  assigned_user_id uuid,
  attendance_entry_id uuid,
  message_id uuid,
  marker_at timestamptz,
  check (previous_user_id is distinct from assigned_user_id),
  check (
    (attendance_entry_id is null and message_id is null and marker_at is null)
    or (previous_user_id is not null and assigned_user_id is not null
        and attendance_entry_id is not null and message_id is not null and marker_at is not null)
  )
);

create index whatsapp_lead_handoffs_latest_idx
  on private.whatsapp_lead_handoffs (organization_id, lead_id, ordinal desc);

alter table private.whatsapp_lead_handoffs enable row level security;
revoke all on table private.whatsapp_lead_handoffs from public, anon, authenticated, service_role;
grant select, update (attendance_entry_id, message_id, marker_at)
  on table private.whatsapp_lead_handoffs to service_role;

-- Runs on every real transition, including an unassignment. The lead row lock
-- serializes transitions so older pending messages cannot claim a later handoff.
create function private.record_whatsapp_lead_handoff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into private.whatsapp_lead_handoffs (
    organization_id, lead_id, previous_user_id, assigned_user_id
  ) values (new.organization_id, new.id, old.assigned_user_id, new.assigned_user_id);
  return new;
end;
$function$;

revoke all on function private.record_whatsapp_lead_handoff() from public, anon, authenticated, service_role;

create trigger record_whatsapp_lead_handoff
after update on public.leads
for each row when (old.assigned_user_id is distinct from new.assigned_user_id)
execute function private.record_whatsapp_lead_handoff();

commit;
