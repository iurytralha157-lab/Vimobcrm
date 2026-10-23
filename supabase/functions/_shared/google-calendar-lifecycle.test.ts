import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { conditionalGoogleWriteHeaders } from "./google-calendar-conflict";
import { assertGoogleCalendarOAuthReady, GoogleCalendarConnectionChangedError, GoogleCalendarVersionChangedError } from "./google-calendar-delivery";
import { buildGoogleEventDescription } from "./google-calendar-event";

function load<T>(name: string, dependencies: Record<string, unknown>): T {
  const file = resolve(process.cwd(), "supabase/functions/_shared/google-calendar.ts");
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, name);
  const compiled = ts.transpileModule(`${declaration.getText(source).replace(/^export\s+/, "")}\nreturn ${name};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies)) as T;
}
type Row = Record<string, unknown>;
const organizationId = "11111111-1111-4111-8111-111111111111";
const ownerId = "33333333-3333-4333-8333-333333333333";
const event = { id: "22222222-2222-4222-8222-222222222222", organization_id: organizationId,
  user_id: ownerId, updated_at: "2026-10-12T12:00:00Z" };

test("late owner transfer after link persistence deletes with the returned provider etag", async () => {
  let ownerChecks = 0, links = 0;
  const deletes: Row[] = [];
  const supabase = { from: (table: string) => {
    let updating = false;
    const query = { select: () => query, eq: () => query, is: () => query,
      update: () => { updating = true; return query; },
      maybeSingle: async () => ({ data: table === "schedule_events" && !updating ? event : null, error: null }),
      then: (done: (result: unknown) => void) => done({ error: null }),
    };
    return query;
  } };
  const cleanup = load<(connection: Row, id: string, etag: string) => Promise<void>>("removeStaleGoogleWrite", {
    normalizeCalendarId: (value: string) => value || "primary", conditionalGoogleWriteHeaders,
    googleFetch: async (_connection: Row, path: string, init: Row) => {
      deletes.push({ path, ...init }); return new Response(null, { status: 204 });
    }, assertGoogleCalendarJobLease: async () => undefined, supabase,
  });
  const push = load<(id: string, actor: null, execution: Row) => Promise<Row>>("pushScheduleEventToGoogle", {
    supabase, getUserProfile: async () => ({}), getConnectionForUser: async () => ({ id: "synthetic-connection", calendar_id: "primary" }),
    normalizeCalendarId: (value: string) => value || "primary", getOutboundEventContext: async () => ({ event, attendeeEmails: [] }),
    getOrganizationTimeZone: async () => "UTC", scheduleEventToGoogle: () => ({ summary: "Synthetic" }),
    buildVimobGoogleEventId: (id: string) => id.replace(/-/g, ""),
    currentScheduleEventOwner: async () => ++ownerChecks <= 2 ? ownerId : null,
    assertScheduleSnapshotCurrent: async () => undefined, assertGoogleCalendarJobLease: async () => undefined,
    googleJson: async () => ({ id: "synthetic-provider-id", etag: '"fresh-etag"' }),
    upsertEventLink: async () => { links++; }, removeStaleGoogleWrite: cleanup,
  });
  assert.deepEqual(await push(event.id, null, { trustedJobOrganizationId: organizationId }),
    { skipped: true, reason: "CANONICAL_EVENT_REMOVED_OR_TRANSFERRED" });
  assert.equal(links, 1); assert.equal(deletes.length, 1);
  assert.deepEqual(deletes[0].headers, { "If-Match": '"fresh-etag"' });
});

test("clearing the final description and location emits explicit Google PATCH nulls", () => {
  const build = load<(event: Row, attendees: string[], timeZone: string) => Row>("scheduleEventToGoogle", {
    normalizeGoogleCalendarTimeZone: (value: string) => value, buildGoogleEventSummary: () => "Synthetic",
    buildGoogleEventDescription, buildGoogleEventAttendees: () => [], buildVimobGoogleExtendedProperties: () => ({}),
    buildGoogleReminderSettings: () => ({ useDefault: false, overrides: [] }),
  });
  const serialized = JSON.parse(JSON.stringify(build({ description: null, location: "", is_all_day: false,
    start_time: "2026-10-12T10:00:00Z", end_time: "2026-10-12T11:00:00Z" }, [], "UTC")));
  assert.equal(serialized.description, null); assert.equal(serialized.location, null);
});

test("OAuth persists only through the atomic activation RPC with the observed credential revision", async () => {
  const calls: Row[] = [];
  const existing = { id: "synthetic-connection", credential_revision: 7, token_secret_ref: "synthetic-secret" };
  const query = { select: () => query, eq: () => query, order: () => query,
    then: (done: (value: unknown) => void) => done({ data: [existing], error: null }) };
  const activate = load<(params: Row) => Promise<Row>>("upsertConnectionFromOAuth", {
    supabase: { from: () => query, rpc: async (name: string, args: Row) => { calls.push({ name, ...args }); return { data: existing, error: null }; } },
    addSeconds: () => "2027-01-01T00:00:00Z", normalizeGoogleAccountEmail: (value: string) => value.toLowerCase(),
    selectReusableGoogleCalendarConnection: (rows: Row[]) => rows[0], readTokenSecret: async () => ({ refresh_token: "synthetic-existing" }),
    assertGoogleCalendarOAuthReady,
  });
  await activate({ state: { user_id: ownerId, organization_id: organizationId }, userInfo: { email: "SYNTHETIC@example.test" },
    tokenResponse: { access_token: "synthetic-access", scope: "https://www.googleapis.com/auth/calendar.events.owned", expires_in: 3600 } });
  assert.equal(calls.length, 1); assert.equal(calls[0].name, "google_calendar_activate_oauth_connection");
  assert.equal(calls[0].p_expected_revision, 7); assert.equal(calls[0].p_connection_id, existing.id);
  assert.equal((calls[0].p_token as Row).refresh_token, "synthetic-existing");
});

test("partial consent performs no activation even when an older offline token exists", async () => {
  let activations = 0;
  const query = { select: () => query, eq: () => query, order: () => query,
    then: (done: (value: unknown) => void) => done({ data: [{ id: "synthetic", token_secret_ref: "synthetic", credential_revision: 1 }], error: null }) };
  const activate = load<(params: Row) => Promise<Row>>("upsertConnectionFromOAuth", {
    supabase: { from: () => query, rpc: async () => { activations++; return { data: {}, error: null }; } },
    addSeconds: () => "2027-01-01T00:00:00Z", normalizeGoogleAccountEmail: (value: string) => value,
    selectReusableGoogleCalendarConnection: (rows: Row[]) => rows[0], readTokenSecret: async () => ({ refresh_token: "synthetic-existing" }),
    assertGoogleCalendarOAuthReady,
  });
  await assert.rejects(activate({ state: { user_id: ownerId, organization_id: organizationId }, userInfo: { email: "synthetic@example.test" },
    tokenResponse: { access_token: "synthetic-access", scope: "openid email" } }), /Permissao/);
  assert.equal(activations, 0);
});

test("OAuth CAS rejection reports a restartable connection change", async () => {
  const query = { select: () => query, eq: () => query, order: () => query,
    then: (done: (value: unknown) => void) => done({ data: [], error: null }) };
  const activate = load<(params: Row) => Promise<Row>>("upsertConnectionFromOAuth", {
    supabase: { from: () => query, rpc: async () => ({ data: null, error: { code: "40001" } }) },
    addSeconds: () => "2035-01-01T00:00:00Z", normalizeGoogleAccountEmail: (value: string) => value,
    selectReusableGoogleCalendarConnection: () => null, assertGoogleCalendarOAuthReady, GoogleCalendarConnectionChangedError,
  });
  await assert.rejects(activate({ state: { user_id: ownerId, organization_id: organizationId }, userInfo: { email: "synthetic@example.test" },
    tokenResponse: { access_token: "synthetic-access", refresh_token: "synthetic-refresh", scope: "https://www.googleapis.com/auth/calendar.events.owned" } }),
    GoogleCalendarConnectionChangedError);
});

test("lead text and relation metadata are both omitted without the owner's current lead scope", async () => {
  const args: Row[] = [];
  const lead = load<(event: Row) => Promise<Row | null>>("getLinkedLead", {
    supabase: { rpc: async (name: string, params: Row) => { args.push({ name, ...params }); return { data: null, error: null }; } },
  });
  const context = load<(event: Row) => Promise<{ event: Row; attendeeEmails: string[] }>>("getOutboundEventContext", { getLinkedLead: lead });
  const result = await context({ ...event, lead_id: "synthetic-lead", property_id: "synthetic-property" });
  assert.equal(result.event.lead, null); assert.equal(result.event.lead_id, null); assert.equal(result.event.property_id, null);
  assert.deepEqual(result.attendeeEmails, []);
  assert.deepEqual(args, [{ name: "google_calendar_get_authorized_event_lead", p_event_id: event.id,
    p_organization_id: organizationId, p_owner_user_id: ownerId }]);
});

test("a scope RPC failure does not silently export lead information", async () => {
  const failure = new Error("synthetic scope unavailable");
  const lead = load<(event: Row) => Promise<Row | null>>("getLinkedLead", {
    supabase: { rpc: async () => ({ data: null, error: failure }) },
  });
  await assert.rejects(lead({ ...event, lead_id: "synthetic-lead" }), failure);
});

test("forced refresh commits through credential CAS and retains the worker lease context", async () => {
  const lease = { id: "synthetic-job", worker: "synthetic-worker" };
  const connection = { id: "synthetic-connection", token_secret_ref: "synthetic-secret", credential_revision: 3, vimob_job: lease };
  const calls: Row[] = []; let heartbeats = 0;
  const refresh = load<(connection: Row, force: boolean) => Promise<{ connection: Row; token: Row }>>("refreshAccessToken", {
    readTokenSecret: async () => ({ access_token: "synthetic-old", refresh_token: "synthetic-refresh", expires_at: "2035-01-01T00:00:00Z",
      scope: "https://www.googleapis.com/auth/calendar.events.owned" }),
    getGoogleOAuthConfig: () => ({ clientId: "synthetic-id", clientSecret: "synthetic-secret" }),
    assertGoogleCalendarJobLease: async () => { heartbeats++; }, GOOGLE_TOKEN_URL: "https://example.test/synthetic-token",
    googleCalendarFetchWithDeadline: async () => new Response(JSON.stringify({ access_token: "synthetic-new", expires_in: 3600 })),
    addSeconds: () => "2035-01-01T01:00:00Z",
    supabase: { rpc: async (name: string, params: Row) => { calls.push({ name, ...params }); return { data: { ...connection, vimob_job: undefined }, error: null }; } },
  });
  const result = await refresh(connection, true);
  assert.equal(heartbeats, 2); assert.equal(result.connection.vimob_job, lease);
  assert.equal(calls[0].name, "google_calendar_store_refreshed_token");
  assert.equal(calls[0].p_expected_revision, 3); assert.equal(calls[0].p_expected_secret_ref, "synthetic-secret");
});

test("401 retries force refresh without independently rewriting Vault expiry", async () => {
  const forces: unknown[] = []; let requests = 0;
  const fetchGoogle = load<(connection: Row, path: string) => Promise<Response>>("googleFetch", {
    assertGoogleCalendarJobLease: async () => undefined, buildGoogleCalendarApiUrl: (value: string) => value,
    refreshAccessToken: async (connection: Row, force?: boolean) => { forces.push(force); return { connection, token: { access_token: "synthetic-only" } }; },
    googleCalendarFetchWithDeadline: async () => new Response(null, { status: ++requests === 1 ? 401 : 200 }),
  });
  assert.equal((await fetchGoogle({ id: "synthetic" }, "/synthetic")).status, 200);
  assert.deepEqual(forces, [undefined, true]);
});

test("credential CAS rejection requeues as a version change rather than painting an account error", async () => {
  const refresh = load<(connection: Row, force: boolean) => Promise<Row>>("refreshAccessToken", {
    readTokenSecret: async () => ({ access_token: "synthetic-old", refresh_token: "synthetic-refresh", expires_at: "2020-01-01T00:00:00Z",
      scope: "https://www.googleapis.com/auth/calendar.events.owned" }),
    getGoogleOAuthConfig: () => ({ clientId: "synthetic-id", clientSecret: "synthetic-secret" }),
    assertGoogleCalendarJobLease: async () => undefined, GOOGLE_TOKEN_URL: "https://example.test/token",
    googleCalendarFetchWithDeadline: async () => new Response(JSON.stringify({ access_token: "synthetic-refreshed", expires_in: 3600 })),
    addSeconds: () => "2035-01-01T00:00:00Z", GoogleCalendarVersionChangedError,
    supabase: { rpc: async () => ({ data: null, error: { code: "40001" } }) },
  });
  await assert.rejects(refresh({ id: "synthetic", credential_revision: 1, token_secret_ref: "synthetic" }, true), GoogleCalendarVersionChangedError);
});

test("disconnect refresh keeps its explicit marker across a 401 and second credential CAS", async () => {
  const connection = { id: "synthetic-connection", token_secret_ref: "synthetic-secret", credential_revision: 5, vimob_disconnect: true };
  const disconnectFlags: unknown[] = []; let requests = 0;
  const fetchWithDeadline = async (url: string) => url === "https://example.test/token"
    ? new Response(JSON.stringify({ access_token: "synthetic-refreshed", expires_in: 3600 }))
    : new Response(null, { status: ++requests === 1 ? 401 : 200 });
  const refresh = load<(connection: Row, force?: boolean) => Promise<Row>>("refreshAccessToken", {
    readTokenSecret: async () => ({ access_token: "synthetic-old", refresh_token: "synthetic-refresh", expires_at: "2020-01-01T00:00:00Z",
      scope: "https://www.googleapis.com/auth/calendar.events.owned" }),
    getGoogleOAuthConfig: () => ({ clientId: "synthetic-id", clientSecret: "synthetic-secret" }),
    assertGoogleCalendarJobLease: async () => undefined, GOOGLE_TOKEN_URL: "https://example.test/token",
    googleCalendarFetchWithDeadline: fetchWithDeadline, addSeconds: () => "2035-01-01T00:00:00Z",
    supabase: { rpc: async (_name: string, params: Row) => {
      disconnectFlags.push(params.p_allow_disconnecting);
      return { data: { ...connection, vimob_disconnect: undefined }, error: null };
    } },
  });
  const googleFetch = load<(connection: Row, path: string) => Promise<Response>>("googleFetch", {
    assertGoogleCalendarJobLease: async () => undefined, buildGoogleCalendarApiUrl: () => "https://example.test/calendar",
    refreshAccessToken: refresh, googleCalendarFetchWithDeadline: fetchWithDeadline,
  });
  assert.equal((await googleFetch(connection, "/channels/stop")).status, 200);
  assert.deepEqual(disconnectFlags, [true, true]);
});
