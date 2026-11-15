-- F00 preconditions only. Reviewed against the zero-reservation partial schema.
-- Then apply 20261012223804_persist_property_creation_receipts.sql unchanged.
-- No auxiliary ACL/policy hardening or migration-ledger writes belong here.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.properties in share row exclusive mode;

do $preflight$
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception 'property receipts require PostgreSQL 15 or newer';
  end if;
  if to_regnamespace('private') is null
    or to_regclass('public.organizations') is null then
    raise exception 'property receipt schemas or organization table are missing';
  end if;
  if (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')) <> 3 then
    raise exception 'expected Supabase roles are missing';
  end if;
  if to_regclass('public.property_creation_receipts') is not null
    or to_regclass('public.properties_creation_request_uidx') is not null
    or to_regprocedure('private.guard_property_creation_ledger()') is not null
    or to_regprocedure('private.property_creation_ledger_is_valid(jsonb)') is not null
    or to_regprocedure('private.guard_property_creation_receipt()') is not null
    or to_regprocedure('private.capture_property_creation_receipt()') is not null
    or exists (select 1 from pg_trigger where tgrelid = 'public.properties'::regclass
      and tgname in ('properties_guard_creation_ledger','properties_capture_creation_receipt')) then
    raise exception 'unexpected property receipt objects; review partial state before applying';
  end if;
  if exists (select 1 from public.properties where metadata ? '_creation_idempotency') then
    raise exception 'this cutover requires the reviewed zero-reservation state';
  end if;
end;
$preflight$;

-- The FK accepts a valid immediate unique index; it need not be a constraint.
-- Reuse an equivalent standalone index instead of replaying the foundation.
do $identity_index$
begin
  if not exists (
    select 1 from pg_index i
    where i.indrelid = 'public.properties'::regclass
      and i.indisunique and i.indisvalid and i.indisready and i.indimmediate
      and i.indpred is null and i.indexprs is null and i.indnkeyatts = 2
      and (select array_agg(a.attname::text order by a.attname)
        from unnest(i.indkey::smallint[]) with ordinality k(attnum, position)
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
        where k.position <= i.indnkeyatts) = array['id','organization_id']::text[]
  ) then
    if to_regclass('public.properties_organization_id_id_uidx') is not null then
      raise exception 'property composite identity index name has an unexpected definition';
    end if;
    create unique index properties_organization_id_id_uidx
      on public.properties (organization_id, id);
  end if;
end;
$identity_index$;

-- Exact reservation subset of 20261012212534; auxiliary access stays unchanged.
create unique index properties_creation_request_uidx
  on public.properties (
    organization_id,
    (metadata -> '_creation_idempotency' ->> 'actor_id'),
    (metadata -> '_creation_idempotency' ->> 'key_hash')
  ) where metadata ? '_creation_idempotency';

create function private.guard_property_creation_ledger()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.metadata ? '_creation_idempotency' then
    if not coalesce(new.metadata ? '_creation_idempotency', false) then
      new.metadata := coalesce(new.metadata, '{}'::jsonb)
        || jsonb_build_object('_creation_idempotency', old.metadata -> '_creation_idempotency');
    elsif old.metadata -> '_creation_idempotency' is distinct from new.metadata -> '_creation_idempotency' then
      raise exception using errcode = '23514', message = 'property creation reservation is immutable';
    end if;
  elsif new.metadata ? '_creation_idempotency' then
    raise exception using errcode = '23514', message = 'property creation reservation cannot be assigned after creation';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_property_creation_ledger() from public, anon, authenticated;
create trigger properties_guard_creation_ledger before update of metadata on public.properties
  for each row execute function private.guard_property_creation_ledger();

commit;
