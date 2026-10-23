import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureSecrets, fixtureSession, legacyEdgeHarness, boundedResult, pendingRequest } from './helpers/whatsapp-legacy-edge-harness.mjs';

const cron = { 'x-cron-secret': fixtureSecrets.cron };
const receipt = () => Response.json({ success: true, queued: true, notification_id: 'synthetic-notification' });
const isNotification = request => request.url.includes('notification-dispatcher');
const run = async h => {
  const response = await boundedResult(h.handler(h.request({}, cron)));
  assert.ok(response, 'the health check must finish');
  return (await response.json()).results;
};

for (const status of [401, 403, 404, 429, 500, 503]) {
  test(`HTTP ${status} cannot prove disconnection or publish side effects`, async t => {
    const h = legacyEdgeHarness('session-health-check', { fetch: async request => isNotification(request)
      ? receipt() : Response.json({ error: 'synthetic upstream failure' }, { status }) });
    t.after(h.dispose);
    const results = await run(h);
    assert.equal(results[0].success, false);
    assert.equal(results[0].new_status, undefined);
    assert.equal(h.effects.appliedUpdates.length, 0);
    assert.equal(h.effects.inserts.length, 0);
    assert.equal(h.effects.requests.filter(isNotification).length, 0);
  });
}

for (const payload of [{}, null, [], { unexpected: 'schema' }, { data: {} }, { data: { connected: 'false' } },
  { success: false, data: { connected: false } }, { data: { state: 'connecting' } },
  { data: { connected: true, Connected: false } }]) {
  test(`unknown status ${JSON.stringify(payload)} cannot mark a live session disconnected`, async t => {
    const h = legacyEdgeHarness('session-health-check', { fetch: async request => isNotification(request)
      ? receipt() : Response.json(payload) });
    t.after(h.dispose);
    const results = await run(h);
    assert.equal(results[0].success, false);
    assert.equal(h.effects.updates.length, 0);
    assert.equal(h.effects.inserts.length, 0);
    assert.equal(h.effects.requests.filter(isNotification).length, 0);
  });
}

test('an unknown second observation preserves status and allows the next session', async t => {
  let probes = 0;
  const h = legacyEdgeHarness('session-health-check', {
    sessions: [fixtureSession('unknown'), fixtureSession('healthy')],
    fetch: async request => request.url.includes('instance-healthy') ? Response.json({ data: { connected: true } })
      : isNotification(request) ? receipt() : Response.json(++probes === 1 ? { data: { connected: false } } : {}),
  });
  t.after(h.dispose);
  const results = await run(h);
  assert.deepEqual(results.map(row => row.success), [false, true]);
  assert.deepEqual(h.effects.appliedUpdates.map(row => row.id), ['healthy']);
  assert.equal(h.effects.requests.filter(isNotification).length, 0);
});

for (const slug of ['global-whatsapp-status', 'session-health-check']) {
  for (const active of [false, null]) test(`${slug} rejects a suspended or unknown-activity super administrator`, async t => {
    const h = legacyEdgeHarness(slug, { active });
    t.after(h.dispose);
    const response = await h.handler(h.request({ instance_name: 'synthetic-instance' }));
    assert.equal(response.status, 403);
    assert.equal(h.effects.bodyReads, 0);
    assert.equal(h.effects.requests.length, 0);
    assert.equal(h.effects.updates.length, 0);
  });
  for (const options of [{ profileMissing: true }, { profileError: { code: 'synthetic-profile-error' } }]) {
    test(`${slug} fails closed on a missing or failed privileged profile lookup ${JSON.stringify(options)}`, async t => {
      const h = legacyEdgeHarness(slug, options);
      t.after(h.dispose);
      assert.equal((await h.handler(h.request({ instance_name: 'synthetic-instance' }))).status, 403);
      assert.equal(h.effects.bodyReads, 0);
      assert.equal(h.effects.requests.length, 0);
    });
  }
}

for (const change of [{ updated_at: '2026-10-15T01:00:00Z' }, { status: 'deleted' }, { instance_id: 'replacement' },
  { instance_name: 'replacement' }, { owner_user_id: 'replacement-owner' }, { organization_id: 'other-org' },
  { provider: 'evolution' }, { is_active: false }]) {
  for (const connected of [true, false]) test(`late ${connected ? 'connected' : 'disconnected'} probe cannot overwrite ${JSON.stringify(change)}`, async t => {
    let probes = 0;
    const sessions = [fixtureSession()];
    const h = legacyEdgeHarness('session-health-check', { sessions, fetch: async request => {
      if (isNotification(request)) return receipt();
      if (++probes === (connected ? 1 : 2)) Object.assign(sessions[0], change);
      return Response.json({ data: { connected } });
    } });
    t.after(h.dispose);
    const results = await run(h);
    assert.equal(results[0].success, false);
    assert.equal(h.effects.appliedUpdates.length, 0);
    assert.equal(h.effects.requests.filter(isNotification).length, 0);
    assert.equal(h.effects.inserts.length, 0);
  });
}

