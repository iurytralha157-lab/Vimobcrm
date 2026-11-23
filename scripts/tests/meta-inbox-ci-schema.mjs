import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const baseline = readFileSync(new URL(
  '../../supabase/migrations/20260722000000_production_public_private_baseline.sql', import.meta.url,
), 'utf8').replaceAll('\r\n', '\n');
const inbox = baseline.match(/^CREATE TABLE IF NOT EXISTS "public"\."meta_webhook_events" \(\n[\s\S]*?^\);$/m)?.[0];
const primaryKey = baseline.match(/^ALTER TABLE ONLY "public"\."meta_webhook_events"\n    ADD CONSTRAINT "meta_webhook_events_pkey" PRIMARY KEY \("id"\);$/m)?.[0];
assert.ok(inbox && primaryKey, 'The Meta inbox definition is missing from the reviewed baseline');

// The lease tests use organization-free receipts and need only the canonical inbox.
process.stdout.write(`${inbox}\n${primaryKey}\n`);
