import test from "node:test";
import assert from "node:assert/strict";
import { desiredGoogleTarget, processGoogleScheduleV2, tasksRuntimeRpc, type GoogleScheduleRuntimeDependencies } from "./google-tasks-runtime.ts";
import { googleTaskMarker, type TasksRecord } from "./google-tasks-api.ts";

const attempt = "10000000-0000-4000-8000-000000000001";
const job = { id: "job", organization_id: "org-a", connection_id: "connection-a", locked_by: "worker", action: "push_upsert",
  schedule_event_id: "event-a", payload: { event_id: "event-a", owner_user_id: "owner-a", target: "calendar", protocol_version: 2 } };
function harness(type = "meeting") {
  const event: TasksRecord = { id: "event-a", organization_id: "org-a", user_id: "owner-a", event_type: type,
    start_time: "2026-11-05T12:00:00Z", end_time: "2026-11-05T12:30:00Z", updated_at: "2026-11-04T10:00:00Z", status: "scheduled" };
  const connection: TasksRecord = { id: "connection-a", user_id: "owner-a", organization_id: "org-a", routing_v2: true, tasks_authorized: true, tasks_list_id: "list" };
  const history: string[] = [];
  let stale = false;
  const deps: GoogleScheduleRuntimeDependencies = {
    getEvent: async () => event, getConnection: async () => connection,
    getTaskLinks: async () => [{ id: "link-a", tasklist_id: "list", task_id: "task-a", creation_attempt: attempt }],
    assertOwner: async () => { history.push("authorize owner"); },
    assertSnapshot: async () => { history.push("check snapshot"); if (stale) throw new Error("snapshot changed"); },
    getTimeZone: async () => "America/Sao_Paulo", getExportContext: async source => source,
    request: () => async (_path, init) => {
      history.push(init?.method || "GET");
      return init?.method === "DELETE" ? new Response(null, { status: 204 })
        : new Response(JSON.stringify({ id: "task-a", etag: "etag", notes: googleTaskMarker(attempt) }));
    },
    rpc: async name => { history.push(name); return true; },
    calendarUpsert: async () => { history.push("Calendar upsert"); return { google_event_id: "calendar-a" }; },
    calendarDelete: async () => { history.push("Calendar cleanup"); },
    requeueCurrent: async (sourceJob, sourceEvent) => {
      assert.equal(sourceJob.organization_id, sourceEvent.organization_id);
      assert.equal((sourceJob.payload as TasksRecord).owner_user_id, sourceEvent.user_id);
      assert.equal(sourceJob.schedule_event_id, sourceEvent.id);
      history.push("requeue current");
    },
  };
  return { deps, event, connection, history, stale: () => { stale = true; } };
}

test("All six types route by the server contract; legacy stays Calendar", () => {
  for (const type of ["task", "message", "email", "call"]) assert.equal(desiredGoogleTarget(type, true), "tasks");
  for (const type of ["meeting", "visit"]) assert.equal(desiredGoogleTarget(type, true), "calendar");
  for (const type of ["task", "message", "email", "call", "meeting", "visit"]) assert.equal(desiredGoogleTarget(type, false), "calendar");
  assert.throws(() => desiredGoogleTarget("unknown", true));
});

test("A connection from another tenant is refused before any provider call", async () => {
  const h = harness(); h.connection.organization_id = "org-b";
  await assert.rejects(processGoogleScheduleV2(job, h.deps), /Conexao Google indisponivel/);
  assert.deepEqual(h.history, []);
});

test("A connection belonging to another owner cannot execute cleanup", async () => {
  const h = harness(); h.connection.user_id = "owner-b";
  await assert.rejects(processGoogleScheduleV2({ ...job, action: "push_delete" }, h.deps), /Conexao Google indisponivel/);
  assert.deepEqual(h.history, []);
});

test("Tasks-to-Calendar conversion commits success only after removing the linked task", async () => {
  const h = harness();
  await processGoogleScheduleV2(job, h.deps);
  assert.ok(h.history.indexOf("Calendar upsert") < h.history.indexOf("DELETE"));
  assert.ok(h.history.indexOf("DELETE") < h.history.indexOf("google_schedule_commit_sync"));
});

