import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { connectVerifiedDatabase, localAuthFetch, readVerifiedManifest, RUNTIME_ROOT } from './queue-local-homologation-target.mjs';
import { assertOwnedBrowserWorker, readRuntimeOSIdentity } from './queue-browser-cleanup.mjs';

export function isolatedProcessEnvironment(manifest, signingMode) {
  const environment = {};
  for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'ProgramData']) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  Object.assign(environment, {
    API_ENV: 'test', API_HOST: '127.0.0.1', API_PORT: '58081', API_BACKGROUND_WORKERS_ENABLED: 'false',
    API_CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:3005,http://localhost:3005',
    DATABASE_URL: manifest.databaseURL, DATABASE_MAX_CONNS: '8', DATABASE_MIN_CONNS: '0',
    SUPABASE_PROJECT_URL: manifest.supabaseURL, NEXT_PUBLIC_SUPABASE_URL: manifest.supabaseURL,
    SUPABASE_SERVICE_ROLE_KEY: manifest.serviceRoleKey, SUPABASE_JWT_AUDIENCE: 'authenticated',
    SUPABASE_JWT_ISSUER: `${manifest.supabaseURL.replace(/\/$/, '')}/auth/v1`,
    SUPABASE_JWKS_URL: signingMode === 'jwks' ? `${manifest.supabaseURL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json` : '',
    SUPABASE_JWT_SECRET: signingMode === 'legacy' ? manifest.jwtSecret : '',
    APP_PUBLIC_URL: 'http://127.0.0.1:3005', VIMOB_API_URL: 'http://127.0.0.1:58081',
    GOOGLE_CALENDAR_IMMEDIATE_DISPATCH_ENABLED: 'false', NOTIFICATION_DISPATCH_WORKER_ENABLED: 'false',
    WHATSAPP_AI_WORKER_ENABLED: 'false', WHATSAPP_AI_FOLLOW_UP_WORKER_ENABLED: 'false',
    WHATSAPP_OUTBOX_WORKER_ENABLED: 'false', WHATSAPP_WEBHOOK_WORKER_ENABLED: 'false',
    WHATSAPP_MEDIA_WORKER_ENABLED: 'false', WHATSAPP_SESSION_SUPERVISOR_ENABLED: 'false',
    WHATSAPP_UNLINKED_RETENTION_WORKER_ENABLED: 'false', META_WEBHOOK_WORKER_ENABLED: 'false',
    META_CONVERSION_FEEDBACK_WORKER_ENABLED: 'false', ASAAS_RECONCILIATION_ENABLED: 'false',
    PROPERTY_PUBLICATION_WORKER_ENABLED: 'false', GRUPO_OLX_IMPORT_REPORT_WORKER_ENABLED: 'false',
    STAGE_INACTIVITY_WORKER_ENABLED: 'false',
  });
  return environment;
}

export async function launchQueueLocalHomologation(mode, filename) {
  assert.ok(['api', 'runtime'].includes(mode), 'Choose api or runtime.');
  const manifest = await readVerifiedManifest(filename);
  const db = await connectVerifiedDatabase(manifest);
  await db.end();
  const response = await localAuthFetch(manifest)(`${manifest.supabaseURL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`);
  assert.ok(response.ok, 'Real local Auth JWKS endpoint must be reachable.');
  const jwks = await response.json();
  const signingMode = jwks.keys?.length ? 'jwks' : 'legacy';
  if (signingMode === 'legacy') assert.ok(typeof manifest.jwtSecret === 'string' && manifest.jwtSecret.length >= 32, 'Local HS256 Auth requires its own explicit synthetic JWT secret.');
  const cwd = path.join(RUNTIME_ROOT, 'process-cwd');
  await fs.mkdir(cwd, { recursive: true });
  for (const file of ['.env', '.env.local']) assert.equal(await fs.access(path.join(cwd, file)).then(() => true, () => false), false, 'Process CWD must contain no dotenv files.');
  const executable = path.join(RUNTIME_ROOT, 'bin', mode === 'api' ? 'vimob-api.exe' : 'queue-homologation-runtime.exe');
  await fs.access(executable);
  const log = path.join(RUNTIME_ROOT, `${mode}.log`);
  const output = await fs.open(log, 'a');
  try {
    const launchRequestedAt = new Date().toISOString();
    const processRecord = path.join(RUNTIME_ROOT, `${mode}-process.json`);
    const launchIntent = { kind: 'vimob-queue-local-process-v1', runId: manifest.runId, mode,
      runtimeMode: mode === 'runtime' ? 'production_worker' : undefined, executable, cwd, log, launchRequestedAt,
      attestationStatus: 'LAUNCH_RESERVED' };
    // Preserve a fail-closed intent even if OS identity lookup fails after
    // spawn. A second continuous worker cannot race this exclusive reserve.
    if (mode === 'runtime') await fs.writeFile(processRecord, JSON.stringify(launchIntent, null, 2), { flag: 'wx', mode: 0o600 });
    const child = spawn(executable, mode === 'api' ? [] : ['-manifest', path.resolve(filename), '-worker'], {
      cwd, env: isolatedProcessEnvironment(manifest, signingMode), stdio: ['ignore', output.fd, output.fd], detached: true, windowsHide: true,
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    if (mode === 'runtime') await fs.writeFile(processRecord, JSON.stringify({ ...launchIntent, pid: child.pid, attestationStatus: 'PENDING_OS_IDENTITY' }, null, 2));
    const spawnRecordedAt = new Date().toISOString();
    const processIdentity = mode === 'runtime' ? await readRuntimeOSIdentity(child.pid) : null;
    if (mode === 'runtime') assert.ok(child.exitCode === null && child.signalCode === null, 'The originally spawned worker must still be alive during its first OS attestation.');
    const receipt = { kind: 'vimob-queue-local-process-v1', runId: manifest.runId, mode, runtimeMode: mode === 'runtime' ? 'production_worker' : undefined,
      pid: child.pid, executable, cwd, log, launchRequestedAt, recordedAt: spawnRecordedAt, osStartedAt: processIdentity?.startedAt, attestationStatus: 'VERIFIED' };
    if (mode === 'runtime') assertOwnedBrowserWorker(manifest, receipt, processIdentity);
    await fs.writeFile(processRecord, JSON.stringify(receipt, null, 2));
    return { mode, pid: child.pid, log, signingMode, status: 'spawned_readiness_not_yet_verified' };
  } finally {
    await output.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  launchQueueLocalHomologation(process.argv[2], process.argv[3]).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => { process.stderr.write(`Local queue launch failed: ${error.message}\n`); process.exitCode = 1; });
}
