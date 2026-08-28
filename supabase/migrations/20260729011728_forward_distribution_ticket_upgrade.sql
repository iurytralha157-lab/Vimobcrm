-- Forward-only compatibility bridge for databases that applied an earlier
-- revision of 20260728183851_unify_lead_distribution.sql.
--
-- Fresh databases already have the ticket/IWRR implementation. This migration
-- accepts only:
--   1. that current implementation; or
--   2. the known ledger-backed, row-lock implementation immediately preceding
--      it (with the lead lock already relaxed to FOR NO KEY UPDATE).
--
-- Anything else aborts before the distribution function is replaced. This is
-- deliberate: distribution is a money-path workflow and an unknown function
-- body must never be "upgraded" by guessing.

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'vimob:distribution-ticket-forward-upgrade',
    0
  )
);

do $distribution_upgrade_preflight$
declare
  v_distribution_proc oid;
  v_definition text;
  v_marker text;
  v_language text;
  v_is_security_definer boolean;
  v_volatility "char";
  v_return_type oid;
  v_config text[];
  v_owner_name name;
  v_argument_names text[];
  v_default_count smallint;
begin
  if pg_catalog.to_regclass('private.lead_distribution_events') is null then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_unknown_contract',
      detail = 'private.lead_distribution_events is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    where relation.oid = 'private.lead_distribution_events'::regclass
      and relation.relkind = 'r'
      and relation.relrowsecurity = true
  ) then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_unknown_contract',
      detail = 'private.lead_distribution_events must be an RLS-enabled table';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_definition
    where constraint_definition.conrelid =
          'private.lead_distribution_events'::regclass
      and constraint_definition.contype = 'u'
      and constraint_definition.conname =
          'lead_distribution_events_org_idempotency_key_key'
      and pg_catalog.pg_get_constraintdef(
            constraint_definition.oid,
            true
          ) = 'UNIQUE (organization_id, idempotency_key)'
  ) then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_unknown_contract',
      detail = 'the durable organization/idempotency ledger constraint diverged';
  end if;

  v_distribution_proc := pg_catalog.to_regprocedure(
    'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamp with time zone)'
  );

  if v_distribution_proc is null
     or (
       select count(*)
       from pg_catalog.pg_proc as procedure_definition
       join pg_catalog.pg_namespace as namespace
         on namespace.oid = procedure_definition.pronamespace
       where namespace.nspname = 'private'
         and procedure_definition.proname = 'distribute_lead'
     ) <> 1 then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_unknown_contract',
      detail = 'private.distribute_lead must have exactly the canonical signature';
  end if;

  select
    language_definition.lanname,
    procedure_definition.prosecdef,
    procedure_definition.provolatile,
    procedure_definition.prorettype,
    procedure_definition.proconfig,
    pg_catalog.pg_get_userbyid(procedure_definition.proowner),
    procedure_definition.proargnames,
    procedure_definition.pronargdefaults,
    pg_catalog.lower(
      pg_catalog.pg_get_functiondef(procedure_definition.oid)
    )
  into
    v_language,
    v_is_security_definer,
    v_volatility,
    v_return_type,
    v_config,
    v_owner_name,
    v_argument_names,
    v_default_count,
    v_definition
  from pg_catalog.pg_proc as procedure_definition
  join pg_catalog.pg_language as language_definition
    on language_definition.oid = procedure_definition.prolang
  where procedure_definition.oid = v_distribution_proc;

  if v_language <> 'plpgsql'
     or v_is_security_definer is distinct from true
     or v_volatility <> 'v'
     or v_return_type <> 'jsonb'::regtype
     or not (
       coalesce(v_config, array[]::text[])
       @> array['search_path=""']::text[]
     )
     or v_owner_name <> current_user::name
     or v_argument_names <> array[
       'p_organization_id',
       'p_lead_id',
       'p_idempotency_key',
       'p_round_robin_id',
       'p_preserve_assignee',
       'p_source',
       'p_now'
     ]::text[]
     or v_default_count <> 4 then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_unknown_contract',
      detail = 'private.distribute_lead execution attributes diverged';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure_definition
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure_definition.proacl,
        pg_catalog.acldefault('f', procedure_definition.proowner)
      )
    ) as privilege_definition
    left join pg_catalog.pg_roles as grantee
      on grantee.oid = privilege_definition.grantee
    where procedure_definition.oid = v_distribution_proc
      and privilege_definition.privilege_type = 'EXECUTE'
      and privilege_definition.grantee <> procedure_definition.proowner
      and coalesce(grantee.rolname, 'PUBLIC') <> 'service_role'
  ) then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_unknown_contract',
      detail = 'private.distribute_lead has an unexpected EXECUTE grant';
  end if;

  foreach v_marker in array array[
    'for no key update',
    'private.lead_distribution_events',
    'on conflict (organization_id, idempotency_key) do nothing',
    'public.pick_round_robin_for_lead(p_lead_id)',
    'insert into public.assignments_log',
    'insert into public.round_robin_logs',
    '''canonical_round_robin''',
    '''distribution_deferred'''
  ]
  loop
    if pg_catalog.strpos(v_definition, v_marker) = 0 then
      raise exception using
        errcode = '55000',
        message = 'distribution_upgrade_unknown_contract',
        detail = pg_catalog.format(
          'private.distribute_lead is missing required marker: %s',
          v_marker
        );
    end if;
  end loop;

  if pg_catalog.strpos(v_definition, 'auth.uid') > 0
     or pg_catalog.strpos(v_definition, 'auth.role') > 0
     or pg_catalog.strpos(v_definition, 'request.jwt') > 0 then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_unknown_contract',
      detail = 'private.distribute_lead unexpectedly depends on request claims';
  end if;

  if pg_catalog.strpos(
       v_definition,
       'private.next_round_robin_ticket(v_queue.id)'
     ) > 0 then
    -- The current implementation is already installed. Require its complete
    -- ticket, IWRR and ledger audit contract before treating this as a no-op.
    foreach v_marker in array array[
      'from private.pick_round_robin_ticket_candidate(',
      '''queue_ticket_iwrr_v1''',
      'set distribution_ticket = v_ticket',
      'algorithm_version = ''queue_ticket_iwrr_v1''',
      'slot_count = v_candidate.slot_count',
      'candidate_position = v_candidate.slot_position',
      '''distribution_ticket'', v_ticket',
      '''recipient_position'', v_candidate.recipient_position'
    ]
    loop
      if pg_catalog.strpos(v_definition, v_marker) = 0 then
        raise exception using
          errcode = '55000',
          message = 'distribution_upgrade_unknown_contract',
          detail = pg_catalog.format(
            'ticket-based private.distribute_lead is missing marker: %s',
            v_marker
          );
      end if;
    end loop;
  else
    -- Only the known pre-ticket implementation is eligible for replacement.
    -- These markers cover the inline candidate CTE, count/weight ordering and
    -- the transactional queue/member counters removed by the ticket redesign.
    foreach v_marker in array array[
      'with expanded_candidates as (',
      'counted_candidates as (',
      'candidate.member_leads_count::numeric / candidate.weight::numeric',
      'candidate.user_leads_count',
      'set leads_count = coalesce(leads_count, 0) + 1',
      'set leads_distributed = coalesce(leads_distributed, 0) + 1',
      'current_position = v_candidate.candidate_position',
      'for update;'
    ]
    loop
      if pg_catalog.strpos(v_definition, v_marker) = 0 then
        raise exception using
          errcode = '55000',
          message = 'distribution_upgrade_unknown_contract',
          detail = pg_catalog.format(
            'pre-ticket private.distribute_lead is missing marker: %s',
            v_marker
          );
      end if;
    end loop;

    if pg_catalog.strpos(v_definition, 'queue_ticket_') > 0
       or pg_catalog.strpos(
            v_definition,
            'private.pick_round_robin_ticket_candidate'
          ) > 0 then
      raise exception using
        errcode = '55000',
        message = 'distribution_upgrade_unknown_contract',
        detail = 'a partially migrated distribution function was detected';
    end if;
  end if;
end
$distribution_upgrade_preflight$;

do $distribution_bridge_preflight$
declare
  v_bridge oid;
  v_argument_names text[];
  v_default_count smallint;
  v_return_type oid;
  v_owner name;
  v_language text;
  v_body text;
begin
  v_bridge := pg_catalog.to_regprocedure(
    'public.distribute_lead_from_backend(uuid,uuid,text,uuid,boolean,text,timestamp with time zone)'
  );

  if v_bridge is null
     or (
       select count(*)
       from pg_catalog.pg_proc as procedure_definition
       join pg_catalog.pg_namespace as namespace
         on namespace.oid = procedure_definition.pronamespace
       where namespace.nspname = 'public'
         and procedure_definition.proname =
             'distribute_lead_from_backend'
     ) <> 1 then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_unknown_contract',
      detail = 'public.distribute_lead_from_backend must have exactly the canonical signature';
  end if;

  select
    procedure_definition.proargnames,
    procedure_definition.pronargdefaults,
    procedure_definition.prorettype,
    pg_catalog.pg_get_userbyid(procedure_definition.proowner),
    language_definition.lanname,
    pg_catalog.regexp_replace(
      pg_catalog.lower(procedure_definition.prosrc),
      '\s+',
      '',
      'g'
    )
  into
    v_argument_names,
    v_default_count,
    v_return_type,
    v_owner,
    v_language,
    v_body
  from pg_catalog.pg_proc as procedure_definition
  join pg_catalog.pg_language as language_definition
    on language_definition.oid = procedure_definition.prolang
  where procedure_definition.oid = v_bridge;

  if v_argument_names <> array[
       'p_organization_id',
       'p_lead_id',
       'p_idempotency_key',
       'p_round_robin_id',
       'p_preserve_assignee',
       'p_source',
       'p_now'
     ]::text[]
     or v_default_count <> 4
     or v_return_type <> 'jsonb'::regtype
     or v_owner <> current_user::name
     or v_language <> 'sql'
     or v_body <>
        'selectprivate.distribute_lead(p_organization_id,p_lead_id,p_idempotency_key,p_round_robin_id,p_preserve_assignee,p_source,p_now);'
     or pg_catalog.strpos(v_body, 'auth.') > 0
     or pg_catalog.strpos(v_body, 'request.') > 0 then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_unknown_contract',
      detail = 'public.distribute_lead_from_backend has an unknown delegation contract';
  end if;
