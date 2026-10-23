import { readFile } from 'node:fs/promises';

// Deliberately no DB client, environment loading or executable entry point.
// The existing local harness must verify the disposable target before execution.
const cases = new Map([
  ['stage', 'queue_stage_assignment.regression.sql'],
  ['activity', 'queue_activity_pool.regression.sql'],
  ['activity-clock-before', 'queue_activity_clock.regression.sql'],
  ['activity-clock-after', 'queue_activity_clock.regression.sql'],
]);

export async function queueAlgorithmRegressionSQL(name) {
  if (!cases.has(name)) throw new Error('Unknown queue algorithm regression');
  const root = new URL('../../supabase/tests/', import.meta.url);
  const [fixture, test] = await Promise.all([
    readFile(new URL('queue_algorithm_fixes.fixture.sql', root), 'utf8'),
    readFile(new URL(cases.get(name), root), 'utf8'),
  ]);
  const clockMode = name.startsWith('activity-clock-')
    ? `set local vimob.queue_clock_probe_expect='${name.endsWith('-after') ? 'fixed' : 'vulnerable'}';\n` : '';
  return `begin;\nset local statement_timeout='60s';\nset local lock_timeout='5s';\n${clockMode}${fixture}\n${test}\nset constraints all immediate;\nrollback;\n`;
}
