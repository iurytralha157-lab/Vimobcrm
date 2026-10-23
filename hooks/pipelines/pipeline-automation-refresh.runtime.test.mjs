import assert from 'node:assert/strict';
import test from 'node:test';
import { pipelineAutomationRefreshRuntime } from './pipeline-automation-refresh-runtime-fixture.mjs';

test('Atualizar replaces a fresh lost automation cache with the server won rule and leaves other tenant/actor caches intact', async () => {
  const h = pipelineAutomationRefreshRuntime();
  try {
    assert.equal(h.outcome(), 'lost'); assert.equal(h.query().isStale, false);
    assert.equal(h.options().staleTime, 600_000); assert.deepEqual(h.requests, []);
    const sentinels = h.sentinels(); h.setServerStatus('won');
    await h.manual();
    assert.equal(h.outcome(), 'won', 'Atualizar must refresh the rules used for lost/won preflight');
    assert.deepEqual(h.requests, [{ stageId: undefined, organizationId: 'org-a' }]);
    assert.deepEqual(h.notices, [{ kind: 'success', message: 'Atualizado!' }]);
    assert.deepEqual(h.refreshing, [true, false]); assert.deepEqual(h.sentinels(), sentinels);
  } finally { h.close(); }
});

test('automation read failure prevents the Atualizado success and preserves the last accepted outcome', async () => {
  const h = pipelineAutomationRefreshRuntime();
  try {
    h.fail(new Error('Synthetic automation read failed')); await h.manual();
    assert.equal(h.requests.length, 1, 'manual refresh must attempt the active automation query');
    assert.equal(h.outcome(), 'lost');
    assert.deepEqual(h.notices, [{ kind: 'error', message: 'Não foi possível atualizar: Synthetic automation read failed' }]);
    assert.deepEqual(h.refreshing, [true, false]);
  } finally { h.close(); }
});

for (const [name, options] of [
  ['missing permission', { allowed: false }], ['module disabled', { modules: ['crm'] }],
  ['tenant context belongs to another organization', { tenantOrg: 'org-b' }], ['organization absent', { org: null }],
]) test(`disabled automation query does not bypass access during manual/focus/interval refresh: ${name}`, async () => {
  const h = pipelineAutomationRefreshRuntime(options);
  try {
    assert.equal(h.query().isEnabled, false); await h.manual();
    await h.automatic('focus'); await h.automatic('interval', 120_000);
    assert.deepEqual(h.requests, [], 'QueryObserver.refetch ignores enabled, so the Screen must gate the call');
  } finally { h.close(); }
});

test('permission revoked after mounting retires the former manual and visible refresh callbacks', async () => {
  const h = pipelineAutomationRefreshRuntime();
  try {
    assert.equal(h.query().isEnabled, true); h.render({ allowed: false });
    assert.equal(h.query().isEnabled, false); await h.manual(); await h.automatic('focus');
    assert.deepEqual(h.requests, [], 'the actual callback/effect dependency lists must observe access changes');
  } finally { h.close(); }
});

for (const event of ['focus', 'interval', 'visibilitychange']) test(`visible ${event} reconciliation refreshes automation rules with the real observer`, async () => {
  const h = pipelineAutomationRefreshRuntime();
  try {
    const sentinels = h.sentinels(); h.setServerStatus('won');
    assert.deepEqual(h.intervalDelays(), [120_000]); await h.automatic(event, 120_000);
    assert.equal(h.outcome(), 'won');
    assert.deepEqual(h.requests, [{ stageId: undefined, organizationId: 'org-a' }]);
    assert.deepEqual(h.sentinels(), sentinels); assert.deepEqual(h.notices, []);
  } finally { h.close(); }
});

test('hidden reconciliation and repeated focus within the existing throttle do not refetch automations', async () => {
  const h = pipelineAutomationRefreshRuntime();
  try {
    h.setServerStatus('won'); h.visible(false); await h.automatic('focus', 120_000);
    assert.deepEqual(h.requests, []); assert.equal(h.outcome(), 'lost');
    h.visible(true); await h.automatic('visibilitychange', 0); assert.equal(h.requests.length, 1);
    await h.automatic('focus', 10_000); assert.equal(h.requests.length, 1);
  } finally { h.close(); }
});
