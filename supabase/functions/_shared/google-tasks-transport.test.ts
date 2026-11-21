import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { assertGoogleTasksScope, buildGoogleTasksApiUrl } from "./google-tasks-api.ts";
import { GoogleCalendarLeaseLostError, GoogleCalendarRetryableError } from "./google-calendar-delivery.ts";
import type { GoogleScheduleRuntimeDependencies } from "./google-tasks-runtime.ts";

type RecordValue = Record<string, unknown>;
type Transport = (connection: RecordValue, path: string, init?: RequestInit) => Promise<Response>;
type LeaseCheck = (connection: RecordValue) => Promise<void>;

function realFunction<T>(name: string, dependencies: RecordValue): T {
  const path = resolve(process.cwd(), "supabase/functions/_shared/google-calendar.ts");
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ESNext, true);
  const declaration = source.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(declaration, `Expected the real ${name} implementation`);
  const compiled = ts.transpileModule(`${declaration.getText(source).replace(/^export\s+/, "")}\nreturn ${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies)) as T;
}

function harness() {
  let claimedRevision = 1;
  let currentRevision = 1;
  let refreshes = 0;
  const requests: RequestInit[] = [];
  let afterRefresh = () => {};
  let onRequest = () => new Response("{}", { status: 200 });
  const connection = { id: "synthetic-connection", vimob_job: { id: "synthetic-job", worker: "synthetic-worker" } };
  const lease = realFunction<LeaseCheck>("assertGoogleCalendarJobLease", {
    GoogleCalendarLeaseLostError,
    supabase: { rpc: async (name: string, args: RecordValue) => {
      assert.equal(name, "google_calendar_job_heartbeat");
      assert.deepEqual(args, { p_job_id: "synthetic-job", p_worker: "synthetic-worker" });
      // PostgreSQL separately proves that reconnect changes the revision and
      // makes the heartbeat reject the old claim. Here exercise its consumer.
      return { data: claimedRevision === currentRevision, error: null };
    } },
  });
  const transport = realFunction<Transport>("googleTasksFetch", {
    buildGoogleTasksApiUrl,
    assertGoogleTasksScope,
    assertGoogleCalendarJobLease: lease,
    refreshAccessToken: async () => {
      refreshes++;
      afterRefresh();
      return { connection, token: {
        scope: "https://www.googleapis.com/auth/tasks", access_token: "synthetic-access-token",
      } };
    },
    googleCalendarFetchWithDeadline: async (url: string, init: RequestInit) => {
      assert.equal(new URL(url).origin, "https://tasks.googleapis.com");
      requests.push(init);
      return onRequest();
    },
  });
  return {
    connection, transport, requests,
    reconnect: () => { currentRevision++; },
    reclaim: () => { claimedRevision = currentRevision; },
    afterRefresh: (callback: () => void) => { afterRefresh = callback; },
    onRequest: (callback: () => Response) => { onRequest = callback; },
    refreshCount: () => refreshes,
  };
}

test("revoked credential claim blocks Tasks before reading credentials or contacting Google", async () => {
  const h = harness();
  h.reconnect();
  await assert.rejects(h.transport(h.connection, "/lists/synthetic-list/tasks", { method: "POST" }),
    GoogleCalendarLeaseLostError);
  assert.equal(h.refreshCount(), 0);
  assert.equal(h.requests.length, 0);
});

test("reconnect between token acquisition and dispatch prevents every Tasks write", async () => {
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const h = harness();
    h.afterRefresh(h.reconnect);
    await assert.rejects(h.transport(h.connection, "/lists/synthetic-list/tasks", { method }),
      GoogleCalendarLeaseLostError);
    assert.equal(h.refreshCount(), 1);
    assert.equal(h.requests.length, 0, `${method} must not use a grant belonging to a newer revision`);
  }
});

test("a 401 retry cannot send a second Tasks write after the credential claim changes", async () => {
  const h = harness();
  h.onRequest(() => {
    h.reconnect();
    return new Response("{}", { status: 401 });
  });
  await assert.rejects(h.transport(h.connection, "/lists/synthetic-list/tasks", { method: "POST" }),
    GoogleCalendarLeaseLostError);
  assert.equal(h.requests.length, 1);
});

test("the runtime shares one wall-clock budget across successive Tasks requests", async () => {
  let clock = 1_000;
  const requests: RequestInit[] = [];
  const factory = realFunction<() => GoogleScheduleRuntimeDependencies>("googleScheduleV2Dependencies", {
    Date: { now: () => clock },
    GoogleCalendarRetryableError,
    assertScheduleSnapshotCurrent: async () => {},
    getOrganizationTimeZone: async () => "UTC",
    googleTasksFetch: async (_connection: RecordValue, _path: string, init: RequestInit) => {
      requests.push(init);
      return new Response("{}", { status: 200 });
    },
  });
  const request = factory().request({ id: "synthetic-connection" });
  await request("/users/@me/lists");
  clock += 74_999;
  await request("/users/@me/lists?pageToken=synthetic");
  clock += 1;
  await assert.rejects(async () => request("/users/@me/lists?pageToken=synthetic-next"),
    (error: unknown) => error instanceof GoogleCalendarRetryableError && error.status === 408);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.signal instanceof AbortSignal));
});
