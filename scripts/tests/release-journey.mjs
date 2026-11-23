import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readBaseline, normalize } from '../supabase/local-schema-baseline-contract.mjs';
import { assertSQLArtifact } from '../supabase/local-schema-baseline-artifacts.mjs';

const root = process.cwd();
const output = await mkdtemp(path.join(tmpdir(), 'vimob-release-gate-'));
const run = 'vimob-release-' + randomBytes(6).toString('hex');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const label = 'vimob.test.release=' + run;
const fixtureName = 'vimob_release_gate';
const http = { app: 'http://127.0.0.1:58730', api: 'http://127.0.0.1:58731', supabase: 'http://127.0.0.1:58732' };
const password = randomBytes(24).toString('hex');
const dbURL = `postgresql://postgres:${password}@127.0.0.1:58733/${fixtureName}?sslmode=disable`;
const internalDB = dbURL.replace('127.0.0.1:58733', `${run}-db:5432`);
const jwtSecret = randomBytes(32).toString('hex');
const providerSecret = randomBytes(24).toString('hex');
const ports = ['58731', '58732', '58733'];
const marker = path.join(output, 'target.json');
const names = [];
const processEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|CI|PLAYWRIGHT_BROWSERS_PATH)$/i.test(key)));
const image = {
  db: 'public.ecr.aws/supabase/postgres@sha256:178f0976b54a39237096bfa310c1a352dbc82fb1b08dda45cdb8acb5d40c1426',
  auth: 'public.ecr.aws/supabase/gotrue@sha256:0a8557cbe0fd53a067726fe656f79eb1b03a1ab3cdde4b59907ce5a1e1a202ab',
  rest: 'public.ecr.aws/supabase/postgrest@sha256:7c5840727ad683b0fdbfb9810930665b34f8b44884a4dc740aa8844748a2b85e',
  gateway: 'node:24-alpine',
  api: `${run}-api`,
  web: `${run}-web`,
};

function docker(args, options = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024,
    timeout: 240_000, env: processEnvironment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

function token(role) {
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const claims = Buffer.from(JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + 7200 })).toString('base64url');
  const payload = `${header}.${claims}`;
  return `${payload}.${createHmac('sha256', jwtSecret).update(payload).digest('base64url')}`;
}

async function envFile(name, entries) {
  const filename = path.join(output, `${name}.env`);
  await writeFile(filename, Object.entries(entries).map(([key, val]) => `${key}=${val}`).join('\n') + '\n', { mode: 0o600 });
  return filename;
}

async function start(role, env, options = [], args = []) {
  const name = `${run}-${role}`;
  const environment = await envFile(role, env);
  docker(['create', '--name', name, '--label', label, '--network', run,
    '--env-file', environment, ...options, image[role], ...args]);
  names.push(name);
  if (role === 'gateway') docker(['network', 'connect', `${run}-ingress`, name]);
  docker(['start', name]);
}

function psql(source, database = fixtureName, username = 'supabase_admin') {
  return docker(['exec', '-i', '--env', 'PGPASSWORD', `${run}-db`, 'psql', '-X', '-qAt', '--no-password', '--set', 'ON_ERROR_STOP=1',
    '-U', username, '-d', database], { input: source, env: { ...processEnvironment, PGPASSWORD: password }, stdio: ['pipe', 'pipe', 'pipe'] });
}

async function retry(description, probe, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (await probe()) return;
    } catch {
      // Never print connection strings or HTTP responses from readiness probes.
    }
    await delay(1000);
  }
  throw new Error(`Release fixture did not become ready: ${description}`);
}

