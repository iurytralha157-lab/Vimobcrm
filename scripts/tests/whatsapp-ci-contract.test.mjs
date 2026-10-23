import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { CI_MARKER, CI_PORT, CI_DATABASE, GO_PACKAGE, GO_TESTS, NODE_TESTS, DATABASE_NODE_TESTS, RUNTIME_TESTS, fixtureRoot, targetURL,
  validateURL, validateManifest, assertCluster, childEnvironment, assertGoResults, assertTap, assertNodeTap, sqlModeOptions } from './whatsapp-ci-contract.mjs';

const root = path.resolve('fixture-parent', 'vimob-whatsapp-ci');
const now = Date.parse('2026-10-14T15:00:00Z');
const manifest = () => ({ kind: CI_MARKER, marker: CI_MARKER, root, database: CI_DATABASE,
  createdAt: new Date(now).toISOString(), nonce: 'a'.repeat(64), actual: {
    systemIdentifier: '7696313589555176164', dataDirectory: path.join(root, 'data'),
    port: String(CI_PORT), listenAddresses: '127.0.0.1', serverAddress: '127.0.0.1', fsync: 'on', synchronousCommit: 'on' } });

test('fixed explicit CI root and URL are accepted', () => {
  assert.equal(fixtureRoot(root), root); assert.equal(validateURL(targetURL()).port, String(CI_PORT));
  assert.throws(() => fixtureRoot('relative/vimob-whatsapp-ci')); assert.throws(() => fixtureRoot(path.resolve('unrelated')));
});
for (const url of [targetURL().replace('127.0.0.1', 'remote.invalid'), targetURL().replace('127.0.0.1', 'localhost'),
  targetURL().replace(':57924', ':57922'), targetURL().replace(CI_DATABASE, 'postgres'),
  targetURL().replace('postgres:synthetic@', 'service_role:synthetic@'), targetURL() + '#fragment',
  ...['host=remote.invalid', 'hostaddr=203.0.113.1', 'port=5432', 'dbname=postgres', 'service=remote', 'options=-c%20role=service_role', 'sslmode=disable'].map(p => targetURL() + '&' + p)]) {
  test('rejects redirected target ' + url.replace(/:[^:@]+@/, ':***@'), () => assert.throws(() => validateURL(url)));
}
test('fresh manifest requires every identity boundary', () => {
  validateManifest(manifest(), root, now);
  for (const mutate of [m => m.kind = 'regular-db', m => m.marker = 'other', m => m.nonce = 'x',
    m => m.database = 'postgres', m => m.actual.systemIdentifier = 'unknown', m => m.actual.dataDirectory = path.dirname(root),
    m => m.actual.port = '5432', m => m.actual.listenAddresses = '*', m => m.actual.serverAddress = '0.0.0.0',
    m => m.actual.fsync = 'off', m => m.actual.synchronousCommit = 'off', m => m.root = path.dirname(root),
    m => m.createdAt = new Date(now + 1).toISOString(), m => m.createdAt = new Date(now - 6 * 60 * 60_000 - 1).toISOString()]) {
    const changed = manifest(); mutate(changed); assert.throws(() => validateManifest(changed, root, now));
  }
});
test('actual database is checked independently of the manifest including nonce and system identifier', () => {
  const m = manifest(), actual = { ...m.actual, database: CI_DATABASE, nonce: m.nonce }; assertCluster(m, actual);
  for (const key of Object.keys(actual)) assert.throws(() => assertCluster(m, { ...actual, [key]: 'wrong' }), key);
});
test('ambient credentials and PG target overrides cannot reach children', () => {
  const env = childEnvironment({ PATH: 'safe', HOME: '/safe', PGHOST: 'remote', PGHOSTADDR: 'remote', PGPORT: '5432',
    PGSERVICE: 'remote', PGOPTIONS: 'bad', PGPASSWORD: 'secret', DATABASE_URL: 'remote', SUPABASE_URL: 'remote',
    EVOLUTION_GO_API_KEY: 'secret', WHATSAPP_TEST_DATABASE_URL: 'remote', NODE_OPTIONS: '--import=remote' });
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'LANG', 'LC_ALL', 'NO_COLOR', 'PATH']);
});
function goLog(extra = []) { return [...GO_TESTS.map(Test => ({ Test, Action: 'pass' })), ...extra, { Action: 'pass' }].map(e => JSON.stringify({ Package: GO_PACKAGE, ...e })).join('\n'); }
test('Go proof rejects skips, absent/extra/duplicate tests and failed subtests', () => {
  assert.equal(assertGoResults(goLog()).topLevel, GO_TESTS.length);
  for (const raw of [goLog([{ Test: GO_TESTS[0] + '/sub', Action: 'skip' }]), goLog([{ Test: GO_TESTS[0] + '/sub', Action: 'fail' }]),
    goLog([{ Test: 'TestNotAllowed', Action: 'pass' }]), goLog([{ Test: GO_TESTS[0], Action: 'pass' }]), goLog().split('\n').slice(1).join('\n'),
    goLog([{ Action: 'fail' }]), goLog([{ Action: 'skip' }]), goLog([{ Action: 'pass' }]), goLog([{ Action: 'pass', Package: 'other' }])]) {
    assert.throws(() => assertGoResults(raw));
  }
});
test('TAP proof rejects skip/TODO, failure, bailout, absent plans and plan mismatches', () => {
  assert.equal(assertTap('1..2\nok 1 - first\nok 2 - second\n'), 2);
  assert.equal(assertTap('1..1\r\nok 1 - pass\r\n# todo 0\r\n# skipped 0\r\n'), 1);
  for (const raw of ['1..1\nok 1 # SKIP optional', '1..1\nnot ok 1', 'Bail out! unavailable', 'ok 1', '1..2\nok 1', '1..1\nok 1 # TODO later',
    '1..2\nok 1\nok 1', '1..1\nok 1\n1..1', '1..2\nok 2\nok 1', '1..1\nok 1\n  Bail out! missing', '1..1\nok 1\n  not ok 1',
    '1..1\nok 1\n# todo 1', '1..1\nok 1\n# skipped 1']) assert.throws(() => assertTap(raw));
});
test('SQL mode accepts only fixed non-connection argument sets', () => {
  assert.deepEqual(sqlModeOptions({ mode: 'tap' }).args, ['-q', '-A', '-t']);
  for (const options of [['-h', 'remote.invalid'], { args: ['-d', 'postgres'] }, { extra: ['-v', 'ON_ERROR_STOP=0'] },
    { mode: '-h remote.invalid' }, { mode: 'tap', host: 'remote.invalid' }]) assert.throws(() => sqlModeOptions(options));
});
test('Node TAP reports distinct top-level and nested totals and requires a complete zero-failure summary', () => {
  const raw = 'ok 1 - nested\n1..1\n# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  assert.deepEqual(assertNodeTap(raw), { topLevel: 1, includingSubtests: 2 });
  for (const changed of [raw.replace('# tests 2', '# tests 0'), raw.replace('# pass 2', '# pass 1'),
    raw.replace('# fail 0', '# fail 1'), raw.replace('# cancelled 0', '# cancelled 1'), raw.replace('# skipped 0', ''), raw + '# tests 2\n']) assert.throws(() => assertNodeTap(changed));
});
test('surface allowlist retains actual page, modal, avatar and history regressions', () => {
  assert.ok(RUNTIME_TESTS.includes('components/features/whatsapp/conversations/integrated-surfaces-mobile.runtime.test.mjs'));
  assert.ok(RUNTIME_TESTS.includes('components/features/whatsapp/conversations/floating-mobile-modal.runtime.test.mjs'));
  assert.ok(RUNTIME_TESTS.includes('hooks/whatsapp/use-whatsapp-sender-avatars.runtime.test.mjs'));
  assert.ok(RUNTIME_TESTS.includes('hooks/use-whatsapp-messages-paginated.race.test.mjs'));
  assert.equal(new Set(GO_TESTS).size, GO_TESTS.length);
});