end
$distribution_bridge_preflight$;

-- Add audit fields only when absent, and reject same-named fields with a
-- different shape. All four are intentionally nullable: idempotent
-- already-assigned/no-queue outcomes do not reserve a queue ticket.
do $distribution_audit_columns$
declare
  v_column record;
  v_attribute record;
begin
  for v_column in
    select *
    from (
      values
        ('distribution_ticket'::name, 'bigint'::regtype, 'bigint'),
        ('algorithm_version'::name, 'text'::regtype, 'text'),
        ('slot_count'::name, 'bigint'::regtype, 'bigint'),
        ('candidate_position'::name, 'bigint'::regtype, 'bigint')
    ) as expected(column_name, type_oid, type_sql)
  loop
    select
      attribute.atttypid,
      attribute.attnotnull,
      attribute.atthasdef,
      attribute.attgenerated
    into v_attribute
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'private.lead_distribution_events'::regclass
      and attribute.attname = v_column.column_name
      and attribute.attnum > 0
      and not attribute.attisdropped;

    if not found then
      execute pg_catalog.format(
        'alter table private.lead_distribution_events add column %I %s',
        v_column.column_name,
        v_column.type_sql
      );
    elsif v_attribute.atttypid <> v_column.type_oid
          or v_attribute.attnotnull
          or v_attribute.atthasdef
          or v_attribute.attgenerated <> '' then
      raise exception using
        errcode = '55000',
        message = 'distribution_upgrade_unknown_contract',
        detail = pg_catalog.format(
          'private.lead_distribution_events.%I has an unexpected shape',
          v_column.column_name
        );
    end if;
  end loop;
end
$distribution_audit_columns$;

do $distribution_index_preflight$
declare
  v_index oid;
  v_definition text;
begin
  v_index := pg_catalog.to_regclass(
    'public.round_robin_logs_queue_member_user_idx'
  );

  if v_index is not null then
    select pg_catalog.lower(pg_catalog.pg_get_indexdef(index_definition.indexrelid))
    into v_definition
    from pg_catalog.pg_index as index_definition
    join pg_catalog.pg_class as relation
      on relation.oid = index_definition.indexrelid
    where index_definition.indexrelid = v_index
      and relation.relkind = 'i'
      and index_definition.indisvalid
      and index_definition.indisready
      and not index_definition.indisunique;

    if v_definition is null
       or pg_catalog.strpos(
            v_definition,
            'using btree (round_robin_id, member_id, assigned_user_id)'
          ) = 0
       or pg_catalog.strpos(v_definition, 'member_id is not null') = 0
       or pg_catalog.strpos(v_definition, 'assigned_user_id is not null') = 0 then
      raise exception using
        errcode = '55000',
        message = 'distribution_upgrade_unknown_contract',
        detail = 'round_robin_logs_queue_member_user_idx diverged';
    end if;
  end if;
end
$distribution_index_preflight$;

create index if not exists round_robin_logs_queue_member_user_idx
  on public.round_robin_logs (
    round_robin_id,
    member_id,
    assigned_user_id
  )
  where member_id is not null
    and assigned_user_id is not null;

do $distribution_latest_ticket_index_preflight$
declare
  v_index oid;
  v_definition text;
begin
  v_index := pg_catalog.to_regclass(
    'public.round_robin_logs_canonical_queue_latest_idx'
  );

  if v_index is not null then
    select pg_catalog.lower(pg_catalog.pg_get_indexdef(index_definition.indexrelid))
    into v_definition
    from pg_catalog.pg_index as index_definition
    join pg_catalog.pg_class as relation
      on relation.oid = index_definition.indexrelid
    where index_definition.indexrelid = v_index
      and relation.relkind = 'i'
      and index_definition.indisvalid
      and index_definition.indisready
      and not index_definition.indisunique;

    if v_definition is null
       or pg_catalog.strpos(
            v_definition,
            'using btree (organization_id, round_robin_id, created_at desc, id desc)'
          ) = 0
       or pg_catalog.strpos(
            v_definition,
            'reason = ''canonical_round_robin'''
          ) = 0 then
      raise exception using
        errcode = '55000',
        message = 'distribution_upgrade_unknown_contract',
        detail = 'round_robin_logs_canonical_queue_latest_idx diverged';
    end if;
  end if;
end
$distribution_latest_ticket_index_preflight$;

create index if not exists round_robin_logs_canonical_queue_latest_idx
  on public.round_robin_logs (
    organization_id,
    round_robin_id,
    created_at desc,
    id desc
  )
  where reason = 'canonical_round_robin';

-- Keep weighted execution bounded. The write is a no-op on already normalized
-- databases and lets ALTER COLUMN SET NOT NULL succeed on older installations.
do $distribution_weight_preflight$
declare
  v_type oid;
  v_constraint_definition text;
  v_constraint_validated boolean;
begin
  select attribute.atttypid
  into v_type
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'public.round_robin_members'::regclass
    and attribute.attname = 'weight'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if v_type is distinct from 'integer'::regtype then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_unknown_contract',
      detail = 'public.round_robin_members.weight is not integer';
  end if;

  select
    pg_catalog.pg_get_constraintdef(constraint_definition.oid, true),
    constraint_definition.convalidated
  into
    v_constraint_definition,
    v_constraint_validated
  from pg_catalog.pg_constraint as constraint_definition
  where constraint_definition.conrelid =
        'public.round_robin_members'::regclass
    and constraint_definition.conname =
        'round_robin_members_weight_check';

  if found
     and (
       v_constraint_validated is distinct from true
       or v_constraint_definition <>
          'CHECK (weight >= 1 AND weight <= 1000)'
     ) then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_unknown_contract',
      detail = 'round_robin_members_weight_check diverged';
  end if;
end
$distribution_weight_preflight$;

update public.round_robin_members
set weight = least(
  greatest(coalesce(weight, 1), 1),
  1000
)
where weight is null
   or weight < 1
   or weight > 1000;

alter table public.round_robin_members
  alter column weight set default 1,
  alter column weight set not null;

do $distribution_weight_constraint$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_definition
    where constraint_definition.conrelid =
          'public.round_robin_members'::regclass
      and constraint_definition.conname =
          'round_robin_members_weight_check'
  ) then
    alter table public.round_robin_members
      add constraint round_robin_members_weight_check
      check (weight between 1 and 1000);
  end if;
end
$distribution_weight_constraint$;

-- Existing helper functions are never overwritten blindly. Their execution
-- attributes and defining invariants must match the current contract; absent
-- helpers are installed below.
do $distribution_helper_preflight$
declare
  v_expected record;
  v_proc oid;
  v_language text;
  v_is_security_definer boolean;
  v_volatility text;
  v_is_strict boolean;
  v_config text[];
  v_definition text;
  v_marker text;
  v_owner_name name;
begin
  for v_expected in
    select *
    from (
      values
        (
          'private.round_robin_ticket_sequence_name(uuid)',
          'sql',
          false,
          'i',
          true,
          array[
            'lead_distribution_ticket_',
            'pg_catalog.replace(p_round_robin_id::text'
          ]::text[]
        ),
        (
          'private.ensure_round_robin_ticket_sequence(uuid)',
          'plpgsql',
          true,
          'v',
          false,
          array[
            'pg_catalog.pg_advisory_xact_lock',
            'create sequence private.%i as bigint start with %s',
            'relation.relkind = ''s''',
            'sum(coalesce(member.leads_count, 0))',
            'public.round_robin_logs',
            'metadata->>''distribution_ticket''',
            'private.lead_distribution_events',
            '''canonical_round_robin''',
            'revoke all on sequence private.%i'
          ]::text[]
        ),
        (
          'private.next_round_robin_ticket(uuid)',
          'plpgsql',
          true,
          'v',
          false,
          array[
            'private.ensure_round_robin_ticket_sequence(p_round_robin_id)',
            'pg_catalog.nextval(v_sequence)'
          ]::text[]
        ),
        (
          'private.pick_round_robin_ticket_candidate(uuid,uuid,text,boolean,integer,time without time zone,bigint)',
          'sql',
          true,
          's',
          false,
          array[
            'with expanded_candidates as (',
            'availability_filtered_candidates as (',
            'from availability_filtered_candidates as available',
            'ranked_recipients as (',
            'ticket_state as (',
            'chosen_interval as (',
            'rank_in_round',
            'prior_entry_occurrences',
            'entry.effective_weight >= state.selected_round',
            'public.member_availability'
          ]::text[]
        ),
        (
          'private.create_round_robin_ticket_sequence()',
          'plpgsql',
          true,
          'v',
          false,
          array[
            'returns trigger',
            'private.ensure_round_robin_ticket_sequence(new.id)'
          ]::text[]
        ),
        (
          'private.cleanup_orphan_round_robin_ticket_sequences()',
          'plpgsql',
          true,
          'v',
          false,
          array[
            'lead_distribution_ticket_%',
            '^lead_distribution_ticket_[0-9a-f]{32}$',
            'relation.relkind = ''s''',
            'private.round_robin_ticket_sequence_name(queue.id)',
            'drop sequence if exists private.%i',
            'limit 100'
          ]::text[]
        )
    ) as expected(
      signature,
      language_name,
      security_definer,
      volatility,
      is_strict,
      markers
    )
  loop
    v_proc := pg_catalog.to_regprocedure(v_expected.signature);
    if v_proc is null then
      continue;
    end if;

    select
      language_definition.lanname,
      procedure_definition.prosecdef,
      procedure_definition.provolatile::text,
      procedure_definition.proisstrict,
      procedure_definition.proconfig,
      pg_catalog.pg_get_userbyid(procedure_definition.proowner),
      pg_catalog.lower(
        pg_catalog.pg_get_functiondef(procedure_definition.oid)
      )
    into
      v_language,
      v_is_security_definer,
      v_volatility,
      v_is_strict,
      v_config,
      v_owner_name,
      v_definition
    from pg_catalog.pg_proc as procedure_definition
    join pg_catalog.pg_language as language_definition
      on language_definition.oid = procedure_definition.prolang
    where procedure_definition.oid = v_proc;

    if v_language <> v_expected.language_name
       or v_is_security_definer is distinct from
          v_expected.security_definer
       or v_volatility <> v_expected.volatility
       or v_is_strict is distinct from v_expected.is_strict
       or not (
         coalesce(v_config, array[]::text[])
         @> array['search_path=""']::text[]
       )
       or v_owner_name <> current_user::name then
      raise exception using
        errcode = '55000',
        message = 'distribution_upgrade_unknown_contract',
        detail = pg_catalog.format(
          '%s execution attributes diverged',
          v_expected.signature
        );
    end if;

    if exists (
      select 1
      from pg_catalog.pg_proc as procedure_definition
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          procedure_definition.proacl,
          pg_catalog.acldefault('f', procedure_definition.proowner)
        )
      ) as privilege_definition
      left join pg_catalog.pg_roles as grantee
        on grantee.oid = privilege_definition.grantee
      where procedure_definition.oid = v_proc
        and privilege_definition.privilege_type = 'EXECUTE'
        and privilege_definition.grantee <> procedure_definition.proowner
        and coalesce(grantee.rolname, 'PUBLIC') not in (
          'PUBLIC',
          'anon',
          'authenticated',
          'service_role'
        )
    ) then
      raise exception using
        errcode = '55000',
        message = 'distribution_upgrade_unknown_contract',
        detail = pg_catalog.format(
          '%s has an unexpected EXECUTE grant',
          v_expected.signature
        );
    end if;

    foreach v_marker in array v_expected.markers
    loop
      if pg_catalog.strpos(v_definition, v_marker) = 0 then
        raise exception using
          errcode = '55000',
          message = 'distribution_upgrade_unknown_contract',
          detail = pg_catalog.format(
            '%s is missing marker: %s',
            v_expected.signature,
            v_marker
          );
      end if;
    end loop;

    if v_expected.signature like
         'private.pick_round_robin_ticket_candidate(%'
       and pg_catalog.strpos(v_definition, 'generate_series') > 0 then
      raise exception using
        errcode = '55000',
        message = 'distribution_upgrade_unknown_contract',
        detail = 'the IWRR picker must not materialize weighted rows';
    end if;
  end loop;
