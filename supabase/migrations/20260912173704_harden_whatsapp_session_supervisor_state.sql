-- Backend-only operational state for Evolution Go supervision.
--
-- Do not put these leases/cursors in whatsapp_sessions. That table has an
-- updated_at trigger and is user-facing; using it as a worker queue both lies
-- about business freshness and lets unrelated edits disturb fleet fairness.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $supervisor_foundation$
begin
  if to_regclass('public.whatsapp_sessions') is null
     or to_regclass('public.organizations') is null then
    raise exception 'WhatsApp supervisor foundation is incomplete';
  end if;
end;
$supervisor_foundation$;

create schema if not exists private;

create table if not exists private.whatsapp_session_supervisor_state (
  session_id uuid primary key,
  organization_id uuid not null,
  provider_instance_key text not null,
  last_claimed_at timestamptz,
  claim_token text,
  lease_expires_at timestamptz,
  probe_failure_count integer not null default 0,
  retry_at timestamptz,
  last_error_code text,
  last_provider_observed_at timestamptz,
  last_provider_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.whatsapp_session_supervisor_state
  add column if not exists session_id uuid,
  add column if not exists organization_id uuid,
  add column if not exists provider_instance_key text,
  add column if not exists last_claimed_at timestamptz,
  add column if not exists claim_token text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists probe_failure_count integer not null default 0,
  add column if not exists retry_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_provider_observed_at timestamptz,
  add column if not exists last_provider_status text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- A partially-created table from an interrupted rollout is repaired from the
-- authoritative session row before NOT NULL is enforced.
update private.whatsapp_session_supervisor_state state
set organization_id = session.organization_id,
    provider_instance_key = coalesce(
      nullif(btrim(session.advanced_settings->>'evolution_go_resolved_instance_key'), ''),
      nullif(btrim(session.instance_id), ''),
      nullif(btrim(session.instance_name), ''),
      'missing:' || session.id::text
    )
from public.whatsapp_sessions session
where state.session_id = session.id
  and (state.organization_id is null or state.provider_instance_key is null);

alter table private.whatsapp_session_supervisor_state
  alter column organization_id set not null,
  alter column provider_instance_key set not null;

do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'private.whatsapp_session_supervisor_state'::regclass
      and contype = 'p'
  ) then
    alter table private.whatsapp_session_supervisor_state
      add constraint whatsapp_session_supervisor_state_pkey primary key (session_id);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'private.whatsapp_session_supervisor_state'::regclass
      and conname = 'whatsapp_session_supervisor_state_session_fkey'
  ) then
    alter table private.whatsapp_session_supervisor_state
      add constraint whatsapp_session_supervisor_state_session_fkey
      foreign key (session_id)
      references public.whatsapp_sessions(id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'private.whatsapp_session_supervisor_state'::regclass
      and conname = 'whatsapp_session_supervisor_state_organization_fkey'
  ) then
    alter table private.whatsapp_session_supervisor_state
      add constraint whatsapp_session_supervisor_state_organization_fkey
      foreign key (organization_id)
      references public.organizations(id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'private.whatsapp_session_supervisor_state'::regclass
      and conname = 'whatsapp_session_supervisor_state_failure_count_check'
  ) then
    alter table private.whatsapp_session_supervisor_state
      add constraint whatsapp_session_supervisor_state_failure_count_check
      check (probe_failure_count between 0 and 10000);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'private.whatsapp_session_supervisor_state'::regclass
      and conname = 'whatsapp_session_supervisor_state_lease_shape_check'
  ) then
    alter table private.whatsapp_session_supervisor_state
      add constraint whatsapp_session_supervisor_state_lease_shape_check
      check (
        (claim_token is null and lease_expires_at is null)
        or (nullif(btrim(claim_token), '') is not null and lease_expires_at is not null)
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'private.whatsapp_session_supervisor_state'::regclass
      and conname = 'whatsapp_session_supervisor_state_provider_status_check'
  ) then
    alter table private.whatsapp_session_supervisor_state
      add constraint whatsapp_session_supervisor_state_provider_status_check
      check (last_provider_status is null or last_provider_status in ('connected', 'disconnected', 'qr_ready'));
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'private.whatsapp_session_supervisor_state'::regclass
      and conname = 'whatsapp_session_supervisor_state_provider_key_check'
  ) then
    alter table private.whatsapp_session_supervisor_state
      add constraint whatsapp_session_supervisor_state_provider_key_check
      check (char_length(btrim(provider_instance_key)) between 1 and 256);
  end if;
end;
$migration$;

-- Materialize every session eligible for supervision before the uniqueness
-- fence is installed. This makes a legacy cross-tenant provider-key collision
-- fail this atomic migration, rather than letting rollout succeed and making
-- every supervisor claim fail only after the new binary is live.
delete from private.whatsapp_session_supervisor_state as state
where not exists (
  select 1
  from public.whatsapp_sessions as session
  where session.id = state.session_id
    and session.organization_id = state.organization_id
    and lower(btrim(coalesce(session.provider, ''))) = 'evolution_go'
    and coalesce(session.is_active, true) = true
    and lower(btrim(coalesce(session.status, ''))) not in ('deleted', 'disabled')
    and lower(coalesce(session.advanced_settings->>'auto_reconnect_enabled', 'true')) <> 'false'
);

