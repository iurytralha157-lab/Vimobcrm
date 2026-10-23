begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A receipt has no expiry: an ambiguous POST may be retried after its property
-- was deleted. Organization deletion is the only automatic receipt cleanup.
create table public.property_creation_receipts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null,
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  property_id uuid,
  state text not null check (state in ('created', 'removed')),
  created_at timestamptz not null default now(),
  primary key (organization_id, actor_id, key_hash),
  constraint property_creation_receipts_property_fkey
    foreign key (organization_id, property_id)
    references public.properties(organization_id, id)
    on delete set null (property_id),
  constraint property_creation_receipts_state_property_check check (
    (state = 'created' and property_id is not null)
    or (state = 'removed' and property_id is null)
  )
);
create index property_creation_receipts_property_idx
  on public.property_creation_receipts(organization_id, property_id)
  where property_id is not null;
alter table public.property_creation_receipts enable row level security;
-- No browser policies are created, and no browser table or column privileges
-- are granted. The backend owns this ledger; no direct DELETE/TTL job is added.
revoke all on table public.property_creation_receipts from public, anon, authenticated, service_role;
grant select, insert, update on table public.property_creation_receipts to service_role;

create function private.property_creation_ledger_is_valid(ledger jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(ledger) = 'object'
    and jsonb_typeof(ledger -> 'actor_id') = 'string'
    and jsonb_typeof(ledger -> 'key_hash') = 'string'
    and jsonb_typeof(ledger -> 'request_hash') = 'string'
    and (ledger ->> 'actor_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (ledger ->> 'key_hash') ~ '^[0-9a-f]{64}$'
    and (ledger ->> 'request_hash') ~ '^[0-9a-f]{64}$', false
  );
$$;
revoke all on function private.property_creation_ledger_is_valid(jsonb) from public, anon, authenticated;

create function private.guard_property_creation_receipt()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if row(new.organization_id, new.actor_id, new.key_hash, new.request_hash, new.created_at)
    is distinct from row(old.organization_id, old.actor_id, old.key_hash, old.request_hash, old.created_at) then
    raise exception using errcode = '23514', message = 'property creation receipt identity is immutable';
  end if;
  if old.state = 'removed' and row(new.property_id, new.state) is distinct from row(old.property_id, old.state) then
    raise exception using errcode = '23514', message = 'removed property creation receipt cannot be revived';
  end if;
  if new.property_id is distinct from old.property_id then
    if new.property_id is not null or exists (
      select 1 from public.properties property
      where property.organization_id = old.organization_id and property.id = old.property_id
    ) then
      raise exception using errcode = '23514', message = 'property creation receipt cannot be reassigned or detached';
    end if;
  end if;
  -- FK ON DELETE SET NULL retains the receipt and becomes a durable tombstone.
  new.state := case when new.property_id is null then 'removed' else 'created' end;
  return new;
end;
$$;
revoke all on function private.guard_property_creation_receipt() from public, anon, authenticated;
create trigger property_creation_receipts_guard_update
  before update on public.property_creation_receipts
  for each row execute function private.guard_property_creation_receipt();

-- Capture old replicas' metadata-ledger INSERTs too. This prevents a mixed
-- rollout from creating keyed properties without an independent receipt.
create function private.capture_property_creation_receipt()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ledger jsonb := new.metadata -> '_creation_idempotency';
begin
  if not private.property_creation_ledger_is_valid(ledger) then
    raise exception using errcode = '23514', message = 'property creation ledger is invalid';
  end if;
  insert into public.property_creation_receipts
    (organization_id, actor_id, key_hash, request_hash, property_id, state, created_at)
  values (new.organization_id, (ledger ->> 'actor_id')::uuid,
    ledger ->> 'key_hash', ledger ->> 'request_hash', new.id, 'created', new.created_at);
  return new;
end;
$$;
revoke all on function private.capture_property_creation_receipt() from public, anon, authenticated;
create trigger properties_capture_creation_receipt
  after insert on public.properties
  for each row when (new.metadata ? '_creation_idempotency')
  execute function private.capture_property_creation_receipt();

-- Do not guess hashes or silently drop malformed legacy reservations. Such a
-- row must be reviewed before this migration can be applied safely.
do $validate_backfill$
begin
  if exists (select 1 from public.properties property
    where property.metadata ? '_creation_idempotency'
      and not private.property_creation_ledger_is_valid(property.metadata -> '_creation_idempotency')) then
    raise exception using errcode = '23514', message = 'invalid legacy property creation ledger requires review before receipt backfill';
  end if;
  if exists (select 1 from public.properties property
    where property.metadata ? '_creation_idempotency'
    group by property.organization_id,
      (property.metadata -> '_creation_idempotency' ->> 'actor_id')::uuid,
      property.metadata -> '_creation_idempotency' ->> 'key_hash'
    having count(*) > 1) then
    raise exception using errcode = '23514', message = 'duplicate legacy property creation ledger requires review before receipt backfill';
  end if;
end;
$validate_backfill$;
insert into public.property_creation_receipts
  (organization_id, actor_id, key_hash, request_hash, property_id, state, created_at)
select property.organization_id,
  (property.metadata -> '_creation_idempotency' ->> 'actor_id')::uuid,
  property.metadata -> '_creation_idempotency' ->> 'key_hash',
  property.metadata -> '_creation_idempotency' ->> 'request_hash',
  property.id, 'created', property.created_at
from public.properties property
where property.metadata ? '_creation_idempotency';

comment on table public.property_creation_receipts is
  'Privileged creation receipts; retain removed tombstones without automatic expiration to prevent delayed POST resurrection.';
commit;
