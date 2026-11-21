import test from "node:test";
import assert from "node:assert/strict";
import { buildGoogleTaskBody, buildGoogleTasksApiUrl, googleTaskMarker, recoverGoogleTask, hasGoogleTasksScope } from "./google-tasks-api.ts";
import { pushGoogleTask, deleteGoogleTaskLink, type GoogleTasksDeliveryContext } from "./google-tasks-delivery.ts";

const attempt = "10000000-0000-4000-8000-000000000001";
const event = { id: "20000000-0000-4000-8000-000000000001", title: "Retorno sintetico", event_type: "call",
  start_time: "2026-11-05T01:30:00Z", end_time: "2026-11-05T01:45:00Z", updated_at: "2026-11-04T10:00:00Z", status: "scheduled" };
const context = (): GoogleTasksDeliveryContext => ({ job: { id: "job", locked_by: "worker" },
  connection: { tasks_list_id: "vimob-list" }, event: { ...event }, timeZone: "America/Sao_Paulo" });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("Tasks date follows the organization's civil day and preserves clock in notes", () => {
  const task = buildGoogleTaskBody(event, "America/Sao_Paulo", attempt);
  assert.equal(task.due, "2026-11-04T00:00:00.000Z");
  assert.equal(task.status, "needsAction");
  assert.equal(task.completed, null);
  assert.match(String(task.notes), /22:30/);
  assert.match(String(task.notes), /22:45/);
  assert.ok(String(task.notes).includes(googleTaskMarker(attempt)));
});

test("Tasks completion and reopening are projected without losing origin", () => {
  const completed = buildGoogleTaskBody({ ...event, status: "completed", completed_at: "2026-11-05T02:00:00Z" }, "UTC", attempt);
  assert.equal(completed.status, "completed");
  assert.equal(completed.completed, "2026-11-05T02:00:00Z");
  assert.equal(buildGoogleTaskBody(event, "UTC", attempt).completed, null);
});

test("Tasks credentials never travel to an arbitrary origin or broad partial scope", () => {
  for (const path of ["https://example.com", "//example.com/", "/../wrong", "/x\\y", "/x#y"]) {
    assert.throws(() => buildGoogleTasksApiUrl(path));
  }
  assert.equal(buildGoogleTasksApiUrl("/lists/a/tasks"), "https://tasks.googleapis.com/tasks/v1/lists/a/tasks");
  assert.equal(hasGoogleTasksScope("https://www.googleapis.com/auth/tasks.readonly"), false);
  assert.equal(hasGoogleTasksScope("openid https://www.googleapis.com/auth/tasks"), true);
});

test("Recover a lost POST response across paginated completed/hidden tasks", async () => {
  const paths: string[] = [];
  const found = await recoverGoogleTask(async path => {
    paths.push(path);
    return path.includes("pageToken=")
      ? json({ items: [{ id: "recovered", notes: googleTaskMarker(attempt), status: "completed" }] })
      : json({ items: [{ id: "unrelated", notes: "Unrelated personal task" }], nextPageToken: "page2" });
  }, "vimob-list", attempt);
  assert.equal(found?.id, "recovered");
  assert.ok(paths.every(path => path.includes("showCompleted=true&showHidden=true&showDeleted=true")));
  assert.equal(paths.length, 2);
});

test("Ambiguous copies and repeated pagination halt reconciliation", async () => {
  await assert.rejects(recoverGoogleTask(async () => json({ items: [
    { id: "one", notes: googleTaskMarker(attempt) }, { id: "two", notes: googleTaskMarker(attempt) },
  ] }), "list", attempt), /Mais de uma copia/);
  await assert.rejects(recoverGoogleTask(async () => json({ nextPageToken: "same" }), "list", attempt), /Nao foi possivel concluir/);
});

