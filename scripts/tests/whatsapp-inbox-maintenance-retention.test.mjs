import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { verifiedClient } from './whatsapp-ci-fixture.mjs';
import { fixtureRoot } from './whatsapp-ci-contract.mjs';
import { buildInboxMaintenanceDeleteQuery } from '../maintenance/whatsapp-inbox-maintenance.mjs';

// Admission verifies the real loopback cluster, nonce and directory before any
// SQL. Only a temporary table is changed; the production CLI is never imported.
const root = fixtureRoot(process.env.VIMOB_WHATSAPP_CI_ROOT);
const { client } = await verifiedClient(root);
after(() => client.end());
const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
const old = new Date(Date.now() - 72 * 60 * 60_000);
const future = new Date(Date.now() + 24 * 60 * 60_000);
let sequence = 0;

async function seed(overrides = {}) {
  const row = { event_key: `synthetic-${++sequence}`, event_type: 'Message', status: 'processed',
    created_at: old, processed_at: old, expires_at: old, payload: {}, ...overrides };
  await client.query(`insert into pg_temp.whatsapp_webhook_inbox
    (event_key,event_type,status,created_at,processed_at,expires_at,payload)
    values($1,$2,$3,$4,$5,$6,$7::jsonb)`, Object.values(row));
  return row.event_key;
}
function family(parent = 'synthetic-parent', version = '1') {
  return { __vimob_ingress: { routing_key: 'receipt-target:synthetic',
    receipt_effect: { version, parent_event_key: parent } } };
}
async function cleanup(name = 'processed_older_24h', limit = 100) {
  // The only substitution is the relation name, keeping the CLI's actual SQL
  // and bindings while isolating these tests from canonical fixture rows.
  const sql = buildInboxMaintenanceDeleteQuery(name)
    .replaceAll('public.whatsapp_webhook_inbox', 'pg_temp.whatsapp_webhook_inbox');
  return (await client.query(sql, [cutoff, limit])).rows[0].deleted;
}
async function keys() {
  return (await client.query('select event_key from pg_temp.whatsapp_webhook_inbox order by event_key'))
    .rows.map(row => row.event_key);
}
function scenario(name, body) {
  test(name, async () => {
    await client.query('begin');
    try {
      await client.query(`create temporary table whatsapp_webhook_inbox (
        id uuid primary key default gen_random_uuid(), event_key text unique not null,
        event_type text not null, status text not null, created_at timestamptz not null,
        processed_at timestamptz, expires_at timestamptz, payload jsonb not null
      ) on commit drop`);
      await body();
    } finally { await client.query('rollback'); }
  });
}

scenario('expired ordinary rows remain eligible and the batch limit is respected', async () => {
  await seed(); await seed();
  assert.equal(await cleanup('processed_older_24h', 1), 1);
  assert.equal((await keys()).length, 1);
  assert.equal(await cleanup(), 1);
});
for (const [name, changes] of [
  ['unexpired', { expires_at: future }], ['unknown expiry', { expires_at: null }],
  ['recently processed', { processed_at: new Date() }],
]) scenario(`maintenance preserves ${name} processed rows`, async () => {
  const key = await seed(changes);
  assert.equal(await cleanup(), 0); assert.deepEqual(await keys(), [key]);
});
scenario('unfinished and dead messages remain protected', async () => {
  for (const status of ['pending', 'retry', 'processing', 'dead']) await seed({ status });
  assert.equal(await cleanup(), 0); assert.equal((await keys()).length, 4);
});
scenario('stale QR cleanup preserves fresh QR and normal messages', async () => {
  await seed({ event_type: 'qrcode', status: 'pending' });
  const fresh = await seed({ event_type: 'qrcode', status: 'retry', created_at: new Date() });
  const message = await seed({ status: 'pending' });
  assert.equal(await cleanup('stale_qrcode'), 1);
  assert.deepEqual(await keys(), [fresh, message].sort());
});
for (const status of ['pending', 'retry', 'processing', 'dead', 'processed']) {
  scenario(`receipt parent and callback identity survive a ${status} sibling and batch size one`, async () => {
    await seed({ event_key: 'synthetic-parent', payload: family() });
    await seed({ event_key: 'synthetic-child', status,
      expires_at: status === 'processed' ? future : old, payload: family() });
    assert.equal(await cleanup('processed_older_24h', 1), 0);
    assert.deepEqual(await keys(), ['synthetic-child', 'synthetic-parent']);
    const replay = await client.query(`insert into pg_temp.whatsapp_webhook_inbox
      select gen_random_uuid(),event_key,event_type,status,created_at,processed_at,expires_at,payload
      from pg_temp.whatsapp_webhook_inbox where event_key='synthetic-parent'
      on conflict(event_key) do nothing returning id`);
    assert.equal(replay.rowCount, 0, 'the original callback identity must still deduplicate');
  });
}
scenario('fully expired completed receipt families remain owned by the canonical worker', async () => {
  await seed({ payload: family() }); await seed({ payload: family() });
  assert.equal(await cleanup(), 0); assert.equal((await keys()).length, 2);
});
scenario('unknown or partial server receipt markers fail closed', async () => {
  for (const payload of [family('synthetic', '2'),
    { __vimob_ingress: { receipt_effect: {} } },
    { __vimob_ingress: { routing_key: 'receipt-target:synthetic' } }]) await seed({ payload });
  assert.equal(await cleanup(), 0); assert.equal((await keys()).length, 3);
});
scenario('the QR class also cannot erase a server receipt marker', async () => {
  await seed({ event_type: 'qrcode', status: 'retry', payload: family() });
  assert.equal(await cleanup('stale_qrcode'), 0); assert.equal((await keys()).length, 1);
});
test('unknown cleanup classes are rejected before query execution', () => {
  for (const name of ['missing', 'constructor', '__proto__', 'processed_older_24h; delete'])
    assert.throws(() => buildInboxMaintenanceDeleteQuery(name));
});
