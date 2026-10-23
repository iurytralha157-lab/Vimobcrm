import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseAssigneeClockTarget, sourceFunction } from './test-pipeline-assignee-clocks-postgres.mjs';

test('requires the explicit marker and rejects remote/default/options-bearing targets before connecting', () => {
  for (const [marker, target] of [
    ['', 'postgresql://postgres@127.0.0.1:57962/postgres'],
    ['LOCAL_WRITE_TEST', 'postgresql://postgres@db.example:57962/postgres'],
    ['LOCAL_WRITE_TEST', 'postgresql://postgres@127.0.0.1/postgres'],
    ['LOCAL_WRITE_TEST', 'postgresql://postgres@127.0.0.1:5432/postgres'],
    ['LOCAL_WRITE_TEST', 'postgresql://postgres@127.0.0.1:57962/app'],
    ['LOCAL_WRITE_TEST', 'postgresql://service_role@127.0.0.1:57962/postgres'],
    ['LOCAL_WRITE_TEST', 'postgresql://postgres:secret@127.0.0.1:57962/postgres'],
    ['LOCAL_WRITE_TEST', 'postgresql://postgres@127.0.0.1:57962/postgres?host=db.example'],
    ['LOCAL_WRITE_TEST', 'postgresql://postgres@127.0.0.1:57962/postgres#fragment'],
    ['LOCAL_WRITE_TEST', 'invalid'],
  ]) assert.throws(() => parseAssigneeClockTarget(marker, target));
  assert.equal(parseAssigneeClockTarget('LOCAL_WRITE_TEST', 'postgresql://postgres@127.0.0.1:57962/postgres').host, '127.0.0.1');
  assert.equal(parseAssigneeClockTarget('LOCAL_WRITE_TEST', 'postgresql://postgres@[::1]:57962/postgres').host, '::1');
});

test('extracts the real migration function without changing its security or status branches', async () => {
  const read = name => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
  const previous = sourceFunction(await read('20261016043851_pipeline_stage_assignee_team_consistency.sql'), 'public.execute_stage_automations').replaceAll('\r\n', '\n');
  const updated = sourceFunction(await read('20261016121216_pipeline_stage_assignee_clock_consistency.sql'), 'public.execute_stage_automations').replaceAll('\r\n', '\n');
  // The full function is redefined by SQL; enforce that every other branch,
  // tenant/team predicate and security option is identical to its predecessor.
  const restored = updated.replace(/\) and new\.assigned_user_id is distinct from target_user_id then\n[\s\S]*?\n        end if;\n      end if;/,
    ') then\n        new.assigned_user_id := target_user_id;\n      end if;');
  assert.notEqual(restored, updated, 'the new assignment-clock branch exists');
  assert.equal(restored, previous, 'no unrelated function behavior or security clause changed');
});

test('fixture declares every lead column referenced by the imported real functions and trigger column lists', async () => {
  const source = await readFile(new URL('./test-pipeline-assignee-clocks-postgres.mjs', import.meta.url), 'utf8');
  const table = source.match(/create table public\.leads\(([\s\S]*?)\);/)[1];
  const declared = new Set([...table.matchAll(/(?:^|,)\s*([a-z_]\w*)\s+\w+/g)].map(match => match[1]));
  const read = name => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
  const base = await read('20260722000000_production_public_private_baseline.sql');
  const history = await read('20260921115616_add_silent_historical_lead_import.sql');
  const functions = [
    sourceFunction(base, 'public.set_lead_assigned_at', true),
    sourceFunction(base, 'public.set_lead_assigned_at_on_insert', true),
    sourceFunction(await read('20260912172606_advance_pipeline_board_order_on_reentry_and_distribution.sql'), 'private.guard_lead_clocks'),
    sourceFunction(await read('20260913104722_repair_cadence_operational_schema.sql'), 'private.capture_lead_cycles'),
    sourceFunction(await read('20261016121216_pipeline_stage_assignee_clock_consistency.sql'), 'public.execute_stage_automations'),
  ];
  const referenced = new Set(functions.flatMap(body => [...body.matchAll(/\b(?:new|old)\.([a-z_]\w*)/gi)]
    .map(match => match[1].toLowerCase())));
  for (const name of ['tr_set_assigned_at', 'tr_set_assigned_at_insert', 'trg_guard_lead_clocks',
    'trigger_execute_stage_automations', 'trg_capture_lead_cycles']) {
    const trigger = history.match(new RegExp(`create trigger ${name}\\s[\\s\\S]*?execute function [^;]+;`, 'i'))[0];
    const columns = trigger.match(/update of\s+([\s\S]*?)\s+on public\.leads/i)?.[1];
    for (const column of columns?.split(',') ?? []) referenced.add(column.trim());
    for (const match of trigger.matchAll(/\b(?:new|old)\.([a-z_]\w*)/gi)) referenced.add(match[1].toLowerCase());
  }
  assert.deepEqual([...referenced].filter(column => !declared.has(column)), [], 'fixture must support the whole imported trigger composition');
});