end
$distribution_helper_preflight$;

do $install_distribution_ticket_sequence_helpers$
begin
  if pg_catalog.to_regprocedure(
       'private.round_robin_ticket_sequence_name(uuid)'
     ) is null then
    execute $function$
      create function private.round_robin_ticket_sequence_name(
        p_round_robin_id uuid
      )
      returns name
      language sql
      immutable
      strict
      set search_path = ''
      as $body$
        select (
          'lead_distribution_ticket_'
          || pg_catalog.replace(p_round_robin_id::text, '-', '')
        )::name
      $body$
    $function$;
  end if;

  if pg_catalog.to_regprocedure(
       'private.ensure_round_robin_ticket_sequence(uuid)'
     ) is null then
    execute $function$
      create function private.ensure_round_robin_ticket_sequence(
        p_round_robin_id uuid
      )
      returns regclass
      language plpgsql
      security definer
      set search_path = ''
      as $body$
      declare
        v_name name;
        v_sequence regclass;
        v_start bigint;
      begin
        if p_round_robin_id is null then
          raise exception using
            errcode = '22023',
            message = 'round_robin_id_required';
        end if;

        v_name := private.round_robin_ticket_sequence_name(p_round_robin_id);
        v_sequence := pg_catalog.to_regclass(
          pg_catalog.format('private.%I', v_name)
        );
        if v_sequence is not null then
          perform 1
          from pg_catalog.pg_class as relation
          where relation.oid = v_sequence
            and relation.relkind = 'S';
          if not found then
            raise exception using
              errcode = '42809',
              message = 'round_robin_ticket_object_is_not_sequence';
          end if;
          execute pg_catalog.format(
            'revoke all on sequence private.%I from public, anon, authenticated, service_role',
            v_name
          );
          return v_sequence;
        end if;

        perform pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(
            'lead-distribution-ticket:' || p_round_robin_id::text,
            0
          )
        );

        v_sequence := pg_catalog.to_regclass(
          pg_catalog.format('private.%I', v_name)
        );
        if v_sequence is not null then
          perform 1
          from pg_catalog.pg_class as relation
          where relation.oid = v_sequence
            and relation.relkind = 'S';
          if not found then
            raise exception using
              errcode = '42809',
              message = 'round_robin_ticket_object_is_not_sequence';
          end if;
          execute pg_catalog.format(
            'revoke all on sequence private.%I from public, anon, authenticated, service_role',
            v_name
          );
          return v_sequence;
        end if;

        select greatest(
          coalesce(queue.leads_distributed, 0)::bigint,
          coalesce(
            (
              select sum(coalesce(member.leads_count, 0))::bigint
              from public.round_robin_members as member
              where member.round_robin_id = p_round_robin_id
            ),
            0
          ),
          (
            select count(*)::bigint
            from public.round_robin_logs as distribution_log
            where distribution_log.round_robin_id = p_round_robin_id
              and distribution_log.reason = 'canonical_round_robin'
          ),
          coalesce(
            (
              select max(
                (distribution_log.metadata->>'distribution_ticket')::bigint
              )
              from public.round_robin_logs as distribution_log
              where distribution_log.round_robin_id = p_round_robin_id
                and distribution_log.metadata->>'distribution_ticket'
                  ~ '^[0-9]+$'
            ),
            0
          ),
          coalesce(
            (
              select max(distribution_event.distribution_ticket)
              from private.lead_distribution_events as distribution_event
              where distribution_event.round_robin_id = p_round_robin_id
            ),
            0
          )
        ) + 1
        into v_start
        from public.round_robins as queue
        where queue.id = p_round_robin_id;

        if not found then
          raise exception using
            errcode = '23503',
            message = 'round_robin_not_found';
        end if;

        execute pg_catalog.format(
          'create sequence private.%I as bigint start with %s',
          v_name,
          v_start
        );
        execute pg_catalog.format(
          'revoke all on sequence private.%I from public, anon, authenticated, service_role',
          v_name
        );

        return pg_catalog.to_regclass(
          pg_catalog.format('private.%I', v_name)
        );
      end
      $body$
    $function$;
  end if;

  if pg_catalog.to_regprocedure(
       'private.next_round_robin_ticket(uuid)'
     ) is null then
    execute $function$
      create function private.next_round_robin_ticket(
        p_round_robin_id uuid
      )
      returns bigint
      language plpgsql
      volatile
      security definer
      set search_path = ''
      as $body$
      declare
        v_sequence regclass;
      begin
        v_sequence :=
          private.ensure_round_robin_ticket_sequence(p_round_robin_id);
        return pg_catalog.nextval(v_sequence);
      end
      $body$
    $function$;
  end if;
end
$install_distribution_ticket_sequence_helpers$;

