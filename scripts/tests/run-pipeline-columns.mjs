import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));

// Local, synthetic regression suites. No CRM service, database or deployment.
export const pipelineColumnTestFiles = Object.freeze([
  'hooks/pipelines/pipeline-crud-session.runtime.test.mjs',
  'components/features/automations/stage-automation-create-scope.runtime.test.mjs',
  'components/features/pipelines/pipeline-screen/pipeline-editor-session.runtime.test.mjs',
  'hooks/pipelines/pipeline-editor-visit.runtime.test.mjs',
  'components/features/automations/stage-automation-revision.runtime.test.mjs',
  'components/features/pipelines/pipeline-screen/pipeline-settings.runtime.test.mjs',
  'components/features/pipelines/pipeline-screen/pipeline-stage-inline-save.runtime.test.mjs',
  'components/features/pipelines/stages-editor-mobile.runtime.test.mjs',
  'components/features/pipelines/pipeline-screen/stage-delete.runtime.test.mjs',
  'components/features/pipelines/pipeline-screen/delete-confirmation-retirement.test.mjs',
  'components/features/pipelines/pipeline-screen/pipeline-container-revision.runtime.test.mjs',
  'hooks/pipelines/pipeline-round-robin.runtime.test.mjs',
  'hooks/pipelines/pipeline-delete-remount.test.mjs',
  'hooks/pipelines/pipeline-automation-refresh.runtime.test.mjs',
  'hooks/pipelines/pipeline-catalog-recovery.runtime.test.mjs',
  'hooks/pipelines/pipeline-refresh-session.runtime.test.mjs',
  'lib/pipeline-stage-editor-draft.test.ts',
  'lib/validation/pipelines.test.ts',
  'lib/validation/pipeline-container-revision.test.ts',
  'lib/validation/pipeline-delete-revision.test.ts',
  'lib/validation/pipeline-round-robin-revision.test.ts',
  'lib/validation/stage-automation-revision.test.ts',
  'lib/access/pipeline-settings-access.test.ts',
  'lib/stage-automations-query-key.test.ts',
  'lib/pipeline-query-key.test.ts',
  'lib/pipeline-board-query.test.ts',
  'lib/pipeline-pagination-state.test.ts',
  'lib/pipeline-pagination-projections.test.ts',
  'lib/pipeline-board-cache.test.ts',
  'lib/pipeline-board-cache-filter-scope.test.ts',
  'lib/pipeline-stage-snapshot.test.ts',
  'lib/pipeline-filter-readiness.test.ts',
  'lib/pipeline-reliability.test.ts',
  'lib/query-placeholder-safety.test.ts',
  'lib/api/pipeline-board-meta-filters.test.ts',
  'lib/api/pipeline-stage-pagination.test.mjs',
  'lib/lead-realtime-policy.test.ts',
  'hooks/pipelines/pipeline-page.runtime.test.mjs',
  'hooks/pipelines/pipeline-background-restore.runtime.test.mjs',
  'components/features/pipelines/pipeline-screen/pipeline-board-interactions.runtime.test.mjs',
  'components/features/pipelines/pipeline-screen/pipeline-board-responsive.runtime.test.mjs',
  'components/features/pipelines/pipeline-screen/pipeline-stale-notice.runtime.test.mjs',
  'components/features/pipelines/pipeline-screen/pipeline-drag-animation.runtime.test.mjs',
  'components/features/pipelines/pipeline-screen/pipeline-pickup-contract.runtime.test.mjs',
  'components/features/pipelines/pipeline-screen/pipeline-gap-drop.runtime.test.mjs',
  'components/features/pipelines/pipeline-screen/board-order.runtime.test.mjs',
  'components/features/pipelines/pipeline-screen/pipeline-card-clock.runtime.test.mjs',
  'components/features/pipelines/pipeline-screen/model.test.ts',
  'components/features/pipelines/pipeline-screen/stage-view.test.ts',
  'components/features/pipelines/pipeline-screen/pipeline-layout.test.mts',
  'components/features/pipelines/pipeline-screen/stage-editor-contract.test.ts',
  'components/features/pipelines/pipeline-move-session.runtime.test.mjs',
  'components/features/pipelines/pipeline-recovery.runtime.test.mjs',
  'components/features/leads/lead-card-actions.runtime.test.mjs',
  'components/features/cadences/stage-operational-rules/rules-access.runtime.test.mjs',
  'components/features/cadences/stage-operational-rules/model.test.ts',
  'lib/validation/cadences.test.ts',
  'hooks/pipelines/empty-column-recovery.runtime.test.mjs',
  'lib/pipeline-stage-key.test.ts',
  'components/features/pipelines/stages-editor-key.runtime.test.mjs',
  'packages/contracts/openapi/pipeline-stage-key-contract.test.mjs',
  'components/features/pipelines/pipeline-screen/pipeline-drag-geometry.runtime.test.mjs',
  'hooks/leads/lead-card-outcome-draft.runtime.test.mjs',
  'hooks/leads/record-lead-contact-outcome.runtime.test.mjs',
]);

