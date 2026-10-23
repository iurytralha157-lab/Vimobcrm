import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { load } = require('js-yaml');
const workflow = load(readFileSync(new URL('../../.github/workflows/docker-images.yml', import.meta.url), 'utf8'));

test('image publication waits for every existing gate and the WhatsApp gate', () => {
  assert.deepEqual(workflow.jobs['build-and-push'].needs,
    ['release-gates', 'invitation-integration', 'membership-access-integration', 'whatsapp-contracts']);
  assert.equal(workflow.jobs['build-and-push'].permissions.packages, 'write');
  const staticCommands = workflow.jobs['release-gates'].steps.map(step => step.run || '').join('\n');
  for (const command of ['npm run audit:check', 'npm run validation:test', 'npm run typecheck', 'npm run lint',
    'node scripts/supabase/verify-migrations.mjs', 'node scripts/supabase/verify-edge-functions.mjs',
    'go test ./apps/api/... ./packages/auth/... ./packages/db/...']) assert.ok(staticCommands.includes(command), command);
});
test('WhatsApp gate is secret-free, uses explicit PG17/pgTAP and cleans even after initialization failure', () => {
  const job = workflow.jobs['whatsapp-contracts'];
  assert.equal(job['runs-on'], 'ubuntu-24.04'); assert.equal(job['timeout-minutes'], 40);
  assert.deepEqual(job.permissions, { contents: 'read' }); assert.equal(job.services, undefined);
  assert.doesNotMatch(JSON.stringify(job), /secrets\.|DATABASE_URL|SERVICE_ROLE|docker\/login|build-push-action/);
  const install = job.steps.find(step => step.name.startsWith('Install PostgreSQL')).run;
  for (const required of ['https://www.postgresql.org/media/keys/ACCC4CF8.asc', 'signed-by=',
    'create_main_cluster = false', 'postgresql-17 postgresql-17-pgtap', '/usr/lib/postgresql/17/bin/postgres --version']) assert.ok(install.includes(required), required);
  assert.equal(job.steps.find(step => step.name.startsWith('Test WhatsApp')).run,
    'node scripts/tests/whatsapp-ci-run.mjs all "$RUNNER_TEMP/vimob-whatsapp-ci" /usr/lib/postgresql/17/bin');
  const download = job.steps.find(step => step.name.startsWith('Download locked Go'));
  assert.deepEqual(download.run.trim().split('\n'), ['apps/api', 'packages/auth', 'packages/db'].map(module => 'go -C ' + module + ' mod download'));
  assert.ok(job.steps.indexOf(download) < job.steps.findIndex(step => step.name.startsWith('Test WhatsApp')));
  const cleanup = job.steps.find(step => step.name.startsWith('Stop only'));
  assert.equal(cleanup.if, 'always()'); assert.ok(cleanup.run.includes('whatsapp-ci-fixture.mjs stop'));
  const artifact = job.steps.find(step => step.uses === 'actions/upload-artifact@v4');
  assert.equal(artifact.if, 'always()');
  assert.deepEqual(artifact.with.path.trim().split('\n'), ['log', 'json', 'jsonl', 'tap'].map(ext => '${{ runner.temp }}/vimob-whatsapp-ci/results/*.' + ext));
  assert.doesNotMatch(artifact.with.path, /\.sql|runtime|password|data\//);
});
