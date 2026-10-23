-- Apply before the compatible API/Web release. Runtime counters deliberately
-- do not invalidate an editor's configuration revision.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- A nonvolatile default keeps ADD COLUMN from rewriting the existing catalog.
-- Real edits below still use clock_timestamp() and a monotonic microsecond step.
alter table public.tags add column updated_at timestamptz not null default now();
create or replace function private.advance_management_tag_revision()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if (new.name, new.color, new.description) is distinct from (old.name, old.color, old.description) then
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end
$function$;
revoke all on function private.advance_management_tag_revision() from public, anon, authenticated;
create trigger advance_management_tag_revision before update on public.tags
for each row execute function private.advance_management_tag_revision();

alter table public.round_robins add column revision bigint not null default 1;
alter table public.round_robins add constraint round_robins_revision_safe_integer
check (revision between 1 and 9007199254740991) not valid;
alter table public.round_robins validate constraint round_robins_revision_safe_integer;

create or replace function private.advance_management_queue_revision()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if (to_jsonb(new) - array['revision','updated_at','last_assigned_index','current_position','leads_distributed'])
     is distinct from
     (to_jsonb(old) - array['revision','updated_at','last_assigned_index','current_position','leads_distributed']) then
    new.revision := old.revision + 1;
  elsif new.revision is distinct from old.revision then
    new.revision := old.revision + 1;
  end if;
  return new;
end
$function$;
revoke all on function private.advance_management_queue_revision() from public, anon, authenticated;
create trigger zz_advance_management_queue_revision before update on public.round_robins
for each row execute function private.advance_management_queue_revision();

create or replace function private.advance_management_queue_child_revision()
returns trigger language plpgsql set search_path = '' as $function$
declare queue_ids uuid[]; target_id uuid;
begin
  if tg_op = 'UPDATE' and
     (to_jsonb(new) - array['updated_at','created_at','leads_count']) =
     (to_jsonb(old) - array['updated_at','created_at','leads_count']) then
    return new;
  end if;
  if tg_op = 'INSERT' then queue_ids := array[new.round_robin_id];
  elsif tg_op = 'DELETE' then queue_ids := array[old.round_robin_id];
  else queue_ids := array[old.round_robin_id, new.round_robin_id]; end if;
  for target_id in select distinct id from unnest(queue_ids) id order by id loop
    update public.round_robins set revision = revision + 1
    where id = target_id;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;
revoke all on function private.advance_management_queue_child_revision() from public, anon, authenticated;
create trigger advance_management_queue_member_revision after insert or update or delete on public.round_robin_members
for each row execute function private.advance_management_queue_child_revision();
create trigger advance_management_queue_rule_revision after insert or update or delete on public.round_robin_rules
for each row execute function private.advance_management_queue_child_revision();
create or replace trigger audit_round_robins_changes after insert or delete or update on public.round_robins
for each row execute function private.write_audit_log_for_row('distribution_queue', 'current_position', 'last_assigned_index', 'leads_distributed', 'revision');

create table private.crm_management_create_requests (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('team', 'round_robin')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, entity_type, key_hash)
);
alter table private.crm_management_create_requests enable row level security;
revoke all on table private.crm_management_create_requests from public, anon, authenticated;
grant select, insert on table private.crm_management_create_requests to service_role;
comment on table private.crm_management_create_requests is
  'Creation deduplication by tenant, actor and hashed attempt; stores no raw payload or personal data snapshot.';
commit;
