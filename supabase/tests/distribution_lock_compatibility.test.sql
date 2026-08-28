begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

select is(
  (
    select regexp_count(
      lower(pg_catalog.pg_get_functiondef(procedure.oid)),
      'for no key update;'
    )
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz)'::regprocedure
  ),
  1,
  'canonical distribution uses one non-key lead lock compatible with attribution foreign keys'
);

select is(
  (
    select regexp_count(
      lower(pg_catalog.pg_get_functiondef(procedure.oid)),
      'for update;'
    )
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz)'::regprocedure
  ),
  0,
  'canonical distribution does not retain exclusive queue or member lock convoys'
);

select ok(
  (
    select
      lower(procedure.prosrc)
        like '%private.next_round_robin_ticket(v_queue.id)%'
      and lower(procedure.prosrc)
        like '%private.pick_round_robin_ticket_candidate(%'
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz)'::regprocedure
  ),
  'canonical distribution reserves and resolves a queue-local ticket'
);

select is(
  (
    select regexp_count(
      lower(pg_catalog.pg_get_functiondef(procedure.oid)),
      'revoke all on sequence'
    )
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'private.ensure_round_robin_ticket_sequence(uuid)'::regprocedure
  ),
  1,
  'ticket sequence ACL is written only during creation, not on the hot path'
);

select ok(
  (
    select
      procedure.prosecdef
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
        where setting = 'search_path=""'
      )
      and lower(procedure.prosrc) not like '%generate_series%'
      and lower(procedure.prosrc) like '%weight_groups as%'
      and lower(procedure.prosrc) like '%selected_entry as%'
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'private.pick_round_robin_ticket_candidate(uuid,uuid,text,boolean,integer,time without time zone,bigint)'::regprocedure
  ),
  'ticket candidate helper is hardened and maps weights without row expansion'
);

select ok(
  not has_function_privilege(
    'anon',
    'private.pick_round_robin_ticket_candidate(uuid,uuid,text,boolean,integer,time without time zone,bigint)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.pick_round_robin_ticket_candidate(uuid,uuid,text,boolean,integer,time without time zone,bigint)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.pick_round_robin_ticket_candidate(uuid,uuid,text,boolean,integer,time without time zone,bigint)',
    'execute'
  ),
  'ticket candidate helper is callable only through the canonical owner boundary'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as weight_constraint
    where weight_constraint.conrelid = 'public.round_robin_members'::regclass
      and weight_constraint.conname = 'round_robin_members_weight_check'
      and weight_constraint.convalidated
      and lower(pg_catalog.pg_get_constraintdef(weight_constraint.oid))
        like '%weight >= 1%'
      and lower(pg_catalog.pg_get_constraintdef(weight_constraint.oid))
        like '%weight <= 1000%'
  ),
  'database constrains distribution weights to the API contract'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_index as index
    join pg_catalog.pg_class as relation
      on relation.oid = index.indexrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'leads_org_phone_unique'
      and index.indisunique
      and index.indisvalid
      and pg_catalog.strpos(
        lower(pg_catalog.pg_get_indexdef(index.indexrelid)),
        'normalize_phone'
      ) > 0
  ),
  'same-phone intake is arbitrated by the valid normalized-phone unique index'
);

select ok(
  (
    select
      procedure.prosecdef
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
        where setting like 'search_path=%'
      )
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz)'::regprocedure
  ),
  'lock relaxation preserves the canonical security-definer search path'
);

select ok(
  to_regprocedure(
    'private.cleanup_orphan_round_robin_ticket_sequences()'
  ) is not null
  and exists (
    select 1
    from cron.job
    where jobname = 'cleanup-round-robin-ticket-sequences'
  ),
  'orphan ticket sequences have a scheduled lifecycle cleanup'
);

select ok(
  (
    select
      lower(procedure.prosrc) like '%private.distribute_lead(%'
      and lower(procedure.prosrc) not like '%public.handle_lead_intake(%'
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'public.trigger_handle_lead_intake()'::regprocedure
  ),
  'unmarked lead inserts enter the canonical distributor instead of the legacy path'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.handle_lead_intake(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.redistribute_lead_from_pool(uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.redistribute_lead_round_robin(uuid)',
    'execute'
  ),
  'service-role callers cannot bypass canonical distribution through legacy RPCs'
);

select * from finish();
rollback;
