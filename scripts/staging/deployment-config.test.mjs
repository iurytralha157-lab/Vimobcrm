import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createECDH } from 'node:crypto';
import test from 'node:test';
import { validateBuildConfig, validateDeploymentConfig } from './deployment-config.mjs';

const ref = 'abcdefghijklmnopqrst';
const token = (role, projectRef = ref) => [
  Buffer.from('{}').toString('base64url'),
  Buffer.from(JSON.stringify({ role, ref: projectRef })).toString('base64url'),
  'synthetic-test-signature',
].join('.');
function config() {
  const curve = createECDH('prime256v1');
  curve.setPrivateKey(Buffer.alloc(32, 1));
  return {
    STAGING_PROJECT_REF: ref,
    STAGING_SUPABASE_URL: `https://${ref}.supabase.co`,
    STAGING_SUPABASE_ANON_KEY: token('anon'),
    STAGING_SUPABASE_SECRET_KEY: token('service_role'),
    STAGING_PUBLIC_WEB_URL: 'https://homolog.crm.invalid',
    STAGING_PUBLIC_API_URL: 'https://api-homolog.crm.invalid',
    STAGING_WEB_DOMAIN: 'homolog.crm.invalid',
    STAGING_API_DOMAIN: 'api-homolog.crm.invalid',
    STAGING_DATABASE_URL: `postgresql://postgres:synthetic-password@db.${ref}.supabase.co:5432/postgres?sslmode=require`,
    STAGING_RELEASE_SHA: 'a'.repeat(40),
    STAGING_IMAGE_PREFIX: 'ghcr.io/test-owner/test-private-repo',
    STAGING_PUBLIC_SIGNUP_RECOVERY_SECRET: 'synthetic-recovery-secret-'.repeat(2),
    STAGING_BILLING_EDGE_CLIENT_IP_SIGNING_SECRET: 'synthetic-billing-secret-'.repeat(2),
    STAGING_TRUSTED_PROXY_CIDRS: '172.31.24.0/24,127.0.0.1/32',
    STAGING_WEB_PUSH_VAPID_PUBLIC_KEY: curve.getPublicKey().toString('base64url'),
    STAGING_WEB_PUSH_VAPID_PRIVATE_KEY: curve.getPrivateKey().toString('base64url'),
  };
}

test('checks a new Cloud target without accessing any database', () => {
  const result = validateDeploymentConfig(config());
  assert.equal(result.databaseAccessed, false);
  assert.equal(result.deployed, false);
  assert.equal(result.projectRef, ref);
  assert.ok(!JSON.stringify(result).includes('synthetic-password'));
});

test('accepts session pooler only when the username identifies the chosen project', () => {
  const env = config();
  env.STAGING_DATABASE_URL = `postgresql://postgres.${ref}:synthetic-password@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require`;
  assert.doesNotThrow(() => validateDeploymentConfig(env));
  env.STAGING_DATABASE_URL = env.STAGING_DATABASE_URL.replace(ref, 'zzzzzzzzzzzzzzzzzzzz');
  assert.throws(() => validateDeploymentConfig(env), /selected staging project/);
});

test('rejects production ref and production origins, including alternate labels', () => {
  assert.throws(() => validateBuildConfig({ ...config(), STAGING_PROJECT_REF: 'iemalzlfnbouobyjwlwi' }), /Production/);
  assert.throws(() => validateBuildConfig({ ...config(), STAGING_PUBLIC_WEB_URL: 'https://app.vimobcrm.com.br' }), /identify staging/);
  assert.throws(() => validateBuildConfig({ ...config(), STAGING_SUPABASE_URL: 'https://supabase.vimobcrm.com.br' }), /mismatch/);
});

test('rejects swapped keys or project claims before build/deployment', () => {
  assert.throws(() => validateBuildConfig({ ...config(), STAGING_SUPABASE_ANON_KEY: token('service_role') }), /wrong role/);
  assert.throws(() => validateBuildConfig({ ...config(), STAGING_SUPABASE_ANON_KEY: token('anon', 'z'.repeat(20)) }), /match the staging project/);
  assert.throws(() => validateDeploymentConfig({ ...config(), STAGING_SUPABASE_SECRET_KEY: token('service_role', 'z'.repeat(20)) }), /match the staging project/);
});

test('opaque keys explicitly retain the requirement for remote project verification', () => {
  const env = { ...config(), STAGING_SUPABASE_ANON_KEY: 'sb_publishable_' + 'x'.repeat(24) };
  assert.equal(validateBuildConfig(env).publicKeyCheck, 'opaque-key-requires-remote-verification');
});

test('rejects insecure or ambiguous database destinations', () => {
  for (const url of [
    'postgres://postgres:synthetic-password@localhost/postgres?sslmode=require',
    config().STAGING_DATABASE_URL.replace('5432', '6543'),
    config().STAGING_DATABASE_URL.replace('sslmode=require', 'sslmode=disable'),
    config().STAGING_DATABASE_URL.replace(ref, 'iemalzlfnbouobyjwlwi'),
    config().STAGING_DATABASE_URL + '&sslmode=disable',
    config().STAGING_DATABASE_URL + '&host=prod.invalid',
  ]) assert.throws(() => validateDeploymentConfig({ ...config(), STAGING_DATABASE_URL: url }));
});

test('checks VAPID key pairing without including private material in diagnostics', () => {
  const env = config();
  env.STAGING_WEB_PUSH_VAPID_PRIVATE_KEY = Buffer.alloc(32, 2).toString('base64url');
  assert.throws(() => validateDeploymentConfig(env), /do not form a valid pair/);
  assert.throws(() => validateDeploymentConfig({ ...config(), STAGING_WEB_PUSH_VAPID_PUBLIC_KEY: '' }), /Missing/);
});

test('rejects unsafe proxy networks, short secrets and domain disagreement', () => {
  for (const cidr of ['0.0.0.0/0', '::/0', '10.0.0.0/8', '172.31.0.0', '172.31.0.0/24/extra']) {
    assert.throws(() => validateDeploymentConfig({ ...config(), STAGING_TRUSTED_PROXY_CIDRS: cidr }), /proxy CIDRs/);
  }
  assert.throws(() => validateDeploymentConfig({ ...config(), STAGING_PUBLIC_SIGNUP_RECOVERY_SECRET: 'short' }), /32-512/);
  assert.throws(() => validateDeploymentConfig({ ...config(), STAGING_WEB_DOMAIN: 'other.invalid' }), /mismatch/);
});

test('CLI errors never echo a malformed connection string or its password', () => {
  const result = spawnSync(process.execPath, ['scripts/staging/deployment-config.mjs'], {
    env: { ...process.env, ...config(), STAGING_DATABASE_URL: 'postgres://:DO-NOT-PRINT-THIS@[invalid' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not a valid URL/);
  assert.ok(!result.stderr.includes('DO-NOT-PRINT-THIS'));
});
