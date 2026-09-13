begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

select has_table(
  'private',
  'whatsapp_session_supervisor_state',
  'WhatsApp supervision keeps operational state outside the user-facing session table'
);

select col_is(
  'private',
  'whatsapp_session_supervisor_state',
  'last_claimed_at',
  'timestamp with time zone',
  'the fair-scan cursor is a typed timestamp'
);

select col_is(
  'private',
  'whatsapp_session_supervisor_state',
  'lease_expires_at',
  'timestamp with time zone',
  'cross-replica claims have an expiring lease'
);

select col_is(
  'private',
  'whatsapp_session_supervisor_state',
  'claim_token',
  'text',
  'cross-replica writes carry a fencing token'
);

select col_is(
  'private',
  'whatsapp_session_supervisor_state',
  'provider_instance_key',
  'text',
  'a recreated provider identity invalidates stale retry and lease state'
);

select ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation
    where relation.oid = 'private.whatsapp_session_supervisor_state'::regclass
  ),
  'the private supervisor table has forced RLS defense in depth'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_policy policy
    where policy.polrelid = 'private.whatsapp_session_supervisor_state'::regclass
  ),
  0::bigint,
  'the backend-only supervisor table has no browser policy'
);

select ok(
  not has_table_privilege('anon', 'private.whatsapp_session_supervisor_state', 'select')
  and not has_table_privilege('anon', 'private.whatsapp_session_supervisor_state', 'insert')
  and not has_table_privilege('anon', 'private.whatsapp_session_supervisor_state', 'update')
  and not has_table_privilege('authenticated', 'private.whatsapp_session_supervisor_state', 'select')
  and not has_table_privilege('authenticated', 'private.whatsapp_session_supervisor_state', 'insert')
  and not has_table_privilege('authenticated', 'private.whatsapp_session_supervisor_state', 'update')
  and not has_table_privilege('service_role', 'private.whatsapp_session_supervisor_state', 'select')
  and not has_table_privilege('service_role', 'private.whatsapp_session_supervisor_state', 'update'),
  'browser and service API roles cannot read or mutate supervisor internals'
);

select has_function(
  'private',
  'claim_whatsapp_sessions_for_supervision',
  array['text', 'integer', 'interval', 'interval'],
  'the atomic supervisor claim function exists'
);

select ok(
  (
    select procedure.prosecdef
    from pg_catalog.pg_proc procedure
    where procedure.oid = 'private.claim_whatsapp_sessions_for_supervision(text,integer,interval,interval)'::regprocedure
  ),
  'the claim function owns its tightly-scoped table access'
);

select ok(
  (
    select 'search_path=pg_catalog' = any(coalesce(procedure.proconfig, array[]::text[]))
    from pg_catalog.pg_proc procedure
    where procedure.oid = 'private.claim_whatsapp_sessions_for_supervision(text,integer,interval,interval)'::regprocedure
  ),
  'the SECURITY DEFINER claim has an immutable search_path'
);

select ok(
  not has_function_privilege(
    'anon',
    'private.claim_whatsapp_sessions_for_supervision(text,integer,interval,interval)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.claim_whatsapp_sessions_for_supervision(text,integer,interval,interval)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.claim_whatsapp_sessions_for_supervision(text,integer,interval,interval)',
    'execute'
  ),
  'the claim function is not an RPC available to client-facing roles'
);

select ok(
  position(
    'for update of state skip locked'
    in lower(pg_get_functiondef('private.claim_whatsapp_sessions_for_supervision(text,integer,interval,interval)'::regprocedure))
  ) > 0,
  'claiming skips rows already held by another worker instead of blocking'
);

select ok(
  position(
    'on conflict (session_id) do nothing'
    in lower(pg_get_functiondef('private.claim_whatsapp_sessions_for_supervision(text,integer,interval,interval)'::regprocedure))
  ) > 0,
  'registering existing sessions does not take no-op update locks across the fleet'
);

select ok(
  position(
    'partition by state.organization_id'
    in lower(pg_get_functiondef('private.claim_whatsapp_sessions_for_supervision(text,integer,interval,interval)'::regprocedure))
  ) > 0,
  'claim pages interleave tenants instead of letting one large organization monopolize a cycle'
);

select ok(
  (
    select bool_and(index_state.indisready and index_state.indisvalid)
    from pg_catalog.pg_index index_state
    where index_state.indexrelid in (
      'private.whatsapp_session_supervisor_state_fair_claim_idx'::regclass,
      'private.whatsapp_session_supervisor_state_lease_idx'::regclass,
      'private.whatsapp_session_supervisor_state_retry_idx'::regclass
    )
  ),
  'fair-claim, lease and retry indexes are ready and valid'
);

select ok(
  (
    select index_state.indisunique and index_state.indisready and index_state.indisvalid
    from pg_catalog.pg_index index_state
    where index_state.indexrelid =
      'private.whatsapp_session_supervisor_state_provider_instance_uidx'::regclass
  ),
  'one Evolution provider instance cannot be supervised as two CRM sessions or tenants'
);

select ok(
  position(
    'session.updated_at'
    in lower(pg_get_functiondef('private.claim_whatsapp_sessions_for_supervision(text,integer,interval,interval)'::regprocedure))
  ) = 0,
  'session updated_at is not reused as a supervisor cursor or freshness signal'
);

select * from finish();
rollback;