export function pipelineColumnTestEnvironment(inherited = process.env) {
  const environment = { ...inherited };
  for (const key of Object.keys(environment)) {
    // Regression controls must run against this checkout, never inherited RED
    // sources, real-service opt-ins, database credentials or alternate loaders.
    if (/(^|_)(TEST|E2E|INTEGRATION)(_|$)|DATABASE_URL|SUPABASE|^VIMOB_RUN_|_SOURCE(_FILE)?$|BEFORE_DIR$|^NODE_OPTIONS$|^PIPELINE_BOARD_ASSERT_FIXED$/i.test(key)) {
      delete environment[key];
    }
  }
  return environment;
}

function optionsFromArguments(arguments_) {
  const files = [];
  let concurrency = 1;
  let list = false;
  for (const argument of arguments_) {
    if (argument === '--list') list = true;
    else if (argument.startsWith('--file=')) files.push(argument.slice('--file='.length).replaceAll('\\', '/'));
    else if (/^--concurrency=[12]$/.test(argument)) concurrency = Number(argument.at(-1));
    else throw new Error(`Unknown Pipeline test option: ${argument}`);
  }
  const selected = files.length ? files : [...pipelineColumnTestFiles];
  if (new Set(selected).size !== selected.length) throw new Error('Duplicate Pipeline test file');
  for (const file of selected) {
    if (!pipelineColumnTestFiles.includes(file) || !existsSync(resolve(repository, file))) {
      throw new Error(`Unknown or missing Pipeline test file: ${file}`);
    }
  }
  return { files: selected, concurrency, list };
}

export async function runPipelineColumnTests(arguments_ = process.argv.slice(2)) {
  if (new Set(pipelineColumnTestFiles).size !== pipelineColumnTestFiles.length) throw new Error('Duplicate canonical Pipeline test file');
  const options = optionsFromArguments(arguments_);
  if (options.list) {
    process.stdout.write(`${JSON.stringify(options, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(`PIPELINE_COLUMNS_FILES ${JSON.stringify(options)}\n`);
  const child = spawn(process.execPath, [
    '--experimental-strip-types', '--import', './scripts/tests/typescript-alias-hooks.mjs',
    '--test', '--test-reporter=tap', `--test-concurrency=${options.concurrency}`, ...options.files,
  ], { cwd: repository, env: pipelineColumnTestEnvironment(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data.toString(); process.stdout.write(data); });
  child.stderr.on('data', data => { output += data.toString(); process.stderr.write(data); });
  const code = await new Promise((resolveCode, reject) => { child.once('error', reject); child.once('close', resolveCode); });
  const counts = {};
  for (const field of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const last = [...output.matchAll(new RegExp(`^# ${field} (\\d+)\\s*$`, 'gm'))].at(-1);
    counts[field] = last ? Number(last[1]) : null;
  }
  const skipped = /(?:^|\n)(?:ok|not ok)\b[^\n]*#\s*SKIP\b/i.test(output) || counts.skipped > 0;
  const success = code === 0 && counts.tests > 0 && counts.fail === 0 && counts.cancelled === 0 && counts.todo === 0 && !skipped;
  process.stdout.write(`PIPELINE_COLUMNS_RESULT ${JSON.stringify({ exit: code, files: options.files.length, counts, success })}\n`);
  if (!success && code === 0) process.stderr.write('Pipeline gate requires completed tests with zero failures, skips and TODOs.\n');
  return success ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runPipelineColumnTests();
}
