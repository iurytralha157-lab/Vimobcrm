import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { PRODUCTION_PROJECT_REF } from './cloud-baseline-contract.mjs';

const required = (env, name) => {
  const value = env[name]?.trim();
  assert.ok(value, `Missing ${name}.`);
  return value;
};

function parseUrl(value, name) {
  try { return new URL(value); }
  catch { throw new Error(`${name} is not a valid URL.`); }
}

function origin(env, name) {
  const value = required(env, name);
  const url = parseUrl(value, name);
  assert.ok(url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    !url.search && !url.hash && url.pathname === '/' && !value.endsWith('/'),
  `${name} must be an HTTPS origin without credentials, port or trailing slash.`);
  assert.ok(!/(^|\.)example\.(com|net|org)$/.test(url.hostname), `${name} is still an example.`);
  return url;
}

function key(env, name, projectRef, role, prefix) {
  const value = required(env, name);
  if (value.startsWith(prefix)) {
    assert.ok(value.length >= 25 && !/\s/.test(value), `${name} has an invalid key format.`);
    // Opaque keys have no locally inspectable project claim. Connectivity and
    // role verification against the selected project remain a deployment gate.
    return 'opaque-key-requires-remote-verification';
  }
  let payload;
  try {
    assert.equal(value.split('.').length, 3);
    payload = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'));
  } catch { throw new Error(`${name} must be the appropriate Supabase key.`); }
  assert.equal(payload.role, role, `${name} has the wrong role.`);
  assert.equal(payload.ref, projectRef, `${name} does not match the staging project.`);
  return 'legacy-key-claims-checked-signature-not-verified';
}

export function validateBuildConfig(env) {
  const projectRef = required(env, 'STAGING_PROJECT_REF');
  assert.match(projectRef, /^[a-z]{20}$/, 'Invalid staging project reference.');
  assert.notEqual(projectRef, PRODUCTION_PROJECT_REF, 'Production project is forbidden.');
  const supabase = origin(env, 'STAGING_SUPABASE_URL');
  assert.equal(supabase.origin, `https://${projectRef}.supabase.co`, 'Supabase URL/project mismatch.');
  const web = origin(env, 'STAGING_PUBLIC_WEB_URL');
  const api = origin(env, 'STAGING_PUBLIC_API_URL');
  for (const [name, url] of [['web', web], ['API', api]]) {
    assert.ok(url.hostname.split('.')[0].match(/(^|[-])(homologacao|homolog|staging|qa)([-]|$)/),
      `The ${name} hostname must explicitly identify staging.`);
  }
  assert.equal(new Set([web.origin, api.origin, supabase.origin]).size, 3, 'Staging origins must be distinct.');
  return { projectRef, supabaseUrl: supabase.origin, webUrl: web.origin, apiUrl: api.origin,
    publicKeyCheck: key(env, 'STAGING_SUPABASE_ANON_KEY', projectRef, 'anon', 'sb_publishable_') };
}

function validateDatabase(env, projectRef) {
  const url = parseUrl(required(env, 'STAGING_DATABASE_URL'), 'STAGING_DATABASE_URL');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Database URL must use PostgreSQL.');
  assert.equal(url.pathname, '/postgres', 'Use the isolated project database named postgres.');
  assert.ok(url.password, 'Database password is required.');
  assert.ok(!url.port || url.port === '5432', 'Use direct or session pooling on port 5432.');
  assert.ok(['require', 'verify-full'].includes(url.searchParams.get('sslmode')), 'Database TLS is required.');
  assert.deepEqual([...url.searchParams.keys()], ['sslmode'],
    'Only one sslmode parameter is allowed; connection overrides are forbidden.');
  assert.ok(!url.hash, 'Database URL fragments are forbidden.');
  const user = decodeURIComponent(url.username);
  const direct = url.hostname === `db.${projectRef}.supabase.co` && user === 'postgres';
  const pooled = /^(aws|gcp)-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
    user === `postgres.${projectRef}`;
  assert.ok(direct || pooled, 'Database host/user does not identify the selected staging project.');
}

function secret(env, name) {
  const value = required(env, name);
  assert.ok(value.length >= 32 && value.length <= 512 && !/\s/.test(value),
    `${name} must contain 32-512 non-whitespace characters.`);
}

function proxies(env) {
  const value = required(env, 'STAGING_TRUSTED_PROXY_CIDRS');
  for (const cidr of value.split(',')) {
    const [ip, bits, extra] = cidr.trim().split('/');
    const version = isIP(ip);
    const prefix = Number(bits);
    assert.ok(!extra && bits && /^\d+$/.test(bits) && version &&
      Number.isInteger(prefix) && prefix >= (version === 4 ? 16 : 48) &&
      prefix <= (version === 4 ? 32 : 128), 'Trusted proxy CIDRs must use restricted explicit networks.');
  }
}

function vapid(env) {
  const publicKey = required(env, 'STAGING_WEB_PUSH_VAPID_PUBLIC_KEY');
  const privateKey = required(env, 'STAGING_WEB_PUSH_VAPID_PRIVATE_KEY');
  assert.match(publicKey, /^[A-Za-z0-9_-]{87}$/, 'Invalid staging VAPID public key format.');
  assert.match(privateKey, /^[A-Za-z0-9_-]{43}$/, 'Invalid staging VAPID private key format.');
  try {
    const curve = createECDH('prime256v1');
    curve.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    assert.ok(curve.getPublicKey().equals(Buffer.from(publicKey, 'base64url')));
  } catch { throw new Error('The staging VAPID public/private keys do not form a valid pair.'); }
}

export function validateDeploymentConfig(env) {
  const result = validateBuildConfig(env);
  assert.equal(required(env, 'STAGING_WEB_DOMAIN'), new URL(result.webUrl).hostname, 'Web domain/URL mismatch.');
  assert.equal(required(env, 'STAGING_API_DOMAIN'), new URL(result.apiUrl).hostname, 'API domain/URL mismatch.');
  assert.match(required(env, 'STAGING_RELEASE_SHA'), /^[a-f0-9]{40}$/, 'Use the full release commit SHA.');
  assert.match(required(env, 'STAGING_IMAGE_PREFIX'), /^ghcr\.io\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/,
    'Use the approved private repository image prefix.');
  validateDatabase(env, result.projectRef);
  result.serverKeyCheck = key(env, 'STAGING_SUPABASE_SECRET_KEY', result.projectRef, 'service_role', 'sb_secret_');
  secret(env, 'STAGING_PUBLIC_SIGNUP_RECOVERY_SECRET');
  secret(env, 'STAGING_BILLING_EDGE_CLIENT_IP_SIGNING_SECRET');
  proxies(env);
  vapid(env);
  return { ...result, configurationChecked: true, databaseAccessed: false, deployed: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.ok(process.argv.slice(2).every(arg => arg === '--build'), 'Only --build is supported.');
    const result = process.argv.includes('--build') ? validateBuildConfig(process.env) : validateDeploymentConfig(process.env);
    console.log(JSON.stringify({ result: 'passed', ...result }));
  } catch (error) {
    // Assertion errors can contain actual/expected values. Emit only messages,
    // never the inspected input, stack, keys or connection string.
    console.error(`Staging configuration rejected: ${error.message.split('\n')[0]}`);
    process.exitCode = 1;
  }
}
