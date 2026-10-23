import assert from "node:assert/strict";
import test from "node:test";
import { collectScheduleRealtimeRefresh } from "./schedule-realtime-refresh";

test("keeps every event and lead in a legacy SSE burst", () => {
  const first = collectScheduleRealtimeRefresh(null, {
    organizationId: "org-a", data: { eventId: "event-a", leadId: "lead-a" },
  });
  const batch = collectScheduleRealtimeRefresh(first, {
    organizationId: "org-a", data: { eventId: "event-b", leadId: "lead-b" },
  });
  assert.deepEqual([...batch.eventIds], ["event-a", "event-b"]);
  assert.deepEqual([...batch.leadIds], ["lead-a", "lead-b"]);
  assert.equal(batch.refreshAll, false);
});

test("opaque private-safe invalidation refreshes the tenant without collecting IDs", () => {
  const first = collectScheduleRealtimeRefresh(null, {
    organizationId: "org-a", data: { eventId: "event-a", leadId: "lead-a" },
  });
  const batch = collectScheduleRealtimeRefresh(first, { organizationId: "org-a" });
  assert.equal(batch.refreshAll, true);
  assert.equal(batch.eventIds.size, 0);
  assert.equal(batch.leadIds.size, 0);
});

test("switching organization never reuses another tenant's pending refresh", () => {
  const first = collectScheduleRealtimeRefresh(null, {
    organizationId: "org-a", data: { eventId: "event-a", leadId: "lead-a" },
  });
  const batch = collectScheduleRealtimeRefresh(first, {
    organizationId: "org-b", data: { eventId: "event-b" },
  });
  assert.equal(batch.organizationId, "org-b");
  assert.deepEqual([...batch.eventIds], ["event-b"]);
  assert.equal(batch.leadIds.size, 0);
});

test("a large burst remains bounded and falls back to a complete tenant refresh", () => {
  let batch = collectScheduleRealtimeRefresh(null, { organizationId: "org-a", data: { eventId: "event-0" } });
  for (let index = 1; index < 1_000; index++) {
    batch = collectScheduleRealtimeRefresh(batch, { organizationId: "org-a", data: { eventId: `event-${index}` } });
  }
  assert.equal(batch.refreshAll, true);
  assert.equal(batch.eventIds.size, 0);
});
