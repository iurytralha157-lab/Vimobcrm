import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CI_MARKER, GO_TESTS, NODE_TESTS, DATABASE_NODE_TESTS, SQL_TESTS, SQL_BASELINE_TESTS, RUNTIME_TESTS, assertGoResults, assertTap, assertNodeTap,
  childEnvironment, fixtureRoot, targetURL, validateURL } from './whatsapp-ci-contract.mjs';
import { initialize, verifiedClient, sqlFile, command, stop } from './whatsapp-ci-fixture.mjs';
import { bootstrap } from './whatsapp-ci-bootstrap.mjs';

async function capture(root, name, file, args, env, secrets = []) {
  const redact = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[synthetic-credential]'), String(value || ''));
  try {
    const result = await command(file, args, { env, timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024 });
    await writeFile(path.join(root, 'results', name), redact(result.stdout + result.stderr));
    return result;
  } catch (error) {
    await writeFile(path.join(root, 'results', name), redact(error.stdout + error.stderr));
    throw new Error(`required CI phase ${name} failed (exit ${error.code ?? 'unknown'}); see redacted result log`);
  }
}
export async function runNode(root) {
  const result = await capture(root, 'node.tap', process.execPath,
    ['--test', '--test-reporter=tap', '--test-concurrency=1', ...NODE_TESTS], childEnvironment());
  return assertNodeTap(result.stdout);
}
export async function runRuntime(root) {
  const result = await capture(root, 'runtime.tap', process.execPath,
    ['--test', '--test-reporter=tap', '--test-concurrency=1', ...RUNTIME_TESTS], childEnvironment());
  return assertNodeTap(result.stdout);
}
export async function runSQL(root, baselineOnly = false) {
  assert.equal(typeof baselineOnly, 'boolean');
  const sql = [];
  for (const name of baselineOnly ? SQL_BASELINE_TESTS : SQL_TESTS) {
    const assertions = name === 'whatsapp_personal_quick_replies.test.sql';
    let output;
    try { output = await sqlFile(root, 'supabase/tests/' + name, { mode: assertions ? 'assertions' : 'tap' }); }
    catch (error) {
      await writeFile(path.join(root, 'results', name + '.log'), String(error.stdout || '') + String(error.stderr || ''));
      throw new Error('required SQL test failed: ' + name);
    }
    await writeFile(path.join(root, 'results', name + '.log'), output.stdout + output.stderr);
    if (assertions) assert.equal(output.stdout.trim(), 'whatsapp_personal_quick_replies: all assertions passed');
    sql.push({ file: name, assertions: assertions ? 'exception assertions completed' : assertTap(output.stdout),
      sourceSha256: output.sha256, executedSha256: output.executedSha256 });
  }
  return sql;
}
export async function runDatabase(root) {
  const sql = await runSQL(root);
  const maintenanceResult = await capture(root, 'maintenance.tap', process.execPath,
    ['--test', '--test-reporter=tap', '--test-concurrency=1', ...DATABASE_NODE_TESTS],
    { ...childEnvironment(), VIMOB_WHATSAPP_CI_ROOT: root });
  const maintenance = assertNodeTap(maintenanceResult.stdout);
  const { client } = await verifiedClient(root); await client.end();
  const password = await readFile(path.join(root, 'password.txt'), 'utf8');
  const url = targetURL(password); validateURL(url);
  const env = { ...childEnvironment(), GOPROXY: 'off', GOTOOLCHAIN: 'local', VIMOB_RUN_WHATSAPP_CI: 'LOCAL_WRITE_TEST',
    VIMOB_RUN_WHATSAPP_SEND_DB_TESTS: 'LOCAL_WRITE_TEST', VIMOB_LOCAL_WHATSAPP_CLONE_VERIFIED: CI_MARKER,
    VIMOB_WHATSAPP_CI_ROOT: root, VIMOB_WHATSAPP_CI_RUNTIME: path.join(root, 'runtime.json'),
    WHATSAPP_EPOCH1_TEST_DATABASE_URL: url, WHATSAPP_TEST_DATABASE_URL: url };
  const result = await capture(root, 'go.jsonl', 'go', ['test', '-json', '-count=1', '-parallel=1', '-timeout=10m',
    './apps/api/internal/whatsapp', '-run', '^(' + GO_TESTS.join('|') + ')$'], env, [password]);
  return { go: assertGoResults(result.stdout), sql, maintenance };
}
export async function runGate(action, rootValue, bin) {
  assert.ok(['all', 'db', 'checks', 'sql', 'sql-baseline', 'runtime'].includes(action), 'expected all/db/checks/sql/sql-baseline/runtime');
  const root = fixtureRoot(rootValue), results = { syntheticOnly: true };
  let initialized = false, failure;
  try {
    if (action === 'runtime') {
      await mkdir(path.join(root, 'results'), { recursive: true });
      results.runtime = await runRuntime(root);
    } else {
      if (action === 'checks') {
        const { client } = await verifiedClient(root); await client.end(); initialized = true;
      } else {
        await initialize(root, bin); initialized = true;
        await bootstrap(root, action !== 'sql-baseline');
      }
      if (action === 'sql-baseline') {
        results.sharedQueuePending = true;
        results.scope = 'diagnostic original SQL six only; this is not the required all gate';
        results.database = { sql: await runSQL(root, true) };
      } else {
        results.node = await runNode(root);
        results.database = action === 'sql' ? { sql: await runSQL(root) } : await runDatabase(root);
      }
      if (action === 'all') results.runtime = await runRuntime(root);
    }
    await writeFile(path.join(root, 'results', 'summary-' + action + '.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
    return results;
  } catch (error) {
    failure = error; throw error;
  } finally {
    // initialize itself also stops its own cluster if it fails after pg_ctl
    // starts but before CREATE DATABASE/marker. Bootstrap/test failures land here.
    if (initialized) {
      await access(path.join(root, 'runtime.json'));
      try { await writeFile(path.join(root, 'results', 'cleanup.json'), JSON.stringify(await stop(root))); }
      catch (cleanupError) {
        await writeFile(path.join(root, 'results', 'cleanup.json'), JSON.stringify({ stopped: false, failed: true }));
        if (failure) throw new AggregateError([failure, cleanupError], 'required gate and owned cleanup failed');
        throw cleanupError;
      }
    }
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await runGate(...process.argv.slice(2));
}
