-- Forward compatibility: preserve managed wrapper, weighted new leads, legacy
-- durable rotation, separate retry clocks and backend-only job mutations.
-- No historical rows or counters are rewritten. Roll back API first; keep the
-- additive columns/ledger and guards until the previous API is retired.
begin;
set local lock_timeout='5s';
set local statement_timeout='5min';
do $patch_canonical_rotation$
declare
  source text; definition text; original_anchor text; replacement_anchor text;
  original_notification_anchor text; replacement_notification_anchor text;
  canonical_hash text; expected_hash text; original_source text;
begin
  select procedure.prosrc,pg_get_functiondef(procedure.oid) into source,definition
  from pg_proc procedure where procedure.oid=to_regprocedure(
    'private.distribute_lead_legacy_before_queue_runtime(uuid,uuid,text,uuid,boolean,text,timestamp with time zone)');
  canonical_hash:=md5(regexp_replace(source,'\s','','g'));
  if source is null then
    raise exception using errcode='55000',message='round_robin_rotation_missing_legacy_canonical';
  end if;
  if not exists (select 1 from pg_proc procedure where procedure.oid=to_regprocedure(
    'private.distribute_lead_legacy_before_queue_runtime(uuid,uuid,text,uuid,boolean,text,timestamp with time zone)')
    and procedure.prosecdef and procedure.prorettype='jsonb'::regtype
    and 'search_path=""'=any(procedure.proconfig)) then
    raise exception using errcode='55000',message='round_robin_rotation_unsafe_canonical_boundary';
  end if;
  source:=replace(source,E'\r\n',E'\n');
  definition:=replace(definition,E'\r\n',E'\n');
  original_anchor:=$original_rotation_anchor$        v_ticket := private.next_round_robin_ticket(v_queue.id);

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
        ) as candidate;$original_rotation_anchor$;
  replacement_anchor:=$new_rotation_anchor$        if (
          v_lead.assigned_user_id is not null or exists (
            select 1 from private.round_robin_rotation_state rotation
            where rotation.organization_id=p_organization_id and rotation.lead_id=p_lead_id
              and rotation.round_robin_id=v_queue.id and cardinality(rotation.visited_user_ids)>0
          ) or exists (
            select 1 from public.round_robin_logs prior
            where prior.organization_id=p_organization_id and prior.lead_id=p_lead_id
              and prior.round_robin_id=v_queue.id and prior.assigned_user_id is not null
              and private.is_round_robin_rotation_assignment_reason(prior.reason)
          )
        ) then
          v_ticket := null;
          -- p_now is the original intake event time, including delayed Meta or
          -- WhatsApp events. Transfer availability uses the processing clock,
          -- like the confirmed-log guard; the historical event stays intact.
          select candidate.* into v_candidate
          from private.preview_round_robin_redistribution_candidate(
            p_organization_id, p_lead_id, v_queue.id,
            v_lead.assigned_user_id, null
          ) as candidate;
        else
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
        end if;$new_rotation_anchor$;
  original_anchor:=replace(original_anchor,E'\r\n',E'\n');
  replacement_anchor:=replace(replacement_anchor,E'\r\n',E'\n');
  -- A published hotfix may already be the renamed legacy implementation.
  -- Exact reverse transforms prove its predecessor before leaving it in place.
  if canonical_hash not in ('63b85de2532566f0f457b126747688e6','9a654223cc6e94f617a13e9d33da27ea') then
    original_source:=source;
    source:=replace(source,replacement_anchor,original_anchor);
    source:=replace(source,'(case when v_ticket is null then ''lead_queue_rotation_v1'' else ''queue_ticket_iwrr_v1'' end)','''queue_ticket_iwrr_v1''');
    source:=regexp_replace(source,E',\\n[ ]*case when v_ticket is null then v_event_id::text end','');
    expected_hash:=md5(regexp_replace(source,'\s','','g'));
    if expected_hash not in ('63b85de2532566f0f457b126747688e6','9a654223cc6e94f617a13e9d33da27ea') then
      -- The original unify body has six fewer indentation spaces.
      source:=replace(original_source,
        substring(replace(E'\n'||replacement_anchor,E'\n      ',E'\n') from 2),
        substring(replace(E'\n'||original_anchor,E'\n      ',E'\n') from 2));
      source:=replace(source,'(case when v_ticket is null then ''lead_queue_rotation_v1'' else ''queue_ticket_iwrr_v1'' end)','''queue_ticket_iwrr_v1''');
      source:=regexp_replace(source,E',\\n[ ]*case when v_ticket is null then v_event_id::text end','');
      expected_hash:=md5(regexp_replace(source,'\s','','g'));
    end if;
    if expected_hash not in ('63b85de2532566f0f457b126747688e6','9a654223cc6e94f617a13e9d33da27ea') then
      raise exception using errcode='55000',message='round_robin_rotation_unknown_legacy_canonical';
    end if;
    return;
  end if;
  if canonical_hash='9a654223cc6e94f617a13e9d33da27ea' then
    original_anchor:=substring(replace(E'\n'||original_anchor,E'\n      ',E'\n') from 2);
    replacement_anchor:=substring(replace(E'\n'||replacement_anchor,E'\n      ',E'\n') from 2);
  end if;
  if (length(source)-length(replace(source,original_anchor,'')))/length(original_anchor)<>1 then
    raise exception using errcode='55000',message='round_robin_rotation_canonical_anchor_mismatch';
  end if;
  definition:=replace(definition,original_anchor,replacement_anchor);
  definition:=replace(definition,'''queue_ticket_iwrr_v1''',
    '(case when v_ticket is null then ''lead_queue_rotation_v1'' else ''queue_ticket_iwrr_v1'' end)');
  -- The original recipient-only key is stable for a genuinely new lead, but
  -- would collide when a later round/resume legitimately returns to that user.
  -- A rotation notification belongs to its durable distribution event. Replays
  -- return that ledger result before inserting another notification.
  original_notification_anchor:=$original_notification_anchor$            'dedupe_key', concat_ws(
              ':',
              'new_lead_received',
              p_lead_id::text,
              v_candidate.user_id::text
            )$original_notification_anchor$;
  replacement_notification_anchor:=$replacement_notification_anchor$            'dedupe_key', concat_ws(
              ':',
              'new_lead_received',
              p_lead_id::text,
              v_candidate.user_id::text,
              case when v_ticket is null then v_event_id::text end
            )$replacement_notification_anchor$;
  original_notification_anchor:=replace(original_notification_anchor,E'\r\n',E'\n');
  replacement_notification_anchor:=replace(replacement_notification_anchor,E'\r\n',E'\n');
  if canonical_hash='9a654223cc6e94f617a13e9d33da27ea' then
    original_notification_anchor:=substring(replace(E'\n'||original_notification_anchor,E'\n      ',E'\n') from 2);
    replacement_notification_anchor:=substring(replace(E'\n'||replacement_notification_anchor,E'\n      ',E'\n') from 2);
  end if;
  if (length(source)-length(replace(source,original_notification_anchor,'')))/length(original_notification_anchor)<>1 then
    raise exception using errcode='55000',message='round_robin_rotation_notification_anchor_mismatch';
  end if;
  definition:=replace(definition,original_notification_anchor,replacement_notification_anchor);
  execute definition;
