import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const genericWebhook = source("./generic-webhook/index.ts");
const publicApi = source("./public-api/index.ts");
const poolChecker = source("./pool-checker/index.ts");
const evolutionWebhook = source("./evolution-webhook/index.ts");
const hardeningMigration = source("../migrations/20260908034600_harden_edge_reentry_and_pool_redistribution.sql");
const atomicReentryMigration = source(
  "../migrations/20260908065613_make_edge_reentry_processing_atomic.sql",
);
const poolWarningMigration = source(
  "../migrations/20260908071500_harden_pool_warning_delivery.sql",
);

test("generic webhook is a side-effect-free tombstone for the Go ingress", () => {
  assert.match(genericWebhook, /serveRetiredGenericWebhook/);
  assert.match(genericWebhook, /status:\s*410/);
  assert.match(genericWebhook, /generic_webhook_endpoint_retired/);
  assert.match(genericWebhook, /\/v1\/public\/webhooks\/generic/);
  assert.doesNotMatch(
    genericWebhook,
    /createClient|Deno\.env|fetch\s*\(|\.from\s*\(|\.rpc\s*\(|\.insert\s*\(/i,
  );
});

test("legacy public API preserves property reads and tombstones lead writes before auth", () => {
  assert.match(publicApi, /req\.method === "GET" && path === "\/properties"/);
  assert.match(publicApi, /req\.method === "GET" && propertyMatch/);
  assert.match(publicApi, /public_api_lead_write_gone/);
  assert.match(publicApi, /\/v1\/public\/api\/leads/);
  assert.match(publicApi, /status:\s*410/);

  const retirementGuard = publicApi.indexOf("if (isLegacyLeadWrite(req))");
  const authentication = publicApi.indexOf("const authHeader = req.headers");
  assert.ok(retirementGuard >= 0, "POST /leads retirement guard must exist");
  assert.ok(
    authentication > retirementGuard,
    "POST /leads must return 410 before authentication or runtime I/O",
  );

  assert.doesNotMatch(publicApi, /\.from\(\s*["']leads["']\s*\)/);
  assert.doesNotMatch(publicApi, /register_lead_reentry_from_backend/);
  assert.doesNotMatch(publicApi, /distribute_lead_from_backend/);
});

test("legacy distribution RPCs are absent from active Edge callers", () => {
  for (const caller of [evolutionWebhook, poolChecker]) {
    assert.doesNotMatch(caller, /\.rpc\(\s*["']handle_lead_intake["']/);
    assert.doesNotMatch(caller, /\.rpc\(\s*["']redistribute_lead_from_pool["']/);
  }
});

test("pool discovery treats a null redistribution count as zero", () => {
  const nullSafeCounterFilters = poolChecker.match(
    /redistribution_count\.is\.null,redistribution_count\.lt\.\$\{maxRedistributions\}/g,
  ) || [];

  assert.equal(
    nullSafeCounterFilters.length,
    2,
    "warning and redistribution discovery must both treat NULL as zero",
  );
});

test("WhatsApp reentries use the atomic backend processor", () => {
  assert.match(
    evolutionWebhook,
    /\.rpc\(\s*["']process_whatsapp_lead_reentry_from_backend["']/,
  );
  assert.doesNotMatch(
    evolutionWebhook,
    /\.rpc\(\s*["']register_lead_reentry(?:_from_backend)?["']/,
  );
  assert.match(evolutionWebhook, /reentryProcessing\?\.event_id/);
  assert.match(evolutionWebhook, /providerMessageId/);
  assert.match(evolutionWebhook, /evolution-whatsapp-ingress/);
  assert.match(evolutionWebhook, /throw reentryError/);
  assert.match(hardeningMigration, /'reentry'/);
  assert.match(hardeningMigration, /'entry_subtype'/);
  assert.match(hardeningMigration, /return jsonb_build_object\([\s\S]*?'event_id'/);
  assert.match(
    atomicReentryMigration,
    /create or replace function public\.process_whatsapp_lead_reentry_from_backend/,
  );
  assert.match(
    atomicReentryMigration,
    /public\.register_lead_reentry_from_backend\(/,
  );
  assert.match(
    atomicReentryMigration,
    /update public\.whatsapp_conversations/,
  );
  assert.match(atomicReentryMigration, /insert into public\.lead_meta/);
  assert.match(
    atomicReentryMigration,
    /edge_reentry_processing[\s\S]*?'status', 'completed'/,
  );
  assert.match(
    atomicReentryMigration,
    /revoke all on function public\.process_whatsapp_lead_reentry_from_backend[\s\S]*?from public, anon, authenticated, service_role/,
  );
  assert.match(
    atomicReentryMigration,
    /grant execute on function public\.process_whatsapp_lead_reentry_from_backend[\s\S]*?to service_role/,
  );

  const immutableEventLookup = atomicReentryMigration.indexOf(
    "and event.provider = 'evolution_whatsapp'",
  );
  const completedReplayReturn = atomicReentryMigration.indexOf(
    "if v_existing_result is not null then",
    immutableEventLookup,
  );
  const mutableLeadLock = atomicReentryMigration.indexOf(
    "from public.leads as lead",
  );
  const mutableConversationLock = atomicReentryMigration.indexOf(
    "from public.whatsapp_conversations as conversation",
  );
  assert.ok(immutableEventLookup >= 0, "immutable provider event lookup must exist");
  assert.ok(
    completedReplayReturn > immutableEventLookup,
    "completed replay must return from the immutable event result",
  );
  assert.ok(
    mutableLeadLock > completedReplayReturn,
    "completed replay must return before locking or validating the lead",
  );
  assert.ok(
    mutableConversationLock > completedReplayReturn,
    "completed replay must return before locking or validating the conversation",
  );
});

test("WhatsApp reentry processing returns before the new-lead path", () => {
  const processor = evolutionWebhook.indexOf(
    '.rpc("process_whatsapp_lead_reentry_from_backend"',
  );
  const reentryReturn = evolutionWebhook.indexOf("return;", processor);
  const newLeadPath = evolutionWebhook.indexOf(
    "// Determinar usuário responsável",
    processor,
  );

  assert.ok(processor >= 0, "atomic WhatsApp reentry processor must exist");
  assert.ok(reentryReturn > processor, "reentry path must return after processing");
  assert.ok(newLeadPath > reentryReturn, "reentry must not enter the new-lead path");
});

test("pool idempotency keys are based on immutable assignment state", () => {
  assert.match(poolChecker, /assignmentAt:\s*lead\.distribution_assignment_at/);
  assert.match(poolChecker, /roundRobinId:\s*lead\.distribution_round_robin_id/);
  assert.match(poolChecker, /redistributionCount:\s*lead\.redistribution_count/);
});

test("pool warning notification and marker use one backend transaction", () => {
  assert.match(
    poolChecker,
    /\.rpc\(\s*["']send_pool_redistribution_warning_from_backend["']/,
  );
  assert.doesNotMatch(
    poolChecker,
    /\.from\(\s*["']notifications["']\s*\)\.insert/,
  );
  assert.match(poolChecker, /status:\s*failCount > 0 \? 500 : 200/);
  assert.match(poolChecker, /success:\s*failCount === 0/);

  assert.match(
    poolWarningMigration,
    /create or replace function public\.send_pool_redistribution_warning_from_backend/,
  );
  assert.match(poolWarningMigration, /from public\.leads as lead[\s\S]*?for update/);
  assert.match(poolWarningMigration, /insert into public\.notifications/);
  assert.match(
    poolWarningMigration,
    /set redistribution_warning_sent_at = p_now/,
  );
  assert.match(poolWarningMigration, /'dedupe_key'/);
  assert.match(
    poolWarningMigration,
    /revoke all on function public\.send_pool_redistribution_warning_from_backend[\s\S]*?from public, anon, authenticated, service_role/,
  );
  assert.match(
    poolWarningMigration,
    /grant execute on function public\.send_pool_redistribution_warning_from_backend[\s\S]*?to service_role/,
  );
});

test("pool redistribution is finalized in the canonical database transaction", () => {
  assert.match(poolChecker, /\.rpc\(\s*["']redistribute_lead_from_pool_backend["']/);
  const wrapperCallIndex = poolChecker.indexOf(
    '"redistribute_lead_from_pool_backend"',
  );
  assert.ok(wrapperCallIndex >= 0);
  const redistributionFinalization = poolChecker.slice(wrapperCallIndex);
  assert.doesNotMatch(
    redistributionFinalization,
    /\.from\(["']lead_pool_history["']\)/,
  );
  assert.doesNotMatch(
    redistributionFinalization,
    /\.from\(["']notifications["']\)/,
  );
  assert.match(poolChecker, /pool_distribution_not_finalized/);

  const wrapperStart = hardeningMigration.indexOf(
    "create or replace function public.redistribute_lead_from_pool_backend",
  );
  const wrapper = hardeningMigration.slice(wrapperStart);
  assert.ok(wrapperStart >= 0);
  assert.match(wrapper, /private\.distribute_lead\(/);
  assert.match(wrapper, /insert into public\.lead_pool_history/);
  assert.match(wrapper, /insert into public\.notifications/);
  assert.match(wrapper, /update private\.lead_distribution_events/);
  assert.match(wrapper, /'pool_finalized', true/);
  assert.match(wrapper, /legacy_pool_counter_reconciliation_failed/);

  const leadLock = wrapper.indexOf("from public.leads as lead");
  const ledgerRereadAfterLock = wrapper.indexOf(
    "from private.lead_distribution_events as event",
    leadLock,
  );
  assert.ok(leadLock >= 0, "pool aggregate must lock the lead");
  assert.ok(
    ledgerRereadAfterLock > leadLock,
    "pool aggregate must re-read its ledger after waiting for the lead lock",
  );
  assert.match(wrapper, /revoke all on function public\.redistribute_lead_from_pool_backend[\s\S]*?from public, anon, authenticated, service_role/);
  assert.match(wrapper, /grant execute on function public\.redistribute_lead_from_pool_backend[\s\S]*?to service_role/);
});
