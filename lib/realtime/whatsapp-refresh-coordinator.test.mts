import assert from "node:assert/strict";
import test from "node:test";

const modulePath = "./whatsapp-refresh-coordinator.ts";
type TestScope = { organizationId: string };
type TestBatch = {
  scopeKey: string;
  scope: TestScope;
  allMessages: boolean;
  allLeadMessages: boolean;
  conversationIds: readonly string[];
  leadIds: readonly string[];
};
type TestRequest = Partial<Omit<TestBatch, "scopeKey" | "scope">> & {
  scopeKey: string;
  scope: TestScope;
  refreshConversations?: boolean;
  refreshMessages?: boolean;
  refreshLeadMessages?: boolean;
};
type TestCoordinator = {
  schedule: (request: TestRequest) => void;
  flush: (scopeKey: string) => boolean;
  clear: () => void;
};
type TestCoordinatorConstructor = new (
  onFlush: (batch: TestBatch) => void,
  delayMs?: number,
) => TestCoordinator;
const refreshModule = await import(modulePath) as unknown as {
  WhatsAppRealtimeRefreshCoordinator: TestCoordinatorConstructor;
};
const { WhatsAppRealtimeRefreshCoordinator } = refreshModule;

test("coalesces SSE, inbox and lead hints for one tenant", () => {
  const batches: Array<{
    scopeKey: string;
    allMessages: boolean;
    allLeadMessages: boolean;
    conversationIds: readonly string[];
    leadIds: readonly string[];
  }> = [];
  const coordinator = new WhatsAppRealtimeRefreshCoordinator(
    (batch) => batches.push(batch),
    60_000,
  );

  coordinator.schedule({
    scopeKey: "organization-a:user-a:scope-a",
    scope: { organizationId: "organization-a" },
    refreshConversations: true,
    refreshMessages: true,
    refreshLeadMessages: true,
    conversationIds: ["conversation-a"],
    leadIds: ["lead-a"],
  });
  coordinator.schedule({
    scopeKey: "organization-a:user-a:scope-a",
    scope: { organizationId: "organization-a" },
    refreshConversations: true,
    refreshMessages: true,
    refreshLeadMessages: true,
    allMessages: true,
    allLeadMessages: true,
  });
  coordinator.schedule({
    scopeKey: "organization-a:user-a:scope-a",
    scope: { organizationId: "organization-a" },
    refreshMessages: true,
    conversationIds: ["conversation-a"],
    leadIds: ["lead-a"],
  });

  assert.equal(coordinator.flush("organization-a:user-a:scope-a"), true);
  assert.equal(batches.length, 1);
  assert.equal(batches[0]?.allMessages, true);
  assert.equal(batches[0]?.allLeadMessages, true);
  assert.deepEqual(batches[0]?.conversationIds, ["conversation-a"]);
  assert.deepEqual(batches[0]?.leadIds, ["lead-a"]);
  coordinator.clear();
});

test("never merges refreshes from different tenants", () => {
  const batches: Array<{ scopeKey: string; scope: { organizationId: string } }> = [];
  const coordinator = new WhatsAppRealtimeRefreshCoordinator(
    (batch) => batches.push(batch),
    60_000,
  );

  coordinator.schedule({
    scopeKey: "organization-a:user-a:scope-a",
    scope: { organizationId: "organization-a" },
    refreshConversations: true,
  });
  coordinator.schedule({
    scopeKey: "organization-b:user-a:scope-a",
    scope: { organizationId: "organization-b" },
    refreshConversations: true,
  });

  coordinator.flush("organization-a:user-a:scope-a");
  coordinator.flush("organization-b:user-a:scope-a");

  assert.deepEqual(
    batches.map((batch) => batch.scope.organizationId),
    ["organization-a", "organization-b"],
  );
  coordinator.clear();
});

test("allows a later real change after the previous batch flushed", () => {
  let flushes = 0;
  const coordinator = new WhatsAppRealtimeRefreshCoordinator(
    () => { flushes += 1; },
    60_000,
  );
  const request = {
    scopeKey: "organization-a:user-a:scope-a",
    scope: { organizationId: "organization-a" },
    refreshMessages: true,
    conversationIds: ["conversation-a"],
  };

  coordinator.schedule(request);
  coordinator.flush(request.scopeKey);
  coordinator.schedule(request);
  coordinator.flush(request.scopeKey);

  assert.equal(flushes, 2);
  coordinator.clear();
});