function runBrowser() {
  const vars = {
    ...processEnvironment, E2E_RELEASE_MANIFEST: marker, E2E_RELEASE_DIR: output,
    E2E_RELEASE_DB: dbURL, E2E_RELEASE_SERVICE: token('service_role'),
    E2E_RELEASE_PROVIDER_SECRET: providerSecret,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test',
      '--config', 'tests/e2e/release.config.ts'], { cwd: root, env: vars, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Browser journey exited ${code}`)));
  });
}

let networkReady = false;
let ingressReady = false;
try {
  assert.match(revision, /^[a-f0-9]{40}$/);
  const dockerEndpoint = docker(['context', 'inspect', '--format', '{{(index .Endpoints "docker").Host}}']);
  assert.ok(['unix:///var/run/docker.sock', 'npipe:////./pipe/dockerDesktopLinuxEngine'].includes(dockerEndpoint),
    'The journey needs a local Docker engine.');
  const baseline = await readBaseline(root, path.join(root, 'supabase/reconciliation/local-bootstrap/baseline-20261016.json'));
  for (const artifact of baseline.artifacts) assertSQLArtifact(normalize(artifact.source));
  docker(['network', 'create', '--internal', '--label', label, run]);
  networkReady = true;
  docker(['network', 'create', '--label', label, `${run}-ingress`]);
  ingressReady = true;
  await start('db', { POSTGRES_PASSWORD: password, POSTGRES_DB: 'postgres' }, ['--shm-size', '256m', '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,size=2g']);
  await retry('disposable PostgreSQL TCP listener', () => {
    docker(['exec', run + '-db', 'pg_isready', '-h', '127.0.0.1', '-p', '5432', '-d', 'postgres']);
    return psql('select 1;', 'postgres') === '1';
  });
  psql(`do $roles$
    declare role_name text;
    begin
      foreach role_name in array array['pgbouncer', 'supabase_auth_admin', 'supabase_functions_admin',
        'supabase_realtime_admin', 'supabase_storage_admin']
      loop
        if not exists (select from pg_catalog.pg_roles where rolname = role_name) then
          execute format('create role %I nologin', role_name);
        end if;
      end loop;
    end
    $roles$;`, 'postgres');
  psql(`create database ${fixtureName} owner postgres template template0;`, 'postgres');
  psql(`begin;\nset local transaction_timeout='180s';\n${baseline.artifacts.map(row => normalize(row.source)).join('\n')}\ncommit;\n`);
  for (const migration of baseline.forwards) {
    try {
      // Match the existing local baseline launcher: the fixture application role owns forward-created objects.
      psql(migration.source, fixtureName, 'postgres');
    } catch (error) {
      const detail = String(error.stderr ?? '').split('\n').find(line => line.includes('ERROR:'))?.trim();
      throw new Error(`Release database forward failed: ${migration.file}${detail ? ' (' + detail + ')' : ''}`);
    }
  }
  psql(`create schema vimob_release_fixture;
    create table vimob_release_fixture.target (run_id text primary key);
    insert into vimob_release_fixture.target values ('${run}');
    revoke all on schema vimob_release_fixture from public;`);
  console.log('Reviewed Supabase baseline and forwards installed on a fresh database.');
  await start('auth', {
    GOTRUE_API_HOST: '0.0.0.0', GOTRUE_API_PORT: '9999',
    API_EXTERNAL_URL: `${http.supabase}/auth/v1`, GOTRUE_SITE_URL: http.app,
    GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: `${internalDB}&search_path=auth`,
    GOTRUE_JWT_SECRET: jwtSecret, GOTRUE_JWT_ISSUER: `${http.supabase}/auth/v1`, GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_ADMIN_ROLES: 'service_role',
    GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_DISABLE_SIGNUP: 'true',
    GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'true',
    GOTRUE_DB_AUTOMIGRATE: 'false', GOTRUE_DB_NAMESPACE: 'auth', GOTRUE_LOG_LEVEL: 'warn',
  }, [], ['auth', 'serve']);
  await start('rest', {
    PGRST_DB_URI: internalDB, PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon',
    PGRST_JWT_SECRET: jwtSecret, PGRST_SERVER_HOST: '0.0.0.0', PGRST_SERVER_PORT: '3000', PGRST_LOG_LEVEL: 'warn',
  });
  const gatewayFile = path.join(root, 'scripts/tests/release-journey-gateway.mjs');
  const gatewayEnv = { RELEASE_FIXTURE_NAME: run, RELEASE_FIXTURE_ORIGIN: http.app, RELEASE_FIXTURE_PROVIDER: providerSecret };
  await start('gateway', gatewayEnv, [
    '--mount', `type=bind,source=${gatewayFile},target=/gateway.mjs,readonly`,
    '-p', '127.0.0.1:58730:3000', ...ports.flatMap(port => ['-p', `127.0.0.1:${port}:${port}`]),
  ], ['node', '/gateway.mjs']);
  await retry('real Supabase Auth', async () => (await fetch(`${http.supabase}/auth/v1/health`)).ok);
  await retry('real Supabase Data API', async () => (await fetch(`${http.supabase}/rest/v1/`, {
    headers: { apikey: token('anon') },
  })).ok);
  const builds = await Promise.allSettled([['api', {}], ['web', {
    NEXT_PUBLIC_SUPABASE_URL: http.supabase, NEXT_PUBLIC_SUPABASE_ANON_KEY: token('anon'),
    NEXT_PUBLIC_VIMOB_API_URL: http.api, NEXT_PUBLIC_SITE_URL: http.app,
  }]].map(([role, args]) => new Promise((resolve, reject) => {
    const config = { VIMOB_RELEASE_SHA: revision, ...args };
    const child = spawn('docker', ['build', '--file', `Dockerfile.${role}`, '--tag', image[role], '--label', label,
      ...Object.keys(config).flatMap(key => ['--build-arg', key]), '.'],
    { env: { ...processEnvironment, ...config }, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Isolated ${role} build exited ${code}`)));
  })));
  const failedBuild = builds.find(build => build.status === 'rejected');
  if (failedBuild) throw failedBuild.reason;
  await start('api', {
    API_ENV: 'test', API_HOST: '0.0.0.0', API_PORT: '8081', API_CORS_ALLOWED_ORIGINS: http.app,
    DATABASE_URL: internalDB, DATABASE_MAX_CONNS: '6', DATABASE_MIN_CONNS: '0',
    SUPABASE_JWT_SECRET: jwtSecret, SUPABASE_JWT_ISSUER: `${http.supabase}/auth/v1`,
    SUPABASE_JWT_AUDIENCE: 'authenticated', SUPABASE_PROJECT_URL: `http://${run}-gateway:58732`,
    SUPABASE_SERVICE_ROLE_KEY: token('service_role'), APP_PUBLIC_URL: http.app,
    API_BACKGROUND_WORKERS_ENABLED: 'true', WHATSAPP_WEBHOOK_WORKER_ENABLED: 'true',
    WHATSAPP_WEBHOOK_PROCESSOR_MODE: 'native', WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS: '*',
    EVOLUTION_GO_API_URL: `http://${run}-gateway:58734`, EVOLUTION_GO_API_KEY: providerSecret,
    EVOLUTION_GO_IMAGE_DIGEST: docker(['image', 'inspect', image.gateway, '--format', '{{.Id}}']),
    EVOLUTION_GO_BACKEND_WEBHOOK_URL: `http://${run}-gateway:58731/v1/whatsapp/webhook/evolution-go`,
    WHATSAPP_SESSION_SUPERVISOR_ENABLED: 'false', WHATSAPP_OUTBOX_WORKER_ENABLED: 'true',
    WHATSAPP_MEDIA_WORKER_ENABLED: 'false', WHATSAPP_UNLINKED_RETENTION_WORKER_ENABLED: 'false',
    WHATSAPP_AI_WORKER_ENABLED: 'false', WHATSAPP_AI_FOLLOW_UP_WORKER_ENABLED: 'false',
    AUTOMATION_RUNTIME_WORKER_ENABLED: 'false', AUTOMATION_INACTIVITY_WORKER_ENABLED: 'false',
    NOTIFICATION_DISPATCH_WORKER_ENABLED: 'false', META_WEBHOOK_WORKER_ENABLED: 'false',
    META_CONVERSION_FEEDBACK_WORKER_ENABLED: 'false', ASAAS_RECONCILIATION_ENABLED: 'false',
    PROPERTY_DEVELOPMENT_RESERVATION_WORKER_ENABLED: 'false', PROPERTY_PUBLICATION_WORKER_ENABLED: 'false',
    GRUPO_OLX_IMPORT_REPORT_WORKER_ENABLED: 'false', STAGE_INACTIVITY_WORKER_ENABLED: 'false',
    GOOGLE_CALENDAR_IMMEDIATE_DISPATCH_ENABLED: 'false',
  });
  const webEnvironment = await envFile('web', {
    NEXT_PUBLIC_VIMOB_RELEASE_SHA: revision,
    NEXT_PUBLIC_SUPABASE_URL: http.supabase, NEXT_PUBLIC_SUPABASE_ANON_KEY: token('anon'),
    NEXT_PUBLIC_VIMOB_API_URL: http.api, NEXT_PUBLIC_SITE_URL: http.app, VIMOB_API_URL: http.api,
  });
  docker(['create', '--name', `${run}-web`, '--label', label, '--network', `container:${run}-gateway`,
    '--env-file', webEnvironment, image.web]);
  names.push(`${run}-web`);
  docker(['start', `${run}-web`]);
  for (const [kind, url] of [['Go API', `${http.api}/readyz`], ['Next Web', `${http.app}/login`]]) {
    await retry(kind, async () => {
      const response = await fetch(url, { redirect: 'error' });
      return response.ok && response.headers.get('X-Vimob-Release-Sha') === revision;
    });
  }
  await writeFile(marker, JSON.stringify({ run, revision, ...http }), { flag: 'wx', mode: 0o600 });
  await runBrowser();
} catch (error) {
  const message = error instanceof Error && typeof error.status !== 'number' ? error.message : 'Docker fixture command failed.';
  console.error(message);
  for (const role of ['db', 'auth', 'rest', 'api', 'web']) {
    if (!names.includes(`${run}-${role}`)) continue;
    try {
      const result = spawnSync('docker', ['logs', '--tail', '20', `${run}-${role}`],
        { encoding: 'utf8', env: processEnvironment, timeout: 5_000, windowsHide: true });
      const log = (result.stdout ?? '') + (result.stderr ?? '');
      const redacted = [password, jwtSecret, providerSecret, token('anon'), token('service_role')]
        .reduce((text, secret) => text.replaceAll(secret, '[redacted]'), log)
        .replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, '[redacted-token]');
      if (redacted) console.error(`${role}:\n${redacted}`);
    } catch { /* Preserve the primary local fixture failure. */ }
  }
  process.exitCode = 1;
} finally {
  for (const name of names.reverse()) {
    try { docker(['rm', '-f', '-v', name]); } catch { process.exitCode = 1; }
  }
  for (const [name, ready] of [[`${run}-ingress`, ingressReady], [run, networkReady]]) {
    if (ready) try { docker(['network', 'rm', name]); } catch { process.exitCode = 1; }
  }
  for (const ref of [image.api, image.web]) {
    try { docker(['image', 'rm', ref]); } catch { /* Builds may have failed before tagging. */ }
  }
  for (const file of ['db.env', 'auth.env', 'rest.env', 'gateway.env', 'api.env', 'web.env']) {
    await unlink(path.join(output, file)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  console.log(`Release journey output: ${output}`);
}