insert into private.whatsapp_session_supervisor_state as state (
  session_id,
  organization_id,
  provider_instance_key,
  created_at,
  updated_at
)
select
  session.id,
  session.organization_id,
  coalesce(
    nullif(btrim(session.advanced_settings->>'evolution_go_resolved_instance_key'), ''),
    nullif(btrim(session.instance_id), ''),
    nullif(btrim(session.instance_name), ''),
    'missing:' || session.id::text
  ),
  now(),
  now()
from public.whatsapp_sessions session
where lower(btrim(coalesce(session.provider, ''))) = 'evolution_go'
  and coalesce(session.is_active, true) = true
  and lower(btrim(coalesce(session.status, ''))) not in ('deleted', 'disabled')
  and lower(coalesce(session.advanced_settings->>'auto_reconnect_enabled', 'true')) <> 'false'
on conflict (session_id) do update
set organization_id = excluded.organization_id,
    provider_instance_key = excluded.provider_instance_key,
    updated_at = now()
where state.organization_id is distinct from excluded.organization_id
   or state.provider_instance_key is distinct from excluded.provider_instance_key;

-- One provider instance on the shared Evolution service may never be supervised
-- as two CRM sessions/tenants. Existing ambiguity fails this migration closed.
create unique index if not exists whatsapp_session_supervisor_state_provider_instance_uidx
  on private.whatsapp_session_supervisor_state (provider_instance_key);

do $provider_instance_unique_index_contract$
declare
  index_definition text;
