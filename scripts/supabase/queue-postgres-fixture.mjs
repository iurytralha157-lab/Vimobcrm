import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export const lockWaitObservations = [];

export const openWeek = () => ({ version: 1, timezone: 'UTC', days: Array.from({ length: 7 }, (_, day_of_week) =>
  ({ day_of_week, is_active: true, is_all_day: true, start_time: null, end_time: null })) });
export const closedWeek = () => ({ ...openWeek(), days: openWeek().days.map(day => ({ ...day, is_active: false })) });

export async function seed(db, { pool = false, count = 5 } = {}) {
  const f = { org: randomUUID(), queue: randomUUID(), lead: randomUUID(), role: randomUUID(), users: Array.from({ length: count }, randomUUID) };
  await db.query('insert into public.organizations(id) values($1)', [f.org]);
  for (const [position, user] of f.users.entries()) {
    await db.query('insert into public.users(id,name) values($1,$2)', [user, `Synthetic concurrency ${position}`]);
    await db.query('insert into public.organization_members(organization_id,user_id) values($1,$2)', [f.org, user]);
  }
  await db.query('insert into public.organization_roles(id,organization_id,name) values($1,$2,$3)', [f.role, f.org, 'Synthetic queue operator']);
  await db.query(`insert into public.organization_role_permissions(organization_id,role_id,permission_key,permission_id)
    values($1,$2,'lead_operate',(select id from public.available_permissions where key='lead_operate'))`, [f.org, f.role]);
  for (const user of f.users) await db.query('insert into public.user_organization_roles(organization_id,user_id,role_id) values($1,$2,$3)', [f.org, user, f.role]);
  await db.query('insert into public.round_robins(id,organization_id,settings) values($1,$2,$3)', [f.queue, f.org, {
    enable_redistribution: true, redistribution_timeout_minutes: 1, redistribution_warning_minutes: 0,
    redistribution_max_attempts: 0, operating_schedule: pool ? closedWeek() : openWeek(),
  }]);
  for (const [position, user] of f.users.entries()) {
    await db.query(`insert into public.round_robin_members(id,organization_id,round_robin_id,user_id,position)
      values($1,$2,$3,$4,$5)`, [randomUUID(), f.org, f.queue, user, position + 1]);
  }
  await newLead(db, f, f.lead);
  const result = await distribute(db, f, f.lead, 'setup');
  assert.equal(result.reason, pool ? 'queue_closed' : 'assigned');
  return f;
}

export async function newLead(db, f, lead = randomUUID()) {
  await db.query('insert into public.leads(id,organization_id,origin_round_robin_id) values($1,$2,$3)', [lead, f.org, f.queue]);
  return lead;
}

