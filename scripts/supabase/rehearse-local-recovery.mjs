import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

const images = {
  db: 'postgres:17.6-alpine',
  auth: 'public.ecr.aws/supabase/gotrue:v2.195.0',
  client: 'node:24-bookworm-slim',
}
const labelKey = 'com.vimob.recovery-rehearsal'
const run = `vimob-recovery-${randomUUID().slice(0, 12)}`
const dbPassword = randomBytes(24).toString('hex')
const jwtSecret = randomBytes(32).toString('hex')
const actorPassword = randomBytes(16).toString('hex')
const objectBytes = `vimob recovery fixture ${run}`
const backup = `${run}-backup`
const containers = []
const networks = []
const volumes = []
const step = { name: 'preflight' }

function docker(args, input) {
  const result = spawnSync('docker', ['--context', 'desktop-linux', ...args], {
    input, encoding: 'utf8', maxBuffer: 512_000, timeout: 90_000, windowsHide: true,
  })
  assert.equal(result.status, 0, `${step.name}: Docker ${args[0]} failed (${result.status ?? result.error?.code ?? result.signal})`)
  return result.stdout.trim()
}

function newVolume(name) {
  docker(['volume', 'create', '--label', `${labelKey}=${run}`, name])
  volumes.push(name)
  return name
}

function createEnvironment(suffix) {
  const name = `${run}-${suffix}`
  docker(['network', 'create', '--internal', '--label', `${labelKey}=${run}`, name])
  networks.push(name)
  assert.equal(docker(['network', 'inspect', '--format', '{{.Internal}}', name]), 'true')
  return { name, files: newVolume(`${name}-files`) }
}

function startService(env, kind, variables, mounts = []) {
  const name = `${env.name}-${kind}`
  docker(['run', '-d', '--pull', 'never', '--name', name, '--label', `${labelKey}=${run}`,
    '--network', env.name, '--network-alias', kind, ...mounts,
    ...Object.entries(variables).flatMap(([key, value]) => ['-e', `${key}=${value}`]), images[kind]])
  containers.push(name)
  assert.equal(docker(['inspect', '--format', '{{len .HostConfig.PortBindings}}', name]), '0')
  return name
}

async function eventually(probe) {
  for (let attempt = 0; attempt < 55; attempt += 1) {
    try { if (probe()) return } catch { /* Services start asynchronously. */ }
    await delay(750)
  }
  throw new Error(`${step.name}: service did not become ready`)
}

const bind = (volume, target, readOnly = false) => [
  '--mount', `type=volume,source=${volume},target=${target}${readOnly ? ',readonly' : ''}`,
]