begin
  select regexp_replace(lower(pg_get_indexdef(index_state.indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index as index_state
  where index_state.indexrelid = to_regclass('private.whatsapp_session_supervisor_state_provider_instance_uidx')
    and index_state.indrelid = 'private.whatsapp_session_supervisor_state'::regclass
    and index_state.indisunique
    and index_state.indisready
    and index_state.indisvalid;

  if index_definition is distinct from
     'create unique index whatsapp_session_supervisor_state_provider_instance_uidx on private.whatsapp_session_supervisor_state using btree (provider_instance_key)'
  then
    raise exception 'private.whatsapp_session_supervisor_state_provider_instance_uidx is missing, invalid, or unexpected';
  end if;
end;
$provider_instance_unique_index_contract$;

create index if not exists whatsapp_session_supervisor_state_fair_claim_idx
  on private.whatsapp_session_supervisor_state
  (organization_id, last_claimed_at asc nulls first, session_id);

create index if not exists whatsapp_session_supervisor_state_lease_idx
  on private.whatsapp_session_supervisor_state (lease_expires_at, session_id)
  where lease_expires_at is not null;

create index if not exists whatsapp_session_supervisor_state_retry_idx
  on private.whatsapp_session_supervisor_state (retry_at, session_id)
  where retry_at is not null;

alter table private.whatsapp_session_supervisor_state enable row level security;
alter table private.whatsapp_session_supervisor_state force row level security;

comment on table private.whatsapp_session_supervisor_state is
  'Backend-only leases, fair-scan cursors, provider observations and retry state for WhatsApp session supervision.';

create or replace function private.claim_whatsapp_sessions_for_supervision(
  p_claim_token text,
  p_limit integer default 50,
  p_minimum_age interval default interval '1 minute',
  p_lease interval default interval '5 minutes'
)
returns table (
  session_id uuid,
  organization_id uuid,
  claim_token text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
#variable_conflict use_column
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_claim_token text := pg_catalog.btrim(p_claim_token);
begin
  if v_claim_token is null or pg_catalog.length(v_claim_token) < 16 or pg_catalog.length(v_claim_token) > 256 then
    raise exception 'invalid WhatsApp supervisor claim token' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'WhatsApp supervisor claim limit must be between 1 and 100' using errcode = '22023';
  end if;
  if p_minimum_age is null or p_minimum_age < interval '30 seconds' or p_minimum_age > interval '1 hour' then
    raise exception 'WhatsApp supervisor minimum age must be between 30 seconds and 1 hour' using errcode = '22023';
  end if;
  if p_lease is null or p_lease < interval '1 minute' or p_lease > interval '30 minutes' then
    raise exception 'WhatsApp supervisor lease must be between 1 and 30 minutes' using errcode = '22023';
  end if;

  -- Retire operational rows as soon as their source session leaves the
  -- supervision domain. Keeping tombstones would reserve a provider instance
  -- key forever and could make a legitimate replacement session fail every
  -- future claim on the global uniqueness fence.
  delete from private.whatsapp_session_supervisor_state as state
  where not exists (
    select 1
    from public.whatsapp_sessions as session
    where session.id = state.session_id
      and session.organization_id = state.organization_id
      and pg_catalog.lower(pg_catalog.btrim(coalesce(session.provider, ''))) = 'evolution_go'
      and coalesce(session.is_active, true) = true
      and pg_catalog.lower(pg_catalog.btrim(coalesce(session.status, ''))) not in ('deleted', 'disabled')
      and pg_catalog.lower(coalesce(session.advanced_settings->>'auto_reconnect_enabled', 'true')) <> 'false'
  );

  -- Register newly-created sessions without touching the user-facing session
  -- row. DO NOTHING is deliberate: a no-op DO UPDATE would still lock every
  -- existing state row and serialize otherwise independent claimers.
  insert into private.whatsapp_session_supervisor_state as state (
    session_id,
    organization_id,
    provider_instance_key,
    created_at,
    updated_at
  )
  select
    session.id,
    session.organization_id,
    coalesce(
      nullif(pg_catalog.btrim(session.advanced_settings->>'evolution_go_resolved_instance_key'), ''),
      nullif(pg_catalog.btrim(session.instance_id), ''),
      nullif(pg_catalog.btrim(session.instance_name), ''),
      'missing:' || session.id::text
    ),
    v_now,
    v_now
  from public.whatsapp_sessions session
  where pg_catalog.lower(pg_catalog.btrim(coalesce(session.provider, ''))) = 'evolution_go'
    and coalesce(session.is_active, true) = true
    and pg_catalog.lower(pg_catalog.btrim(coalesce(session.status, ''))) not in ('deleted', 'disabled')
    and pg_catalog.lower(coalesce(session.advanced_settings->>'auto_reconnect_enabled', 'true')) <> 'false'
  on conflict (session_id) do nothing;

  -- A recreate changes provider_instance_key and atomically invalidates every
  -- old lease/backoff before the replacement instance is inspected. This
  -- update locks only identities which actually changed.
  update private.whatsapp_session_supervisor_state state
  set organization_id = session.organization_id,
      provider_instance_key = coalesce(
        nullif(pg_catalog.btrim(session.advanced_settings->>'evolution_go_resolved_instance_key'), ''),
        nullif(pg_catalog.btrim(session.instance_id), ''),
        nullif(pg_catalog.btrim(session.instance_name), ''),
        'missing:' || session.id::text
      ),
      last_claimed_at = null,
      claim_token = null,
      lease_expires_at = null,
      probe_failure_count = 0,
      retry_at = null,
      last_error_code = null,
      last_provider_observed_at = null,
      last_provider_status = null,
      updated_at = v_now
  from public.whatsapp_sessions session
  where session.id = state.session_id
    and (
      state.organization_id is distinct from session.organization_id
      or state.provider_instance_key is distinct from coalesce(
        nullif(pg_catalog.btrim(session.advanced_settings->>'evolution_go_resolved_instance_key'), ''),
        nullif(pg_catalog.btrim(session.instance_id), ''),
        nullif(pg_catalog.btrim(session.instance_name), ''),
        'missing:' || session.id::text
      )
    );

  return query
  with eligible as materialized (
    select
      state.session_id,
      state.organization_id,
      state.last_claimed_at,
      row_number() over (
        partition by state.organization_id
        order by state.last_claimed_at asc nulls first, state.session_id asc
      ) as tenant_position
    from private.whatsapp_session_supervisor_state state
    join public.whatsapp_sessions session
      on session.id = state.session_id
     and session.organization_id = state.organization_id
    where pg_catalog.lower(pg_catalog.btrim(coalesce(session.provider, ''))) = 'evolution_go'
      and coalesce(session.is_active, true) = true
      and pg_catalog.lower(pg_catalog.btrim(coalesce(session.status, ''))) not in ('deleted', 'disabled')
      and pg_catalog.lower(coalesce(session.advanced_settings->>'auto_reconnect_enabled', 'true')) <> 'false'
      and (state.retry_at is null or state.retry_at <= v_now)
      and (state.lease_expires_at is null or state.lease_expires_at <= v_now)
      and (state.last_claimed_at is null or state.last_claimed_at <= v_now - p_minimum_age)
  ), candidates as (
    select state.session_id
    from private.whatsapp_session_supervisor_state state
    join eligible on eligible.session_id = state.session_id
    order by
      eligible.tenant_position asc,
      eligible.last_claimed_at asc nulls first,
      eligible.organization_id asc,
      eligible.session_id asc
    limit p_limit
    for update of state skip locked
  ), claimed as (
    update private.whatsapp_session_supervisor_state state
    set claim_token = v_claim_token,
        last_claimed_at = v_now,
        lease_expires_at = v_now + p_lease,
        updated_at = v_now
    from candidates
    where state.session_id = candidates.session_id
    returning state.session_id, state.organization_id, state.claim_token
  )
  select claimed.session_id, claimed.organization_id, claimed.claim_token
  from claimed;
end;
$function$;

comment on function private.claim_whatsapp_sessions_for_supervision(text, integer, interval, interval) is
  'Atomically claims a fair, tenant-interleaved page of active Evolution Go sessions. Locks are held only for this statement; provider IO occurs after commit.';

revoke all on table private.whatsapp_session_supervisor_state
  from public, anon, authenticated, service_role;
revoke all on function private.claim_whatsapp_sessions_for_supervision(text, integer, interval, interval)
  from public, anon, authenticated, service_role;

commit;