export async function distribute(db, f, lead = f.lead, key = randomUUID()) {
  return (await db.query(`select private.distribute_lead($1,$2,$3,$4,false,'meta') result`, [f.org, lead, key, f.queue])).rows[0].result;
}
export async function runtime(db, f) {
  return (await db.query('select * from private.queue_lead_runtime where organization_id=$1 and lead_id=$2', [f.org, f.lead])).rows[0];
}
export async function claim(db, f, actor, key, r) {
  return (await db.query('select private.claim_queue_pool($1,$2,$3,$4,$5,$6,$7) result',
    [f.org, f.lead, actor, f.queue, r.episode_id, r.revision, key])).rows[0].result;
}
export async function step(db, f, { force = false } = {}) {
  return (await db.query('select private.queue_runtime_step($1,$2,clock_timestamp(),$3) result', [f.org, f.lead, force])).rows[0].result;
}
export async function expire(db, f) {
  await db.query(`update private.queue_lead_runtime set due_at=clock_timestamp()-interval '1 minute',
    next_action_at=clock_timestamp()-interval '1 second' where organization_id=$1 and lead_id=$2`, [f.org, f.lead]);
}
export async function parkOtherWork(db, f) {
  // Each batch case owns one synthetic organization. Previous cases retain
  // committed evidence but must not become unrelated timed work mid-test.
  await db.query("update private.queue_lead_runtime set next_action_at=clock_timestamp()+interval '1 day' where organization_id<>$1 and next_action_at is not null", [f.org]);
}
export async function snapshot(db, f) {
  return (await db.query(`select jsonb_build_object('owner',l.assigned_user_id,'assigned_at',l.assigned_at,
    'runtime',to_jsonb(r),'visits',(select count(*) from private.queue_round_visits v where v.organization_id=$1 and v.lead_id=$2),
    'logs',(select count(*) from public.assignments_log a where a.organization_id=$1 and a.lead_id=$2),
    'events',(select count(*) from private.queue_runtime_events e where e.organization_id=$1 and e.lead_id=$2),
    'notifications',(select count(*) from public.notifications n where n.organization_id=$1 and n.lead_id=$2)) result
    from public.leads l join private.queue_lead_runtime r on r.organization_id=l.organization_id and r.lead_id=l.id
    where l.organization_id=$1 and l.id=$2`, [f.org, f.lead])).rows[0].result;
}
export async function invariants(db) {
  const { rows: [r] } = await db.query(`select
    (select count(*) from private.queue_lead_runtime r join public.leads l on l.id=r.lead_id and l.organization_id=r.organization_id
      where r.state in ('pool_ready','pool_waiting','limit_exhausted') and l.assigned_user_id is not null) as pool_owned,
    (select count(*) from private.queue_lead_runtime r join public.leads l on l.id=r.lead_id and l.organization_id=r.organization_id
      where r.state in ('auto_assigned','manual_protected','human_protected') and l.assigned_user_id is null) as protected_unowned,
    (select count(*) from private.queue_round_visits v join private.queue_lead_runtime r using(organization_id,lead_id)
      where v.episode_id<>r.episode_id or v.round_number>r.round_number) as invalid_visits,
    (select count(*) from private.queue_runtime_commands) as leaked_commands,
    (select count(*) from private.queue_lead_runtime r join public.round_robins q on q.id=r.round_robin_id
      where q.organization_id<>r.organization_id) as crossed_tenants`);
  for (const [name, value] of Object.entries(r)) assert.equal(Number(value), 0, name);
}

// Observe actual blocking; a timer alone never proves sessions overlapped.
export async function waitForBlocked(observer, pid, description, signal) {
  const end = Date.now() + 5000;
  do {
    const { rows: [row] } = await observer.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1', [pid]);
    if (signal?.aborted) return null;
    if (row?.wait_event_type === 'Lock') {
      lockWaitObservations.push({ description, pid, waitEvent: row.wait_event, observedAt: new Date().toISOString() });
      return row;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  } while (Date.now() < end);
  throw new Error(`No observed PostgreSQL lock wait: ${description}`);
}

export async function armBarrier(observer, connection, key) {
  await observer.query('select pg_advisory_lock($1)', [key]);
  await connection.query("select set_config('queue_homologation.pause',$1,false)", [String(key)]);
}
export async function releaseBarrier(observer, connection, key) {
  await observer.query('select pg_advisory_unlock($1)', [key]);
  await connection.query("select set_config('queue_homologation.pause','',false)");
}

export async function installTestHooks(db) {
  await db.query(`create schema if not exists queue_homologation;
    create or replace function queue_homologation.pause_assignment() returns trigger language plpgsql as $$
    declare barrier text:=current_setting('queue_homologation.pause',true);
    begin
      if barrier is not null and barrier<>'' and new.assigned_user_id is distinct from old.assigned_user_id then
        perform pg_advisory_xact_lock(barrier::bigint);
      end if;
      return new;
    end; $$;
    create trigger zzzz_homologation_pause_assignment before update of assigned_user_id on public.leads
      for each row execute function queue_homologation.pause_assignment();
    create or replace function queue_homologation.fail_notification() returns trigger language plpgsql as $$
    begin
      if current_setting('queue_homologation.fail_notification',true)='yes' then
        raise exception using errcode='P0001',message='synthetic_notification_failure';
      end if;
      return new;
    end; $$;
    create trigger zzzz_homologation_fail_notification before insert on public.notifications
      for each row execute function queue_homologation.fail_notification();`);
}