const query = (db, sql) => docker(['exec', '-i', db, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', 'postgres'], sql)

async function startDatabase(env, source) {
  const db = startService(env, 'db', { POSTGRES_PASSWORD: dbPassword }, [
    '--tmpfs', '/var/lib/postgresql/data:rw,size=512m,mode=700,uid=70,gid=70',
    ...bind(backup, '/backup', !source),
  ])
  await eventually(() => docker(['exec', db, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).includes('accepting connections'))
  query(db, `
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit bypassrls;
  `)
  return db
}

function runClient(env, source, variables = {}) {
  const name = `${env.name}-probe`
  try {
    return docker(['run', '--rm', '--pull', 'never', '--name', name, '--label', `${labelKey}=${run}`, '-i',
      '--network', env.name, ...Object.entries(variables).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
      images.client, 'node', '--input-type=module', '-'], source)
  } finally {
    const matches = docker(['ps', '-aq', '--filter', `label=${labelKey}=${run}`, '--filter', `name=^/${name}$`])
    if (matches) docker(['rm', '-fv', matches])
  }
}

async function startAuth(env) {
  const url = `postgres://postgres:${dbPassword}@db:5432/postgres?sslmode=disable`
  const auth = startService(env, 'auth', {
    GOTRUE_API_HOST: '0.0.0.0', GOTRUE_API_PORT: '9999', API_EXTERNAL_URL: 'http://auth:9999',
    GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: `${url}&search_path=auth`,
    GOTRUE_SITE_URL: 'http://auth:9999', GOTRUE_JWT_SECRET: jwtSecret, GOTRUE_JWT_AUD: 'authenticated',
    GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
    GOTRUE_MAILER_AUTOCONFIRM: 'true',
  })
  await eventually(() => {
    docker(['exec', auth, 'wget', '-qO', '/dev/null', '-T', '2', 'http://127.0.0.1:9999/health'])
    return true
  })
  return auth
}

const initializeSource = `
  create schema auth;
  create schema storage;
  create schema private;
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
`

const browserProbe = `
  import assert from 'node:assert/strict';
  const { SOURCE, ACTOR_PASSWORD } = process.env;
  async function request(url, options) {
    return fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(5000) });
  }
  const users = [];
  for (const actor of ['owner', 'other']) {
    const path = SOURCE ? '/signup' : '/token?grant_type=password';
    const response = await request('http://auth:9999' + path, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: actor + '@recovery.invalid', password: ACTOR_PASSWORD }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.access_token && body.user?.id);
    users.push(body.user.id);
  }
  console.log(JSON.stringify(users));
`

function probe(env, source) {
  return JSON.parse(runClient(env, browserProbe, {
    ...(source ? { SOURCE: '1' } : {}), ACTOR_PASSWORD: actorPassword,
  }))
}

function withFiles(env, command, readOnly = true) {
  return docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--label', `${labelKey}=${run}`,
    ...bind(env.files, '/storage', readOnly), '-e', `OBJECT_BYTES=${objectBytes}`, images.db, 'sh', '-ec', command])
}

function archiveFiles(env, source) {
  const command = source
    ? 'tar -C /storage -cf /backup/storage.tar . && test -s /backup/storage.tar'
    : 'tar -C /storage -xf /backup/storage.tar';
  docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--label', `${labelKey}=${run}`,
    ...bind(backup, '/backup', !source), ...bind(env.files, '/storage', source), images.db, 'sh', '-ec', command])
}

const migration = name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')
const eventsSql = migration('20260728181626_durable_realtime_event_bus.sql')
const cursorSql = migration('20261123043951_serialize_realtime_event_cursor_allocation.sql')

