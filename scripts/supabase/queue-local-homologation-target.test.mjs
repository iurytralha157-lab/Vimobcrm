import assert from 'node:assert/strict';
import test from 'node:test';
import { localAuthFetch, PROJECT_ID, STACK_ROOT, validateManifest, verifyContainerIdentity } from './queue-local-homologation-target.mjs';
import { fixtureUUID, queueSchedule } from './seed-queue-local-homologation.mjs';

function manifest() {
  return { kind: 'vimob-queue-homologation-v1', runId: '11111111-1111-4111-8111-111111111111', projectId: PROJECT_ID,
    workdir: STACK_ROOT, supabaseURL: 'http://127.0.0.1:57421', databaseURL: 'postgresql://postgres:synthetic-local-only@127.0.0.1:57422/postgres?sslmode=disable',
    databaseContainer: `supabase_db_${PROJECT_ID}`, networkName: `${PROJECT_ID}-isolated`,
    anonKey: 'synthetic-anon-key-local-only', serviceRoleKey: 'synthetic-service-key-local-only' };
}

function identity(value) {
  return { labels: { 'com.supabase.cli.project': PROJECT_ID }, ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '57422' }] }, networks: { [value.networkName]: {} } };
}

test('only the approved isolated project, loopback ports and stack root can be seeded', () => {
  assert.equal(validateManifest(manifest()).projectId, PROJECT_ID);
  for (const mutation of [
    value => { value.projectId = 'another-project'; },
    value => { value.runId = 'unverified'; },
    value => { value.workdir = 'D:/Vimob/workspaces/vimob-crm'; },
    value => { value.supabaseURL = 'https://example.invalid'; },
    value => { value.databaseURL = 'postgresql://postgres:synthetic@database.invalid:57422/postgres'; },
    value => { value.databaseURL = 'postgresql://postgres:synthetic@127.0.0.1:5432/postgres'; },
    value => { value.databaseContainer = 'unrelated-database'; },
  ]) {
    const value = manifest();
    mutation(value);
    assert.throws(() => validateManifest(value));
  }
});

test('container binding, project label and internal-only network are independent barriers', () => {
  const value = manifest();
  assert.doesNotThrow(() => verifyContainerIdentity(value, identity(value), true));
  for (const mutation of [
    container => { container.labels['com.supabase.cli.project'] = 'other-project'; },
    container => { container.ports['5432/tcp'][0].HostIp = '0.0.0.0'; },
    container => { container.ports['5432/tcp'][0].HostPort = '5432'; },
    container => { container.networks.external = {}; },
  ]) {
    const container = identity(value);
    mutation(container);
    assert.throws(() => verifyContainerIdentity(value, container, true));
  }
  assert.throws(() => verifyContainerIdentity(value, identity(value), false));
});

test('synthetic Auth cannot forward credentials outside its exact local origin', () => {
  const guardedFetch = localAuthFetch(manifest());
  for (const url of ['https://example.invalid/auth/v1/admin/users', 'http://localhost:57421/auth/v1/admin/users', 'http://127.0.0.1:57422/auth/v1/admin/users']) {
    assert.throws(() => guardedFetch(url, { method: 'POST' }));
  }
});

test('unpublished internal database requires an exact independently attested loopback relay', () => {
  const value = { ...manifest(), databaseRelayContainer: `${PROJECT_ID}-db-relay`, ingressNetworkName: `${PROJECT_ID}-ingress` };
  const container = identity(value);
  container.ports['5432/tcp'] = [];
  const relay = { ingressInternal: false, container: {
    labels: { 'queue.homologation.run_id': value.runId, 'queue.homologation.project': PROJECT_ID },
    ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '57422' }] },
    command: ['TCP-LISTEN:5432,fork,reuseaddr', `TCP:supabase_db_${PROJECT_ID}:5432`],
    networks: { [value.networkName]: {}, [value.ingressNetworkName]: {} },
  } };
  assert.doesNotThrow(() => verifyContainerIdentity(value, container, true, relay));
  assert.throws(() => verifyContainerIdentity(value, container, true));
  for (const mutate of [
    state => { state.container.labels['queue.homologation.run_id'] = 'another-run'; },
    state => { state.container.command[1] = 'TCP:database.invalid:5432'; },
    state => { state.container.networks.unrelated = {}; },
    state => { state.container.ports['5432/tcp'][0].HostIp = '0.0.0.0'; },
    state => { state.ingressInternal = true; },
  ]) {
    const changed = structuredClone(relay);
    mutate(changed);
    assert.throws(() => verifyContainerIdentity(value, container, true, changed));
  }
});

test('fixture IDs are deterministic per run and never shared across organizations', () => {
  const run = manifest().runId;
  assert.equal(fixtureUUID(run, 'a:org'), fixtureUUID(run, 'a:org'));
  assert.notEqual(fixtureUUID(run, 'a:org'), fixtureUUID(run, 'b:org'));
  assert.match(fixtureUUID(run, 'a:org'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('closed fixture is explicitly closed all week; open fixture is explicit all-day', () => {
  for (const open of [false, true]) {
    const value = queueSchedule(open);
    assert.equal(value.days.length, 7);
    assert.deepEqual(value.days.map(day => day.day_of_week), [0, 1, 2, 3, 4, 5, 6]);
    for (const day of value.days) {
      assert.equal(day.is_active, open);
      assert.equal(day.is_all_day, open);
      assert.equal(day.start_time, null);
      assert.equal(day.end_time, null);
    }
  }
});
