import assert from "node:assert/strict";
import test from "node:test";

import {
  appendConversationUnreadEffect,
  completedEvolutionGoEffectMetadata,
  deterministicEvolutionGoEffectId,
  EVOLUTION_GO_UNREAD_LEDGER_KEY,
  EVOLUTION_GO_UNREAD_LEDGER_LIMIT,
  hasConversationUnreadEffect,
  pendingEvolutionGoEffectMetadata,
  removeConversationUnreadEffect,
  storedEvolutionGoEffectState,
} from "./message-effects.ts";

const organizationId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const providerMessageId = "provider-message-123";

test("message effect marker survives retry and becomes terminal only at completion", () => {
  const pending = pendingEvolutionGoEffectMetadata(
    { source: "evolution_go_webhook" },
    providerMessageId,
    "2026-08-16T12:00:00.000Z",
  );
  assert.equal(
    storedEvolutionGoEffectState(pending, providerMessageId),
    "pending",
  );
  const retried = pendingEvolutionGoEffectMetadata(
    pending,
    providerMessageId,
    "2026-08-16T12:05:00.000Z",
  );
  assert.equal(
    retried.evolution_go_webhook_effects.started_at,
    "2026-08-16T12:00:00.000Z",
  );
  const completed = completedEvolutionGoEffectMetadata(
    retried,
    providerMessageId,
    "2026-08-16T12:06:00.000Z",
  );
  assert.equal(
    storedEvolutionGoEffectState(completed, providerMessageId),
    "completed",
  );
  assert.equal(
    storedEvolutionGoEffectState(completed, "other-message"),
    "conflict",
  );
  assert.equal(storedEvolutionGoEffectState({}, providerMessageId), "untracked");
});

test("completed marker cannot be downgraded by a replay", () => {
  const completed = completedEvolutionGoEffectMetadata(
    {},
    providerMessageId,
    "2026-08-16T12:06:00.000Z",
  );
  const replay = pendingEvolutionGoEffectMetadata(
    completed,
    providerMessageId,
    "2026-08-16T13:00:00.000Z",
  );
  assert.equal(storedEvolutionGoEffectState(replay, providerMessageId), "completed");
});

test("conversation ledger makes unread application replay-safe within its bounded crash window", () => {
  let metadata = {};
  const keys = Array.from(
    { length: EVOLUTION_GO_UNREAD_LEDGER_LIMIT + 2 },
    (_, index) => index.toString(16).padStart(64, "0"),
  );
  for (const key of keys) metadata = appendConversationUnreadEffect(metadata, key);
  assert.equal(
    metadata[EVOLUTION_GO_UNREAD_LEDGER_KEY].length,
    EVOLUTION_GO_UNREAD_LEDGER_LIMIT,
  );
  assert.equal(hasConversationUnreadEffect(metadata, keys.at(-1)), true);
  assert.equal(hasConversationUnreadEffect(metadata, keys[0]), false);
  const replay = appendConversationUnreadEffect(metadata, keys.at(-1));
  assert.equal(
    replay[EVOLUTION_GO_UNREAD_LEDGER_KEY].filter((key) => key === keys.at(-1)).length,
    1,
  );
  const released = removeConversationUnreadEffect(replay, keys.at(-1));
  assert.equal(hasConversationUnreadEffect(released, keys.at(-1)), false);
});

test("effect IDs are deterministic, scoped, and valid UUIDv8 values", async () => {
  const first = await deterministicEvolutionGoEffectId(
    organizationId,
    sessionId,
    providerMessageId,
    "inbound_log",
  );
  const replay = await deterministicEvolutionGoEffectId(
    organizationId,
    sessionId,
    providerMessageId,
    "inbound_log",
  );
  const otherSession = await deterministicEvolutionGoEffectId(
    organizationId,
    "33333333-3333-4333-8333-333333333333",
    providerMessageId,
    "inbound_log",
  );
  assert.equal(first, replay);
  assert.notEqual(first, otherSession);
  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});