test('access, cancellation, canonical-card and touch regressions are selected once in their execution phase', () => {
  const required = [
    ['hooks/whatsapp-inbox-denial.runtime.test.mjs', NODE_TESTS],
    ['hooks/whatsapp-head-cancellation.runtime.test.mjs', NODE_TESTS],
    ['hooks/whatsapp-terminal-auth.runtime.test.mjs', RUNTIME_TESTS],
    ['hooks/whatsapp/use-whatsapp-visible-canonical-previews.runtime.test.mjs', RUNTIME_TESTS],
    ['components/features/whatsapp/conversations/floating-tags-touch.runtime.test.mjs', RUNTIME_TESTS],
  ];
  const all = [...NODE_TESTS, ...RUNTIME_TESTS];
  const missingOrDuplicated = required.filter(([file, phase]) =>
    phase.filter(selected => selected === file).length !== 1 || all.filter(selected => selected === file).length !== 1);
  assert.deepEqual(missingOrDuplicated.map(([file]) => file), []);
});

test('the actual runner passes each selected module to node with the closed child environment', async () => {
  const source = readFileSync(new URL('./whatsapp-ci-run.mjs', import.meta.url), 'utf8');
  const passing = 'ok 1 - synthetic command proof\n1..1\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  for (const [name, log, selected] of [['runNode', 'node.tap', NODE_TESTS], ['runRuntime', 'runtime.tap', RUNTIME_TESTS]]) {
    const declaration = source.match(new RegExp(`export async function ${name}\\(root\\) \\{[\\s\\S]*?\\n\\}`))?.[0];
    assert.ok(declaration, name);
    const calls = [], environment = { PATH: 'synthetic-path', CI: '1' };
    let environmentCalls = 0;
    const invoke = Function('capture', 'childEnvironment', 'NODE_TESTS', 'RUNTIME_TESTS', 'assertNodeTap', 'process',
      `${declaration.replace('export ', '')}; return ${name};`)(
      async (...args) => { calls.push(args); return { stdout: passing }; },
      () => { environmentCalls++; return environment; }, NODE_TESTS, RUNTIME_TESTS, assertNodeTap, { execPath: 'synthetic-node' });
    assert.deepEqual(await invoke(root), { topLevel: 1, includingSubtests: 1 });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 4), [root, log, 'synthetic-node',
      ['--test', '--test-reporter=tap', '--test-concurrency=1', ...selected]]);
    assert.equal(environmentCalls, 1);
    assert.strictEqual(calls[0][4], environment);
  }
});
test('the required gate retains monitor, lazy history, maintenance and queue cancellation regressions', () => {
  for (const file of ['scripts/tests/whatsapp-legacy-health-state.test.mjs', 'lib/api/whatsapp-history-media.test.mjs'])
    assert.ok(NODE_TESTS.includes(file), file);
  assert.deepEqual(DATABASE_NODE_TESTS, ['scripts/tests/whatsapp-inbox-maintenance-retention.test.mjs']);
  for (const name of ['TestLocalLeadHistoryLazyMediaContract', 'TestMediaWorkerCompletionWinsItsOwnHeartbeatCancellation',
    'TestLocalQueueOutboxCanceledWorkUsesCurrentDurableMarker', 'TestLocalQueueCanceledMediaPhaseRollsBackWithoutLiveWaiters'])
    assert.ok(GO_TESTS.includes(name), name);
  for (const list of [NODE_TESTS, DATABASE_NODE_TESTS, RUNTIME_TESTS]) assert.equal(new Set(list).size, list.length);
});

test('the required gate runs session synchronization and every send entry with shared hook regressions', () => {
  for (const name of ['TestLocalSessionQRCodeDoesNotInventDisconnect', 'TestLocalSessionStatusReturnsStateThatWonTheCAS',
    'TestLocalSessionStatusCannotUndoExplicitLogout', 'TestLocalDeferredSessionControlsRejectRetainedEpochAndLostLease',
    'TestLocalInboundCaptureContinuesAfterDeferredSessionDisconnect']) assert.ok(GO_TESTS.includes(name), name);
  for (const file of ['components/features/whatsapp/conversations/entry-send-receive.runtime.test.mjs',
    'components/features/whatsapp/conversations/send-entry-surfaces.runtime.test.mjs', 'hooks/whatsapp-send-admission.runtime.test.mjs',
    'hooks/use-whatsapp-send-intent.runtime.test.mjs', 'hooks/use-whatsapp-session-intent.runtime.test.mjs']) {
    assert.ok(RUNTIME_TESTS.includes(file), file);
  }
  assert.ok(NODE_TESTS.includes('lib/whatsapp-send-admission.test.mjs'));
});
