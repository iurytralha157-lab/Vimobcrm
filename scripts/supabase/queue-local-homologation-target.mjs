import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

export const PROJECT_ID = 'queue-homolog-20261015';
export const RUNTIME_ROOT = 'C:/Users/andre/Documents/Codex/2026-10-14/c/work/queue-homologation';
export const STACK_ROOT = `${RUNTIME_ROOT}/stack`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateManifest(manifest) {
  assert.equal(manifest.kind, 'vimob-queue-homologation-v1');
  assert.match(manifest.runId, UUID);
  assert.equal(manifest.projectId, PROJECT_ID);
  assert.equal(path.resolve(manifest.workdir).toLowerCase(), path.resolve(STACK_ROOT).toLowerCase());
  const api = new URL(manifest.supabaseURL);
  assert.ok(api.username === '' && api.password === '', 'HTTP target must contain no userinfo.');
  assert.equal(api.href, 'http://127.0.0.1:57421/');
  const database = new URL(manifest.databaseURL);
  assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
  assert.equal(database.hostname, '127.0.0.1');
  assert.equal(database.port, '57422');
  assert.equal(database.pathname, '/postgres');
  assert.equal(database.username, 'postgres');
  assert.ok(database.password.length > 0);
  assert.equal(database.hash, '');
  for (const [key, value] of database.searchParams) {
    assert.ok(key === 'sslmode' && value === 'disable');
  }
  assert.equal(manifest.databaseContainer, `supabase_db_${PROJECT_ID}`);
  assert.equal(manifest.networkName, `${PROJECT_ID}-isolated`);
  if (manifest.databaseRelayContainer !== undefined) {
    assert.equal(manifest.databaseRelayContainer, `${PROJECT_ID}-db-relay`);
    assert.equal(manifest.ingressNetworkName, `${PROJECT_ID}-ingress`);
  } else assert.equal(manifest.ingressNetworkName, undefined);
  for (const name of ['anonKey', 'serviceRoleKey']) assert.ok(typeof manifest[name] === 'string' && manifest[name].length > 20);
  return manifest;
}

function verifyLoopbackBinding(ports) {
  const bindings = ports?.['5432/tcp'] || [];
  assert.ok(bindings.some(binding => binding.HostIp === '127.0.0.1' && binding.HostPort === '57422'), 'Database must be bound only to loopback.');
  assert.ok(bindings.every(binding => (binding.HostIp === '127.0.0.1' || binding.HostIp === '::1') && binding.HostPort === '57422'), 'Unexpected SQL publication is forbidden.');
  assert.ok(Object.entries(ports || {}).every(([port, values]) => port === '5432/tcp' || !values?.length), 'Unexpected additional relay publication is forbidden.');
}

export function verifyContainerIdentity(manifest, container, networkInternal, relay) {
  assert.equal(container.labels?.['com.supabase.cli.project'], PROJECT_ID);
  const bindings = container.ports?.['5432/tcp'] || [];
  assert.deepEqual(Object.keys(container.networks || {}), [manifest.networkName], 'Database must use only its isolated internal network.');
  assert.equal(networkInternal, true, 'Database network must have no outbound route.');
  if (!manifest.databaseRelayContainer) {
    verifyLoopbackBinding(container.ports);
    return;
  }
  assert.equal(bindings.length, 0, 'Relayed database must have no direct SQL publication.');
  assert.ok(Object.values(container.ports || {}).every(values => !values?.length), 'Relayed database must have no direct publication.');
  assert.ok(relay?.container, 'An independently inspected relay is required.');
  const proxy = relay.container;
  assert.equal(proxy.labels?.['queue.homologation.run_id'], manifest.runId);
  assert.equal(proxy.labels?.['queue.homologation.project'], PROJECT_ID);
  assert.deepEqual(proxy.command, ['TCP-LISTEN:5432,fork,reuseaddr', `TCP:supabase_db_${PROJECT_ID}:5432`]);
  assert.deepEqual(Object.keys(proxy.networks || {}).sort(), [manifest.networkName, manifest.ingressNetworkName].sort());
  assert.equal(relay.ingressInternal, false, 'Ingress must be a separately attested publication network.');
  verifyLoopbackBinding(proxy.ports);
}

export async function readVerifiedManifest(filename) {
  assert.ok(filename && path.isAbsolute(filename), 'Pass an absolute manifest path.');
  const actual = await fs.realpath(filename);
  const directory = path.dirname(actual).toLowerCase();
  assert.ok([RUNTIME_ROOT, STACK_ROOT].some(root => path.resolve(root).toLowerCase() === directory));
  const manifest = validateManifest(JSON.parse(await fs.readFile(actual, 'utf8')));
  const docker = process.env.QUEUE_HOMOLOGATION_DOCKER_BIN || 'docker';
  const options = { encoding: 'utf8', timeout: 15_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };
  const inspect = name => JSON.parse(execFileSync(docker, ['inspect', '--format', '{"labels":{{json .Config.Labels}},"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}},"command":{{json .Config.Cmd}}}', name], options));
  const container = inspect(manifest.databaseContainer);
  const internal = JSON.parse(execFileSync(docker, ['network', 'inspect', '--format', '{{json .Internal}}', manifest.networkName], options));
  const relay = manifest.databaseRelayContainer ? {
    container: inspect(manifest.databaseRelayContainer),
    ingressInternal: JSON.parse(execFileSync(docker, ['network', 'inspect', '--format', '{{json .Internal}}', manifest.ingressNetworkName], options)),
  } : undefined;
  verifyContainerIdentity(manifest, container, internal, relay);
  return manifest;
}

export async function connectVerifiedDatabase(manifest) {
  validateManifest(manifest);
  const client = new pg.Client({ connectionString: manifest.databaseURL, connectionTimeoutMillis: 10_000, statement_timeout: 10_000,
    query_timeout: 15_000, application_name: 'queue-local-homologation-only' });
  await client.connect();
  try {
    const result = await client.query(`select current_database() as database,
      (select run_id::text from private.queue_homologation_sentinel where singleton=true) as run_id,
      (select project_id from private.queue_homologation_sentinel where singleton=true) as project_id,
      (select count(*)::int from cron.job where active) as active_cron`);
    assert.equal(result.rows[0].database, 'postgres');
    assert.equal(result.rows[0].run_id, manifest.runId);
    assert.equal(result.rows[0].project_id, PROJECT_ID);
    assert.equal(result.rows[0].active_cron, 0, 'Quarantine all local cron jobs before seeding.');
    return client;
  } catch (error) {
    await client.end();
    throw error;
  }
}

export function localAuthFetch(manifest) {
  const origin = new URL(manifest.supabaseURL).origin;
  return (input, init) => {
    const target = new URL(typeof input === 'string' ? input : input.url || input.href);
    assert.equal(target.origin, origin, 'Local authentication must never contact another origin.');
    const timeout = AbortSignal.timeout(15_000);
    return fetch(input, { ...init, redirect: 'error', signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  };
}