async function rehearse() {
  const endpoint = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}', 'desktop-linux'])
  assert.match(endpoint, /^(?:npipe:\/\/\/\/\.\/pipe\/dockerDesktopLinuxEngine|unix:\/\/\/[^\n]+)$/)
  const imageIDs = Object.fromEntries(Object.entries(images).map(([kind, tag]) => [kind, docker(['image', 'inspect', '--format', '{{.Id}}', tag])]))
  newVolume(backup)

  step.name = 'prepare synthetic source'
  const source = createEnvironment('source')
  const sourceDb = await startDatabase(source, true)
  query(sourceDb, initializeSource)
  step.name = 'start source GoTrue'
  const sourceAuth = await startAuth(source)
  step.name = 'seed source policy and protected object'
  const original = probe(source, true)
  assert.equal(original.length, 2)
  for (const id of original) assert.match(id, /^[0-9a-f-]{36}$/)
  const expectedObjectHash = createHash('sha256').update(objectBytes).digest('hex')
  withFiles(source, 'printf %s "$OBJECT_BYTES" > /storage/lead-note.txt', false)
  query(sourceDb, `
    create table storage.recovery_objects (
      name text primary key, owner_id uuid not null references auth.users(id), object_sha256 text not null
    );
    alter table storage.recovery_objects enable row level security;
    create policy fixture_read on storage.recovery_objects for select to authenticated using (owner_id = auth.uid());
    grant usage on schema storage to authenticated;
    grant select on storage.recovery_objects to authenticated;
    insert into storage.recovery_objects values ('lead-note.txt', '${original[0]}'::uuid, '${expectedObjectHash}');
    create table public.organizations (id uuid primary key);
    insert into public.organizations values ('3622a656-bf62-44b7-b977-8c43628efe58');
    create table public.recovery_lead(id integer primary key, owner_id uuid not null references auth.users(id), name text not null);
    insert into public.recovery_lead values (1, '${original[0]}'::uuid, 'synthetic lead');
    create table private.recovery_queue(lead_id integer references public.recovery_lead(id), status text not null);
    insert into private.recovery_queue values (1, 'pending');
    ${eventsSql}
    ${cursorSql}
    insert into private.realtime_events(organization_id, event_type)
      values ('3622a656-bf62-44b7-b977-8c43628efe58', 'recovery.synthetic');
  `)

  step.name = 'seal backup'
  docker(['stop', sourceAuth])
  const backupStarted = performance.now()
  docker(['exec', sourceDb, 'pg_dump', '-U', 'postgres', '-Fc', '-f', '/backup/db.dump', 'postgres'])
  archiveFiles(source, true)
  const backupMs = Math.round(performance.now() - backupStarted)
  const fingerprint = db => docker(['exec', db, 'sha256sum', '/backup/db.dump', '/backup/storage.tar'])
  const hashes = fingerprint(sourceDb)
  assert.equal(hashes.split('\n').length, 2)
  query(sourceDb, `insert into public.recovery_lead values (2, '${original[0]}'::uuid, 'after the backup');`)
  docker(['stop', sourceDb])

  step.name = 'restore isolated destination'
  const restoreStarted = performance.now()
  const restored = createEnvironment('restored')
  const restoredDb = await startDatabase(restored, false)
  assert.equal(fingerprint(restoredDb), hashes)
  docker(['exec', restoredDb, 'pg_restore', '-U', 'postgres', '--exit-on-error', '--single-transaction', '-d', 'postgres', '/backup/db.dump'])
  archiveFiles(restored, false)
  step.name = 'start restored GoTrue'
  await startAuth(restored)
  step.name = 'verify restored application data'
  const recovered = probe(restored, false)
  assert.deepEqual(recovered, original)
  const restoredObjectHash = withFiles(restored, 'sha256sum /storage/lead-note.txt').split(/\s+/)[0]
  assert.equal(restoredObjectHash, expectedObjectHash)
  const storageVisibility = id => query(restoredDb, `
    begin read only;
    set local role authenticated;
    set local "request.jwt.claim.sub" = '${id}';
    select count(*) from storage.recovery_objects where name = 'lead-note.txt' and object_sha256 = '${restoredObjectHash}';
    rollback;
  `)
  assert.equal(storageVisibility(recovered[0]), '1')
  assert.equal(storageVisibility(recovered[1]), '0')
  const databaseChecks = JSON.parse(query(restoredDb, `
    select json_build_object(
      'leadRecovered', (select count(*) = 1 from public.recovery_lead where id=1 and owner_id='${original[0]}'::uuid),
      'postBackupWriteExcluded', (select count(*) = 0 from public.recovery_lead where id=2),
      'queuePendingPreserved', (select count(*) = 1 from private.recovery_queue where lead_id=1 and status='pending'),
      'realtimeEventRecovered', (select count(*) = 1 from private.realtime_events where event_type='recovery.synthetic'),
      'securityTriggerRecovered', exists (select from pg_trigger where tgrelid='private.realtime_events'::regclass
        and tgname='realtime_events_lock_cursor_allocation' and tgenabled='O')
    );
  `))
  assert.ok(Object.values(databaseChecks).every(value => value === true))
  return { passed: true, synthetic: true, sourceIsolation: 'internal network, no published ports',
    restoreIsolation: 'fresh internal network and volumes, no published ports', imageIDs, backupMs,
    restoreAndVerifyMs: Math.round(performance.now() - restoreStarted),
    archiveSha256: { database: hashes.split(/\s+/)[0], storage: hashes.split('\n')[1].split(/\s+/)[0] },
    checks: { ...databaseChecks, authIdentitiesRecovered: recovered.length,
      storageFileSha256: restoredObjectHash, storageMetadataRlsVerified: true },
    storageHttpVerified: false }
}

let receipt
try {
  receipt = await rehearse()
} finally {
  step.name = 'clean owned resources'
  for (const name of containers.reverse()) docker(['rm', '-fv', name])
  for (const name of networks.reverse()) docker(['network', 'rm', name])
  for (const name of volumes.reverse()) docker(['volume', 'rm', name])
}
console.log(JSON.stringify({ ...receipt, resourcesRemoved: true }, null, 2))
