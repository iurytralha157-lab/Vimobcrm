-- Reconcile only the audited production ticket helper with the already
-- versioned 20260729021500 fix and a fresh catalog read after advisory wait.
-- A cached to_regclass lookup can miss a sequence committed during that wait.
-- Existing sequences must already be private.
-- No sequence is recreated, advanced, restarted, or granted new privileges.
-- The creation branch keeps its initial REVOKE under the queue advisory lock.
do $guard_ticket_sequence_acl_hotpath$
declare
  helper oid:=to_regprocedure('private.ensure_round_robin_ticket_sequence(uuid)');
  source text; definition text; source_hash text; revoke_anchor text;
  lookup_anchor text; replacement_lookup text;
  original_owner oid; original_acl aclitem[]; original_config text[];
begin
  select procedure.prosrc,pg_get_functiondef(procedure.oid),
    procedure.proowner,procedure.proacl,procedure.proconfig
  into source,definition,original_owner,original_acl,original_config
  from pg_proc procedure where procedure.oid=helper;
  source_hash:=md5(regexp_replace(source,'\s','','g'));
  if source is null or source_hash not in (
    '206e6eb1c84b4cd0f702267a2cc3dcce', -- installed unify helper
    '700fe7a982c03a6490a54e78733bc31a', -- 20260729021500 already installed
    '04e2f165d04c6806c496e874b1977537'  -- this exact guarded fix installed
  ) then
    raise exception using errcode='55000',message='ticket_sequence_unknown_helper_predecessor';
  end if;
  if not exists (select 1 from pg_proc procedure join pg_language language
    on language.oid=procedure.prolang where procedure.oid=helper
      and procedure.prosecdef and procedure.prorettype='regclass'::regtype
      and procedure.provolatile='v' and language.lanname='plpgsql'
      and 'search_path=""'=any(procedure.proconfig)) then
    raise exception using errcode='55000',message='ticket_sequence_unsafe_helper_boundary';
  end if;
  -- The removed calls only revoked these roles. Do not silently stop that
  -- repair if existing sequence ACLs are unexpectedly open or inherited.
  if exists (select 1 from pg_class sequence join pg_namespace namespace
    on namespace.oid=sequence.relnamespace where namespace.nspname='private'
      and sequence.relkind='S'
      and sequence.relname ~ '^lead_distribution_ticket_[0-9a-f]{32}$'
      and (has_sequence_privilege('anon',sequence.oid,'USAGE,SELECT,UPDATE')
        or has_sequence_privilege('authenticated',sequence.oid,'USAGE,SELECT,UPDATE')
        or has_sequence_privilege('service_role',sequence.oid,'USAGE,SELECT,UPDATE')
        or exists (select 1 from aclexplode(coalesce(sequence.relacl,
          acldefault('S',sequence.relowner))) privilege where privilege.grantee=0))) then
    raise exception using errcode='55000',message='ticket_sequence_existing_acl_requires_review';
  end if;
  if source_hash='04e2f165d04c6806c496e874b1977537' then
    return;
  end if;
  source:=replace(source,E'\r\n',E'\n');
  definition:=replace(definition,E'\r\n',E'\n');
  revoke_anchor:=$existing_sequence_revoke$    execute pg_catalog.format(
      'revoke all on sequence private.%I from public, anon, authenticated, service_role',
      v_name
    );
$existing_sequence_revoke$;
  if source_hash='206e6eb1c84b4cd0f702267a2cc3dcce' then
    if (length(source)-length(replace(source,revoke_anchor,'')))/length(revoke_anchor)<>2 then
      raise exception using errcode='55000',message='ticket_sequence_existing_revoke_anchor_mismatch';
    end if;
    source:=replace(source,revoke_anchor,'');
    definition:=replace(definition,revoke_anchor,'');
  end if;
  if md5(regexp_replace(source,'\s','','g'))<>'700fe7a982c03a6490a54e78733bc31a' then
    raise exception using errcode='55000',message='ticket_sequence_runtime_revoke_postcondition_failed';
  end if;
  -- Include the lock in this exact unique anchor so the initial warm-path
  -- lookup stays unchanged. An explicit catalog query after waiting sees a
  -- sequence committed by the previous lock holder. Do not filter relkind:
  -- the existing following guard must still reject a wrong object with 42809.
  lookup_anchor:=$post_lock_lookup$  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'lead-distribution-ticket:' || p_round_robin_id::text,
      0
    )
  );

  v_sequence := pg_catalog.to_regclass(
    pg_catalog.format('private.%I', v_name)
  );$post_lock_lookup$;
  replacement_lookup:=$fresh_post_lock_lookup$  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'lead-distribution-ticket:' || p_round_robin_id::text,
      0
    )
  );

  select relation.oid into v_sequence
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
  where namespace.nspname='private' and relation.relname=v_name;$fresh_post_lock_lookup$;
  if (length(source)-length(replace(source,lookup_anchor,'')))/length(lookup_anchor)<>1 then
    raise exception using errcode='55000',message='ticket_sequence_post_lock_lookup_anchor_mismatch';
  end if;
  execute replace(definition,lookup_anchor,replacement_lookup);
  if not exists (select 1 from pg_proc procedure where procedure.oid=helper
    and md5(regexp_replace(procedure.prosrc,'\s','','g'))='04e2f165d04c6806c496e874b1977537'
    and procedure.proowner=original_owner
    and procedure.proacl is not distinct from original_acl
    and procedure.proconfig is not distinct from original_config
    and procedure.prosecdef and procedure.prorettype='regclass'::regtype) then
    raise exception using errcode='55000',message='ticket_sequence_helper_postcondition_failed';
  end if;
end;
$guard_ticket_sequence_acl_hotpath$;