do $install_distribution_iwrr_picker$
begin
  if pg_catalog.to_regprocedure(
       'private.pick_round_robin_ticket_candidate(uuid,uuid,text,boolean,integer,time without time zone,bigint)'
     ) is null then
    execute $function$
      create function private.pick_round_robin_ticket_candidate(
        p_organization_id uuid,
        p_round_robin_id uuid,
        p_strategy text,
        p_ignore_availability boolean,
        p_current_day integer,
        p_current_time time without time zone,
        p_ticket bigint
      )
      returns table (
        member_id uuid,
        user_id uuid,
        team_id uuid,
        team_member_id uuid,
        user_name text,
        slot_position bigint,
        slot_count bigint,
        recipient_position bigint,
        recipient_count bigint,
        availability_reason text
      )
      language sql
      stable
      security definer
      set search_path = ''
      as $body$
        with expanded_candidates as (
          -- Direct queue entries. When a team is explicitly attached to the
          -- direct user, membership in that exact team remains mandatory.
          select
            member.id as member_id,
            member.user_id,
            member.team_id,
            team_member.id as team_member_id,
            member.position,
            least(greatest(member.weight, 1), 1000) as weight,
            account.name as user_name,
            0 as candidate_kind,
            coalesce(
              team_member.created_at,
              member.created_at
            ) as candidate_created_at
          from public.round_robin_members as member
          join public.users as account
            on account.id = member.user_id
           and account.organization_id = p_organization_id
           and coalesce(account.is_active, true) = true
          left join public.teams as team
            on team.id = member.team_id
           and team.organization_id = p_organization_id
           and coalesce(team.is_active, true) = true
          left join public.team_members as team_member
            on team_member.team_id = member.team_id
           and team_member.user_id = member.user_id
           and team_member.organization_id = p_organization_id
           and coalesce(team_member.is_active, true) = true
          where member.round_robin_id = p_round_robin_id
            and member.organization_id = p_organization_id
            and member.user_id is not null
            and coalesce(member.is_active, true) = true
            and (
              member.team_id is null
              or (team.id is not null and team_member.id is not null)
            )
            and exists (
              select 1
              from public.organization_members as organization_member
              where organization_member.organization_id = p_organization_id
                and organization_member.user_id = member.user_id
                and organization_member.is_active = true
            )

          union all

          -- Team entries expand only to choose the recipient inside the entry.
          -- The queue-entry weight is applied once after this expansion.
          select
            member.id as member_id,
            team_member.user_id,
            member.team_id,
            team_member.id as team_member_id,
            member.position,
            least(greatest(member.weight, 1), 1000) as weight,
            account.name as user_name,
            1 as candidate_kind,
            team_member.created_at as candidate_created_at
          from public.round_robin_members as member
          join public.teams as team
            on team.id = member.team_id
           and team.organization_id = p_organization_id
           and coalesce(team.is_active, true) = true
          join public.team_members as team_member
            on team_member.team_id = team.id
           and team_member.organization_id = p_organization_id
           and coalesce(team_member.is_active, true) = true
          join public.users as account
            on account.id = team_member.user_id
           and account.organization_id = p_organization_id
           and coalesce(account.is_active, true) = true
          where member.round_robin_id = p_round_robin_id
            and member.organization_id = p_organization_id
            and member.user_id is null
            and member.team_id is not null
            and coalesce(member.is_active, true) = true
            and exists (
              select 1
              from public.organization_members as organization_member
              where organization_member.organization_id = p_organization_id
                and organization_member.user_id = team_member.user_id
                and organization_member.is_active = true
            )
        ),
        availability_filtered_candidates as (
          select candidate.*
          from expanded_candidates as candidate
          where p_ignore_availability
             or candidate.team_member_id is null
             or not exists (
               select 1
               from public.member_availability as availability
               where availability.organization_id = p_organization_id
                 and availability.team_member_id = candidate.team_member_id
                 and coalesce(availability.is_active, true) = true
             )
             or exists (
               select 1
               from public.member_availability as availability
               where availability.organization_id = p_organization_id
                 and availability.team_member_id = candidate.team_member_id
                 and availability.day_of_week = p_current_day
                 and coalesce(availability.is_active, true) = true
                 and (
                   coalesce(availability.is_all_day, false) = true
                   or (
                     availability.start_time is not null
                     and availability.end_time is not null
                     and (
                       (
                         availability.start_time <= availability.end_time
                         and p_current_time between
                           availability.start_time
                           and availability.end_time
                       )
                       or (
                         availability.start_time > availability.end_time
                         and (
                           p_current_time >= availability.start_time
                           or p_current_time <= availability.end_time
                         )
                       )
                     )
                   )
                 )
             )
        ),
        deduplicated_candidates as (
          select candidate.*
          from (
            select
              available.*,
              row_number() over (
                partition by available.user_id
                order by
                  available.candidate_kind,
                  available.position,
                  available.candidate_created_at,
                  available.member_id,
                  available.team_member_id nulls last
              ) as duplicate_rank
            from availability_filtered_candidates as available
          ) as candidate
          where candidate.duplicate_rank = 1
        ),
        ranked_recipients as (
          select
            candidate.*,
            row_number() over (
              partition by candidate.member_id
              order by
                candidate.candidate_kind,
                candidate.candidate_created_at,
                candidate.user_id,
                candidate.team_member_id nulls last
            )::bigint as recipient_position,
            count(*) over (
              partition by candidate.member_id
            )::bigint as recipient_count
          from deduplicated_candidates as candidate
        ),
        entries as (
          select
            recipient.member_id,
            min(recipient.position)::integer as position,
            max(
              case
                when lower(coalesce(p_strategy, 'simple')) = 'weighted'
                  then recipient.weight
                else 1
              end
            )::bigint as effective_weight
          from ranked_recipients as recipient
          group by recipient.member_id
        ),
        ticket_state as (
          select
            total.total_weight as slot_count,
            (
              pg_catalog.mod(p_ticket - 1, total.total_weight) + 1
            )::bigint as slot_position,
            ((p_ticket - 1) / total.total_weight)::bigint
              as completed_cycles
          from (
            select sum(entry.effective_weight)::bigint as total_weight
            from entries as entry
          ) as total
          where total.total_weight > 0
        ),
        weight_groups as (
          select
            entry.effective_weight,
            count(*)::bigint as entry_count
          from entries as entry
          group by entry.effective_weight
        ),
        interval_seed as (
          select
            weight_group.*,
            lag(
              weight_group.effective_weight,
              1,
              0::bigint
            ) over (
              order by weight_group.effective_weight
            ) as previous_round,
            coalesce(
              sum(
                weight_group.effective_weight * weight_group.entry_count
              ) over (
                order by weight_group.effective_weight
                rows between unbounded preceding and 1 preceding
              ),
              0
            )::bigint as saturated_slots,
            sum(weight_group.entry_count) over (
              order by weight_group.effective_weight
              rows between current row and unbounded following
            )::bigint as active_entries
          from weight_groups as weight_group
        ),
        intervals as (
          select
            seed.*,
            ticket.*,
            (
              seed.saturated_slots
              + seed.previous_round * seed.active_entries
            )::bigint as slots_before,
            (
              seed.saturated_slots
              + seed.effective_weight * seed.active_entries
            )::bigint as slots_through
          from interval_seed as seed
          cross join ticket_state as ticket
        ),
        chosen_interval as (
          select
            interval.*,
            (
              interval.previous_round
              + (
                interval.slot_position
                - interval.slots_before
                + interval.active_entries
                - 1
              ) / interval.active_entries
            )::bigint as selected_round
          from intervals as interval
          where interval.slot_position > interval.slots_before
            and interval.slot_position <= interval.slots_through
        ),
        round_state as (
          select
            interval.*,
            (
              interval.slot_position
              - (
                interval.saturated_slots
                + (
                  interval.selected_round - 1
                ) * interval.active_entries
              )
            )::bigint as rank_in_round
          from chosen_interval as interval
        ),
        round_entries as (
          select
            entry.*,
            state.slot_position,
            state.slot_count,
            state.completed_cycles,
            state.selected_round,
            state.rank_in_round,
            row_number() over (
              order by entry.position, entry.member_id
            )::bigint as entry_rank
          from entries as entry
          cross join round_state as state
          where entry.effective_weight >= state.selected_round
        ),
        selected_entry as (
          select
            entry.*,
            (
              entry.completed_cycles * entry.effective_weight
              + entry.selected_round
              - 1
            )::bigint as prior_entry_occurrences
          from round_entries as entry
          where entry.entry_rank = entry.rank_in_round
        )
        select
          recipient.member_id,
          recipient.user_id,
          recipient.team_id,
          recipient.team_member_id,
          recipient.user_name,
          entry.slot_position,
          entry.slot_count,
          recipient.recipient_position,
          recipient.recipient_count,
          case
            when p_ignore_availability
              then 'queue_ignores_availability'
            when recipient.team_member_id is null
              then 'no_team_schedule'
            else 'available'
          end as availability_reason
        from selected_entry as entry
        join ranked_recipients as recipient
          on recipient.member_id = entry.member_id
         and recipient.recipient_position =
           pg_catalog.mod(
             entry.prior_entry_occurrences,
             recipient.recipient_count
           ) + 1
        limit 1
      $body$
    $function$;
  end if;
end
$install_distribution_iwrr_picker$;

do $install_distribution_ticket_lifecycle_helpers$
begin
  if pg_catalog.to_regprocedure(
       'private.create_round_robin_ticket_sequence()'
     ) is null then
    execute $function$
      create function private.create_round_robin_ticket_sequence()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $body$
      begin
        perform private.ensure_round_robin_ticket_sequence(new.id);
        return new;
      end
      $body$
    $function$;
  end if;

  if pg_catalog.to_regprocedure(
       'private.cleanup_orphan_round_robin_ticket_sequences()'
     ) is null then
    execute $function$
      create function private.cleanup_orphan_round_robin_ticket_sequences()
      returns integer
      language plpgsql
      security definer
      set search_path = ''
      as $body$
      declare
        v_sequence record;
        v_removed integer := 0;
      begin
        for v_sequence in
          select relation.relname
          from pg_catalog.pg_class as relation
          join pg_catalog.pg_namespace as namespace
            on namespace.oid = relation.relnamespace
          where namespace.nspname = 'private'
            and relation.relkind = 'S'
            and relation.relname like 'lead_distribution_ticket_%'
            and relation.relname
              ~ '^lead_distribution_ticket_[0-9a-f]{32}$'
            and not exists (
              select 1
              from public.round_robins as queue
              where private.round_robin_ticket_sequence_name(queue.id)
                = relation.relname::name
            )
          order by relation.relname
          limit 100
        loop
          execute pg_catalog.format(
            'drop sequence if exists private.%I',
            v_sequence.relname
          );
          v_removed := v_removed + 1;
        end loop;

        return v_removed;
      end
      $body$
    $function$;
  end if;
end
$install_distribution_ticket_lifecycle_helpers$;

