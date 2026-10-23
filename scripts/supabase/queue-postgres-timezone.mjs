import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { seed, runtime, claim, snapshot, openWeek, closedWeek } from './queue-postgres-fixture.mjs';

function definition(source, name) {
  const start = source.indexOf(`create or replace function private.${name}(`);
  const end = source.indexOf('$function$;', source.indexOf('$function$', start) + 10);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end + 11);
}

export async function runTimezoneCases({ observer: db, sessions, test }) {
  await test('timezone catalog equals PostgreSQL names and rejects invalid JSON and POSIX-only zones', async () => {
    const { rows: [difference] } = await db.query(`with actual as materialized(select name from pg_catalog.pg_timezone_names)
      select (select count(*)::int from (select name from actual except select name from private.queue_timezone_catalog)x) missing,
        (select count(*)::int from (select name from private.queue_timezone_catalog except select name from actual)x) extra`);
    assert.deepEqual(difference, { missing: 0, extra: 0 });
    for (const timezone of ['UTC', 'Etc/UTC', 'GMT', 'America/Sao_Paulo', 'Asia/Kolkata', 'Europe/Lisbon']) {
      assert.equal((await db.query('select private.queue_schedule_valid($1) valid', [{ ...openWeek(), timezone }])).rows[0].valid, true, timezone);
    }
    assert.ok((await db.query("select timestamp '2026-01-01' at time zone 'FOO3' accepted_posix")).rows[0].accepted_posix);
    const invalid = [null, {}, [], { ...openWeek(), version: 2 }, { ...openWeek(), timezone: 'FOO3' },
      { ...openWeek(), timezone: 'UTC+03' }, { ...openWeek(), timezone: 'Not/A_Zone' },
      { ...openWeek(), timezone: null }, { ...openWeek(), days: {} },
      { ...openWeek(), days: openWeek().days.slice(1) },
      { ...openWeek(), days: openWeek().days.map(() => openWeek().days[0]) },
      { ...openWeek(), days: openWeek().days.map(day => ({ ...day, is_active: 'true' })) },
      { ...openWeek(), days: openWeek().days.map(day => ({ ...day, is_all_day: false, start_time: '25:00', end_time: '26:00' })) }];
    for (const value of invalid) assert.equal((await db.query('select private.queue_schedule_valid($1) valid', [value])).rows[0].valid, false, JSON.stringify(value));
    assert.equal((await db.query('select private.queue_schedule_valid($1) valid', [closedWeek()])).rows[0].valid, true);
  });

  await test('timezone names and refresh are inaccessible to anon authenticated and service role', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const { rows: [acl] } = await db.query(`select has_table_privilege($1,'private.queue_timezone_catalog','SELECT') can_read,
        has_function_privilege($1,'private.refresh_queue_timezone_catalog()','EXECUTE') can_refresh,
        has_function_privilege($1,'private.queue_timezone_name_valid(text)','EXECUTE') can_validate`, [role]);
      assert.deepEqual(acl, { can_read: false, can_refresh: false, can_validate: false });
      await db.query(`set role ${role}`);
      try {
        for (const sql of ['select * from private.queue_timezone_catalog', 'select private.refresh_queue_timezone_catalog()']) {
          await assert.rejects(db.query(sql), error => error.code === '42501');
        }
      } finally { await db.query('reset role'); }
    }
    const { rows: [properties] } = await db.query(`select p.prosecdef definer,p.proconfig configuration
      from pg_proc p where p.oid='private.refresh_queue_timezone_catalog()'::regprocedure`);
    assert.equal(properties.definer, true);
    assert.ok(properties.configuration.some(value => value.startsWith('search_path=') && value.includes('""')));
  });

  await test('cached validator and one-window membership preserve predecessor DST overnight UTC and alias semantics', async () => {
    const schedule = await fs.readFile(new URL('../../supabase/migrations/20261015022236_queue_operating_schedule_contract.sql', import.meta.url), 'utf8');
    const members = await fs.readFile(new URL('../../supabase/migrations/20261015022536_queue_runtime_state_and_audience.sql', import.meta.url), 'utf8');
    await db.query(definition(schedule, 'queue_schedule_valid').replace('private.queue_schedule_valid(', 'queue_homologation.pre_perf_schedule_valid('));
    await db.query(definition(schedule, 'queue_window').replace('private.queue_window(', 'queue_homologation.pre_perf_window(')
      .replaceAll('private.queue_schedule_valid(', 'queue_homologation.pre_perf_schedule_valid('));
    await db.query(definition(members, 'queue_runtime_members').replace('private.queue_runtime_members(', 'queue_homologation.pre_perf_members(')
      .replaceAll('private.queue_window(', 'queue_homologation.pre_perf_window('));
    const f = await seed(db);
    const at = ['2026-03-08T06:30:00Z', '2026-11-01T05:30:00Z', '2026-10-15T04:30:00Z'];
    // Official PostgreSQL images may omit optional backward aliases such as
    // US/Eastern. Use the canonical DST zone and a verified UTC alias.
    for (const timezone of ['UTC', 'Etc/UTC', 'America/New_York', 'America/Sao_Paulo']) {
      const operating = { ...openWeek(), timezone, days: openWeek().days.map(day => ({ ...day, is_all_day: false, start_time: '22:00', end_time: '06:00' })) };
      await db.query("update public.round_robins set settings=jsonb_set(settings,'{operating_schedule}',$1) where id=$2", [operating, f.queue]);
      for (const timestamp of at) {
        const { rows: [windows] } = await db.query('select private.queue_window($1,$2,$3) current,queue_homologation.pre_perf_window($1,$2,$3) previous', [f.org, f.queue, timestamp]);
        assert.deepEqual(windows.current, windows.previous);
        const current = (await db.query('select * from private.queue_runtime_members($1,$2,$3) order by user_id', [f.org, f.queue, timestamp])).rows;
        const previous = (await db.query('select * from queue_homologation.pre_perf_members($1,$2,$3) order by user_id', [f.org, f.queue, timestamp])).rows;
        assert.deepEqual(current, previous);
      }
    }
  });

  await test('invalid schedule fails closed without hiding the queue roster and postgres refresh restores names atomically', async () => {
    const f = await seed(db), before = await snapshot(db, f);
    await db.query('begin');
    try {
      await db.query('alter table public.round_robins disable trigger zz_validate_queue_operating_schedule');
      await db.query("update public.round_robins set settings=jsonb_set(settings,'{operating_schedule,timezone}','\"FOO3\"') where id=$1", [f.queue]);
      await db.query('alter table public.round_robins enable trigger zz_validate_queue_operating_schedule');
      const { rows: [window] } = await db.query('select private.queue_window($1,$2,clock_timestamp()) value', [f.org, f.queue]);
      assert.equal(window.value.valid, false); assert.equal(window.value.open, false);
      const members = (await db.query('select * from private.queue_runtime_members($1,$2,clock_timestamp())', [f.org, f.queue])).rows;
      assert.equal(members.length, f.users.length);
      assert.ok(members.every(member => !member.is_available && member.window_key.startsWith('closed:')));
    } finally { await db.query('rollback'); }
    assert.deepEqual(await snapshot(db, f), before);
    await db.query("delete from private.queue_timezone_catalog where name='UTC'");
    assert.equal((await db.query("select private.queue_timezone_name_valid('UTC') valid")).rows[0].valid, false);
    assert.ok((await db.query('select private.refresh_queue_timezone_catalog() names')).rows[0].names > 100);
    assert.equal((await db.query("select private.queue_timezone_name_valid('UTC') valid")).rows[0].valid, true);
    assert.deepEqual(await snapshot(db, f), before);
  });

  await test('claim with nonexistent queue is opaque not_found and leaves all ledgers unchanged', async () => {
    const f = await seed(db, { pool: true }), r = await runtime(db, f), before = await snapshot(db, f);
    const result = await claim(db, { ...f, queue: randomUUID() }, f.users[0], randomUUID(), r);
    assert.deepEqual(result, { success: false, reason: 'not_found' });
    assert.deepEqual(await snapshot(db, f), before);
  });

  await test('claim with another tenant queue is opaque not_found even while the foreign queue is locked', async () => {
    const f = await seed(db, { pool: true }), foreign = await seed(db, { pool: true });
    const r = await runtime(db, f), before = await snapshot(db, f), otherBefore = await snapshot(db, foreign);
    await sessions[0].query('begin');
    try {
      await sessions[0].query('select 1 from public.round_robins where id=$1 for update', [foreign.queue]);
      const result = await claim(sessions[1], { ...f, queue: foreign.queue }, f.users[0], randomUUID(), r);
      assert.deepEqual(result, { success: false, reason: 'not_found' });
    } finally { await sessions[0].query('rollback'); }
    assert.deepEqual(await snapshot(db, f), before);
    assert.deepEqual(await snapshot(db, foreign), otherBefore);
  });

  await test('claim with a real locked tenant queue is queue_busy without owner runtime receipt or outbox changes', async () => {
    const f = await seed(db, { pool: true }), r = await runtime(db, f), before = await snapshot(db, f);
    await sessions[0].query('begin');
    try {
      await sessions[0].query('select 1 from public.round_robins where id=$1 for update', [f.queue]);
      assert.deepEqual(await claim(sessions[1], f, f.users[0], randomUUID(), r), { success: false, reason: 'queue_busy' });
    } finally { await sessions[0].query('rollback'); }
    assert.deepEqual(await snapshot(db, f), before);
  });
}
