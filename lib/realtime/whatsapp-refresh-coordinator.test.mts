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
type CatchUpTimer = ReturnType<typeof setTimeout>;
type TestCatchUp = { start: (activeInbox?: boolean) => void; hint: () => void; dispose: () => void };
type TestCatchUpFactory = (
  refresh: () => void,
  timers?: {
    set: (callback: () => void, delayMs: number) => CatchUpTimer;
    clear: (timer: CatchUpTimer) => void;
  },
) => TestCatchUp;
const refreshModule = await import(modulePath) as unknown as {
  WhatsAppRealtimeRefreshCoordinator: TestCoordinatorConstructor;
  createWhatsAppInboxSubscriptionCatchUp: TestCatchUpFactory;
};
const { WhatsAppRealtimeRefreshCoordinator, createWhatsAppInboxSubscriptionCatchUp } = refreshModule;

function fakeCatchUpClock() {
  let now = 0;
  let nextId = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  return {
    get now() { return now; },
    get pendingCount() { return pending.size; },
    timers: {
      set(callback: () => void, delayMs: number) {
        const id = ++nextId;
        pending.set(id, { at: now + delayMs, callback });
        return id as unknown as CatchUpTimer;
      },
      clear(timer: CatchUpTimer) { pending.delete(timer as unknown as number); },
    },
    advanceTo(target: number) {
      while (true) {
        const next = [...pending.entries()]
          .filter(([, value]) => value.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        pending.delete(next[0]);
        next[1].callback();
      }
      now = target;
    },
  };
}

test("default timers call native browser methods with the global receiver", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let scheduled = 0;
  let cleared = 0;
  let refreshed = 0;
  globalThis.setTimeout = function (this: unknown) {
    assert.equal(this, globalThis);
    scheduled += 1;
    return scheduled as unknown as ReturnType<typeof setTimeout>;
  } as unknown as typeof setTimeout;
  globalThis.clearTimeout = function (this: unknown) {
    assert.equal(this, globalThis);
    cleared += 1;
  } as typeof clearTimeout;

  try {
    const catchUp = createWhatsAppInboxSubscriptionCatchUp(() => { refreshed += 1; });
    catchUp.start(true);
    assert.equal(refreshed, 1);
    assert.equal(scheduled, 7);
    catchUp.dispose();
    assert.equal(cleared, scheduled);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("catches a missed cold-start hint and retries a transient API failure", () => {
  const clock = fakeCatchUpClock();
  const reads: number[] = [];
  let visible = false;
  const catchUp = createWhatsAppInboxSubscriptionCatchUp(() => {
    reads.push(clock.now);
    // The event reaches the DB at 2 s, but its private broadcast is lost
    // before the replication slot is ready. The 10 s GET fails once.
    if (clock.now < 2_000 || clock.now === 10_000) return;
    visible = true;
  }, clock.timers);

  catchUp.start(true);
  clock.advanceTo(1_000);
  clock.advanceTo(10_000);
  assert.equal(visible, false);
  clock.advanceTo(20_000);
  assert.equal(visible, true);
  assert.deepEqual(reads, [0, 1_000, 10_000, 20_000]);
  catchUp.dispose();
  assert.equal(clock.pendingCount, 0);
});

test("valid inbox hint with failed GET keeps the bounded catch-up alive", () => {
  const clock = fakeCatchUpClock();
  const reads: number[] = [];
  let visible = false;
  const catchUp = createWhatsAppInboxSubscriptionCatchUp(() => {
    reads.push(clock.now);
    if (clock.now === 2_000) return; // Simulate a transient failed GET after the hint.
    if (clock.now >= 2_000) visible = true;
  }, clock.timers);

  catchUp.start(true);
  clock.advanceTo(2_000);
  catchUp.hint();
  assert.equal(visible, false);
  assert.ok(clock.pendingCount > 0);
  clock.advanceTo(10_000);
  assert.equal(visible, true);
  assert.deepEqual(reads, [0, 1_000, 2_000, 10_000]);
  catchUp.dispose();
});

test("reconnect replaces old catch-up timers and teardown cancels the new ones", () => {
  const clock = fakeCatchUpClock();
  const reads: number[] = [];
  const catchUp = createWhatsAppInboxSubscriptionCatchUp(() => reads.push(clock.now), clock.timers);

  catchUp.start(true);
  clock.advanceTo(4_000);
  catchUp.start(true); // Realtime resubscribed after a socket interruption.
  clock.advanceTo(16_000);
  assert.deepEqual(reads, [0, 1_000, 4_000, 5_000, 14_000]);
  catchUp.dispose(); // A tenant or session change cancels pending work.
  clock.advanceTo(100_000);
  assert.deepEqual(reads, [0, 1_000, 4_000, 5_000, 14_000]);
  catchUp.start(true); // A previous tenant/session cannot revive its timer.
  assert.equal(clock.pendingCount, 0);
  assert.deepEqual(reads, [0, 1_000, 4_000, 5_000, 14_000]);
});

test("opening an active inbox catches up when the shared channel was already subscribed", () => {
  const clock = fakeCatchUpClock();
  const reads: number[] = [];
  let visible = false;
  const catchUp = createWhatsAppInboxSubscriptionCatchUp(() => {
    reads.push(clock.now);
    if (clock.now >= 10_000) visible = true;
  }, clock.timers);

  // No new SUBSCRIBED callback arrives when the app-shell registry already
  // owns the channel. The inbox mount starts this sequence on its own.
  catchUp.start(true);
  clock.advanceTo(10_000);
  assert.equal(visible, true);
  assert.deepEqual(reads, [0, 1_000, 10_000]);
  catchUp.dispose();
});

test("a route outside the inbox keeps the original 0/1 s reconcile only", () => {
  const clock = fakeCatchUpClock();
  const reads: number[] = [];
  const catchUp = createWhatsAppInboxSubscriptionCatchUp(() => reads.push(clock.now), clock.timers);

  catchUp.start(false); // App-shell SUBSCRIBED; no active inbox.
  clock.advanceTo(60_000);
  assert.deepEqual(reads, [0, 1_000]);
  assert.equal(clock.pendingCount, 0);
  catchUp.hint(); // Real broadcasts still refresh the app-shell badge.
  assert.deepEqual(reads, [0, 1_000, 60_000]);
  catchUp.dispose();
});

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