revoke all on function private.round_robin_ticket_sequence_name(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.ensure_round_robin_ticket_sequence(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.next_round_robin_ticket(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.pick_round_robin_ticket_candidate(
  uuid,
  uuid,
  text,
  boolean,
  integer,
  time without time zone,
  bigint
) from public, anon, authenticated, service_role;
revoke all on function private.create_round_robin_ticket_sequence()
  from public, anon, authenticated, service_role;
revoke all on function private.cleanup_orphan_round_robin_ticket_sequences()
  from public, anon, authenticated, service_role;

do $distribution_ticket_trigger$
declare
  v_trigger_definition text;
  v_trigger_enabled "char";
begin
  select
    pg_catalog.lower(
      pg_catalog.pg_get_triggerdef(trigger_definition.oid, true)
    ),
    trigger_definition.tgenabled
  into
    v_trigger_definition,
    v_trigger_enabled
  from pg_catalog.pg_trigger as trigger_definition
  where trigger_definition.tgrelid = 'public.round_robins'::regclass
    and trigger_definition.tgname =
        'round_robins_create_distribution_ticket'
    and not trigger_definition.tgisinternal;

  if found then
    if v_trigger_enabled <> 'O'
       or pg_catalog.strpos(
            v_trigger_definition,
            'after insert on round_robins'
          ) = 0
       or pg_catalog.strpos(
            v_trigger_definition,
            'for each row execute function private.create_round_robin_ticket_sequence()'
          ) = 0 then
      raise exception using
        errcode = '55000',
        message = 'distribution_upgrade_unknown_contract',
        detail = 'round_robins_create_distribution_ticket diverged';
    end if;
  else
    create trigger round_robins_create_distribution_ticket
    after insert on public.round_robins
    for each row
    execute function private.create_round_robin_ticket_sequence();
  end if;
end
$distribution_ticket_trigger$;

-- Reconcile all queue-local sequence objects before the function cutover.
-- Existing objects with the reserved name must really be sequences.
do $distribution_ticket_backfill$
declare
  v_round_robin_id uuid;
  v_sequence_name name;
  v_relation oid;
  v_relation_kind "char";
  v_relation_owner name;
begin
  for v_round_robin_id in
    select queue.id
    from public.round_robins as queue
    order by queue.id
  loop
    v_sequence_name :=
      private.round_robin_ticket_sequence_name(v_round_robin_id);
    v_relation := pg_catalog.to_regclass(
      pg_catalog.format('private.%I', v_sequence_name)
    );

    if v_relation is not null then
      select
        relation.relkind,
        pg_catalog.pg_get_userbyid(relation.relowner)
      into
        v_relation_kind,
        v_relation_owner
      from pg_catalog.pg_class as relation
      where relation.oid = v_relation;

      if v_relation_kind <> 'S'
         or v_relation_owner <> current_user::name then
        raise exception using
          errcode = '55000',
          message = 'distribution_upgrade_unknown_contract',
          detail = pg_catalog.format(
            'private.%I has an unexpected relation kind or owner',
            v_sequence_name
          );
      end if;

      if exists (
        select 1
        from pg_catalog.pg_class as relation
        cross join lateral pg_catalog.aclexplode(
          coalesce(
            relation.relacl,
            pg_catalog.acldefault('S', relation.relowner)
          )
        ) as privilege_definition
        left join pg_catalog.pg_roles as grantee
          on grantee.oid = privilege_definition.grantee
        where relation.oid = v_relation
          and privilege_definition.grantee <> relation.relowner
          and coalesce(grantee.rolname, 'PUBLIC') not in (
            'PUBLIC',
            'anon',
            'authenticated',
            'service_role'
          )
      ) then
        raise exception using
          errcode = '55000',
          message = 'distribution_upgrade_unknown_contract',
          detail = pg_catalog.format(
            'private.%I has an unexpected grant',
            v_sequence_name
          );
      end if;
    end if;

    v_relation :=
      private.ensure_round_robin_ticket_sequence(v_round_robin_id);

    execute pg_catalog.format(
      'revoke all on sequence private.%I from public, anon, authenticated, service_role',
      v_sequence_name
    );
  end loop;
end
$distribution_ticket_backfill$;

do $distribution_ticket_cleanup_job$
declare
  v_job_count integer;
  v_schedule text;
  v_command text;
  v_active boolean;
begin
  if pg_catalog.to_regclass('cron.job') is null
     or pg_catalog.to_regprocedure(
          'cron.schedule(text,text,text)'
        ) is null then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_missing_dependency',
      detail = 'pg_cron schedule support is required';
  end if;

  select
    count(*)::integer,
    min(job.schedule),
    min(
      pg_catalog.btrim(
        pg_catalog.regexp_replace(job.command, '\s+', ' ', 'g')
      )
    ),
    bool_and(job.active)
  into
    v_job_count,
    v_schedule,
    v_command,
    v_active
  from cron.job as job
  where job.jobname = 'cleanup-round-robin-ticket-sequences';

  if v_job_count > 1 then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_unknown_contract',
      detail = 'duplicate cleanup-round-robin-ticket-sequences cron jobs';
  elsif v_job_count = 1 then
    if v_schedule <> '31 3 * * *'
       or v_command <>
          'select private.cleanup_orphan_round_robin_ticket_sequences();'
       or v_active is distinct from true then
      raise exception using
        errcode = '55000',
        message = 'distribution_upgrade_unknown_contract',
        detail = 'cleanup-round-robin-ticket-sequences cron job diverged';
    end if;
  else
    perform cron.schedule(
      'cleanup-round-robin-ticket-sequences',
      '31 3 * * *',
      'select private.cleanup_orphan_round_robin_ticket_sequences();'
    );
  end if;
end
$distribution_ticket_cleanup_job$;

-- Replace only the known pre-ticket body. A fresh/current function keeps its
-- OID, owner, ACL and definition untouched.
do $upgrade_canonical_distribution_function$
declare
  v_definition text;
begin
  select pg_catalog.lower(
    pg_catalog.pg_get_functiondef(procedure_definition.oid)
  )
  into v_definition
  from pg_catalog.pg_proc as procedure_definition
  where procedure_definition.oid = pg_catalog.to_regprocedure(
    'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamp with time zone)'
  );

  if pg_catalog.strpos(
       v_definition,
       'private.next_round_robin_ticket(v_queue.id)'
     ) = 0 then
    execute $canonical_function$
      create or replace function private.distribute_lead(
        p_organization_id uuid,
        p_lead_id uuid,
        p_idempotency_key text,
        p_round_robin_id uuid default null,
        p_preserve_assignee boolean default true,
        p_source text default null,
        p_now timestamptz default clock_timestamp()
      )
      returns jsonb
      language plpgsql
      security definer
      set search_path = ''
      as $body$
      declare
        v_lead public.leads%rowtype;
        v_queue public.round_robins%rowtype;
        v_existing_event private.lead_distribution_events%rowtype;
        v_event_id uuid;
        v_queue_id uuid;
        v_source text;
        v_source_label text;
        v_timezone text;
        v_local_now timestamp without time zone;
        v_current_day integer;
        v_current_time time without time zone;
        v_ignore_availability boolean;
        v_candidate record;
        v_previous_assigned_user_id uuid;
        v_target_pipeline_id uuid;
        v_target_stage_id uuid;
        v_ticket bigint;
        v_result jsonb;
      begin
        p_now := coalesce(p_now, clock_timestamp());

        if p_organization_id is null
           or p_lead_id is null
           or p_idempotency_key is null
           or length(btrim(p_idempotency_key)) not between 1 and 200
           or p_idempotency_key <> btrim(p_idempotency_key) then
          raise exception using
            errcode = '22023',
            message = 'invalid_distribution_request';
        end if;

        -- Keep foreign-key updates independent while serializing lifecycle
        -- changes for this lead.
        select lead.*
        into v_lead
        from public.leads as lead
        where lead.id = p_lead_id
          and lead.organization_id = p_organization_id
        for no key update;

        if not found then
          return jsonb_build_object(
            'success', false,
            'reason', 'lead_not_found',
            'lead_id', p_lead_id
          );
        end if;

        select event.*
        into v_existing_event
        from private.lead_distribution_events as event
        where event.organization_id = p_organization_id
          and event.idempotency_key = p_idempotency_key;

        if found then
          if v_existing_event.lead_id <> p_lead_id then
            return jsonb_build_object(
              'success', false,
              'reason', 'idempotency_key_conflict',
              'lead_id', p_lead_id
            );
          end if;

          update public.leads
          set metadata =
            coalesce(metadata, '{}'::jsonb) - 'distribution_deferred'
          where id = p_lead_id
            and organization_id = p_organization_id
            and metadata ? 'distribution_deferred';

          return v_existing_event.result;
        end if;

        v_source := private.normalize_lead_distribution_source(
          coalesce(p_source, v_lead.source)
        );

        v_source_label := case v_source
          when 'meta' then 'Meta Ads'
          when 'whatsapp' then 'WhatsApp'
          when 'webhook' then 'Webhook'
          when 'site' then 'Site'
          when 'manual' then 'Manual'
          else initcap(replace(v_source, '_', ' '))
        end;

        insert into private.lead_distribution_events (
          organization_id,
          lead_id,
          idempotency_key,
          requested_round_robin_id,
          source
        )
        values (
          p_organization_id,
          p_lead_id,
          p_idempotency_key,
          case
            when exists (
              select 1
              from public.round_robins as requested_queue
              where requested_queue.id = p_round_robin_id
                and requested_queue.organization_id = p_organization_id
            ) then p_round_robin_id
            else null
          end,
          v_source
        )
        on conflict (organization_id, idempotency_key) do nothing
        returning id into v_event_id;

        -- The unique ledger key resolves concurrent retries.
        if v_event_id is null then
          select event.*
          into v_existing_event
          from private.lead_distribution_events as event
          where event.organization_id = p_organization_id
            and event.idempotency_key = p_idempotency_key;

          if v_existing_event.lead_id <> p_lead_id then
            return jsonb_build_object(
              'success', false,
              'reason', 'idempotency_key_conflict',
              'lead_id', p_lead_id
            );
          end if;

          return v_existing_event.result;
        end if;

        -- Unexpected exceptions roll this back, leaving an explicit retry
        -- marker instead of falling through to legacy distribution.
        update public.leads
        set metadata =
          coalesce(metadata, '{}'::jsonb) - 'distribution_deferred'
        where id = p_lead_id
          and organization_id = p_organization_id
          and metadata ? 'distribution_deferred';

        insert into public.lead_timeline_events (
          organization_id,
          lead_id,
          event_type,
          title,
          description,
          metadata,
          event_at
        )
        select
          p_organization_id,
          p_lead_id,
          'lead_created',
          'Lead criado',
          'Lead recebido no sistema',
          jsonb_build_object(
            'source', v_source,
            'source_label', v_source_label,
            'distribution_event_id', v_event_id
          ),
          p_now
        where not exists (
          select 1
          from public.lead_timeline_events as timeline
          where timeline.organization_id = p_organization_id
            and timeline.lead_id = p_lead_id
            and timeline.event_type = 'lead_created'
        );

        if coalesce(p_preserve_assignee, true)
           and v_lead.assigned_user_id is not null then
          v_result := jsonb_build_object(
            'success', true,
            'reason', 'already_assigned',
            'lead_id', p_lead_id,
            'assigned_user_id', v_lead.assigned_user_id,
            'team_id', v_lead.team_id,
            'pipeline_id', v_lead.pipeline_id,
            'stage_id', v_lead.stage_id,
            'source', v_source,
            'distribution_event_id', v_event_id
          );

          update private.lead_distribution_events
          set assigned_user_id = v_lead.assigned_user_id,
              team_id = v_lead.team_id,
              outcome = 'already_assigned',
              result = v_result,
              completed_at = p_now
          where id = v_event_id;

          return v_result;
        end if;

        if p_round_robin_id is not null then
          v_queue_id := p_round_robin_id;
        else
          -- Explicit rules win. Pipeline default is only the fallback.
          v_queue_id := public.pick_round_robin_for_lead(p_lead_id);

          if v_queue_id is null then
            select pipeline.default_round_robin_id
            into v_queue_id
            from public.pipelines as pipeline
            where pipeline.id = v_lead.pipeline_id
              and pipeline.organization_id = p_organization_id
              and coalesce(pipeline.is_active, true) = true;
          end if;
        end if;

        -- A queue-local sequence reserves the slot without a hot queue lock.
        select queue.*
        into v_queue
        from public.round_robins as queue
        where queue.id = v_queue_id
          and queue.organization_id = p_organization_id
          and coalesce(queue.is_active, true) = true;

        if not found then
          insert into public.round_robin_logs (
            organization_id,
            lead_id,
            reason,
            metadata
          )
          values (
            p_organization_id,
            p_lead_id,
            'no_matching_queue',
            jsonb_build_object(
              'source', v_source,
              'distribution_event_id', v_event_id
            )
          );

          insert into public.lead_timeline_events (
            organization_id,
            lead_id,
            event_type,
            title,
            description,
            metadata,
            event_at
          )
          values (
            p_organization_id,
            p_lead_id,
            'lead_distribution_pending',
            'Aguardando distribuição',
            'Nenhuma fila de distribuição ativa foi encontrada.',
            jsonb_build_object(
              'destination', 'pool',
              'reason', 'no_matching_queue',
              'source', v_source,
              'distribution_event_id', v_event_id
            ),
            p_now
          );

          v_result := jsonb_build_object(
            'success', false,
            'reason', 'no_matching_queue',
            'lead_id', p_lead_id,
            'source', v_source,
            'distribution_event_id', v_event_id
          );

          update private.lead_distribution_events
          set outcome = 'no_matching_queue',
              result = v_result,
              completed_at = p_now
          where id = v_event_id;

          return v_result;
        end if;

        update private.lead_distribution_events
        set round_robin_id = v_queue.id
        where id = v_event_id;

        v_ignore_availability :=
          lower(
            coalesce(v_queue.settings->>'ignore_availability', 'false')
          ) in ('1', 'true', 'yes');

        v_timezone := coalesce(
          nullif(btrim(v_queue.settings->>'timezone'), ''),
          (
            select nullif(btrim(settings.timezone), '')
            from public.organization_attention_settings as settings
            where settings.organization_id = p_organization_id
          ),
          'America/Sao_Paulo'
        );

        begin
          v_local_now := p_now at time zone v_timezone;
        exception
          when invalid_parameter_value then
            v_timezone := 'America/Sao_Paulo';
            v_local_now := p_now at time zone v_timezone;
        end;

        v_current_day := extract(dow from v_local_now)::integer;
        v_current_time := v_local_now::time;
        v_ticket := private.next_round_robin_ticket(v_queue.id);

        select candidate.*
        into v_candidate
        from private.pick_round_robin_ticket_candidate(
          p_organization_id,
          v_queue.id,
          v_queue.strategy,
          v_ignore_availability,
          v_current_day,
          v_current_time,
          v_ticket
        ) as candidate;

        if v_candidate.user_id is null then
          insert into public.round_robin_logs (
            organization_id,
            round_robin_id,
            lead_id,
            reason,
            metadata
          )
          values (
            p_organization_id,
            v_queue.id,
            p_lead_id,
            'no_available_members',
            jsonb_build_object(
              'source', v_source,
              'queue_name', v_queue.name,
              'distribution_ticket', v_ticket,
              'algorithm_version', 'queue_ticket_iwrr_v1',
              'distribution_event_id', v_event_id
            )
          );

          insert into public.lead_timeline_events (
            organization_id,
            lead_id,
            event_type,
            title,
            description,
            metadata,
            event_at
          )
          values (
            p_organization_id,
            p_lead_id,
            'lead_distribution_pending',
            'Aguardando distribuição',
            'Fila "' || v_queue.name
              || '" sem membros disponíveis no momento.',
            jsonb_build_object(
              'destination', 'pool',
              'reason', 'no_available_members',
              'source', v_source,
              'queue_id', v_queue.id,
              'queue_name', v_queue.name,
              'distribution_event_id', v_event_id
            ),
            p_now
          );

          v_result := jsonb_build_object(
            'success', false,
            'reason', 'no_available_members',
            'lead_id', p_lead_id,
            'round_robin_id', v_queue.id,
            'round_robin_name', v_queue.name,
            'source', v_source,
            'distribution_ticket', v_ticket,
            'algorithm_version', 'queue_ticket_iwrr_v1',
            'distribution_event_id', v_event_id
          );

          update private.lead_distribution_events
          set distribution_ticket = v_ticket,
              algorithm_version = 'queue_ticket_iwrr_v1',
              outcome = 'no_available_members',
              result = v_result,
              completed_at = p_now
          where id = v_event_id;

          return v_result;
        end if;

        v_target_pipeline_id := coalesce(
          v_queue.target_pipeline_id,
          v_lead.pipeline_id
        );

        if v_target_pipeline_id is not null
           and not exists (
             select 1
             from public.pipelines as pipeline
             where pipeline.id = v_target_pipeline_id
               and pipeline.organization_id = p_organization_id
               and coalesce(pipeline.is_active, true) = true
           ) then
          raise exception using
            errcode = '23514',
            message = 'invalid_distribution_target_pipeline';
        end if;

        if v_queue.target_stage_id is not null then
          select stage.id
          into v_target_stage_id
          from public.stages as stage
          where stage.id = v_queue.target_stage_id
            and stage.organization_id = p_organization_id
            and stage.pipeline_id = v_target_pipeline_id
            and coalesce(stage.is_active, true) = true;

          if not found then
            raise exception using
              errcode = '23514',
              message = 'invalid_distribution_target_stage';
          end if;
        elsif exists (
          select 1
          from public.stages as stage
          where stage.id = v_lead.stage_id
            and stage.organization_id = p_organization_id
            and stage.pipeline_id = v_target_pipeline_id
            and coalesce(stage.is_active, true) = true
        ) then
          v_target_stage_id := v_lead.stage_id;
        else
          select stage.id
          into v_target_stage_id
          from public.stages as stage
          where stage.organization_id = p_organization_id
            and stage.pipeline_id = v_target_pipeline_id
            and coalesce(stage.is_active, true) = true
          order by stage.position, stage.id
          limit 1;
        end if;

        v_previous_assigned_user_id := v_lead.assigned_user_id;

        update public.leads
        set assigned_user_id = v_candidate.user_id,
            team_id = v_candidate.team_id,
            pipeline_id = v_target_pipeline_id,
            stage_id = v_target_stage_id,
            assigned_at = p_now,
            updated_at = p_now
        where id = p_lead_id
          and organization_id = p_organization_id;

        insert into public.assignments_log (
          organization_id,
          lead_id,
          round_robin_id,
          assigned_user_id,
          old_user_id,
          new_user_id,
          reason,
          assigned_at
        )
        values (
          p_organization_id,
          p_lead_id,
          v_queue.id,
          v_candidate.user_id,
          v_previous_assigned_user_id,
          v_candidate.user_id,
          'canonical_round_robin',
          p_now
        );

        insert into public.round_robin_logs (
          organization_id,
          round_robin_id,
          lead_id,
          assigned_user_id,
          member_id,
          reason,
          metadata
        )
        values (
          p_organization_id,
          v_queue.id,
          p_lead_id,
          v_candidate.user_id,
          v_candidate.member_id,
          'canonical_round_robin',
          jsonb_build_object(
            'source', v_source,
            'queue_name', v_queue.name,
            'strategy', lower(coalesce(v_queue.strategy, 'simple')),
            'member_id', v_candidate.member_id,
            'team_id', v_candidate.team_id,
            'team_member_id', v_candidate.team_member_id,
            'availability_check', v_candidate.availability_reason,
            'distribution_ticket', v_ticket,
            'algorithm_version', 'queue_ticket_iwrr_v1',
            'slot_count', v_candidate.slot_count,
            'candidate_position', v_candidate.slot_position,
            'recipient_count', v_candidate.recipient_count,
            'recipient_position', v_candidate.recipient_position,
            'distribution_event_id', v_event_id
          )
        );

        insert into public.lead_timeline_events (
          organization_id,
          lead_id,
          user_id,
          event_type,
          title,
          description,
          metadata,
          event_at
        )
        values (
          p_organization_id,
          p_lead_id,
          v_candidate.user_id,
          'lead_assigned',
          'Distribuído via "' || v_queue.name || '"',
          'Atribuído a '
            || coalesce(v_candidate.user_name, 'usuário')
            || ' pela fila "' || v_queue.name || '"',
          jsonb_build_object(
            'source', v_source,
            'source_label', v_source_label,
            'queue_id', v_queue.id,
            'queue_name', v_queue.name,
            'assigned_user_id', v_candidate.user_id,
            'assigned_user_name', v_candidate.user_name,
            'team_id', v_candidate.team_id,
            'pipeline_id', v_target_pipeline_id,
            'stage_id', v_target_stage_id,
            'distribution_type', 'canonical_round_robin',
            'distribution_ticket', v_ticket,
            'algorithm_version', 'queue_ticket_iwrr_v1',
            'slot_count', v_candidate.slot_count,
            'candidate_position', v_candidate.slot_position,
            'distribution_event_id', v_event_id
          ),
          p_now
        );

        insert into public.notifications (
          organization_id,
          user_id,
          lead_id,
          type,
          title,
          content,
          body,
          metadata,
          channel,
          target_url,
          created_at
        )
        values (
          p_organization_id,
          v_candidate.user_id,
          p_lead_id,
          'lead_assigned',
          'Novo lead atribuído',
          'O lead "' || v_lead.name || '" foi atribuído a você.',
          'O lead "' || v_lead.name || '" foi atribuído a você.',
          jsonb_build_object(
            'source', v_source,
            'source_label', v_source_label,
            'lead_name', v_lead.name,
            'round_robin_id', v_queue.id,
            'round_robin_name', v_queue.name,
            'assigned_user_id', v_candidate.user_id,
            'assigned_user_name', v_candidate.user_name,
            'pipeline_id', v_target_pipeline_id,
            'stage_id', v_target_stage_id,
            'event_key', 'new_lead_received',
            'dedupe_key', concat_ws(
              ':',
              'new_lead_received',
              p_lead_id::text,
              v_candidate.user_id::text
            ),
            'distribution_event_id', v_event_id,
            'whatsapp_dispatch_required', true,
            'whatsapp_dispatch', jsonb_build_object('status', 'pending'),
            'dispatch', jsonb_build_object(
              'whatsapp', jsonb_build_object(
                'required', true,
                'status', 'pending'
              ),
              'push', jsonb_build_object(
                'required', true,
                'status', 'pending'
              )
            )
          ),
          'in_app',
          '/crm/pipelines?lead=' || p_lead_id::text,
          p_now
        );

        v_result := jsonb_build_object(
          'success', true,
          'reason', 'assigned',
          'lead_id', p_lead_id,
          'assigned_user_id', v_candidate.user_id,
          'assigned_user_name', v_candidate.user_name,
          'team_id', v_candidate.team_id,
          'pipeline_id', v_target_pipeline_id,
          'stage_id', v_target_stage_id,
          'round_robin_id', v_queue.id,
          'round_robin_name', v_queue.name,
          'member_id', v_candidate.member_id,
          'source', v_source,
          'distribution_ticket', v_ticket,
          'algorithm_version', 'queue_ticket_iwrr_v1',
          'slot_count', v_candidate.slot_count,
          'candidate_position', v_candidate.slot_position,
          'recipient_count', v_candidate.recipient_count,
          'recipient_position', v_candidate.recipient_position,
          'distribution_event_id', v_event_id
        );

        update private.lead_distribution_events
        set distribution_ticket = v_ticket,
            algorithm_version = 'queue_ticket_iwrr_v1',
            slot_count = v_candidate.slot_count,
            candidate_position = v_candidate.slot_position,
            assigned_user_id = v_candidate.user_id,
            team_id = v_candidate.team_id,
            outcome = 'assigned',
            result = v_result,
            completed_at = p_now
        where id = v_event_id;

        return v_result;
      end
      $body$
    $canonical_function$;
  end if;
end
$upgrade_canonical_distribution_function$;

comment on function private.distribute_lead(
  uuid,
  uuid,
  text,
  uuid,
  boolean,
  text,
  timestamptz
) is
  'Backend-only, tenant-scoped, idempotent and atomic lead distribution.';

revoke all on function private.distribute_lead(
  uuid,
  uuid,
  text,
  uuid,
  boolean,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function private.distribute_lead(
  uuid,
  uuid,
  text,
  uuid,
  boolean,
  text,
  timestamptz
) to service_role;

revoke all on table private.lead_distribution_events
  from public, anon, authenticated, service_role;

-- The PostgREST bridge is the only public-schema entrypoint. Its body was
-- validated above before any repair, so attribute drift can be canonicalized
-- without trusting an unknown implementation.
do $reconcile_distribution_bridge$
declare
  v_bridge oid;
  v_language text;
  v_security_definer boolean;
  v_volatility "char";
  v_config text[];
  v_grantee record;
begin
  v_bridge := pg_catalog.to_regprocedure(
    'public.distribute_lead_from_backend(uuid,uuid,text,uuid,boolean,text,timestamp with time zone)'
  );

  select
    language_definition.lanname,
    procedure_definition.prosecdef,
    procedure_definition.provolatile,
    procedure_definition.proconfig
  into
    v_language,
    v_security_definer,
    v_volatility,
    v_config
  from pg_catalog.pg_proc as procedure_definition
  join pg_catalog.pg_language as language_definition
    on language_definition.oid = procedure_definition.prolang
  where procedure_definition.oid = v_bridge;

  if v_language <> 'sql'
     or v_security_definer is distinct from true
     or v_volatility <> 'v'
     or not (
       coalesce(v_config, array[]::text[])
       @> array['search_path=""']::text[]
     ) then
    execute $canonical_bridge$
      create or replace function public.distribute_lead_from_backend(
        p_organization_id uuid,
        p_lead_id uuid,
        p_idempotency_key text,
        p_round_robin_id uuid default null,
        p_preserve_assignee boolean default true,
        p_source text default null,
        p_now timestamptz default clock_timestamp()
      )
      returns jsonb
      language sql
      volatile
      security definer
      set search_path = ''
      as $body$
        select private.distribute_lead(
          p_organization_id,
          p_lead_id,
          p_idempotency_key,
          p_round_robin_id,
          p_preserve_assignee,
          p_source,
          p_now
        );
      $body$
    $canonical_bridge$;
  end if;

  for v_grantee in
    select distinct
      privilege_definition.grantee,
      grantee.rolname
    from pg_catalog.pg_proc as procedure_definition
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure_definition.proacl,
        pg_catalog.acldefault('f', procedure_definition.proowner)
      )
    ) as privilege_definition
    left join pg_catalog.pg_roles as grantee
      on grantee.oid = privilege_definition.grantee
    where procedure_definition.oid = v_bridge
      and privilege_definition.privilege_type = 'EXECUTE'
      and privilege_definition.grantee <> procedure_definition.proowner
      and coalesce(grantee.rolname, 'PUBLIC') <> 'service_role'
  loop
    execute pg_catalog.format(
      'revoke all on function %s from %s',
      v_bridge::regprocedure,
      case
        when v_grantee.grantee = 0 then 'public'
        else pg_catalog.quote_ident(v_grantee.rolname)
      end
    );
  end loop;
end
$reconcile_distribution_bridge$;

comment on function public.distribute_lead_from_backend(
  uuid,
  uuid,
  text,
  uuid,
  boolean,
  text,
  timestamptz
) is
  'Service-role-only Data API bridge to the private canonical distributor.';

revoke all on function public.distribute_lead_from_backend(
  uuid,
  uuid,
  text,
  uuid,
  boolean,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.distribute_lead_from_backend(
  uuid,
  uuid,
  text,
  uuid,
  boolean,
  text,
  timestamptz
) to service_role;

-- Remove the last fail-open route from the INSERT trigger. The deferred marker
-- remains the handoff used by migrated callers; unmarked legacy inserts now
-- enter the same private, idempotent distributor instead of handle_lead_intake.
do $upgrade_lead_intake_trigger_function$
declare
  v_proc oid;
  v_definition text;
  v_language text;
  v_security_definer boolean;
  v_owner name;
  v_config text[];
begin
  v_proc := pg_catalog.to_regprocedure(
    'public.trigger_handle_lead_intake()'
  );

  if v_proc is null then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_unknown_contract',
      detail = 'public.trigger_handle_lead_intake() is missing';
  end if;

  select
    pg_catalog.lower(
      pg_catalog.pg_get_functiondef(procedure_definition.oid)
    ),
    language_definition.lanname,
    procedure_definition.prosecdef,
    pg_catalog.pg_get_userbyid(procedure_definition.proowner),
    procedure_definition.proconfig
  into
    v_definition,
    v_language,
    v_security_definer,
    v_owner,
    v_config
  from pg_catalog.pg_proc as procedure_definition
  join pg_catalog.pg_language as language_definition
    on language_definition.oid = procedure_definition.prolang
  where procedure_definition.oid = v_proc;

  if v_language <> 'plpgsql'
     or v_security_definer is distinct from true
     or v_owner <> current_user::name
     or not (
       coalesce(v_config, array[]::text[])
       @> array['search_path=""']::text[]
     )
     or pg_catalog.strpos(
          v_definition,
          '''distribution_deferred'''
        ) = 0 then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_unknown_contract',
      detail = 'public.trigger_handle_lead_intake() attributes diverged';
  end if;

  if pg_catalog.strpos(
       v_definition,
       'perform private.distribute_lead('
     ) > 0 then
    if pg_catalog.strpos(
         v_definition,
         '''trigger:'' || new.id::text'
       ) = 0
       or pg_catalog.strpos(
            v_definition,
            'perform public.handle_lead_intake'
          ) > 0 then
      raise exception using
        errcode = '55000',
        message = 'distribution_upgrade_unknown_contract',
        detail = 'the canonical intake trigger body diverged';
    end if;
  elsif pg_catalog.strpos(
          v_definition,
          'perform public.handle_lead_intake(new.id)'
        ) > 0 then
    execute $canonical_trigger$
      create or replace function public.trigger_handle_lead_intake()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $body$
      begin
        if new.assigned_user_id is null
           and lower(
             coalesce(
               new.metadata->>'distribution_deferred',
               'false'
             )
           ) not in ('1', 'true', 'yes') then
          perform private.distribute_lead(
            new.organization_id,
            new.id,
            'trigger:' || new.id::text,
            null,
            true,
            new.source,
            coalesce(new.created_at, clock_timestamp())
          );
        end if;
        return new;
      end
      $body$
    $canonical_trigger$;
  else
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_unknown_contract',
      detail = 'an unknown intake trigger body was detected';
  end if;
end
$upgrade_lead_intake_trigger_function$;

-- These routines remain owner-callable for controlled internal maintenance,
-- but no API role may use them to bypass the canonical boundary.
do $revoke_legacy_distribution_routes$
declare
  v_signature text;
  v_proc oid;
begin
  foreach v_signature in array array[
    'public.handle_lead_intake(uuid)',
    'public.redistribute_lead_from_pool(uuid,text)',
    'public.redistribute_lead_round_robin(uuid)'
  ]
  loop
    v_proc := pg_catalog.to_regprocedure(v_signature);
    if v_proc is not null then
      execute pg_catalog.format(
        'revoke all on function %s from public, anon, authenticated, service_role',
        v_proc::regprocedure
      );
    end if;
  end loop;
end
$revoke_legacy_distribution_routes$;

do $distribution_upgrade_postconditions$
declare
  v_definition text;
  v_proc oid;
  v_marker text;
  v_column record;
  v_cron_count integer;
  v_trigger_count integer;
  v_argument_names text[];
  v_default_count smallint;
  v_return_type oid;
  v_owner name;
  v_language text;
  v_security_definer boolean;
  v_volatility "char";
  v_config text[];
  v_body text;
begin
  for v_column in
    select *
    from (
      values
        ('distribution_ticket'::name, 'bigint'::regtype),
        ('algorithm_version'::name, 'text'::regtype),
        ('slot_count'::name, 'bigint'::regtype),
        ('candidate_position'::name, 'bigint'::regtype)
    ) as expected(column_name, type_oid)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid =
            'private.lead_distribution_events'::regclass
        and attribute.attname = v_column.column_name
        and attribute.atttypid = v_column.type_oid
        and attribute.attnum > 0
        and not attribute.attisdropped
        and not attribute.attnotnull
        and not attribute.atthasdef
    ) then
      raise exception using
        errcode = '55000',
        message = 'distribution_upgrade_postcondition_failed',
        detail = pg_catalog.format(
          'audit column %I is missing or invalid',
          v_column.column_name
        );
    end if;
  end loop;

  v_proc := pg_catalog.to_regprocedure(
    'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamp with time zone)'
  );

  if v_proc is null
     or (
       select count(*)
       from pg_catalog.pg_proc as procedure_definition
       join pg_catalog.pg_namespace as namespace
         on namespace.oid = procedure_definition.pronamespace
       where namespace.nspname = 'private'
         and procedure_definition.proname = 'distribute_lead'
     ) <> 1 then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_postcondition_failed',
      detail = 'the canonical distributor is missing or overloaded';
  end if;

  v_definition := pg_catalog.lower(
    pg_catalog.pg_get_functiondef(v_proc)
  );

  foreach v_marker in array array[
    'for no key update',
    'private.next_round_robin_ticket(v_queue.id)',
    'from private.pick_round_robin_ticket_candidate(',
    '''queue_ticket_iwrr_v1''',
    'set distribution_ticket = v_ticket',
    'slot_count = v_candidate.slot_count',
    'candidate_position = v_candidate.slot_position',
    'on conflict (organization_id, idempotency_key) do nothing',
    'insert into public.assignments_log',
    'insert into public.round_robin_logs'
  ]
  loop
    if pg_catalog.strpos(v_definition, v_marker) = 0 then
      raise exception using
        errcode = '55000',
        message = 'distribution_upgrade_postcondition_failed',
        detail = pg_catalog.format(
          'canonical distributor is missing marker: %s',
          v_marker
        );
    end if;
  end loop;

  if pg_catalog.strpos(v_definition, 'for update;') > 0
     or not pg_catalog.has_function_privilege(
       'service_role',
       v_proc,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', v_proc, 'EXECUTE')
     or pg_catalog.has_function_privilege(
       'authenticated',
       v_proc,
       'EXECUTE'
     ) then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_postcondition_failed',
      detail = 'canonical distributor lock or ACL postcondition failed';
  end if;

  v_proc := pg_catalog.to_regprocedure(
    'public.distribute_lead_from_backend(uuid,uuid,text,uuid,boolean,text,timestamp with time zone)'
  );
  if v_proc is null
     or (
       select count(*)
       from pg_catalog.pg_proc as procedure_definition
       join pg_catalog.pg_namespace as namespace
         on namespace.oid = procedure_definition.pronamespace
       where namespace.nspname = 'public'
         and procedure_definition.proname =
             'distribute_lead_from_backend'
     ) <> 1 then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_postcondition_failed',
      detail = 'the backend distribution bridge is missing or overloaded';
  end if;

  select
    procedure_definition.proargnames,
    procedure_definition.pronargdefaults,
    procedure_definition.prorettype,
    pg_catalog.pg_get_userbyid(procedure_definition.proowner),
    language_definition.lanname,
    procedure_definition.prosecdef,
    procedure_definition.provolatile,
    procedure_definition.proconfig,
    pg_catalog.regexp_replace(
      pg_catalog.lower(procedure_definition.prosrc),
      '\s+',
      '',
      'g'
    )
  into
    v_argument_names,
    v_default_count,
    v_return_type,
    v_owner,
    v_language,
    v_security_definer,
    v_volatility,
    v_config,
    v_body
  from pg_catalog.pg_proc as procedure_definition
  join pg_catalog.pg_language as language_definition
    on language_definition.oid = procedure_definition.prolang
  where procedure_definition.oid = v_proc;

  if v_argument_names <> array[
       'p_organization_id',
       'p_lead_id',
       'p_idempotency_key',
       'p_round_robin_id',
       'p_preserve_assignee',
       'p_source',
       'p_now'
     ]::text[]
     or v_default_count <> 4
     or v_return_type <> 'jsonb'::regtype
     or v_owner <> current_user::name
     or v_language <> 'sql'
     or v_security_definer is distinct from true
     or v_volatility <> 'v'
     or not (
       coalesce(v_config, array[]::text[])
       @> array['search_path=""']::text[]
     )
     or v_body <>
        'selectprivate.distribute_lead(p_organization_id,p_lead_id,p_idempotency_key,p_round_robin_id,p_preserve_assignee,p_source,p_now);'
     or pg_catalog.strpos(v_body, 'auth.') > 0
     or pg_catalog.strpos(v_body, 'request.') > 0
     or not pg_catalog.has_function_privilege(
       'service_role',
       v_proc,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', v_proc, 'EXECUTE')
     or pg_catalog.has_function_privilege(
       'authenticated',
       v_proc,
       'EXECUTE'
     )
     or exists (
       select 1
       from pg_catalog.pg_proc as procedure_definition
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           procedure_definition.proacl,
           pg_catalog.acldefault('f', procedure_definition.proowner)
         )
       ) as privilege_definition
       left join pg_catalog.pg_roles as grantee
         on grantee.oid = privilege_definition.grantee
       where procedure_definition.oid = v_proc
         and privilege_definition.privilege_type = 'EXECUTE'
         and privilege_definition.grantee <> procedure_definition.proowner
         and coalesce(grantee.rolname, 'PUBLIC') <> 'service_role'
     ) then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_postcondition_failed',
      detail = 'the backend distribution bridge contract diverged';
  end if;

  v_proc := pg_catalog.to_regprocedure(
    'private.pick_round_robin_ticket_candidate(uuid,uuid,text,boolean,integer,time without time zone,bigint)'
  );
  if v_proc is null then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_postcondition_failed',
      detail = 'the IWRR picker is missing';
  end if;

  v_definition := pg_catalog.lower(
    pg_catalog.pg_get_functiondef(v_proc)
  );
  if pg_catalog.strpos(
       v_definition,
       'availability_filtered_candidates as ('
     ) = 0
     or pg_catalog.strpos(
          v_definition,
          'deduplicated_candidates as ('
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'availability_filtered_candidates as ('
        ) > pg_catalog.strpos(
          v_definition,
          'deduplicated_candidates as ('
        )
     or pg_catalog.strpos(v_definition, 'chosen_interval as (') = 0
     or pg_catalog.strpos(v_definition, 'rank_in_round') = 0
     or pg_catalog.strpos(v_definition, 'generate_series') > 0 then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_postcondition_failed',
      detail = 'the IWRR picker contract diverged';
  end if;

  v_proc := pg_catalog.to_regprocedure(
    'private.ensure_round_robin_ticket_sequence(uuid)'
  );
  v_definition := pg_catalog.lower(
    pg_catalog.pg_get_functiondef(v_proc)
  );
  foreach v_marker in array array[
    'relation.relkind = ''s''',
    'sum(coalesce(member.leads_count, 0))',
    'metadata->>''distribution_ticket''',
    'max(distribution_event.distribution_ticket)',
    'revoke all on sequence private.%i'
  ]
  loop
    if pg_catalog.strpos(v_definition, v_marker) = 0 then
      raise exception using
        errcode = '55000',
        message = 'distribution_upgrade_postcondition_failed',
        detail = pg_catalog.format(
          'ticket sequence helper is missing marker: %s',
          v_marker
        );
    end if;
  end loop;

  v_proc := pg_catalog.to_regprocedure(
    'private.cleanup_orphan_round_robin_ticket_sequences()'
  );
  v_definition := pg_catalog.lower(
    pg_catalog.pg_get_functiondef(v_proc)
  );
  if pg_catalog.strpos(
       v_definition,
       '^lead_distribution_ticket_[0-9a-f]{32}$'
     ) = 0
     or pg_catalog.strpos(v_definition, 'limit 100') = 0 then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_postcondition_failed',
      detail = 'ticket sequence cleanup is not bounded safely';
  end if;

  select count(*)::integer
  into v_trigger_count
  from pg_catalog.pg_trigger as trigger_definition
  where trigger_definition.tgrelid = 'public.round_robins'::regclass
    and trigger_definition.tgname =
        'round_robins_create_distribution_ticket'
    and not trigger_definition.tgisinternal
    and trigger_definition.tgenabled = 'O';

  if v_trigger_count <> 1 then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_postcondition_failed',
      detail = 'the queue ticket trigger is missing or duplicated';
  end if;

  v_proc := pg_catalog.to_regprocedure(
    'public.trigger_handle_lead_intake()'
  );
  v_definition := pg_catalog.lower(
    pg_catalog.pg_get_functiondef(v_proc)
  );
  if pg_catalog.strpos(
       v_definition,
       'perform private.distribute_lead('
     ) = 0
     or pg_catalog.strpos(
          v_definition,
          '''trigger:'' || new.id::text'
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'perform public.handle_lead_intake'
        ) > 0 then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_postcondition_failed',
      detail = 'lead intake still has a fail-open legacy route';
  end if;

  foreach v_marker in array array[
    'public.handle_lead_intake(uuid)',
    'public.redistribute_lead_from_pool(uuid,text)',
    'public.redistribute_lead_round_robin(uuid)'
  ]
  loop
    v_proc := pg_catalog.to_regprocedure(v_marker);
    if v_proc is not null
       and pg_catalog.has_function_privilege(
         'service_role',
         v_proc,
         'EXECUTE'
       ) then
      raise exception using
        errcode = '55000',
        message = 'distribution_upgrade_postcondition_failed',
        detail = pg_catalog.format(
          'service_role can still execute %s',
          v_marker
        );
    end if;
  end loop;

  select count(*)::integer
  into v_cron_count
  from cron.job as job
  where job.jobname = 'cleanup-round-robin-ticket-sequences'
    and job.schedule = '31 3 * * *'
    and job.active
    and pg_catalog.btrim(
      pg_catalog.regexp_replace(job.command, '\s+', ' ', 'g')
    ) =
      'select private.cleanup_orphan_round_robin_ticket_sequences();';

  if v_cron_count <> 1 then
    raise exception using
      errcode = '55000',
      message = 'distribution_upgrade_postcondition_failed',
      detail = 'the ticket cleanup cron postcondition failed';
  end if;
end
$distribution_upgrade_postconditions$;
