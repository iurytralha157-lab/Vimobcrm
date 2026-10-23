import assert from 'node:assert/strict';
import test from 'node:test';
import { isolatedProcessEnvironment } from './launch-queue-local-homologation.mjs';

const manifest = { supabaseURL: 'http://127.0.0.1:57421', databaseURL: 'postgresql://postgres:synthetic-local-only@127.0.0.1:57422/postgres', serviceRoleKey: 'synthetic-local-service-role', jwtSecret: 'synthetic-local-jwt-secret-with-over-32-characters' };

test('API launch never mixes HMAC secret with asymmetric JWKS verification', () => {
  const asymmetric = isolatedProcessEnvironment(manifest, 'jwks');
  assert.equal(asymmetric.SUPABASE_JWT_SECRET, '');
  assert.equal(asymmetric.SUPABASE_JWKS_URL, 'http://127.0.0.1:57421/auth/v1/.well-known/jwks.json');
  const legacy = isolatedProcessEnvironment(manifest, 'legacy');
  assert.equal(legacy.SUPABASE_JWKS_URL, '');
  assert.equal(legacy.SUPABASE_JWT_SECRET, manifest.jwtSecret);
});

test('API launch is loopback-only and does not inherit provider credentials', () => {
  process.env.QUEUE_HOMOLOGATION_TEST_UNRELATED_SECRET = 'synthetic-test-only';
  try {
    const environment = isolatedProcessEnvironment(manifest, 'jwks');
    assert.equal(environment.QUEUE_HOMOLOGATION_TEST_UNRELATED_SECRET, undefined);
    for (const key of ['RESEND_API_KEY', 'OPENAI_API_KEY', 'META_APP_SECRET', 'ASAAS_API_KEY', 'EVOLUTION_GO_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'SUPABASE_ACCESS_TOKEN']) assert.equal(environment[key], undefined);
    assert.equal(environment.API_HOST, '127.0.0.1');
    assert.equal(environment.API_PORT, '58081');
    assert.equal(environment.APP_PUBLIC_URL, 'http://127.0.0.1:3005');
    assert.equal(environment.API_CORS_ALLOWED_ORIGINS, 'http://127.0.0.1:3005,http://localhost:3005');
    assert.equal(environment.API_BACKGROUND_WORKERS_ENABLED, 'false');
    assert.equal(environment.SUPABASE_PROJECT_URL, manifest.supabaseURL);
    assert.equal(environment.DATABASE_URL, manifest.databaseURL);
    assert.equal(environment.NOTIFICATION_DISPATCH_WORKER_ENABLED, 'false');
  } finally {
    delete process.env.QUEUE_HOMOLOGATION_TEST_UNRELATED_SECRET;
  }
});
