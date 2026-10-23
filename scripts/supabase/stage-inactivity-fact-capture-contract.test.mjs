import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const original = readFileSync('supabase/migrations/20261013015858_stage_inactivity_runtime_scaffold.sql', 'utf8').replaceAll('\r\n', '\n');
const migration = readFileSync('supabase/migrations/20261016164738_fence_stage_inactivity_fact_capture.sql', 'utf8').replaceAll('\r\n', '\n');
const definition = source => {
  const match = source.match(/create or replace function private\.record_lead_action_fact\([\s\S]*?\n\$\$;/);
  assert.ok(match, 'the real canonical fact producer must be present');
  return match[0];
};
const join = `        join public.stage_automations automation
          on automation.id = policy.automation_id
         and automation.organization_id = policy.organization_id
         and automation.stage_id = policy.stage_id
         and automation.updated_at = policy.automation_updated_at
         and automation.trigger_type = 'inactivity'
`;

test('forward migration changes only the policy identity gate, preserving shared fact behavior', () => {
  const next = definition(migration);
  assert.ok(next.includes(join));
  assert.equal(next.replace(join, ''), definition(original),
    'attention, cadence, suppression, classification, dedupe and lead locking must stay identical');
});

test('fact coverage continues while paused without adding parent locks or changing privileges', () => {
  const next = definition(migration);
  assert.doesNotMatch(next, /automation\.is_active|policy\.is_enabled/);
  assert.match(next, /for share of lead;/);
  assert.doesNotMatch(next, /for (?:share|update) of (?:automation|policy)/);
  const statements = migration.replace(/^--.*$/gm, '').replace(next, '').trim().replace(/\n{3,}/g, '\n\n');
  assert.equal(statements, "begin;\nset local lock_timeout = '5s';\nset local statement_timeout = '30s';\n\ncommit;",
    'the migration must not create workers, backfill data or alter other objects');
});
