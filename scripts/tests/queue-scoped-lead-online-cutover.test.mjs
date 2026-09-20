import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRepoFile = (path) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

const [migration, freeze, prepareIndexes, strictBinding, retireGlobalIndex] =
  await Promise.all([
    readRepoFile(
      "supabase/migrations/20260920080434_freeze_legacy_whatsapp_ingress_for_online_cutover.sql",
    ),
    readRepoFile(
      "supabase/cutovers/20260920_freeze_legacy_whatsapp_ingress_online.sql",
    ),
    readRepoFile(
      "supabase/cutovers/20260919_prepare_queue_scoped_lead_online_indexes.sql",
    ),
    readRepoFile(
      "supabase/cutovers/20260919_enable_strict_whatsapp_message_binding.sql",
    ),
    readRepoFile(
      "supabase/cutovers/20260919_retire_legacy_global_lead_phone_index.sql",
    ),
  ]);

const portainerStack = await readRepoFile("deploy/portainer-stack.yml");

test("legacy ingress freeze is private, immutable and never replays source rows", () => {
  assert.match(
    migration,
    /create table if not exists private\.whatsapp_webhook_legacy_routing_freeze/,
  );
  assert.match(migration, /enable row level security/);
  assert.match(
    migration,
    /revoke all on table private\.whatsapp_webhook_legacy_routing_freeze[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.match(
    migration,
    /frozen_legacy_whatsapp_ingress_mutation_forbidden/,
  );
  assert.match(
    migration,
    /active_whatsapp_ingress_requires_routing_snapshot_v1/,
  );

  assert.doesNotMatch(
    freeze,
    /\bupdate\s+public\.whatsapp_webhook_inbox\b/i,
  );
  assert.doesNotMatch(
    freeze,
    /\bdelete\s+from\s+public\.whatsapp_webhook_inbox\b/i,
  );
  assert.match(freeze, /set local lock_timeout = '5s'/);
  assert.match(freeze, /legacy_whatsapp_ingress_claim_raced_online_freeze/);
  assert.match(freeze, /guard_whatsapp_webhook_legacy_routing_freeze/);
});

test("online cutover proves the exact frozen identity at every gate", () => {
  for (const source of [prepareIndexes, strictBinding, retireGlobalIndex]) {
    assert.match(source, /online_legacy_freeze/);
    assert.match(
      source,
      /private\.is_frozen_legacy_whatsapp_ingress\([\s\S]*inbox\.id,[\s\S]*inbox\.organization_id,[\s\S]*inbox\.session_id,[\s\S]*inbox\.event_key,[\s\S]*inbox\.processing_lane/,
    );
    assert.match(source, /queue_scoped_lead_online_legacy_freeze_not_ready/);
  }

  assert.match(strictBinding, /set local lock_timeout = '5s'/);
  assert.match(
    strictBinding,
    /whatsapp_webhook_active_routing_snapshot_v1_check[\s\S]*private\.is_frozen_legacy_whatsapp_ingress/,
  );
  assert.match(
    retireGlobalIndex,
    /strict_whatsapp_ingress_snapshot_constraint_not_ready/,
  );
});

test("index transition remains online and ordered", () => {
  assert.match(
    prepareIndexes,
    /create unique index concurrently(?: if not exists)? leads_org_scope_phone_unique/i,
  );
  assert.match(
    prepareIndexes,
    /create index concurrently(?: if not exists)? outbox_messages_active_lead_idx/i,
  );
  assert.match(
    retireGlobalIndex,
    /drop index concurrently(?: if exists)? public\.leads_org_phone_unique/i,
  );

  const strictGate = retireGlobalIndex.indexOf(
    "strict_whatsapp_message_binding_not_ready",
  );
  const drop = retireGlobalIndex.search(
    /drop index concurrently(?: if exists)? public\.leads_org_phone_unique/i,
  );
  assert.ok(strictGate >= 0, "expected the strict binding gate");
  assert.ok(drop > strictGate, "global identity may retire only after B1 proof");
});

test("production API rollout keeps one healthy task serving", () => {
  const apiService = portainerStack.split(/\n  api:\s*\n/)[1];
  assert.ok(apiService, "expected the API service in the Portainer stack");
  assert.match(
    apiService,
    /update_config:[\s\S]*?order: start-first/,
  );
  assert.match(apiService, /failure_action: pause/);
});
