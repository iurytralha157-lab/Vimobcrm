import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { refreshScheduleQueries } from "./schedule-query-refresh";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.ok(predicate(), "query did not reach the expected state");
}

function fixture() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const requests: ReturnType<typeof deferred<string>>[] = [];
  const key = ["schedule-events", "org-a"];
  const observer = new QueryObserver(client, {
    queryKey: key,
    staleTime: 300_000,
    refetchOnMount: true,
    queryFn: () => { const request = deferred<string>(); requests.push(request); return request.promise; },
  });
  const unsubscribe = observer.subscribe(() => undefined);
  return { client, requests, key, observer, unsubscribe, close: () => { unsubscribe(); client.clear(); } };
}

test("a change during the uncached first load produces a second read with current data", { timeout: 3000 }, async () => {
  const f = fixture();
  try {
    assert.equal(f.requests.length, 1);
    const refreshed = refreshScheduleQueries(f.client, { queryKey: f.key });
    f.requests[0].resolve("before change");
    await until(() => f.requests.length === 2);
    f.requests[1].resolve("after change");
    await refreshed;
    assert.equal(f.client.getQueryData(f.key), "after change");
    assert.equal(f.client.getQueryState(f.key)?.isInvalidated, false);
  } finally { f.close(); }
});

test("bursts coalesce while a change during the refresh still triggers a trailing read", { timeout: 3000 }, async () => {
  const f = fixture();
  try {
    const first = refreshScheduleQueries(f.client, { queryKey: f.key });
    const burst = Array.from({ length: 12 }, () => refreshScheduleQueries(f.client, { queryKey: f.key }));
    f.requests[0].resolve("initial");
    await until(() => f.requests.length === 2);
    const trailing = refreshScheduleQueries(f.client, { queryKey: f.key });
    f.requests[1].resolve("middle");
    await until(() => f.requests.length === 3);
    f.requests[2].resolve("latest");
    await Promise.all([first, ...burst, trailing]);
    assert.equal(f.requests.length, 3);
    assert.equal(f.client.getQueryData(f.key), "latest");
  } finally { f.close(); }
});

test("cache removal abandons the old request without refreshing a replacement or another tenant", { timeout: 3000 }, async () => {
  const f = fixture();
  try {
    const refreshed = refreshScheduleQueries(f.client, { queryKey: f.key });
    await Promise.resolve();
    f.client.clear();
    f.client.setQueryData(f.key, "replacement");
    f.client.setQueryData(["schedule-events", "org-b"], "other tenant");
    f.requests[0].resolve("old tenant snapshot");
    await refreshed;
    assert.equal(f.requests.length, 1);
    assert.equal(f.client.getQueryData(f.key), "replacement");
    assert.equal(f.client.getQueryData(["schedule-events", "org-b"]), "other tenant");
  } finally { f.close(); }
});

test("an inactive query stays stale after an old response and rereads when the page mounts", { timeout: 3000 }, async () => {
  const f = fixture();
  try {
    const refreshed = refreshScheduleQueries(f.client, { queryKey: f.key });
    f.unsubscribe();
    f.requests[0].resolve("old snapshot");
    await refreshed;
    assert.equal(f.requests.length, 1);
    assert.equal(f.client.getQueryState(f.key)?.isInvalidated, true);
    const remounted = f.observer.subscribe(() => undefined);
    try {
      await until(() => f.requests.length === 2);
      f.requests[1].resolve("fresh after mount");
      await until(() => f.client.getQueryData(f.key) === "fresh after mount");
    } finally { remounted(); }
  } finally { f.close(); }
});

test("a failed trailing read reports an error without an infinite refresh loop", { timeout: 3000 }, async () => {
  const f = fixture();
  try {
    const refreshed = refreshScheduleQueries(f.client, { queryKey: f.key });
    f.requests[0].resolve("old snapshot");
    await until(() => f.requests.length === 2);
    f.requests[1].reject(new Error("API unavailable"));
    await refreshed;
    assert.equal(f.requests.length, 2);
    assert.equal(f.client.getQueryState(f.key)?.status, "error");
  } finally { f.close(); }
});

test("inactive settled queries are invalidated without starting background reads", async () => {
  const client = new QueryClient();
  try {
    const key = ["schedule-comments", "org-a", "event"];
    client.setQueryData(key, ["cached"]);
    await refreshScheduleQueries(client, { queryKey: key });
    assert.equal(client.getQueryState(key)?.isInvalidated, true);
    assert.equal(client.getQueryState(key)?.fetchStatus, "idle");
  } finally { client.clear(); }
});
