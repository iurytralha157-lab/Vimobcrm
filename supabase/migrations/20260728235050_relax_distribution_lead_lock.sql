-- Reentry attribution rows retain a KEY SHARE lock on their parent lead until
-- commit. Distribution never changes a lead key, so its stronger FOR UPDATE
-- lock only creates unnecessary upgrade conflicts (and can deadlock when
-- several reentries append attribution before converging on distribution).
--
-- Rebuild the already-hardened canonical function from PostgreSQL's own
-- definition so this migration changes only the lead-row lock. Queue tickets
-- remain independent from the lead lock.
do $migration$
declare
  v_signature constant regprocedure :=
    'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz)'::regprocedure;
  v_definition text;
  v_old_lock constant text :=
    E'where lead.id = p_lead_id\n    and lead.organization_id = p_organization_id\n  for update;';
  v_new_lock constant text :=
    E'where lead.id = p_lead_id\n    and lead.organization_id = p_organization_id\n  for no key update;';
begin
  select pg_catalog.pg_get_functiondef(procedure.oid)
  into v_definition
  from pg_catalog.pg_proc as procedure
  where procedure.oid = v_signature;

  if v_definition is null then
    raise exception 'canonical distribute_lead function is missing';
  end if;

  if pg_catalog.strpos(v_definition, v_new_lock) > 0 then
    return;
  end if;
  if pg_catalog.strpos(v_definition, v_old_lock) = 0 then
    raise exception 'canonical distribute_lead lead lock contract changed unexpectedly';
  end if;

  execute pg_catalog.replace(v_definition, v_old_lock, v_new_lock);
end
$migration$;

comment on function private.distribute_lead(
  uuid,
  uuid,
  text,
  uuid,
  boolean,
  text,
  timestamptz
) is
  'Canonical lead distribution. Locks only the lead FOR NO KEY UPDATE; queue assignment uses an auditable non-transactional ticket.';
