import assert from 'node:assert/strict';
import { connectVerifiedDatabase } from './queue-local-homologation-target.mjs';
import { expireSyntheticLead, snapshot } from './queue-full-schema-support.mjs';

async function observedLock(context, session, expected, signal) {
  const end = Date.now() + 12_000;
  while (Date.now() < end && !signal?.aborted) {
    const row = (await context.db.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1', [session])).rows[0];
    if (row?.wait_event_type === 'Lock' && (!expected || row.wait_event === expected)) {
      context.observations.push({ test: 'observed-full-schema-lock', pid: session, waitEvent: row.wait_event });
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (signal?.aborted) return false;
  throw new Error(`Real PostgreSQL lock overlap was not observed for session ${session}.`);
}

async function interleave(context, a, b, pids, key, operation, mutation) {
  await context.db.query('select pg_advisory_lock($1)', [key]);
  await a.query("select set_config('queue_homologation_full.pause',$1,false)", [String(key)]);
  const pending = operation().then(result => ({ result }), error => ({ error }));
  let change;
  const controller = new AbortController();
  try {
    await observedLock(context, pids[0], 'advisory');
    change = mutation().then(result => ({ result }), error => ({ error }));
    const overlap = await Promise.race([
      change.then(result => ({ mutationCompletedBeforeRelease: true, mutationError: result.error?.code })),
      observedLock(context, pids[1], null, controller.signal).then(observed => ({ serialized: observed })),
    ]);
    controller.abort();
    await context.db.query('select pg_advisory_unlock($1)', [key]);
    const assigned = await pending, changed = await change;
    return { ...assigned, mutationError: changed.error, serialized: Boolean(overlap.serialized) };
  } finally {
    controller.abort();
    await context.db.query('select pg_advisory_unlock($1)', [key]);
    await pending;
    if (change) await change;
    await a.query("select set_config('queue_homologation_full.pause','',false)");
  }
}

async function installHooks(context) {
  // This hook pauses AFTER production guards. It is scoped by a session-local
  // setting and the already-attested synthetic organizations. No production
  // function, role, policy or validation path is replaced.
  await context.db.query(`create schema if not exists queue_homologation_full;
    create or replace function queue_homologation_full.pause_assignment() returns trigger language plpgsql as $$
    declare barrier text:=current_setting('queue_homologation_full.pause',true);
    begin
      if barrier is not null and barrier<>'' and new.organization_id=nullif(current_setting('queue_homologation_full.org',true),'')::uuid
        and new.assigned_user_id is distinct from old.assigned_user_id then perform pg_advisory_xact_lock(barrier::bigint); end if;
      return new;
    end; $$;
    drop trigger if exists zzzzzz_full_schema_pause_assignment on public.leads;
    create trigger zzzzzz_full_schema_pause_assignment before update of assigned_user_id on public.leads
      for each row execute function queue_homologation_full.pause_assignment();`);
}

async function removeHooks(context) {
  await context.db.query('drop trigger if exists zzzzzz_full_schema_pause_assignment on public.leads; drop function if exists queue_homologation_full.pause_assignment(); drop schema if exists queue_homologation_full;');
}

async function nextRecipient(context, org, lead) {
  return (await context.db.query(`select m.user_id from private.queue_lead_runtime r
    cross join lateral private.queue_runtime_members(r.organization_id,r.round_robin_id,clock_timestamp()) m
    where r.organization_id=$1 and r.lead_id=$2 and m.is_available and m.user_id is distinct from r.last_user_id
      and not exists(select 1 from private.queue_round_visits v where v.organization_id=r.organization_id and v.lead_id=r.lead_id
        and v.episode_id=r.episode_id and v.round_number=r.round_number and v.user_id=m.user_id)
    order by (m.position>r.last_position or (m.position=r.last_position and m.user_id>r.last_user_id)) desc,m.position,m.user_id limit 1`, [org.id, lead.id])).rows[0]?.user_id;
}

export async function runFullSchemaRaces(context, test) {
  const org = context.fixture.organizations[0];
  const a = await connectVerifiedDatabase(context.manifest), b = await connectVerifiedDatabase(context.manifest);
  const pids = [(await a.query('select pg_backend_pid() pid')).rows[0].pid, (await b.query('select pg_backend_pid() pid')).rows[0].pid];
  // The server must cancel work before node-pg's 15-second client deadline.
  await a.query("set statement_timeout='10s'");
  await b.query("set statement_timeout='10s'");
  await a.query("select set_config('queue_homologation_full.org',$1,false)", [org.id]);
  let installed = false;
  try {
    await installHooks(context);
    installed = true;
    for (const [index, kind] of ['recipient-revocation', 'roster-removal', 'human-first-response'].entries()) {
      await test(`full-schema actual lock race: ${kind}`, async () => {
        const queue = await context.createQueue(org, `race-${kind}`);
        const lead = await context.createLead(org, queue, kind);
        const before = await snapshot(context, org, lead), next = await nextRecipient(context, org, lead);
        assert.ok(next);
        await expireSyntheticLead(context, org, lead);
        const operation = () => a.query('select private.queue_runtime_step($1,$2,clock_timestamp(),true) result', [org.id, lead.id]).then(result => result.rows[0].result);
        let mutation;
        if (kind === 'recipient-revocation') mutation = () => b.query('update public.organization_members set is_active=false where organization_id=$1 and user_id=$2', [org.id, next]);
        else if (kind === 'roster-removal') mutation = () => b.query('update public.round_robin_members set is_active=false where organization_id=$1 and round_robin_id=$2 and user_id=$3', [org.id, queue.id, next]);
        else mutation = () => b.query(`insert into public.lead_timeline_events(organization_id,lead_id,user_id,actor_user_id,event_type,title,metadata,event_at)
          values($1,$2,$3,$3,'first_response','Resposta Humana Sintética','{"is_automation":false}',clock_timestamp())`, [org.id, lead.id, before.owner]);
        const result = await interleave(context, a, b, pids, 915100 + index, operation, mutation);
        const after = await snapshot(context, org, lead);
        context.observations.push({ test: `full-schema-${kind}`, leadId: lead.id, beforeOwner: before.owner, afterOwner: after.owner,
          candidate: next, serialized: result.serialized, assignmentCode: result.error?.code || result.result?.reason,
          mutationCode: result.mutationError?.code || 'committed', mutationCommittedBeforeRelease: !result.serialized && !result.mutationError });
        try {
          if (result.mutationError) {
            assert.equal(result.mutationError.code, '55P03', 'Capability mutation must fail atomically when its queue is busy.');
            assert.equal(result.result?.reason, 'assigned');
            assert.notEqual(kind, 'human-first-response', 'Human fact writes must serialize rather than lose a confirmed action.');
            const active = kind === 'recipient-revocation'
              ? await context.db.query('select is_active from public.organization_members where organization_id=$1 and user_id=$2', [org.id, next])
              : await context.db.query('select is_active from public.round_robin_members where organization_id=$1 and round_robin_id=$2 and user_id=$3', [org.id, queue.id, next]);
            assert.equal(active.rows[0].is_active, true, 'Rejected capability mutation must retain its original active row.');
          } else if (result.error) assert.ok(['23514', '40001', '55P03'].includes(result.error.code));
          else {
            assert.ok(result.serialized || (kind === 'human-first-response' ? after.owner === before.owner : after.owner !== next),
              'Conflicting human/capability change committed before a stale ownership decision.');
          }
        } finally {
          if (kind === 'recipient-revocation') {
            await context.db.query('update public.organization_members set is_active=true where organization_id=$1 and user_id=$2 and not is_active', [org.id, next]);
            for (const table of ['team_members', 'round_robin_members']) await context.db.query(`update public.${table} child set membership_generation=om.membership_generation
              from public.organization_members om where child.organization_id=$1 and child.user_id=$2 and om.organization_id=child.organization_id and om.user_id=child.user_id`, [org.id, next]);
          } else if (kind === 'roster-removal') await context.db.query('update public.round_robin_members set is_active=true where organization_id=$1 and round_robin_id=$2 and user_id=$3', [org.id, queue.id, next]);
        }
      });
    }
  } finally {
    await a.end(); await b.end();
    if (installed) await removeHooks(context);
  }
}