end;
$patch_canonical_rotation$;

-- Keep technical worker retries independent from the lead's business clocks.
-- NULL retains the existing schedule. A warning failure must never postpone
-- the due transfer, and a failed transfer must not consume a business attempt.
-- No lead, job, history, notification or counter is backfilled here.
alter table public.lead_redistribution_jobs
  add column if not exists warning_retry_at timestamptz,
  add column if not exists redistribution_retry_at timestamptz;

comment on column public.lead_redistribution_jobs.warning_retry_at is
  'Backend technical retry eligibility for warnings only. NULL adds no delay; the warning_due_at and due_at business clocks remain authoritative.';
comment on column public.lead_redistribution_jobs.redistribution_retry_at is
  'Backend technical retry eligibility for a transfer only. NULL adds no delay; does not count as an assignment attempt or change due_at/enrolled_at.';

-- Discovery and its stable order use these exact effective clocks. Ordering
-- only by due_at would let expired failures retake the first 50 slots forever.
-- Existing business-clock indexes remain installed for other callers.
create index if not exists idx_lead_redistribution_jobs_retry_due
  on public.lead_redistribution_jobs
    ((greatest(due_at, coalesce(redistribution_retry_at, '-infinity'::timestamptz))), id)
  where status in ('pending', 'warning_sent');

create index if not exists idx_lead_redistribution_jobs_retry_warning
  on public.lead_redistribution_jobs
    ((greatest(warning_due_at, coalesce(warning_retry_at, '-infinity'::timestamptz))), id)
  where status = 'pending'
    and warning_due_at is not null
    and warning_sent_at is null;

-- A legitimate enrollment/reschedule starts fresh technical eligibility even
-- when an older SQL writer reuses the same job row. Keep this at the row
-- boundary so callers cannot accidentally inherit another assignment's wait.
-- The helper reads no tables and needs no elevated identity or public API.
create or replace function private.reset_lead_redistribution_worker_retry_clocks()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  new.warning_retry_at := null;
  new.redistribution_retry_at := null;
  return new;
end;
$$;
revoke all on function private.reset_lead_redistribution_worker_retry_clocks()
from public,anon,authenticated,service_role;

create or replace trigger trg_reset_lead_redistribution_worker_retry_clocks
before update of current_assigned_user_id,enrolled_at,due_at,warning_due_at,
  attempt_count,round_robin_id,status on public.lead_redistribution_jobs
for each row
when (
  old.current_assigned_user_id is distinct from new.current_assigned_user_id
  or old.enrolled_at is distinct from new.enrolled_at
  or old.due_at is distinct from new.due_at
  or old.warning_due_at is distinct from new.warning_due_at
  or old.attempt_count is distinct from new.attempt_count
  or old.round_robin_id is distinct from new.round_robin_id
  or (old.status not in ('pending','warning_sent') and new.status in ('pending','warning_sent'))
)
execute function private.reset_lead_redistribution_worker_retry_clocks();

