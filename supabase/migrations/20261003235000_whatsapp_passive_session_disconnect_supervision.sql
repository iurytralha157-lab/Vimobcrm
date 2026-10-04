-- Keep passive status observation for connected Evolution Go sessions even when automatic recovery is disabled.
-- Disconnected sessions with recovery disabled remain outside the claim domain, preserving the provider-key uniqueness fence.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '1min';

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
      and (pg_catalog.lower(coalesce(session.advanced_settings->>'auto_reconnect_enabled', 'true')) <> 'false' or pg_catalog.lower(pg_catalog.btrim(coalesce(session.status, ''))) = 'connected')
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
    and (pg_catalog.lower(coalesce(session.advanced_settings->>'auto_reconnect_enabled', 'true')) <> 'false' or pg_catalog.lower(pg_catalog.btrim(coalesce(session.status, ''))) = 'connected')
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
      and (pg_catalog.lower(coalesce(session.advanced_settings->>'auto_reconnect_enabled', 'true')) <> 'false' or pg_catalog.lower(pg_catalog.btrim(coalesce(session.status, ''))) = 'connected')
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

revoke all on function private.claim_whatsapp_sessions_for_supervision(text, integer, interval, interval) from public, anon, authenticated, service_role;
commit;