test("Conversion with a concurrent CRM change does not remove the old copy", async () => {
  const h = harness();
  h.deps.calendarUpsert = async () => { h.stale(); return { google_event_id: "calendar-a" }; };
  await assert.rejects(processGoogleScheduleV2(job, h.deps), /snapshot changed/);
  assert.equal(h.history.includes("DELETE"), false);
  assert.equal(h.history.includes("google_schedule_commit_sync"), false);
});

test("Tasks opt-in replaces each prior Calendar intent before acknowledging its changed target", async () => {
  for (const type of ["task", "message", "email", "call"]) {
    const h = harness(type);
    const result = await processGoogleScheduleV2(job, h.deps);
    assert.equal(result.reason, "TARGET_CHANGED_REQUEUED");
    assert.equal(h.history.filter(step => step === "requeue current").length, 1);
    assert.equal(h.history.includes("Calendar upsert"), false);
    assert.equal(h.history.includes("POST"), false);
    assert.equal(h.history.includes("DELETE"), false);
    assert.equal(h.history.includes("google_schedule_commit_sync"), false);
  }
});

test("a changed target cannot be acknowledged while its replacement intent is still unconfirmed", async () => {
  const h = harness("task");
  let enter: () => void = () => {};
  let release: () => void = () => {};
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const confirmation = new Promise<void>(resolve => { release = resolve; });
  h.deps.requeueCurrent = async () => { enter(); await confirmation; };
  let acknowledged = false;
  const processing = processGoogleScheduleV2(job, h.deps).then(result => {
    acknowledged = true;
    return result;
  });
  await entered;
  assert.equal(acknowledged, false);
  assert.equal(h.history.includes("Calendar upsert"), false);
  release();
  assert.equal((await processing).reason, "TARGET_CHANGED_REQUEUED");
});

test("failure to persist the replacement intent leaves the old job eligible for failure and retry", async () => {
  const h = harness("task");
  h.deps.requeueCurrent = async () => { throw new Error("synthetic insert failure"); };
  await assert.rejects(processGoogleScheduleV2(job, h.deps), /synthetic insert failure/);
  assert.equal(h.history.includes("Calendar upsert"), false);
  assert.equal(h.history.includes("POST"), false);
  assert.equal(h.history.includes("DELETE"), false);
  assert.equal(h.history.includes("google_schedule_commit_sync"), false);
});

test("a changed target is not requeued for a connection from another tenant or owner", async () => {
  for (const field of ["organization_id", "user_id"]) {
    const h = harness("task");
    h.connection[field] = "unrelated-identity";
    await assert.rejects(processGoogleScheduleV2(job, h.deps), /Conexao Google indisponivel/);
    assert.deepEqual(h.history, []);
  }
});

test("Delete retains the durable identity after the CRM row has gone", async () => {
  const h = harness(); h.deps.getEvent = async () => null;
  await processGoogleScheduleV2({ ...job, schedule_event_id: null, action: "push_delete" }, h.deps);
  assert.ok(h.history.includes("DELETE"));
  assert.ok(h.history.includes("google_tasks_finalize_link"));
  assert.ok(h.history.includes("Calendar cleanup"));
});

test("A lost fenced commit is never reported as sync success", async () => {
  const h = harness(); h.deps.rpc = async name => name !== "google_schedule_commit_sync";
  await assert.rejects(processGoogleScheduleV2(job, h.deps), /mudou|versao|Version/i);
});

test("RPC failures and missing leases are classified without exposing SQL or tokens", async () => {
  await assert.rejects(tasksRuntimeRpc(async () => ({ data: null, error: { code: "40001" } }), "operation", {}), /mudou|versao|Version/i);
  await assert.rejects(tasksRuntimeRpc(async () => ({ data: null, error: null }), "operation", {}));
  await assert.rejects(tasksRuntimeRpc(async () => ({ data: null, error: { code: "secret" } }), "operation", {}), /Nao foi possivel registrar/);
});
