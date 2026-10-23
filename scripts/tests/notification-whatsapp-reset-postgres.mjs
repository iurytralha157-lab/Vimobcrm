import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialize, verifiedClient, stop, command } from './whatsapp-ci-fixture.mjs';
import { childEnvironment, targetURL } from './whatsapp-ci-contract.mjs';

// Fresh synthetic PostgreSQL only. No repository dotenv, remote URL, migration
// runner, provider, or existing application database is accepted by this runner.
const [rootValue, binValue] = process.argv.slice(2);
assert.ok(rootValue && binValue && path.isAbsolute(rootValue) && path.isAbsolute(binValue),
  'Usage: node scripts/tests/notification-whatsapp-reset-postgres.mjs ABSOLUTE_NEW_ROOT/vimob-whatsapp-ci ABSOLUTE_PG17_BIN');
const root = path.resolve(rootValue), bin = path.resolve(binValue);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
await mkdir(path.dirname(root), { recursive: true });
let initialized = false;
function definition(source, name) {
  const marker = `create or replace function private.${name}(`;
  const start = source.indexOf(marker), body = source.indexOf('$function$', start);
  const end = source.indexOf('$function$', body + '$function$'.length);
  assert.ok(start >= 0 && body > start && end > body, `missing canonical function ${name}`);
  return source.slice(start, end + '$function$'.length) + ';';
}
try {
  await initialize(root, bin); initialized = true;
  const { client, runtime } = await verifiedClient(root);
  try {
    const outbox = await readFile(path.join(repository,
      'supabase/migrations/20260905093544_normalize_notification_delivery_outbox.sql'), 'utf8');
    await client.query(`create schema private; create schema extensions;
      create extension pgcrypto with schema extensions;
      create table public.organizations(id uuid primary key default gen_random_uuid());
      create table public.users(id uuid primary key default gen_random_uuid());
      create table public.push_tokens(id uuid primary key default gen_random_uuid(),
        organization_id uuid, user_id uuid, is_active boolean not null default true);
      create table public.notifications(id uuid primary key default gen_random_uuid(),
        organization_id uuid not null references public.organizations,
        user_id uuid references public.users, title text not null default 'Synthetic notice',
        metadata jsonb not null default '{}', created_at timestamptz not null default now());
      create table public.whatsapp_outbox(id uuid primary key default gen_random_uuid(),
        organization_id uuid not null references public.organizations, status text not null);
      create table vimob_ci_fixture.notification_reset_purpose(nonce text primary key, purpose text not null);`);
    await client.query('insert into vimob_ci_fixture.notification_reset_purpose values($1,$2)',
      [runtime.nonce, 'synthetic-notification-reset-only']);
    const deliveries = outbox.indexOf('create table if not exists private.notification_deliveries (');
    const deliveryEnd = outbox.indexOf('comment on table private.notification_deliveries', deliveries);
    const attempts = outbox.indexOf('create table if not exists private.notification_delivery_attempts (');
    const attemptsEnd = outbox.indexOf('comment on table private.notification_delivery_attempts', attempts);
    assert.ok(deliveries >= 0 && deliveryEnd > deliveries && attempts > deliveryEnd && attemptsEnd > attempts);
    await client.query(outbox.slice(deliveries, deliveryEnd));
    await client.query(outbox.slice(attempts, attemptsEnd));
    for (const name of ['notification_safe_integer', 'notification_safe_timestamptz',
      'notification_dispatch_required', 'notification_delivery_retry_delay',
      'notification_delivery_expected_message_id', 'notification_delivery_idempotency_key',
      'notification_delivery_expiry', 'materialize_notification_deliveries',
      'start_notification_delivery', 'unblock_notification_deliveries', 'apply_notification_delivery_receipt']) {
      await client.query(definition(outbox, name));
    }
  } finally { await client.end(); }
  const password = await readFile(path.join(root, 'password.txt'), 'utf8');
  const result = await command('go', ['test', './internal/admin', '-run', '^TestLocalWhatsAppNotificationReset',
    '-count=1', '-v', '-timeout', '90s'], {
    cwd: path.join(repository, 'apps/api'),
    env: { ...childEnvironment(), VIMOB_NOTIFICATION_RESET_TEST: 'LOCAL_WRITE_TEST',
      VIMOB_NOTIFICATION_RESET_TEST_ROOT: root, VIMOB_NOTIFICATION_RESET_TEST_DATABASE_URL: targetURL(password) },
  });
  await writeFile(path.join(root, 'results', 'notification-reset-go.txt'), result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /--- SKIP:/, 'selected local database tests must run');
  assert.match(result.stdout, /--- PASS: TestLocalWhatsAppNotificationResetScopeCutoffAndDurability/);
  assert.match(result.stdout, /--- PASS: TestLocalWhatsAppNotificationResetWaitsForSendAndPreservesIt/);
  assert.match(result.stdout, /--- PASS: TestLocalWhatsAppNotificationResetAuditFailureRollsBack/);
  process.stdout.write(result.stdout);
  console.log('PASS actual API repository on fresh synthetic PostgreSQL; no full Supabase migration-chain or provider test.');
} catch (error) {
  // Never print connection strings or child environments, including on failure.
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  process.stderr.write(String(error.message).split('\n')[0] + '\n');
  process.exitCode = 1;
} finally {
  if (initialized) {
    await stop(root);
    console.log('Owned synthetic PostgreSQL stopped.');
  }
}