function harness(started = false) {
  let state = started ? "started" : "reserved";
  let remote: Record<string, unknown> | null = started
    ? { id: "task1", etag: "version1", notes: googleTaskMarker(attempt), status: "needsAction" } : null;
  let failAfterCreate = false;
  let loseSnapshot = false;
  const writes: string[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const deps = {
    rpc: async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      rpcCalls.push({ name, args });
      if (name === "google_tasks_reserve_link") return { id: "link", creation_attempt: attempt, creation_state: state, tasklist_id: "vimob-list" };
      if (name === "google_tasks_mark_create_started") { const allowed = state === "reserved"; state = "started"; return { can_create: allowed }; }
      if (name === "google_tasks_commit_link") state = "linked";
      return true;
    },
    request: async (path: string, init?: RequestInit) => {
      const method = init?.method || "GET";
      writes.push(`${method} ${path}`);
      if (method === "POST") {
        remote = { ...JSON.parse(String(init?.body)), id: "task1", etag: "version1" };
        if (failAfterCreate) { failAfterCreate = false; throw new TypeError("simulated network timeout"); }
        return json(remote);
      }
      if (method === "PATCH") { remote = { ...remote, ...JSON.parse(String(init?.body)), etag: "version2" }; return json(remote); }
      return json({ items: remote ? [remote] : [] });
    },
    assertSnapshot: async () => { if (loseSnapshot) throw new Error("snapshot changed"); },
  };
  return { deps, writes, rpcCalls, timeout: () => { failAfterCreate = true; }, stale: () => { loseSnapshot = true; },
    removeRemote: () => { remote = null; } };
}

test("Accepted POST with lost response is recovered; retry never issues a second POST", async () => {
  const h = harness();
  h.timeout();
  await assert.rejects(pushGoogleTask(context(), h.deps), /timeout/);
  await pushGoogleTask(context(), h.deps);
  assert.equal(h.writes.filter(write => write.startsWith("POST ")).length, 1);
  assert.ok(h.rpcCalls.some(call => call.name === "google_schedule_commit_sync"));
});

test("Unknown result without a matching task requires review instead of another creation", async () => {
  const h = harness(true);
  h.removeRemote();
  await assert.rejects(pushGoogleTask(context(), h.deps), /sem resultado confirmado/);
  assert.equal(h.writes.some(write => write.startsWith("POST ")), false);
  assert.equal(h.rpcCalls.some(call => call.name === "google_schedule_commit_sync"), false);
  assert.ok(h.rpcCalls.some(call => call.name === "google_tasks_finalize_link" && call.args.p_error));
});

test("A stale CRM snapshot cannot finalize a recovered remote task", async () => {
  const h = harness(true);
  h.stale();
  await assert.rejects(pushGoogleTask(context(), h.deps), /snapshot changed/);
  assert.equal(h.rpcCalls.some(call => call.name === "google_schedule_commit_sync"), false);
});

test("Deletion refuses a task whose origin marker was changed", async () => {
  let removed = false;
  await assert.rejects(deleteGoogleTaskLink(context().job,
    { id: "link", tasklist_id: "list", task_id: "task1", creation_attempt: attempt }, {
      rpc: async () => true, assertSnapshot: async () => {},
      request: async (_path, init) => { if (init?.method === "DELETE") removed = true;
        return json({ id: "task1", etag: "v1", notes: "Personal task" }); },
    }), /nao corresponde/);
  assert.equal(removed, false);
});

test("A reserved task can be cleaned up after CRM deletion without a Google POST", async () => {
  let networkCalls = 0;
  let finalized = false;
  await deleteGoogleTaskLink(context().job, {
    id: "link", tasklist_id: "list", creation_state: "reserved", creation_attempt: attempt,
  }, { request: async () => { networkCalls++; return json({}); }, assertSnapshot: async () => {},
    rpc: async name => { finalized = name === "google_tasks_finalize_link"; return true; } });
  assert.equal(networkCalls, 0);
  assert.equal(finalized, true);
});
