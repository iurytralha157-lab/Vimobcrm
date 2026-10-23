-- Activity UPDATE/DELETE already own their child tuple before row triggers run.
-- A lead deletion owns the parent first and cascades to the same activity, so
-- no activity trigger may wait for a parent while retaining that child lock.
-- Keep the existing human-fact and client-pool guards authoritative; acquire
-- their parent locks first with a typed, atomic retry outcome instead.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function private.guard_activity_parent_lock_order() returns trigger
language plpgsql security definer set search_path='' as $function$
declare previous_id uuid; incoming_id uuid;
begin
  if tg_op<>'INSERT' then previous_id:=old.lead_id;end if;
  if tg_op<>'DELETE' then incoming_id:=new.lead_id;end if;
  begin
    -- Use the parent tenant, not the activity's supplied organization_id. IN
    -- deduplicates an unchanged relationship; ordering also covers reparenting.
    -- Include legacy parents: the later client guard locks those too. Trusted
    -- writers use the same fence, including concurrent runtime initialization.
    perform 1 from public.leads lead where lead.id in(previous_id,incoming_id)
      order by lead.organization_id,lead.id for no key update nowait;
  exception when lock_not_available then
    raise exception using errcode='55P03',message='queue_activity_lead_busy_retry';
  end;
  if tg_op='DELETE' then return old;end if;return new;
end;
$function$;
revoke all on function private.guard_activity_parent_lock_order() from public,anon,authenticated,service_role;

-- PostgreSQL executes same-kind triggers alphabetically. This must precede
-- a_queue_runtime_human_fact_gate AND b_queue_pool_activity_mutation_gate.
create trigger a_activity_parent_lock_order_gate before insert or update or delete on public.activities
  for each row execute function private.guard_activity_parent_lock_order();

-- Compatible with the previous API: lead-first activity creation and cascade
-- deletion reuse their own locks. Inverse writers receive SQLSTATE 55P03 and
-- must retry their entire rolled-back transaction; nothing is acknowledged as
-- saved. No grants, RLS, facts, ownership or historical data are changed.
-- Forward rollback: drop this trigger and function together in a new migration.
-- It restores the former lock behavior and reopens the audited deadlock cycle.
commit;
