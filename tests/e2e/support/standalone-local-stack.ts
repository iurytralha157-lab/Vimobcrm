import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Explicit alternative to CLI status for this schema-only disposable clone.
// It verifies the container binding and synthetic keys, rather than borrowing
// status/credentials from an unrelated Supabase CLI project.
export function readStandaloneLocalSupabaseStatus(workdir?: string) {
  const manifestPath = process.env.E2E_STANDALONE_LOCAL_STACK_MANIFEST?.trim();
  if (!manifestPath || !path.isAbsolute(manifestPath) || !workdir) {
    throw new Error('The standalone stack requires an absolute manifest and isolated workdir.');
  }
  const actualManifest = fs.realpathSync(manifestPath);
  if (path.dirname(actualManifest).toLowerCase() !== fs.realpathSync(workdir).toLowerCase()) {
    throw new Error('The standalone manifest must belong to its isolated workdir.');
  }
  const manifest = JSON.parse(fs.readFileSync(actualManifest, 'utf8')) as Record<string, string>;
  if (manifest.kind !== 'vimob-whatsapp-disposable'
    || manifest.databaseContainer !== 'vimob-wa-test-ready-20261011'
    || manifest.databaseLabel !== 'whatsapp-20261011') {
    throw new Error('Unrecognized standalone disposable database manifest.');
  }
  const targets = {
    base: required('E2E_BASE_URL'), api: required('E2E_VIMOB_API_URL'),
    supabase: required('E2E_SUPABASE_URL'), database: required('E2E_DATABASE_URL'),
  };
  for (const value of Object.values(targets)) {
    if (!['127.0.0.1', 'localhost'].includes(new URL(value).hostname)) {
      throw new Error('Every standalone target must use loopback.');
    }
  }
  if (targets.supabase !== manifest.supabaseURL || targets.database !== manifest.databaseURL) {
    throw new Error('Standalone environment does not match the disposable manifest.');
  }
  const database = new URL(targets.database);
  if (!['postgres:', 'postgresql:'].includes(database.protocol)
    || database.port !== '57922' || database.pathname !== '/vimob_whatsapp_clone'
    || database.username !== 'postgres' || database.password !== 'local_whatsapp_fixture_only'
    || database.hash || [...database.searchParams].some(([key, value]) => key !== 'sslmode' || value !== 'disable')) {
    throw new Error('Standalone SQL must target the exact disposable schema-only clone.');
  }
  for (const [name, port] of [['base', '3100'], ['api', '8181'], ['supabase', '58021']] as const) {
    const target = new URL(targets[name]);
    if (target.protocol !== 'http:' || target.port !== port || target.pathname !== '/'
      || target.username || target.password || target.search || target.hash) {
      throw new Error('Standalone HTTP targets must use their exact isolated ports.');
    }
  }
  if (required('E2E_EXPECT_SUPABASE_PORT') !== '58021' || required('E2E_EXPECT_DATABASE_PORT') !== '57922') {
    throw new Error('Standalone expected ports must be explicitly configured.');
  }
  const secret = required('E2E_SUPABASE_JWT_SECRET');
  if (secret !== manifest.syntheticJWTSecret || !secret.startsWith('vimob-whatsapp-local-only-') || secret.length < 32) {
    throw new Error('Standalone authentication requires its synthetic JWT secret.');
  }
  const anon = required('E2E_SUPABASE_ANON_KEY');
  const service = required('E2E_SUPABASE_SERVICE_ROLE_KEY');
  verifySyntheticToken(anon, 'anon', secret);
  verifySyntheticToken(service, 'service_role', secret);

  const container = JSON.parse(execFileSync('docker', [
    'inspect', '--format', '{"labels":{{json .Config.Labels}},"ports":{{json .NetworkSettings.Ports}}}',
    manifest.databaseContainer,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000, windowsHide: true })) as {
    labels: Record<string, string>; ports: Record<string, Array<{ HostIp: string; HostPort: string }>>;
  };
  if (container.labels['vimob.test'] !== manifest.databaseLabel
    || !container.ports['5432/tcp']?.some(binding => binding.HostIp === '127.0.0.1' && binding.HostPort === '57922')) {
    throw new Error('Standalone container identity or loopback SQL binding changed.');
  }
  return { API_URL: targets.supabase, DB_URL: targets.database, ANON_KEY: anon, SERVICE_ROLE_KEY: service };
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing explicit standalone setting: ${name}`);
  return value;
}

function verifySyntheticToken(token: string, role: string, secret: string) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid synthetic API token.');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { alg?: string };
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { role?: string; exp?: number };
  const actual = Buffer.from(parts[2], 'base64url');
  const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  if (header.alg !== 'HS256' || claims.role !== role || !claims.exp || claims.exp <= Date.now() / 1000
    || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error('API token does not match the synthetic standalone role and signing secret.');
  }
}
