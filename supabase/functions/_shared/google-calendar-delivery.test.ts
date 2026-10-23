import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { conditionalGoogleWriteHeaders } from "./google-calendar-conflict.ts";
import { assertGoogleCalendarOAuthReady, googleCalendarRetryPolicy, googleCalendarRetryAfter, googleCalendarErrorStatus,
  googleCalendarFetchWithDeadline, GoogleCalendarLeaseLostError, GoogleCalendarRetryableError,
  GoogleCalendarVersionChangedError } from "./google-calendar-delivery.ts";

type RecordValue = Record<string, unknown>;
function realFunction(name: string, dependencies: RecordValue) {
  const path = resolve(process.cwd(), "supabase/functions/_shared/google-calendar.ts");
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ESNext, true);
  const declaration = source.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(declaration);
  const compiled = ts.transpileModule(`${declaration.getText(source).replace(/^export\s+/, "")}\nreturn ${name};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
}

test("partial Google consent and absent offline token fail before either Vault or connection writes", async () => {
  let writes = 0;
  const query = { select: () => query, eq: () => query, order: async () => ({ data: [], error: null }),
    insert: () => { writes += 1; return query; }, single: async () => ({ data: {}, error: null }) };
  const upsert = realFunction("upsertConnectionFromOAuth", {
    supabase: { from: () => query }, addSeconds: () => "future", normalizeGoogleAccountEmail: (email: string) => email,
    selectReusableGoogleCalendarConnection: () => null, assertGoogleCalendarOAuthReady,
    saveTokenSecret: async () => { writes += 1; return "synthetic-secret"; },
  });
  const input = { state: { user_id: "owner", organization_id: "org" }, userInfo: { email: "owner@example.invalid" },
    tokenResponse: { access_token: "synthetic", scope: "openid email", refresh_token: "synthetic-refresh" } };
  await assert.rejects(upsert(input), /Permissao do Google Agenda/);
  await assert.rejects(upsert({ ...input, tokenResponse: { access_token: "synthetic",
    scope: "openid https://www.googleapis.com/auth/calendar.events.owned" } }), /offline/);
  assert.equal(writes, 0);
  assert.doesNotThrow(() => assertGoogleCalendarOAuthReady({ access_token: "synthetic", refresh_token: "synthetic",
    scope: "openid https://www.googleapis.com/auth/calendar.events.owned" }));
});

function concurrencyHarness() {
  const local: RecordValue = { id: "event", organization_id: "org", user_id: "owner", title: "V1", updated_at: "v1", google_sync_status: "pending" };
  let remote = "V0", etag = '"remote-0"';
  const jobStates: RecordValue = {}, history: string[] = [];
  let release: () => void = () => {}, arrived: () => void = () => {};
  const gate = new Promise<void>(r => { release = r; });
  const ready = new Promise<void>(r => { arrived = r; });
  const supabase = { from(table: string) {
    let update: RecordValue | null = null;
    const filters: RecordValue = {};
    const query: RecordValue = { select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      update: (value: RecordValue) => { update = value; return query; },
      maybeSingle: async () => {
        if (table === "google_calendar_event_links") return { data: { google_event_id: "event" }, error: null };
        if (!update) return { data: { ...local }, error: null };
        if (filters.updated_at !== local.updated_at) return { data: null, error: null };
        Object.assign(local, update, { updated_at: "metadata-version" });
        return { data: { id: "event" }, error: null };
      },
    };
    return query;
  }, rpc: async (name: string, args: RecordValue) => {
    if (name === "google_calendar_finish_outbound_job") jobStates[String(args.p_job_id)] = args.p_status;
    return { data: true, error: null };
  } };
  class HttpError extends GoogleCalendarRetryableError {}
  const shared = { supabase, GoogleCalendarLeaseLostError, GoogleCalendarVersionChangedError, GoogleCalendarRetryableError,
    googleCalendarRetryPolicy, errorMessage: (error: Error) => error.message };
  const heartbeat = realFunction("assertGoogleCalendarJobLease", shared);
  const snapshot = realFunction("assertScheduleSnapshotCurrent", shared);
  const finish = realFunction("finishGoogleCalendarJob", shared);
  const push = realFunction("pushScheduleEventToGoogle", {
    ...shared, assertGoogleCalendarJobLease: heartbeat, assertScheduleSnapshotCurrent: snapshot,
    getUserProfile: async () => {}, getConnectionForUser: async () => ({ id: "conn", calendar_id: "primary" }),
    normalizeCalendarId: (value: string) => value, getOutboundEventContext: async (event: RecordValue) => ({ event, attendeeEmails: [] }),
    getOrganizationTimeZone: async () => "America/Sao_Paulo", scheduleEventToGoogle: (event: RecordValue) => ({ summary: event.title }),
    buildVimobGoogleEventId: (value: string) => value, currentScheduleEventOwner: async () => local.user_id,
    GoogleCalendarHttpError: HttpError, assertVimobGoogleEventIdentity: () => {}, conditionalGoogleWriteHeaders,
    googleJson: async (_connection: unknown, _path: string, init: RecordValue = {}) => {
      if (!init.method) return { id: "event", etag };
      const body = JSON.parse(String(init.body));
      if (body.summary === "V1") { arrived(); await gate; }
      if ((init.headers as RecordValue | undefined)?.["If-Match"] !== etag) throw new HttpError("Provider precondition failed", 412);
      remote = body.summary; etag = '"remote-new"'; history.push(`write ${remote}`);
      return { id: "event", etag };
    }, upsertEventLink: async () => {}, markConnectionOutboundSynced: async () => {},
  });
  const execute = realFunction("executeSyncJob", { ...shared, assertGoogleCalendarJobLease: heartbeat,
    finishGoogleCalendarJob: finish, processSyncJob: (job: RecordValue) => push("event", null,
      { trustedJobOrganizationId: "org", jobId: job.id, jobWorker: job.locked_by }),
  });
  return { execute, ready, release: () => release(), edit: () => { local.title = "V2"; local.updated_at = "v2"; },
    result: () => ({ local, remote, jobStates, history }) };
}

test("late V1 write cannot overwrite V2 and must return to the queue rather than succeed", async () => {
  const harness = concurrencyHarness();
  const a = harness.execute({ id: "a", locked_by: "worker-a", action: "push_upsert" });
  await harness.ready;
  harness.edit();
  const b = await harness.execute({ id: "b", locked_by: "worker-b", action: "push_upsert" });
  harness.release();
  const old = await a;
  assert.equal(b.ok, true);
  assert.equal(old.deferred, true);
  assert.equal(harness.result().remote, "V2");
  assert.equal(harness.result().local.title, "V2");
  assert.equal(harness.result().jobStates.a, "queued");
  assert.equal(harness.result().jobStates.b, "succeeded");
  assert.deepEqual(harness.result().history, ["write V2"]);
});

test("a version changed after provider acceptance remains queued and a fresh retry repairs the remote copy", async () => {
  const harness = concurrencyHarness();
  const a = harness.execute({ id: "a", locked_by: "worker-a", action: "push_upsert" });
  await harness.ready;
  harness.edit(); harness.release();
  assert.equal((await a).deferred, true);
  assert.equal(harness.result().remote, "V1");
  assert.equal(harness.result().jobStates.a, "queued");
  await harness.execute({ id: "a", locked_by: "worker-next", action: "push_upsert" });
  assert.equal(harness.result().remote, "V2");
  assert.equal(harness.result().local.google_sync_status, "synced");
  assert.equal(harness.result().jobStates.a, "succeeded");
});

test("a lost lease cannot dispatch or finalize a job", async () => {
  let writes = 0;
  const execute = realFunction("executeSyncJob", {
    GoogleCalendarLeaseLostError, assertGoogleCalendarJobLease: async () => { throw new GoogleCalendarLeaseLostError(); },
    processSyncJob: async () => { writes += 1; }, finishGoogleCalendarJob: async () => { writes += 1; },
  });
  assert.equal((await execute({ id: "job" })).reason, "LEASE_LOST");
  assert.equal(writes, 0);
});

test("an old failure response cannot repaint a successful retry of the same job", async () => {
  let jobStatus = "running", eventStatus = "pending", connectionStatus = "connected", lateWrites = 0;
  let release: () => void = () => {}, arrived: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { arrived = resolve; });
  const query: RecordValue = { update: () => query, eq: () => query, then(resolve: (value: unknown) => void) {
    lateWrites += 1; eventStatus = "error"; resolve({ error: null });
  } };
  const supabase = { from: () => query, rpc: async (name: string, args: RecordValue) => {
    assert.equal(name, "google_calendar_finish_outbound_job");
    assert.ok(typeof args.p_status === "string");
    jobStatus = args.p_status;
    if (args.p_status === "failed") {
      // SQL commits job outcome + visible errors atomically, then the HTTP
      // response is delayed while the durable retry completes elsewhere.
      eventStatus = "error"; connectionStatus = "error";
      assert.equal(args.p_is_conflict, false);
      arrived(); await gate;
    }
    return { data: true, error: null };
  } };
  const shared = { supabase, GoogleCalendarLeaseLostError, GoogleCalendarVersionChangedError,
    GoogleCalendarRetryableError, GoogleCalendarConflictError: class extends Error {},
    googleCalendarRetryPolicy, errorMessage: (error: Error) => error.message };
  const finish = realFunction("finishGoogleCalendarJob", shared);
  const execute = realFunction("executeSyncJob", { ...shared, finishGoogleCalendarJob: finish,
    assertGoogleCalendarJobLease: async () => {},
    processSyncJob: async (job: RecordValue) => {
      if (job.locked_by === "worker-a") throw new GoogleCalendarRetryableError("synthetic transient", 503);
      eventStatus = "synced"; connectionStatus = "connected"; return {};
    }, markConnectionOutboundError: async () => { lateWrites += 1; connectionStatus = "error"; },
  });
  const job = { id: "same-job", organization_id: "org", schedule_event_id: "event", action: "push_upsert",
    locked_by: "worker-a", payload: { owner_user_id: "owner" } };
  const old = execute(job);
  await ready;
  await execute({ ...job, locked_by: "worker-b" });
  assert.equal(jobStatus, "succeeded");
  release(); await old;
  assert.equal(eventStatus, "synced");
  assert.equal(connectionStatus, "connected");
  assert.equal(lateWrites, 0);
});

test("stale-write cleanup uses its provider version and treats quota 403 as transient", async () => {
  const writes: RecordValue[] = [];
  let metadataWrites = 0, status = 412;
  class HttpError extends GoogleCalendarRetryableError {}
  const cleanup = realFunction("removeStaleGoogleWrite", {
    normalizeCalendarId: (value: string) => value, conditionalGoogleWriteHeaders,
    GoogleCalendarHttpError: HttpError, googleCalendarErrorStatus, googleCalendarRetryAfter,
    googleFetch: async (_connection: unknown, _path: string, init: RecordValue) => {
      writes.push(init);
      return new Response(JSON.stringify({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }),
        { status, headers: { "Retry-After": "60" } });
    },
    assertGoogleCalendarJobLease: async () => {},
    supabase: { from: () => { metadataWrites += 1; throw new Error("unexpected metadata write"); } },
  });
  await assert.rejects(cleanup({ id: "conn", calendar_id: "primary" }, "event", '"old-version"'),
    (error: unknown) => error instanceof HttpError && error.status === 412);
  assert.equal((writes[0].headers as RecordValue)["If-Match"], '"old-version"');
  status = 403;
  await assert.rejects(cleanup({ id: "conn", calendar_id: "primary" }, "event", '"old-version"'),
    (error: unknown) => error instanceof HttpError && error.status === 429 && error.retryAfterSeconds === 60);
  assert.equal(metadataWrites, 0);
  assert.equal(googleCalendarErrorStatus(403, { error: { errors: [{ reason: "forbidden" }] } }), 403);
});

test("a rejected Google revocation preserves the token and reports a retryable disconnect failure", async () => {
  const calls: string[] = [];
  const disconnect = realFunction("disconnectConnection", {
    supabase: { rpc: async (name: string) => { calls.push(name); return { data: true, error: null }; } },
    getConnectionById: async () => ({ id: "connection", token_secret_ref: "synthetic", credential_revision: 2,
      disconnecting_at: "2026-10-12T12:00:00Z" }),
    stopGoogleWatches: async () => ({ warnings: [] }), readTokenSecret: async () => ({ refresh_token: "synthetic" }),
    googleCalendarFetchWithDeadline: async () => new Response("{}", { status: 503 }),
  });
  await assert.rejects(disconnect({ id: "connection", token_secret_ref: "synthetic" }), /nao confirmou/);
  assert.deepEqual(calls, ["google_calendar_begin_disconnect", "google_calendar_abort_disconnect"]);
});

test("retry distinguishes permanent failures, exponential jitter and provider Retry-After", () => {
  assert.equal(googleCalendarRetryPolicy(new GoogleCalendarRetryableError("invalid", 400), 1, () => 0.5).retryable, false);
  assert.equal(googleCalendarRetryPolicy(new GoogleCalendarRetryableError("scope", 403), 1).retryable, false);
  assert.equal(googleCalendarRetryPolicy(new GoogleCalendarRetryableError("quota", 429, 300), 1, () => 0).delaySeconds, 300);
  assert.equal(googleCalendarRetryPolicy(new Error("network"), 3, () => 0.5).delaySeconds, 120);
  assert.equal(googleCalendarRetryAfter("12"), 12);
  assert.equal(googleCalendarRetryAfter("invalid"), null);
});

test("every Google HTTP call receives a bounded AbortSignal", async () => {
  const original = globalThis.fetch;
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input, init) => { signal = init?.signal; return new Response(null, { status: 204 }); };
  try { await googleCalendarFetchWithDeadline("https://synthetic.example.invalid"); }
  finally { globalThis.fetch = original; }
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
});
