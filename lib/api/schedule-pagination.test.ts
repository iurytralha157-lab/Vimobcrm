import assert from "node:assert/strict";
import test from "node:test";
import { collectSchedulePages, type SchedulePage } from "./schedule-pagination";

test("reads every page and keeps events beyond the first 200 without truncation", async () => {
  const records = Array.from({ length: 427 }, (_, index) => ({ id: `event-${index}` }));
  const offsets: number[] = [];
  const result = await collectSchedulePages(async (offset, limit) => {
    offsets.push(offset);
    return { data: records.slice(offset, offset + limit), pagination: { offset, limit, has_more: offset + limit < records.length } };
  });
  assert.deepEqual(offsets, [0, 200, 400]);
  assert.deepEqual(result, records);
});

test("accepts the complete array from an older API replica in one request", async () => {
  let requests = 0;
  const records = Array.from({ length: 500 }, (_, index) => ({ id: String(index) }));
  const result = await collectSchedulePages(async () => { requests += 1; return { data: records }; });
  assert.equal(requests, 1);
  assert.deepEqual(result, records);
});

test("deduplicates overlapping pages while keeping the latest returned event", async () => {
  const pages: SchedulePage<{ id: string; title: string }>[] = [
    { data: [{ id: "a", title: "old" }, { id: "b", title: "b" }], pagination: { limit: 2, offset: 0, has_more: true } },
    { data: [{ id: "a", title: "new" }, { id: "c", title: "c" }], pagination: { limit: 2, offset: 2, has_more: false } },
  ];
  const result = await collectSchedulePages(async () => pages.shift()!);
  assert.deepEqual(result, [{ id: "a", title: "new" }, { id: "b", title: "b" }, { id: "c", title: "c" }]);
});

test("fails explicitly instead of looping or returning partial data on a broken cursor", async () => {
  await assert.rejects(collectSchedulePages(async () => ({ data: [{ id: "a" }], pagination: { limit: 1, offset: 9, has_more: true } })), /toda a agenda/);
  await assert.rejects(collectSchedulePages(async () => ({ data: [{ id: "a" }], pagination: { limit: 1, offset: 9, has_more: false } })), /toda a agenda/);
  await assert.rejects(collectSchedulePages(async () => ({ data: [], pagination: { limit: 200, offset: 0, has_more: true } })), /toda a agenda/);
  let requests = 0;
  await assert.rejects(collectSchedulePages(async (offset) => { requests += 1; return { data: [{ id: "a" }], pagination: { limit: 200, offset, has_more: true } }; }), /toda a agenda/);
  assert.equal(requests, 2);
});

test("cancels between pages when identity or selected period changes", async () => {
  const controller = new AbortController();
  let requests = 0;
  await assert.rejects(collectSchedulePages(async (offset, limit) => {
    requests += 1;
    controller.abort();
    return { data: [{ id: "a" }], pagination: { offset, limit, has_more: true } };
  }, controller.signal), { name: "AbortError" });
  assert.equal(requests, 1);
});

test("propagates a failed later page instead of showing a partial successful agenda", async () => {
  let requests = 0;
  await assert.rejects(collectSchedulePages(async (offset, limit) => {
    requests += 1;
    if (offset > 0) throw new Error("second page unavailable");
    return { data: [{ id: "a" }], pagination: { offset, limit, has_more: true } };
  }), /second page unavailable/);
  assert.equal(requests, 2);
});
