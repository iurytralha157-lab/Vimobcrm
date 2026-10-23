import assert from "node:assert/strict";
import test from "node:test";
import { reconcileUnmatchedNotificationReceipts } from "./notification-receipt";

const scope = { organizationId: "org-a", sessionId: "session-a" };
const at = "2026-10-12T18:00:00Z";

test("notification receipts use resolved session and tenant, deduplicate IDs and leave missing identities pending", async () => {
  const calls: Record<string, unknown>[] = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    assert.equal(name, "evolution_go_reconcile_notification_receipt");
    calls.push(args);
    return { data: { outcome: args.p_provider_message_id === "unknown" ? "not_found" : "applied" }, error: null };
  } };
  assert.deepEqual(await reconcileUnmatchedNotificationReceipts(client, scope, ["reminder", "reminder", "unknown"], "delivered", at), new Set(["reminder"]));
  assert.equal(calls.length, 2);
  assert.ok(calls.every((args) => args.p_organization_id === scope.organizationId && args.p_session_id === scope.sessionId && args.p_occurred_at === at));
});

test("accepted/queued/sent receipts never invent notification delivery", async () => {
  const client = { rpc: async () => { throw new Error("unexpected RPC"); } };
  for (const status of ["pending", "queued", "sent", "received"]) {
    assert.equal((await reconcileUnmatchedNotificationReceipts(client, scope, ["id"], status, at)).size, 0);
  }
});

test("late and duplicate receipts are acknowledged through the existing monotonic reconciler", async () => {
  for (const outcome of ["already_applied", "stale"]) {
    const client = { rpc: async () => ({ data: { outcome }, error: null }) };
    assert.deepEqual(await reconcileUnmatchedNotificationReceipts(client, scope, ["id"], "failed", at), new Set(["id"]));
  }
});

test("rejected or unavailable reconciliation stays retryable and does not acknowledge ambiguous or foreign targets", async () => {
  for (const outcome of ["ambiguous", "invalid_status", "invalid_scope", "unknown"]) {
    const client = { rpc: async () => ({ data: { outcome }, error: null }) };
    await assert.rejects(reconcileUnmatchedNotificationReceipts(client, scope, ["id"], "read", at), /rejected/);
  }
  await assert.rejects(reconcileUnmatchedNotificationReceipts({ rpc: async () => ({ data: null, error: new Error("DB unavailable") }) }, scope, ["id"], "read", at), /DB unavailable/);
  await assert.rejects(reconcileUnmatchedNotificationReceipts({ rpc: async () => { throw new Error("must not call"); } }, { organizationId: "", sessionId: "session-a" }, ["id"], "read", at), /scope_missing/);
});