-- RLS, table/column ACLs, policies and the one-active-job uniqueness boundary
-- are deliberately inherited unchanged from the production job table.


-- The production one-active-job boundary must remain present in either path.
-- Fail closed on duplicate legacy data instead of silently stopping live jobs.
create unique index if not exists idx_lead_redistribution_jobs_one_active
  on public.lead_redistribution_jobs(lead_id) where status in ('pending','warning_sent');
do $single_job_boundary$
begin
  if not exists(select 1 from pg_index i join pg_attribute a
    on a.attrelid=i.indrelid and a.attname='lead_id'
    where i.indexrelid=to_regclass('public.idx_lead_redistribution_jobs_one_active')
      and i.indrelid='public.lead_redistribution_jobs'::regclass
      and i.indisunique and i.indisvalid and i.indnkeyatts=1 and i.indkey[0]=a.attnum
      and pg_get_expr(i.indpred,i.indrelid)='(status = ANY (ARRAY[''pending''::text, ''warning_sent''::text]))') then
    raise exception using errcode='55000',message='worker_jobs_invalid_single_active_boundary';
  end if;
end;
$single_job_boundary$;

-- The main catalog-recheck allocator already includes the hotfix warm-path ACL
-- fix. It is preserved, rather than overwritten by the older hotfix helper.
do $ticket_preflight$
declare source text;
begin
  select p.prosrc into source from pg_proc p where p.oid=to_regprocedure('private.ensure_round_robin_ticket_sequence(uuid)')
    and p.prosecdef and p.provolatile='v' and p.prorettype='regclass'::regtype
    and p.proowner=(select oid from pg_roles where rolname='postgres') and 'search_path=""'=any(p.proconfig);
  if source is null or md5(regexp_replace(source,'\s','','g')) <> '1b5753b68f1ab2540369d697ec3ff7a7' then
    raise exception using errcode='55000',message='queue_hotfix_unknown_ticket_helper';
  end if;
  if exists(select 1 from pg_class sequence join pg_namespace namespace on namespace.oid=sequence.relnamespace
    where namespace.nspname='private' and sequence.relkind='S' and sequence.relname ~ '^lead_distribution_ticket_[0-9a-f]{32}$'
      and (has_sequence_privilege('anon',sequence.oid,'USAGE,SELECT,UPDATE')
        or has_sequence_privilege('authenticated',sequence.oid,'USAGE,SELECT,UPDATE')
        or has_sequence_privilege('service_role',sequence.oid,'USAGE,SELECT,UPDATE')
        or exists(select 1 from aclexplode(coalesce(sequence.relacl,acldefault('S',sequence.relowner))) privilege where privilege.grantee=0))) then
    raise exception using errcode='55000',message='ticket_sequence_existing_acl_requires_review';
  end if;
end;
$ticket_preflight$;

-- Worker jobs are backend state. Production's default ALL table grants plus
-- its authenticated membership policy otherwise let a client change both
-- business deadlines and technical retry clocks. Keep existing SELECT/RLS
-- behavior and service_role privileges; remove only direct client mutations.
do $restrict_worker_job_mutations$
declare
  jobs oid:=to_regclass('public.lead_redistribution_jobs');
  columns text;
begin
  if jobs is null or not exists(select 1 from pg_class relation
    where relation.oid=jobs and relation.relkind='r' and relation.relrowsecurity) then
    raise exception using errcode='55000',message='worker_jobs_missing_rls_boundary';
  end if;
  if exists(select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE']) permission
    where not has_table_privilege('service_role',jobs,permission)) then
    raise exception using errcode='55000',message='worker_jobs_missing_service_role_privileges';
  end if;
  revoke insert,update,delete,truncate,references,trigger
    on table public.lead_redistribution_jobs from public,anon,authenticated;
  -- Column grants survive a table-level REVOKE. Revoke only the three
  -- mutating column privileges, retaining any column-level SELECT grant.
  select string_agg(format('%I',attribute.attname),',' order by attribute.attnum)
  into columns from pg_attribute attribute where attribute.attrelid=jobs
    and attribute.attnum>0 and not attribute.attisdropped;
  execute format('revoke insert (%s),update (%s),references (%s) on table public.lead_redistribution_jobs from public,anon,authenticated',
    columns,columns,columns);
  -- Check effective privileges, including grants inherited from another role.
  -- Unexpected inherited authority needs review instead of a silent bypass.
  if exists(select 1 from unnest(array['anon','authenticated']) role
    cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) permission
    where has_table_privilege(role,jobs,permission))
    or exists(select 1 from unnest(array['anon','authenticated']) role
      cross join unnest(array['INSERT','UPDATE','REFERENCES']) permission
      where has_any_column_privilege(role,jobs,permission)) then
    raise exception using errcode='55000',message='worker_jobs_client_mutation_privilege_remains';
  end if;
  if exists(select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE']) permission
    where not has_table_privilege('service_role',jobs,permission)) then
    raise exception using errcode='55000',message='worker_jobs_service_role_privileges_changed';
  end if;
end;
$restrict_worker_job_mutations$;

commit;