for (const connected of [true, false]) {
  test(`database write error is reported for ${connected ? 'connected' : 'disconnected'} state`, async t => {
    const h = legacyEdgeHarness('session-health-check', { onQuery: state => state.operation === 'update'
      ? { data: null, error: { code: 'synthetic-write-error' } } : undefined,
    fetch: async request => isNotification(request) ? receipt() : Response.json({ data: { connected } }) });
    t.after(h.dispose);
    const results = await run(h);
    assert.equal(results[0].success, false);
    assert.equal(h.effects.appliedUpdates.length, 0);
    assert.equal(h.effects.inserts.length, 0);
  });
}

test('a change during a notification is fenced again before the final status update', async t => {
  const sessions = [fixtureSession()];
  const h = legacyEdgeHarness('session-health-check', { sessions, fetch: async request => {
    if (isNotification(request)) {
      Object.assign(sessions[0], { updated_at: '2026-10-15T01:00:00Z', status: 'connected' });
      return receipt();
    }
    return Response.json({ data: { connected: false } });
  } });
  t.after(h.dispose);
  const results = await run(h);
  assert.equal(results[0].success, false);
  assert.equal(h.effects.appliedUpdates.length, 0);
  assert.equal(h.effects.inserts.length, 0);
  assert.equal(h.effects.requests.filter(isNotification).length, 1, 'an already accepted POST cannot be recalled');
});

test('two explicit disconnected observations preserve one notification episode and its acknowledgement', async t => {
  const h = legacyEdgeHarness('session-health-check', { fetch: async request => isNotification(request)
    ? receipt() : Response.json({ data: { connected: false } }) });
  t.after(h.dispose);
  const results = await run(h);
  assert.equal(results[0].success, true);
  assert.equal(results[0].new_status, 'disconnected');
  assert.equal(h.effects.appliedUpdates.length, 1);
  const notifications = h.effects.requests.filter(isNotification);
  assert.equal(notifications.length, 1);
  assert.match(JSON.parse(notifications[0].body).dedupe_key, /session-a:owner-a:2026-10-14T00:00:00Z$/);
});

test('timeout remains unknown without side effects', async t => {
  const h = legacyEdgeHarness('session-health-check', { fetch: pendingRequest });
  t.after(h.dispose);
  assert.equal((await run(h))[0].success, false);
  assert.equal(h.effects.updates.length, 0);
  assert.equal(h.effects.inserts.length, 0);
});

test('inactive sessions do not consume probes while nullable legacy activity remains supported', async t => {
  const h = legacyEdgeHarness('session-health-check', { sessions: [
    { ...fixtureSession('inactive'), is_active: false }, { ...fixtureSession('legacy'), instance_id: null, is_active: null },
  ], fetch: async () => Response.json({ data: { connected: true } }) });
  t.after(h.dispose);
  const results = await run(h);
  assert.equal(results.length, 1);
  assert.equal(results[0].session_id, 'legacy');
  assert.equal(results[0].success, true);
  assert.equal(h.effects.requests.length, 1);
  assert.equal(h.effects.appliedUpdates[0].id, 'legacy');
});

test('a failed conditional snapshot read cannot notify or write', async t => {
  const h = legacyEdgeHarness('session-health-check', { onQuery: state => state.table === 'whatsapp_sessions' && state.columns === 'id'
    ? { data: null, error: { code: 'synthetic-read-error' } } : undefined,
  fetch: async request => isNotification(request) ? receipt() : Response.json({ data: { connected: false } }) });
  t.after(h.dispose);
  assert.equal((await run(h))[0].success, false);
  assert.equal(h.effects.requests.filter(isNotification).length, 0);
  assert.equal(h.effects.updates.length, 0);
});

test('an unavailable audit is reported after the conditional status write', async t => {
  const h = legacyEdgeHarness('session-health-check', { onQuery: state => state.table === 'audit_logs'
    ? { data: null, error: { code: 'synthetic-audit-error' } } : undefined,
  fetch: async request => isNotification(request) ? receipt() : Response.json({ data: { connected: false } }) });
  t.after(h.dispose);
  assert.equal((await run(h))[0].success, false);
  assert.equal(h.effects.appliedUpdates.length, 1);
  assert.equal(h.effects.appliedUpdates[0].status, 'disconnected');
});

test('a later poll reuses the same dedupe episode after an ambiguous notification failure', async t => {
  let notifications = 0;
  const h = legacyEdgeHarness('session-health-check', { fetch: async request => {
    if (!isNotification(request)) return Response.json({ data: { connected: false } });
    if (++notifications === 1) throw new Error('synthetic ambiguous notification failure');
    return receipt();
  } });
  t.after(h.dispose);
  assert.equal((await run(h))[0].success, false);
  assert.equal(h.effects.appliedUpdates.length, 0);
  assert.equal((await run(h))[0].success, true);
  const keys = h.effects.requests.filter(isNotification).map(request => JSON.parse(request.body).dedupe_key);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal(h.effects.appliedUpdates.length, 1);
});

for (const response of [() => Response.json({ state: 'close' }, { status: 503 }), () => Response.json({ unknown: 'state' })]) {
  test(`global status cannot claim a successful disconnected observation from ${String(response)}`, async t => {
    const h = legacyEdgeHarness('global-whatsapp-status', { fetch: response });
    t.after(h.dispose);
    const result = await h.handler(h.request({ instance_name: 'synthetic-instance' }));
    assert.equal((await result.json()).success, false);
    assert.equal(result.status, 500);
  });
}
