import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  buildGoogleEventAttendees,
  buildGoogleEventDescription,
  buildGoogleReminderSettings,
  buildGoogleEventSummary,
  buildVimobGoogleExtendedProperties,
  buildVimobGoogleEventId,
  identityBelongsToOrganization,
  isForeignVimobGoogleEvent,
  isFinalVimobScheduleStatus,
  readVimobGoogleEventIdentity,
  stripVimobLinkedDescription,
} from "./google-calendar-event";
import {
  googleCalendarOrganizationsMatch,
  resolveGoogleScheduleCapability,
} from "./google-calendar-access";
import {
  decideGooglePullForLocalEvent,
  GOOGLE_CALENDAR_CONFLICT_MESSAGE,
  GoogleCalendarConflictError,
} from "./google-calendar-conflict";
import { resolveGoogleCalendarConnectGate } from "./google-calendar-pilot";

type GoogleCalendarUrlBuilder = (path: string) => string;
type GoogleCalendarContractHelpers = {
  constantTimeEqual: (left: string, right: string) => boolean;
  normalizeGoogleAccountEmail: (value: unknown) => string;
  selectReusableGoogleCalendarConnection: (
    connections: Array<Record<string, unknown>>,
    accountEmail: string,
  ) => Record<string, unknown> | null;
};

function loadGoogleCalendarUrlBuilder(): GoogleCalendarUrlBuilder {
  const modulePath = resolve(process.cwd(), "supabase/functions/_shared/google-calendar.ts");
  const source = readFileSync(modulePath, "utf8");
  const sourceFile = ts.createSourceFile(modulePath, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  const declarationNames = new Set(["GOOGLE_CALENDAR_BASE_URL", "GOOGLE_CALENDAR_PATH_PREFIX"]);
  const declarations: string[] = [];
  let functionDeclaration = "";

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declarationNames.has(declaration.name.text)) {
          declarations.push(statement.getText(sourceFile));
          break;
        }
      }
    }

    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === "buildGoogleCalendarApiUrl"
    ) {
      functionDeclaration = statement.getText(sourceFile).replace(/^export\s+/, "");
    }
  }

  assert.equal(declarations.length, declarationNames.size, "Google Calendar URL constants must remain testable");
  assert.notEqual(functionDeclaration, "", "Google Calendar URL builder must exist");

  const compiled = ts.transpileModule(
    `${declarations.join("\n")}\n${functionDeclaration}\nmodule.exports = buildGoogleCalendarApiUrl;`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const isolatedModule = { exports: undefined as GoogleCalendarUrlBuilder | undefined };

  new Function("module", "exports", compiled)(isolatedModule, isolatedModule.exports);
  assert.equal(typeof isolatedModule.exports, "function");
  return isolatedModule.exports as GoogleCalendarUrlBuilder;
}

function loadGoogleCalendarContractHelpers(): GoogleCalendarContractHelpers {
  const modulePath = resolve(process.cwd(), "supabase/functions/_shared/google-calendar.ts");
  const source = readFileSync(modulePath, "utf8");
  const sourceFile = ts.createSourceFile(modulePath, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  const functionNames = new Set([
    "constantTimeEqual",
    "normalizeGoogleAccountEmail",
    "selectReusableGoogleCalendarConnection",
  ]);
  const declarations: string[] = [];

  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      functionNames.has(statement.name.text)
    ) {
      declarations.push(statement.getText(sourceFile).replace(/^export\s+/, ""));
    }
  }

  assert.equal(declarations.length, functionNames.size, "Google Calendar contract helpers must remain testable");
  const compiled = ts.transpileModule(
    `${declarations.join("\n")}\nmodule.exports = { ${Array.from(functionNames).join(", ")} };`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const isolatedModule = { exports: undefined as GoogleCalendarContractHelpers | undefined };

  new Function("module", "exports", compiled)(isolatedModule, isolatedModule.exports);
  assert.ok(isolatedModule.exports);
  return isolatedModule.exports;
}

function loadIsolatedGoogleFunction<T>(
  relativePath: string,
  functionName: string,
  dependencies: Record<string, unknown>,
): T {
  const modulePath = resolve(process.cwd(), relativePath);
  const source = readFileSync(modulePath, "utf8");
  const sourceFile = ts.createSourceFile(modulePath, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  const declaration = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === functionName,
  );
  assert.ok(declaration, `${functionName} must exist`);
  const compiled = ts.transpileModule(
    `${declaration.getText(sourceFile).replace(/^export\s+/, "")}\nmodule.exports = ${functionName};`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const isolatedModule = { exports: undefined as T | undefined };
  new Function("module", "exports", ...Object.keys(dependencies), compiled)(
    isolatedModule,
    isolatedModule.exports,
    ...Object.values(dependencies),
  );
  assert.ok(isolatedModule.exports);
  return isolatedModule.exports;
}

function loadIsolatedGoogleHandler<T>(
  relativePath: string,
  dependencies: Record<string, unknown>,
): T {
  const modulePath = resolve(process.cwd(), relativePath);
  const source = readFileSync(modulePath, "utf8");
  const sourceFile = ts.createSourceFile(modulePath, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  const serve = sourceFile.statements.find(
    (statement): statement is ts.ExpressionStatement =>
      ts.isExpressionStatement(statement)
      && ts.isCallExpression(statement.expression)
      && statement.expression.expression.getText(sourceFile) === "Deno.serve",
  );
  assert.ok(serve && ts.isCallExpression(serve.expression), "Deno.serve handler must exist");
  const handler = serve.expression.arguments[0];
  assert.ok(handler && ts.isArrowFunction(handler), "Deno.serve must receive an arrow handler");
  const compiled = ts.transpileModule(
    `module.exports = ${handler.getText(sourceFile)};`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const isolatedModule = { exports: undefined as T | undefined };
  new Function("module", "exports", ...Object.keys(dependencies), compiled)(
    isolatedModule,
    isolatedModule.exports,
    ...Object.values(dependencies),
  );
  assert.ok(isolatedModule.exports);
  return isolatedModule.exports;
}

function loadGoogleCalendarReturnUrlBuilder(): (currentHref: string) => string {
  const modulePath = resolve(process.cwd(), "lib/api/google-calendar.ts");
  const source = readFileSync(modulePath, "utf8");
  const sourceFile = ts.createSourceFile(modulePath, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  let functionDeclaration = "";

  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === "buildGoogleCalendarReturnUrl"
    ) {
      functionDeclaration = statement.getText(sourceFile).replace(/^export\s+/, "");
    }
  }

  assert.notEqual(functionDeclaration, "", "Google Calendar return URL builder must exist");
  const compiled = ts.transpileModule(
    `${functionDeclaration}\nmodule.exports = buildGoogleCalendarReturnUrl;`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const isolatedModule = { exports: undefined as ((currentHref: string) => string) | undefined };

  new Function("module", "exports", compiled)(isolatedModule, isolatedModule.exports);
  assert.equal(typeof isolatedModule.exports, "function");
  return isolatedModule.exports as (currentHref: string) => string;
}

test("prefixes Google event summaries with the Vimob activity type", () => {
  const cases = [
    ["call", "Ligação"],
    ["email", "E-mail"],
    ["meeting", "Reunião"],
    ["task", "Tarefa"],
    ["message", "Mensagem"],
    ["visit", "Visita"],
  ] as const;

  for (const [eventType, label] of cases) {
    assert.equal(
      buildGoogleEventSummary({ event_type: eventType, title: "Retorno com cliente" }),
      `${label}: Retorno com cliente`,
    );
  }

  assert.equal(
    buildGoogleEventSummary({ event_type: "meeting", title: "Reunião: Retorno com cliente" }),
    "Reunião: Retorno com cliente",
  );
});

test("adds the description, lead and property to the Google description", () => {
  assert.equal(
    buildGoogleEventDescription({
      description: "Levar a ficha de visita.",
      lead: { name: "Marina Souza" },
      property: { code: "AP-204", title: "Apartamento Jardins" },
    }),
    [
      "Levar a ficha de visita.",
      "Vínculos do Vimob CRM\nLead/cliente: Marina Souza\nImóvel: AP-204 — Apartamento Jardins",
    ].join("\n\n"),
  );
});

test("keeps only unique connected guests and excludes the organizer", () => {
  assert.deepEqual(
    buildGoogleEventAttendees(
      ["corretor@vimob.com", "CORRETOR@vimob.com", "gestor@vimob.com", "sem-email"],
      ["gestor@vimob.com"],
    ),
    [{ email: "corretor@vimob.com" }],
  );
});

test("builds one canonical Google Calendar API prefix for pull and push paths", () => {
  const buildGoogleCalendarApiUrl = loadGoogleCalendarUrlBuilder();

  assert.equal(
    buildGoogleCalendarApiUrl("/calendar/v3/calendars/primary/events?showDeleted=true"),
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?showDeleted=true",
  );
  assert.equal(
    buildGoogleCalendarApiUrl("/calendars/primary/events/event-1"),
    "https://www.googleapis.com/calendar/v3/calendars/primary/events/event-1",
  );
  assert.equal(
    buildGoogleCalendarApiUrl("/calendars/primary/events/watch"),
    "https://www.googleapis.com/calendar/v3/calendars/primary/events/watch",
  );
  assert.equal(
    buildGoogleCalendarApiUrl("/channels/stop"),
    "https://www.googleapis.com/calendar/v3/channels/stop",
  );

  assert.equal(
    stripVimobLinkedDescription(
      "Levar a ficha de visita.\n\nVínculos do Vimob CRM\nLead/cliente: Marina Souza\nImóvel: AP-204 — Apartamento Jardins",
    ),
    "Levar a ficha de visita.",
  );
  assert.equal(
    stripVimobLinkedDescription("Vínculos do Vimob CRM\nLead/cliente: Marina Souza"),
    undefined,
  );
});

test("Vimob overwrites a Google edit on its verified linked event", async () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const event = {
    id: "22222222-2222-4222-8222-222222222222",
    organization_id: organizationId,
    user_id: "33333333-3333-4333-8333-333333333333",
    updated_at: "2026-10-06T10:00:00.000Z",
    google_sync_status: "conflict",
  };
  const link = {
    google_event_id: "google-event-1",
    google_etag: '"version-1"',
    deleted_at: null,
  };
  const connection = {
    id: "connection-1",
    organization_id: organizationId,
    user_id: event.user_id,
    calendar_id: "primary",
    account_email: "owner@example.com",
  };
  const requests: Array<{ path: string; init: RequestInit }> = [];
  let linkUpdated = false;
  let localStatusUpdated = false;
  let connectionMarked = false;
  class GoogleCalendarHttpError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  }
  const supabase = {
    from(table: string) {
      let operation = "select";
      const query = {
        select: () => query,
        eq: () => query,
        update: () => {
          operation = "update";
          localStatusUpdated = true;
          return query;
        },
        maybeSingle: async () => ({
          data: table === "schedule_events"
            ? operation === "update" ? { id: event.id } : event
            : link,
          error: null,
        }),
      };
      return query;
    },
  };
  const push = loadIsolatedGoogleFunction<(
    eventId: string,
    actorUserId: string,
    execution: { trustedJobOrganizationId: string },
  ) => Promise<Record<string, unknown>>>(
    "supabase/functions/_shared/google-calendar.ts",
    "pushScheduleEventToGoogle",
    {
      supabase,
      assertGoogleScheduleCapability: async () => undefined,
      getUserProfile: async () => ({ id: event.user_id }),
      getConnectionForUser: async () => connection,
      normalizeCalendarId: (value: string) => value,
      getOutboundEventContext: async () => ({ event, attendeeEmails: [] }),
      getOrganizationTimeZone: async () => "America/Sao_Paulo",
      scheduleEventToGoogle: () => ({ summary: "Compromisso", attendees: [] }),
      currentScheduleEventOwner: async () => event.user_id,
      buildVimobGoogleEventId: () => "vimob-event-1",
      googleJson: async (_connection: unknown, path: string, init: RequestInit = {}) => {
        requests.push({ path, init });
        if (!init.method) return {
          id: link.google_event_id,
          etag: '"version-2"',
          extendedProperties: buildVimobGoogleExtendedProperties(event),
        };
        return { id: link.google_event_id, etag: '"version-3"' };
      },
      assertVimobGoogleEventIdentity: (remote: Record<string, unknown>) => {
        assert.deepEqual(readVimobGoogleEventIdentity(remote)?.ownerUserId, event.user_id);
      },
      upsertEventLink: async () => { linkUpdated = true; },
      markConnectionOutboundSynced: async () => { connectionMarked = true; },
      GoogleCalendarHttpError,
      GoogleCalendarConflictError,
    },
  );

  assert.deepEqual(await push(event.id, null as unknown as string, {
    trustedJobOrganizationId: organizationId,
  }), { synced: true, google_event_id: link.google_event_id });
  assert.deepEqual(requests.map(({ init }) => init.method || "GET"), ["GET", "PATCH"]);
  assert.equal(requests[1].init.headers, undefined);
  assert.match(requests[1].path, /sendUpdates=none$/);
  assert.deepEqual(JSON.parse(String(requests[1].init.body)).attendees, []);
  assert.equal(linkUpdated, true);
  assert.equal(localStatusUpdated, true);
  assert.equal(connectionMarked, true);
});

test("pilot removes old Google guests and never invites assignees", async () => {
  const event = {
    id: "22222222-2222-4222-8222-222222222222",
    organization_id: "11111111-1111-4111-8111-111111111111",
    user_id: "33333333-3333-4333-8333-333333333333",
    start_time: "2026-10-06T10:00:00.000Z",
    end_time: "2026-10-06T11:00:00.000Z",
    status: "confirmed",
  };
  const getContext = loadIsolatedGoogleFunction<(
    event: Record<string, unknown>,
  ) => Promise<{ event: Record<string, unknown>; attendeeEmails: string[] }>>(
    "supabase/functions/_shared/google-calendar.ts",
    "getOutboundEventContext",
    {
      getLinkedLead: async () => ({ id: "lead-a", name: "Lead privado" }),
    },
  );
  const context = await getContext(event);
  assert.deepEqual(context.attendeeEmails, []);
  const buildBody = loadIsolatedGoogleFunction<(
    event: Record<string, unknown>,
    attendeeEmails: string[],
    timeZone: string,
    organizerEmail: string,
  ) => Record<string, unknown>>(
    "supabase/functions/_shared/google-calendar.ts",
    "scheduleEventToGoogle",
    {
      normalizeGoogleCalendarTimeZone: (zone: string) => zone,
      buildGoogleEventSummary,
      buildGoogleEventDescription,
      buildGoogleEventAttendees,
      buildVimobGoogleExtendedProperties,
      buildGoogleReminderSettings,
    },
  );
  const body = buildBody(context.event, context.attendeeEmails, "America/Sao_Paulo", "owner@example.com");
  assert.deepEqual(body.attendees, []);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "attendees"), true, "PATCH must explicitly clear legacy Google guests");
});

test("outbound overwrite refuses an event with a different Vimob owner or tenant", () => {
  const eventId = "22222222-2222-4222-8222-222222222222";
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const ownerUserId = "33333333-3333-4333-8333-333333333333";
  const assertIdentity = loadIsolatedGoogleFunction<(
    remote: Record<string, unknown>,
    eventId: string,
    organizationId: string,
    ownerUserId: string,
  ) => void>(
    "supabase/functions/_shared/google-calendar.ts",
    "assertVimobGoogleEventIdentity",
    { readVimobGoogleEventIdentity, GoogleCalendarConflictError },
  );
  const valid = { extendedProperties: buildVimobGoogleExtendedProperties({
    id: eventId, organization_id: organizationId, user_id: ownerUserId,
  }) };
  assert.doesNotThrow(() => assertIdentity(valid, eventId, organizationId, ownerUserId));
  assert.throws(() => assertIdentity(valid, eventId, organizationId, "44444444-4444-4444-8444-444444444444"), GoogleCalendarConflictError);
  assert.throws(() => assertIdentity(valid, eventId, "55555555-5555-4555-8555-555555555555", ownerUserId), GoogleCalendarConflictError);
});

test("an in-flight create is removed when its Vimob event disappears before link persistence", async () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const event = {
    id: "22222222-2222-4222-8222-222222222222",
    organization_id: organizationId,
    user_id: "33333333-3333-4333-8333-333333333333",
    updated_at: "2026-10-06T10:00:00.000Z",
    google_sync_status: "pending",
  };
  let ownerChecks = 0;
  let cleaned = 0;
  let linked = 0;
  const supabase = {
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: table === "schedule_events" ? event : null,
          error: null,
        }),
      };
      return query;
    },
  };
  const push = loadIsolatedGoogleFunction<(
    eventId: string,
    actorUserId: string,
    execution: { trustedJobOrganizationId: string },
  ) => Promise<Record<string, unknown>>>(
    "supabase/functions/_shared/google-calendar.ts",
    "pushScheduleEventToGoogle",
    {
      supabase,
      assertGoogleScheduleCapability: async () => undefined,
      getUserProfile: async () => ({ id: event.user_id }),
      getConnectionForUser: async () => ({ id: "connection-a", calendar_id: "primary", account_email: "owner@example.test" }),
      normalizeCalendarId: (value: string) => value,
      getOutboundEventContext: async () => ({ event, attendeeEmails: [] }),
      getOrganizationTimeZone: async () => "America/Sao_Paulo",
      scheduleEventToGoogle: () => ({ summary: "Compromisso" }),
      currentScheduleEventOwner: async () => ++ownerChecks === 1 ? event.user_id : null,
      buildVimobGoogleEventId,
      googleJson: async () => ({ id: buildVimobGoogleEventId(event.id), etag: '"new"' }),
      removeStaleGoogleWrite: async () => { cleaned += 1; },
      upsertEventLink: async () => { linked += 1; },
      GoogleCalendarHttpError: class extends Error {},
      GoogleCalendarConflictError,
    },
  );

  assert.deepEqual(
    await push(event.id, event.user_id, { trustedJobOrganizationId: organizationId }),
    { skipped: true, reason: "CANONICAL_EVENT_REMOVED_OR_TRANSFERRED" },
  );
  assert.equal(ownerChecks, 2);
  assert.equal(cleaned, 1);
  assert.equal(linked, 0);
});

test("delete worker defers while the same Vimob event is being created in Google", async () => {
  let deleted = 0;
  const processJob = loadIsolatedGoogleFunction<(
    job: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>>(
    "supabase/functions/_shared/google-calendar.ts",
    "processSyncJob",
    {
      hasRunningUpsertForEvent: async () => true,
      deleteScheduleEventFromGoogle: async () => { deleted += 1; },
    },
  );
  assert.deepEqual(await processJob({
    action: "push_delete",
    organization_id: "organization-a",
    created_by: "actor-a",
    payload: { event_id: "event-a", owner_user_id: "owner-a", link_ids: [] },
  }), { deferred: true, reason: "UPSERT_STILL_RUNNING" });
  assert.equal(deleted, 0);
});

test("outbound worker skips an upsert without a verified owner in its payload", async () => {
  let pushed = 0;
  const processJob = loadIsolatedGoogleFunction<(
    job: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>>(
    "supabase/functions/_shared/google-calendar.ts",
    "processSyncJob",
    {
      currentScheduleEventOwner: async () => "owner-b",
      pushScheduleEventToGoogle: async () => { pushed += 1; },
    },
  );
  assert.deepEqual(await processJob({
    action: "push_upsert",
    organization_id: "organization-a",
    schedule_event_id: "event-a",
    created_by: "actor-a",
    payload: { event_id: "event-a" },
  }), { skipped: true, reason: "STALE_EVENT_OWNER" });
  assert.equal(pushed, 0);
});

test("durable upsert ignores a removed audit actor but skips a transferred owner", async () => {
  let pushed = 0;
  const processJob = loadIsolatedGoogleFunction<(
    job: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>>(
    "supabase/functions/_shared/google-calendar.ts",
    "processSyncJob",
    {
      currentScheduleEventOwner: async () => "owner-b",
      hasOutstandingDeleteForEvent: async () => false,
      pushScheduleEventToGoogle: async () => { pushed += 1; return { synced: true }; },
    },
  );
  const job = {
    action: "push_upsert",
    organization_id: "organization-a",
    schedule_event_id: "event-a",
    created_by: null,
    payload: { event_id: "event-a", owner_user_id: "owner-a" },
  };
  assert.deepEqual(await processJob(job), { skipped: true, reason: "STALE_EVENT_OWNER" });
  assert.equal(pushed, 0);
  assert.deepEqual(await processJob({ ...job, payload: { ...job.payload, owner_user_id: "owner-b" } }), { synced: true });
  assert.equal(pushed, 1);
});

test("durable upsert does not export after the connection owner leaves the organization", async () => {
  const event = {
    id: "22222222-2222-4222-8222-222222222222",
    organization_id: "11111111-1111-4111-8111-111111111111",
    user_id: "33333333-3333-4333-8333-333333333333",
    updated_at: "2026-10-06T10:00:00.000Z",
  };
  let connectionReads = 0;
  let googleWrites = 0;
  const push = loadIsolatedGoogleFunction<(
    id: string, actor: string | null, execution: Record<string, unknown>,
  ) => Promise<unknown>>(
    "supabase/functions/_shared/google-calendar.ts",
    "pushScheduleEventToGoogle",
    {
      supabase: { from: () => {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: event, error: null }),
        };
        return query;
      } },
      getUserProfile: async () => { throw new Error("Sem acesso a organizacao informada."); },
      getConnectionForUser: async () => { connectionReads += 1; return null; },
      googleJson: async () => { googleWrites += 1; return {}; },
    },
  );
  await assert.rejects(push(event.id, null, {
    trustedJobOrganizationId: event.organization_id,
  }), /Sem acesso a organizacao informada/);
  assert.equal(connectionReads, 0);
  assert.equal(googleWrites, 0);
});

test("outbound worker claims verified jobs without a user allowlist", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const run = loadIsolatedGoogleFunction<(limit: number) => Promise<Record<string, unknown>>>(
    "supabase/functions/_shared/google-calendar.ts",
    "runDueJobs",
    {
      supabase: { rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, ...args });
        return { data: [], error: null };
      } },
      crypto,
    },
  );
  assert.deepEqual(await run(20), { processed: 0, results: [] });
  assert.equal(calls.length, 1);
  const claimArgs = calls[0];
  assert.equal(claimArgs.name, "google_calendar_claim_outbound_sync_jobs");
  assert.deepEqual(Object.keys(claimArgs).sort(), ["name", "p_limit", "p_worker"]);
  assert.equal(claimArgs.p_limit, 20);
});

test("deferred deletion returns to the queue without consuming a retry", async () => {
  const updates: Array<Record<string, unknown>> = [];
  const execute = loadIsolatedGoogleFunction<(
    job: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>>(
    "supabase/functions/_shared/google-calendar.ts",
    "executeSyncJob",
    {
      processSyncJob: async () => ({ deferred: true, reason: "UPSERT_STILL_RUNNING" }),
      addSeconds: () => "2026-10-06T10:00:10.000Z",
      supabase: { from: () => ({
        update: (row: Record<string, unknown>) => {
          updates.push(row);
          return { eq: async () => ({ error: null }) };
        },
      }) },
    },
  );
  const result = await execute({ id: "delete-job-a", attempts: 4, max_attempts: 5 });
  assert.equal(result.deferred, true);
  assert.equal(result.ok, true);
  assert.deepEqual(updates, [{
    status: "queued",
    next_run_at: "2026-10-06T10:00:10.000Z",
    locked_at: null,
    locked_by: null,
  }]);
});

test("linkless hard delete removes only the matching deterministic Vimob event", async () => {
  const eventId = "22222222-2222-4222-8222-222222222222";
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const ownerUserId = "33333333-3333-4333-8333-333333333333";
  const connection = {
    id: "connection-a",
    organization_id: organizationId,
    user_id: ownerUserId,
    calendar_id: "primary",
  };
  const requests: Array<{ path: string; method: string; headers?: HeadersInit }> = [];
  const supabase = {
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        in: () => query,
        maybeSingle: async () => ({ data: table === "schedule_events" ? null : null, error: null }),
        then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
      };
      return query;
    },
  };
  const remove = loadIsolatedGoogleFunction<(
    id: string,
    actor: string,
    links: string[],
    execution: Record<string, unknown>,
  ) => Promise<{ deleted: number }>>(
    "supabase/functions/_shared/google-calendar.ts",
    "deleteScheduleEventFromGoogle",
    {
      supabase,
      assertGoogleScheduleCapability: async () => undefined,
      getConnectionById: async () => connection,
      getConnectionForUser: async () => connection,
      normalizeCalendarId: (value: string) => value,
      buildVimobGoogleEventId,
      assertVimobGoogleEventIdentity: (remote: Record<string, unknown>) => {
        assert.equal(readVimobGoogleEventIdentity(remote)?.eventId, eventId);
      },
      markConnectionOutboundSynced: async () => undefined,
      GoogleCalendarConflictError,
      googleFetch: async (_connection: unknown, path: string, init?: RequestInit) => {
        const method = init?.method || "GET";
        requests.push({ path, method, headers: init?.headers });
        if (method === "GET") {
          return new Response(JSON.stringify({
            id: buildVimobGoogleEventId(eventId),
            etag: '"current"',
            extendedProperties: buildVimobGoogleExtendedProperties({
              id: eventId,
              organization_id: organizationId,
              user_id: ownerUserId,
            }),
          }), { status: 200 });
        }
        return new Response(null, { status: 204 });
      },
    },
  );
  assert.deepEqual(await remove(eventId, ownerUserId, [], {
    trustedJobOrganizationId: organizationId,
    fallbackOwnerUserId: ownerUserId,
    fallbackConnectionId: connection.id,
  }), { deleted: 1 });
  assert.deepEqual(requests.map((item) => item.method), ["GET", "DELETE"]);
  assert.equal(requests[1].headers, undefined);
  assert.match(requests[0].path, new RegExp(buildVimobGoogleEventId(eventId)));
});

test("hard delete removes a verified linked event after a Google-side edit", async () => {
  const eventId = "22222222-2222-4222-8222-222222222222";
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const ownerUserId = "33333333-3333-4333-8333-333333333333";
  const connection = {
    id: "connection-a", organization_id: organizationId, user_id: ownerUserId,
    calendar_id: "primary", token_secret_ref: "vault-a",
  };
  const link = {
    id: "link-a", google_calendar_tokens: connection, google_calendar_id: "primary",
    google_event_id: "legacy-linked-id", google_etag: '"old-version"',
  };
  const requests: Array<{ path: string; method: string; headers?: HeadersInit }> = [];
  const supabase = {
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        in: () => query,
        update: () => query,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (value: unknown) => void) => resolve({
          data: table === "google_calendar_event_links" ? [link] : [], error: null,
        }),
      };
      return query;
    },
  };
  let successfulWrites = 0;
  const remove = loadIsolatedGoogleFunction<(
    id: string, actor: string | null, links: string[], execution: Record<string, unknown>,
  ) => Promise<{ deleted: number }>>(
    "supabase/functions/_shared/google-calendar.ts",
    "deleteScheduleEventFromGoogle",
    {
      supabase,
      getConnectionById: async () => connection,
      normalizeCalendarId: (value: string) => value,
      buildVimobGoogleEventId,
      assertVimobGoogleEventIdentity: (remote: Record<string, unknown>) => {
        const identity = readVimobGoogleEventIdentity(remote);
        assert.equal(identity?.eventId, eventId);
        assert.equal(identity?.ownerUserId, ownerUserId);
      },
      markConnectionOutboundSynced: async () => { successfulWrites += 1; },
      googleFetch: async (_connection: unknown, path: string, init?: RequestInit) => {
        const method = init?.method || "GET";
        requests.push({ path, method, headers: init?.headers });
        if (path.includes("vimob") && method === "GET") return new Response(null, { status: 404 });
        if (method === "GET") {
          return new Response(JSON.stringify({
            id: link.google_event_id,
            etag: '"google-edited-version"',
            extendedProperties: buildVimobGoogleExtendedProperties({
              id: eventId, organization_id: organizationId, user_id: ownerUserId,
            }),
          }), { status: 200 });
        }
        return new Response(null, { status: 204 });
      },
    },
  );
  assert.deepEqual(await remove(eventId, null, [link.id], {
    trustedJobOrganizationId: organizationId,
    fallbackOwnerUserId: ownerUserId,
    fallbackConnectionId: connection.id,
  }), { deleted: 1 });
  assert.deepEqual(requests.map(({ method }) => method), ["GET", "DELETE", "GET"]);
  assert.equal(requests[1].headers, undefined);
  assert.match(requests[1].path, /sendUpdates=none$/);
  assert.equal(successfulWrites, 1);
});

test("a successful send keeps connection errors until all failed outbound jobs clear", async () => {
  const connection = {
    id: "connection-a", organization_id: "organization-a", user_id: "owner-a",
  };
  let unresolved = true;
  const writes: Array<Record<string, unknown>> = [];
  const filters: Array<[string, unknown]> = [];
  const markSynced = loadIsolatedGoogleFunction<(
    connection: Record<string, unknown>,
  ) => Promise<void>>(
    "supabase/functions/_shared/google-calendar.ts",
    "markConnectionOutboundSynced",
    {
      supabase: {
        from: (table: string) => {
          const query = {
            select: () => query,
            eq: (field: string, value: unknown) => { filters.push([field, value]); return query; },
            in: (field: string, value: unknown) => { filters.push([field, value]); return query; },
            contains: (field: string, value: unknown) => { filters.push([field, value]); return query; },
            order: () => query,
            limit: () => query,
            maybeSingle: async () => ({ data: unresolved ? { id: "failed-delete-a", last_error: "Delete Google falhou" } : null, error: null }),
            update: (row: Record<string, unknown>) => { writes.push({ table, ...row }); return query; },
            is: () => query,
            then: (resolve: (value: unknown) => void) => resolve({ error: null }),
          };
          return query;
        },
      },
      console: { error: () => undefined },
    },
  );
  await markSynced(connection);
  assert.equal(writes[0].table, "google_calendar_tokens");
  assert.equal(typeof writes[0].last_synced_at, "string");
  assert.equal(writes[0].sync_status, "error");
  assert.equal(writes[0].last_error, "Delete Google falhou");
  assert.deepEqual(filters.slice(0, 4), [
    ["organization_id", connection.organization_id],
    ["action", ["push_upsert", "push_delete"]],
    ["status", ["failed", "dead"]],
    ["payload", { owner_user_id: connection.user_id }],
  ]);
  unresolved = false;
  await markSynced(connection);
  assert.equal(writes[1].sync_status, "connected");
  assert.equal(writes[1].last_error, null);
});

test("a failure recorded during successful status update leaves the card in error", async () => {
  let reads = 0;
  const writes: Array<Record<string, unknown>> = [];
  const markSynced = loadIsolatedGoogleFunction<(
    connection: Record<string, unknown>,
  ) => Promise<void>>(
    "supabase/functions/_shared/google-calendar.ts",
    "markConnectionOutboundSynced",
    {
      supabase: {
        from: () => {
          const query = {
            select: () => query,
            eq: () => query,
            in: () => query,
            contains: () => query,
            order: () => query,
            limit: () => query,
            maybeSingle: async () => ({
              data: ++reads === 1 ? null : { id: "failed-delete-a", last_error: "Remocao falhou" },
              error: null,
            }),
            update: (row: Record<string, unknown>) => { writes.push(row); return query; },
            is: () => query,
            then: (resolve: (value: unknown) => void) => resolve({ error: null }),
          };
          return query;
        },
      },
      console: { error: () => undefined },
    },
  );
  await markSynced({ id: "connection-a", organization_id: "organization-a", user_id: "owner-a" });
  assert.equal(reads, 2);
  assert.deepEqual(writes.map((row) => row.sync_status), ["connected", "error"]);
  assert.equal(writes[1].last_error, "Remocao falhou");
});

test("keeps Vimob reminder choices explicit in Google Calendar", () => {
  assert.deepEqual(buildGoogleReminderSettings(30), {
    useDefault: false,
    overrides: [{ method: "popup", minutes: 30 }],
  });
  assert.deepEqual(buildGoogleReminderSettings(null), {
    useDefault: false,
    overrides: [],
  });
  assert.equal(buildGoogleReminderSettings(undefined), undefined);
  assert.equal(buildGoogleReminderSettings(-1), undefined);
});

test("builds a stable provider id for idempotent Vimob event creation", () => {
  assert.equal(
    buildVimobGoogleEventId("A0B1C2D3-E4F5-6789-ABCD-EF0123456789"),
    "vimoba0b1c2d3e4f56789abcdef0123456789",
  );
  assert.throws(() => buildVimobGoogleEventId("--"), /Invalid Vimob event id/);
});

test("shares one tenant-scoped Vimob identity across organizer and attendee copies", () => {
  const event = {
    id: "a0b1c2d3-e4f5-6789-abcd-ef0123456789",
    organization_id: "c0b1c2d3-e4f5-6789-abcd-ef0123456789",
    user_id: "d0b1c2d3-e4f5-6789-abcd-ef0123456789",
    event_type: "visit",
  };
  const extendedProperties = buildVimobGoogleExtendedProperties(event);
  const organizerCopy = { extendedProperties };
  const attendeeCopy = { extendedProperties: { shared: extendedProperties.shared } };

  const organizerIdentity = readVimobGoogleEventIdentity(organizerCopy);
  const attendeeIdentity = readVimobGoogleEventIdentity(attendeeCopy);
  assert.equal(organizerIdentity?.source, "shared");
  assert.equal(attendeeIdentity?.source, "shared");
  assert.equal(attendeeIdentity?.eventId, organizerIdentity?.eventId);
  assert.equal(attendeeIdentity?.ownerUserId, event.user_id);
  assert.equal(identityBelongsToOrganization(attendeeIdentity, event.organization_id), true);
  assert.equal(
    identityBelongsToOrganization(
      attendeeIdentity,
      "e0b1c2d3-e4f5-6789-abcd-ef0123456789",
    ),
    false,
  );
});

test("does not import a Vimob event from organization A into organization B", async () => {
  const organizationA = "c0b1c2d3-e4f5-6789-abcd-ef0123456789";
  const organizationB = "e0b1c2d3-e4f5-6789-abcd-ef0123456789";
  const googleEvent = {
    id: "google-event-a",
    summary: "Confidential appointment in A",
    description: "Private details belonging to A",
    extendedProperties: buildVimobGoogleExtendedProperties({
      id: "a0b1c2d3-e4f5-6789-abcd-ef0123456789",
      organization_id: organizationA,
      user_id: "d0b1c2d3-e4f5-6789-abcd-ef0123456789",
    }),
  };

  assert.equal(isForeignVimobGoogleEvent(googleEvent, organizationA), false);
  assert.equal(isForeignVimobGoogleEvent(googleEvent, organizationB), true);
  assert.equal(isForeignVimobGoogleEvent({ id: "native-google-event" }, organizationB), false);

  const upsert = loadIsolatedGoogleFunction<(
    connection: Record<string, unknown>,
    event: Record<string, unknown>,
    timeZone: string,
  ) => Promise<Record<string, unknown>>>(
    "supabase/functions/_shared/google-calendar.ts",
    "upsertGoogleEventIntoSchedule",
    { isForeignVimobGoogleEvent },
  );
  assert.deepEqual(
    await upsert({ organization_id: organizationB }, googleEvent, "America/Sao_Paulo"),
    { skipped: true, reason: "FOREIGN_ORGANIZATION" },
  );
  // The isolated function has no database or Google dependencies. Reaching
  // any lookup, insert or update would throw instead of returning above.
});

test("does not resurrect a deleted Vimob event while its Google delete is pending", async () => {
  const organizationA = "c0b1c2d3-e4f5-6789-abcd-ef0123456789";
  const identityEvent = {
    id: "google-vimob-event",
    extendedProperties: buildVimobGoogleExtendedProperties({
      id: "a0b1c2d3-e4f5-6789-abcd-ef0123456789",
      organization_id: organizationA,
      user_id: "d0b1c2d3-e4f5-6789-abcd-ef0123456789",
    }),
  };
  let inserted = 0;
  const noCanonical = loadIsolatedGoogleFunction<(
    connection: Record<string, unknown>,
    event: Record<string, unknown>,
    timeZone: string,
  ) => Promise<Record<string, unknown>>>(
    "supabase/functions/_shared/google-calendar.ts",
    "upsertGoogleEventIntoSchedule",
    {
      isForeignVimobGoogleEvent,
      findEventLink: async () => null,
      readVimobGoogleEventIdentity,
      identityBelongsToOrganization,
      googleEventToSchedule: () => ({ title: "Should not be inserted" }),
      findScheduleEventForConnection: async () => null,
      supabase: { from: () => { inserted += 1; throw new Error("Unexpected insert"); } },
    },
  );
  assert.deepEqual(
    await noCanonical({ organization_id: organizationA }, identityEvent, "America/Sao_Paulo"),
    { skipped: true, reason: "MISSING_CANONICAL_EVENT" },
  );

  const orphanedNativeLink = loadIsolatedGoogleFunction<(
    connection: Record<string, unknown>,
    event: Record<string, unknown>,
    timeZone: string,
  ) => Promise<Record<string, unknown>>>(
    "supabase/functions/_shared/google-calendar.ts",
    "upsertGoogleEventIntoSchedule",
    {
      isForeignVimobGoogleEvent,
      findEventLink: async () => ({ schedule_event_id: null }),
      supabase: { from: () => { inserted += 1; throw new Error("Unexpected insert"); } },
    },
  );
  assert.deepEqual(
    await orphanedNativeLink({ organization_id: organizationA }, { id: "native-google-event" }, "America/Sao_Paulo"),
    { skipped: true, reason: "MISSING_CANONICAL_EVENT" },
  );
  assert.equal(inserted, 0);
});

test("pull preserves a pending local edit when the Google ETag changed", async () => {
  const organizationId = "c0b1c2d3-e4f5-6789-abcd-ef0123456789";
  const eventId = "a0b1c2d3-e4f5-6789-abcd-ef0123456789";
  const localEvent: Record<string, unknown> = {
    id: eventId,
    organization_id: organizationId,
    user_id: "d0b1c2d3-e4f5-6789-abcd-ef0123456789",
    title: "Editado no Vimob",
    description: "Texto local ainda não enviado",
    status: "scheduled",
    google_sync_status: "pending",
  };
  const updates: Array<Record<string, unknown>> = [];
  let linkWrites = 0;
  const query = {
    update: (changes: Record<string, unknown>) => {
      updates.push(changes);
      Object.assign(localEvent, changes);
      return query;
    },
    eq: () => query,
    in: () => query,
    select: () => query,
    maybeSingle: async () => ({ data: { ...localEvent }, error: null }),
  };
  const supabase = { from: (table: string) => {
    assert.equal(table, "schedule_events");
    return query;
  } };
  const markScheduleEventGoogleConflict = loadIsolatedGoogleFunction<(
    connection: Record<string, unknown>,
    scheduleEventId: string,
    link: Record<string, unknown> | null,
  ) => Promise<boolean>>(
    "supabase/functions/_shared/google-calendar.ts",
    "markScheduleEventGoogleConflict",
    { supabase, GOOGLE_CALENDAR_CONFLICT_MESSAGE },
  );
  const upsert = loadIsolatedGoogleFunction<(
    connection: Record<string, unknown>,
    event: Record<string, unknown>,
    timeZone: string,
  ) => Promise<unknown>>(
    "supabase/functions/_shared/google-calendar.ts",
    "upsertGoogleEventIntoSchedule",
    {
      isForeignVimobGoogleEvent,
      findEventLink: async () => ({ schedule_event_id: eventId, google_etag: '"v1"' }),
      readVimobGoogleEventIdentity,
      identityBelongsToOrganization,
      googleEventToSchedule: () => ({ title: "Editado no Google", description: "Texto remoto" }),
      findScheduleEventForConnection: async () => ({ event: { ...localEvent }, authority: "owner" }),
      isFinalVimobScheduleStatus: () => false,
      decideGooglePullForLocalEvent,
      hasRunningOutboundJob: async () => false,
      GOOGLE_CALENDAR_CONFLICT_MESSAGE,
      markScheduleEventGoogleConflict,
      supabase,
      upsertEventLink: async () => { linkWrites += 1; },
    },
  );

  await upsert(
    { organization_id: organizationId, user_id: localEvent.user_id },
    { id: "google-event-a", status: "confirmed", etag: '"v2"' },
    "America/Sao_Paulo",
  );
  assert.equal(localEvent.title, "Editado no Vimob");
  assert.equal(localEvent.description, "Texto local ainda não enviado");
  assert.equal(localEvent.google_sync_status, "conflict");
  assert.equal(localEvent.google_sync_error, GOOGLE_CALENDAR_CONFLICT_MESSAGE);
  assert.equal(updates.some((row) => "title" in row || "description" in row), false);
  assert.equal(linkWrites, 0);
});

test("never processes queued Google-to-Vimob or watch jobs", async () => {
  const organizationA = "c0b1c2d3-e4f5-6789-abcd-ef0123456789";
  const organizationB = "e0b1c2d3-e4f5-6789-abcd-ef0123456789";
  let pullCalls = 0;
  let watchCalls = 0;
  const processJob = loadIsolatedGoogleFunction<(
    job: Record<string, unknown>,
  ) => Promise<unknown>>(
    "supabase/functions/_shared/google-calendar.ts",
    "processSyncJob",
    {
      getConnectionById: async () => ({ organization_id: organizationA, sync_enabled: true }),
      googleCalendarOrganizationsMatch,
      syncConnectionFromGoogle: async () => { pullCalls += 1; return { processed: 1 }; },
      ensureGoogleWatch: async () => { watchCalls += 1; return { renewed: true }; },
    },
  );

  for (const action of ["pull_incremental", "full_sync", "renew_watch"]) {
    assert.deepEqual(
      await processJob({ action, connection_id: "connection-a", organization_id: organizationB }),
      { skipped: true, reason: "INBOUND_SYNC_DISABLED" },
    );
  }
  assert.equal(pullCalls, 0);
  assert.equal(watchCalls, 0);
  assert.deepEqual(
    await processJob({ action: "pull_incremental", connection_id: "connection-a", organization_id: organizationA }),
    { skipped: true, reason: "INBOUND_SYNC_DISABLED" },
  );
  assert.equal(pullCalls, 0);
  assert.equal(watchCalls, 0);
});

test("legacy webhook never queues an inbound pull regardless of channel tenant", async () => {
  const organizationA = "c0b1c2d3-e4f5-6789-abcd-ef0123456789";
  const organizationB = "e0b1c2d3-e4f5-6789-abcd-ef0123456789";
  let queued = 0;
  let checkedCapability = 0;
  const handler = loadIsolatedGoogleHandler<(req: Request) => Promise<Response>>(
    "supabase/functions/google-calendar-webhook/index.ts",
    {
      handleOptions: () => null,
      supabase: {
        from: (table: string) => {
          const query = {
            select: () => query,
            eq: () => query,
            is: () => query,
            gt: () => query,
            maybeSingle: async () => ({
              data: table === "google_calendar_channels"
                ? {
                  organization_id: organizationA,
                  connection_id: "connection-a",
                  token_hash: "valid-hash",
                  resource_id: "resource-a",
                }
                : {
                  organization_id: organizationB,
                  user_id: "user-b",
                  sync_enabled: true,
                  disconnected_at: null,
                },
              error: null,
            }),
          };
          return query;
        },
      },
      sha256Hex: async () => "valid-hash",
      constantTimeEqual: (left: string, right: string) => left === right,
      googleCalendarOrganizationsMatch,
      getGoogleScheduleCapability: async () => { checkedCapability += 1; return { allowed: true }; },
      enqueueSyncJob: async () => { queued += 1; },
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
      errorMessage: (error: unknown) => String(error),
    },
  );
  const response = await handler(new Request("https://example.test/google-calendar-webhook", {
    method: "POST",
    headers: {
      "x-goog-channel-id": "channel-a",
      "x-goog-channel-token": "secret",
      "x-goog-resource-id": "resource-a",
    },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    ignored: true,
    reason: "INBOUND_SYNC_DISABLED",
  });
  assert.equal(checkedCapability, 0);
  assert.equal(queued, 0);
});

test("legacy webhook never queues an inbound pull for a connected user", async () => {
  const userB = "b0b1c2d3-e4f5-6789-abcd-ef0123456789";
  const organizationB = "e0b1c2d3-e4f5-6789-abcd-ef0123456789";
  let queued = 0;
  let checkedCapability = 0;
  const handler = loadIsolatedGoogleHandler<(req: Request) => Promise<Response>>(
    "supabase/functions/google-calendar-webhook/index.ts",
    {
      handleOptions: () => null,
      supabase: {
        from: (table: string) => {
          const query = {
            select: () => query,
            eq: () => query,
            is: () => query,
            gt: () => query,
            maybeSingle: async () => ({
              data: table === "google_calendar_channels"
                ? {
                  organization_id: organizationB,
                  connection_id: "connection-b",
                  token_hash: "valid-hash",
                  resource_id: "resource-b",
                }
                : {
                  organization_id: organizationB,
                  user_id: userB,
                  sync_enabled: true,
                  disconnected_at: null,
                },
              error: null,
            }),
          };
          return query;
        },
      },
      sha256Hex: async () => "valid-hash",
      constantTimeEqual: (left: string, right: string) => left === right,
      googleCalendarOrganizationsMatch,
      getGoogleScheduleCapability: async () => { checkedCapability += 1; return { allowed: true }; },
      enqueueSyncJob: async () => { queued += 1; },
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
      errorMessage: (error: unknown) => String(error),
    },
  );
  const response = await handler(new Request("https://example.test/google-calendar-webhook", {
    method: "POST",
    headers: {
      "x-goog-channel-id": "channel-b",
      "x-goog-channel-token": "secret",
      "x-goog-resource-id": "resource-b",
    },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    ignored: true,
    reason: "INBOUND_SYNC_DISABLED",
  });
  assert.equal(checkedCapability, 0);
  assert.equal(queued, 0);
});

test("OAuth callback rejects revoked Agenda access before exchanging a code", async () => {
  let exchanged = 0;
  const handler = loadIsolatedGoogleHandler<(req: Request) => Promise<Response>>(
    "supabase/functions/google-calendar-oauth/index.ts",
    {
      handleOptions: () => null,
      consumeOAuthState: async () => ({ user_id: "user-a", organization_id: "organization-a", return_url: null }),
      getUserProfile: async () => ({ id: "user-a", organization_id: "organization-a" }),
      getGoogleScheduleCapability: async () => ({ allowed: false, reason: "MEMBERSHIP_REQUIRED", status: 403 }),
      callbackError: (message: string) => new Response(message, { status: 400 }),
      exchangeOAuthCode: async () => { exchanged += 1; throw new Error("Must not exchange revoked code"); },
      errorMessage: (error: unknown) => String(error),
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    },
  );
  const response = await handler(new Request("https://example.test/google-calendar-oauth/callback?state=state-a&code=code-a"));
  assert.equal(response.status, 400);
  assert.match(await response.text(), /Acesso a Agenda revogado/);
  assert.equal(exchanged, 0);
});

test("OAuth start rejects users without Agenda capability before creating a state", async () => {
  let statesCreated = 0;
  const handler = loadIsolatedGoogleHandler<(req: Request) => Promise<Response>>(
    "supabase/functions/google-calendar-oauth/index.ts",
    {
      handleOptions: () => null,
      authenticateUser: async () => ({ id: "user-a" }),
      getUserProfile: async () => ({ id: "user-a", organization_id: "organization-a" }),
      getGoogleScheduleCapability: async () => ({ allowed: false, reason: "AGENDA_MODULE_DISABLED", status: 403 }),
      createOAuthState: async () => { statesCreated += 1; return "state-a"; },
      errorMessage: (error: unknown) => String(error),
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    },
  );
  const response = await handler(new Request("https://example.test/google-calendar-oauth", {
    method: "POST",
    body: JSON.stringify({ action: "get_auth_url" }),
  }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "AGENDA_MODULE_DISABLED",
    code: "AGENDA_MODULE_DISABLED",
  });
  assert.equal(statesCreated, 0);
});

test("OAuth start creates consent URL for an authorized pilot user", async () => {
  let statesCreated = 0;
  const pilotUserId = "b0b1c2d3-e4f5-6789-abcd-ef0123456789";
  const handler = loadIsolatedGoogleHandler<(req: Request) => Promise<Response>>(
    "supabase/functions/google-calendar-oauth/index.ts",
    {
      handleOptions: () => null,
      authenticateUser: async () => ({ id: pilotUserId }),
      getUserProfile: async () => ({ id: pilotUserId, organization_id: "organization-b" }),
      getGoogleScheduleCapability: async () => ({ allowed: true }),
      connectGate: (userId: string) => resolveGoogleCalendarConnectGate(userId, "pilot", pilotUserId),
      createOAuthState: async () => { statesCreated += 1; return "state-b"; },
      buildGoogleAuthUrl: (state: string) => `https://accounts.google.test/auth?state=${state}`,
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
      errorMessage: (error: unknown) => String(error),
    },
  );
  const response = await handler(new Request("https://example.test/google-calendar-oauth", {
    method: "POST",
    body: JSON.stringify({ action: "get_auth_url", organization_id: "organization-b" }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    auth_url: "https://accounts.google.test/auth?state=state-b",
  });
  assert.equal(statesCreated, 1);
});

test("OAuth pilot refuses an unlisted Vimob user before creating state", async () => {
  const userId = "a0b1c2d3-e4f5-6789-abcd-ef0123456789";
  const pilotUserId = "b0b1c2d3-e4f5-6789-abcd-ef0123456789";
  let statesCreated = 0;
  const handler = loadIsolatedGoogleHandler<(req: Request) => Promise<Response>>(
    "supabase/functions/google-calendar-oauth/index.ts",
    {
      handleOptions: () => null,
      authenticateUser: async () => ({ id: userId }),
      getUserProfile: async () => ({ id: userId, organization_id: "organization-a" }),
      getGoogleScheduleCapability: async () => ({ allowed: true }),
      connectGate: (id: string) => resolveGoogleCalendarConnectGate(id, "pilot", pilotUserId),
      connectGateMessage: () => "Piloto restrito",
      createOAuthState: async () => { statesCreated += 1; return "state-a"; },
      errorMessage: (error: unknown) => String(error),
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    },
  );
  const response = await handler(new Request("https://example.test/google-calendar-oauth", {
    method: "POST",
    body: JSON.stringify({ action: "get_auth_url" }),
  }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "Piloto restrito",
    code: "GOOGLE_CALENDAR_PILOT_ONLY",
  });
  assert.equal(statesCreated, 0);
});

test("OAuth callback refuses a user removed from the pilot before exchanging code", async () => {
  const userId = "a0b1c2d3-e4f5-6789-abcd-ef0123456789";
  let exchanged = 0;
  const handler = loadIsolatedGoogleHandler<(req: Request) => Promise<Response>>(
    "supabase/functions/google-calendar-oauth/index.ts",
    {
      handleOptions: () => null,
      consumeOAuthState: async () => ({ user_id: userId, organization_id: "organization-a", return_url: null }),
      getUserProfile: async () => ({ id: userId, organization_id: "organization-a" }),
      getGoogleScheduleCapability: async () => ({ allowed: true }),
      connectGate: (id: string) => resolveGoogleCalendarConnectGate(id, "disabled", userId),
      connectGateMessage: () => "Conexoes desativadas",
      callbackError: (message: string) => new Response(message, { status: 400 }),
      exchangeOAuthCode: async () => { exchanged += 1; throw new Error("Must not exchange blocked code"); },
      errorMessage: (error: unknown) => String(error),
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    },
  );
  const response = await handler(new Request("https://example.test/google-calendar-oauth/callback?state=state-a&code=code-a"));
  assert.equal(response.status, 400);
  assert.match(await response.text(), /Conexoes desativadas/);
  assert.equal(exchanged, 0);
});

test("OAuth status stays readable while a user without Agenda access cannot start consent", async () => {
  const userB = "b0b1c2d3-e4f5-6789-abcd-ef0123456789";
  let statesCreated = 0;
  let disconnects = 0;
  const handler = loadIsolatedGoogleHandler<(req: Request) => Promise<Response>>(
    "supabase/functions/google-calendar-oauth/index.ts",
    {
      handleOptions: () => null,
      authenticateUser: async () => ({ id: userB }),
      getUserProfile: async () => ({ id: userB, organization_id: "organization-b" }),
      getGoogleScheduleCapability: async () => ({ allowed: false, reason: "SCHEDULE_MANAGE_REQUIRED", status: 403 }),
      connectGate: (userId: string) => resolveGoogleCalendarConnectGate(userId, "pilot", userB),
      getConnectionForUser: async () => null,
      getConnectionById: async () => ({ id: "connection-b", user_id: userB, organization_id: "organization-b" }),
      disconnectConnection: async () => { disconnects += 1; },
      createOAuthState: async () => { statesCreated += 1; return "state"; },
      errorMessage: (error: unknown) => String(error),
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    },
  );
  const invoke = (action: string) => handler(new Request("https://example.test/google-calendar-oauth", {
    method: "POST",
    body: JSON.stringify({ action, connection_id: "connection-b" }),
  }));
  const status = await invoke("status");
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), {
    success: true,
    can_connect: false,
    can_use_schedule: false,
    connect_restriction: "SCHEDULE_ACCESS_REQUIRED",
    connection: null,
  });
  const start = await invoke("get_auth_url");
  assert.equal(start.status, 403);
  assert.deepEqual(await start.json(), {
    success: false,
    error: "SCHEDULE_MANAGE_REQUIRED",
    code: "SCHEDULE_MANAGE_REQUIRED",
  });
  assert.equal(statesCreated, 0);
  const disconnected = await invoke("disconnect");
  assert.equal(disconnected.status, 200);
  assert.equal(disconnects, 1);
});

test("OAuth status reports connection eligibility for an authorized pilot user", async () => {
  const userA = "a0b1c2d3-e4f5-6789-abcd-ef0123456789";
  const handler = loadIsolatedGoogleHandler<(req: Request) => Promise<Response>>(
    "supabase/functions/google-calendar-oauth/index.ts",
    {
      handleOptions: () => null,
      authenticateUser: async () => ({ id: userA }),
      getUserProfile: async () => ({ id: userA, organization_id: "organization-a" }),
      getGoogleScheduleCapability: async () => ({ allowed: true }),
      connectGate: (userId: string) => resolveGoogleCalendarConnectGate(userId, "pilot", userA),
      getConnectionForUser: async () => null,
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
      errorMessage: (error: unknown) => String(error),
    },
  );
  const response = await handler(new Request("https://example.test/google-calendar-oauth", {
    method: "POST",
    body: JSON.stringify({ action: "status" }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    can_connect: true,
    can_use_schedule: true,
    connect_restriction: null,
    connection: null,
  });
});

test("existing connection status and disconnect remain available when new OAuth is disabled", async () => {
  const userId = "a0b1c2d3-e4f5-6789-abcd-ef0123456789";
  const connection = {
    id: "connection-a", user_id: userId, organization_id: "organization-a",
    account_email: "existing@example.test", sync_status: "connected",
  };
  let disconnects = 0;
  const handler = loadIsolatedGoogleHandler<(req: Request) => Promise<Response>>(
    "supabase/functions/google-calendar-oauth/index.ts",
    {
      handleOptions: () => null,
      authenticateUser: async () => ({ id: userId }),
      getUserProfile: async () => ({ id: userId, organization_id: "organization-a" }),
      getGoogleScheduleCapability: async () => ({ allowed: true }),
      connectGate: (id: string) => resolveGoogleCalendarConnectGate(id, "disabled", userId),
      getConnectionForUser: async () => connection,
      getConnectionById: async () => connection,
      disconnectConnection: async () => { disconnects += 1; },
      errorMessage: (error: unknown) => String(error),
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    },
  );
  const invoke = (action: string) => handler(new Request("https://example.test/google-calendar-oauth", {
    method: "POST",
    body: JSON.stringify({ action, connection_id: connection.id }),
  }));
  const status = await invoke("status");
  assert.equal(status.status, 200);
  const payload = await status.json();
  assert.equal(payload.can_connect, false);
  assert.equal(payload.can_use_schedule, true);
  assert.equal(payload.connect_restriction, "GOOGLE_CALENDAR_CONNECT_DISABLED");
  assert.equal(payload.connection.id, connection.id);
  const disconnected = await invoke("disconnect");
  assert.equal(disconnected.status, 200);
  assert.equal(disconnects, 1);
});

test("OAuth callback connects without importing Google events or creating a watch", async () => {
  let imports = 0;
  let watches = 0;
  const handler = loadIsolatedGoogleHandler<(req: Request) => Promise<Response>>(
    "supabase/functions/google-calendar-oauth/index.ts",
    {
      handleOptions: () => null,
      consumeOAuthState: async () => ({
        user_id: "user-a",
        organization_id: "organization-a",
        return_url: "https://app.example.test/settings",
      }),
      getUserProfile: async () => ({ id: "user-a", organization_id: "organization-a" }),
      getGoogleScheduleCapability: async () => ({ allowed: true }),
      connectGate: () => ({ allowed: true, restriction: null }),
      exchangeOAuthCode: async () => ({ access_token: "access" }),
      fetchGoogleUserInfo: async () => ({ email: "user@example.test" }),
      upsertConnectionFromOAuth: async () => ({ id: "connection-a" }),
      syncConnectionFromGoogle: async () => { imports += 1; },
      ensureGoogleWatch: async () => { watches += 1; },
      redirectResponse: (url: string) => new Response(null, { status: 302, headers: { Location: url } }),
      callbackError: (message: string) => new Response(message, { status: 400 }),
      errorMessage: (error: unknown) => String(error),
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    },
  );
  const response = await handler(new Request("https://example.test/google-calendar-oauth/callback?state=state-a&code=code-a"));
  assert.equal(response.status, 302);
  assert.equal(imports, 0);
  assert.equal(watches, 0);
  const destination = new URL(response.headers.get("Location") || "");
  assert.equal(destination.searchParams.get("google_calendar_connected"), "1");
  assert.equal(destination.searchParams.has("google_calendar_warning"), false);
});

test("disconnect waits for outbound work before revoking a Google token", async () => {
  class GoogleCalendarDisconnectPendingError extends Error {}
  let pending = true;
  let stopped = 0;
  let revoked = 0;
  const disconnect = loadIsolatedGoogleFunction<(
    connection: Record<string, unknown>,
  ) => Promise<void>>(
    "supabase/functions/_shared/google-calendar.ts",
    "disconnectConnection",
    {
      GoogleCalendarDisconnectPendingError,
      supabase: {
        from: () => {
          const query = {
            select: () => query,
            eq: () => query,
            in: () => query,
            contains: () => query,
            limit: () => query,
            maybeSingle: async () => ({ data: pending ? { id: "job-a" } : null, error: null }),
          };
          return query;
        },
        rpc: async () => { revoked += 1; return { error: null }; },
      },
      stopGoogleWatches: async () => { stopped += 1; },
      readTokenSecret: async () => null,
    },
  );
  const connection = { id: "connection-a", user_id: "owner-a", organization_id: "organization-a" };
  await assert.rejects(disconnect(connection), GoogleCalendarDisconnectPendingError);
  assert.equal(stopped, 0);
  assert.equal(revoked, 0);
  pending = false;
  await disconnect(connection);
  assert.equal(stopped, 1);
  assert.equal(revoked, 1);
});

test("OAuth disconnect reports pending outbound work as a retryable 409", async () => {
  class GoogleCalendarDisconnectPendingError extends Error {}
  const handler = loadIsolatedGoogleHandler<(req: Request) => Promise<Response>>(
    "supabase/functions/google-calendar-oauth/index.ts",
    {
      handleOptions: () => null,
      authenticateUser: async () => ({ id: "owner-a" }),
      getUserProfile: async () => ({ id: "owner-a", organization_id: "organization-a" }),
      getConnectionForUser: async () => ({ id: "connection-a", user_id: "owner-a", organization_id: "organization-a" }),
      disconnectConnection: async () => { throw new GoogleCalendarDisconnectPendingError("Aguarde a sincronizacao."); },
      GoogleCalendarDisconnectPendingError,
      console: { error: () => undefined },
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
      errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
    },
  );
  const response = await handler(new Request("https://example.test/google-calendar-oauth", {
    method: "POST",
    body: JSON.stringify({ action: "disconnect" }),
  }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "GOOGLE_CALENDAR_SYNC_PENDING");
});

test("legacy pause request cannot silently disable one-way delivery", async () => {
  const handler = loadIsolatedGoogleHandler<(req: Request) => Promise<Response>>(
    "supabase/functions/google-calendar-oauth/index.ts",
    {
      handleOptions: () => null,
      authenticateUser: async () => ({ id: "owner-a" }),
      getUserProfile: async () => ({ id: "owner-a", organization_id: "organization-a" }),
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
      errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
    },
  );
  const response = await handler(new Request("https://example.test/google-calendar-oauth", {
    method: "POST",
    body: JSON.stringify({ action: "set_sync_enabled", sync_enabled: false }),
  }));
  assert.equal(response.status, 410);
  assert.equal((await response.json()).code, "ONE_WAY_SYNC_CONTROL_UNSUPPORTED");
});

test("manual inbound sync is disabled while existing outbound push remains available", async () => {
  const userB = "b0b1c2d3-e4f5-6789-abcd-ef0123456789";
  const organizationB = "e0b1c2d3-e4f5-6789-abcd-ef0123456789";
  let pulled = 0;
  let pushed = 0;
  const handler = loadIsolatedGoogleHandler<(req: Request) => Promise<Response>>(
    "supabase/functions/google-calendar-sync/index.ts",
    {
      handleOptions: () => null,
      authenticateServiceOrUser: async () => ({
        service: false,
        profile: { id: userB, organization_id: organizationB },
      }),
      requireUserScheduleManage: async () => null,
      getConnectionById: async () => ({ id: "connection-b", user_id: userB, organization_id: organizationB }),
      syncConnectionFromGoogle: async () => { pulled += 1; },
      supabase: { from: () => {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: { organization_id: organizationB, user_id: userB }, error: null }),
        };
        return query;
      } },
      pushScheduleEventToGoogle: async () => { pushed += 1; return { synced: true }; },
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
      errorMessage: (error: unknown) => String(error),
    },
  );
  const invoke = (action: string) => handler(new Request("https://example.test/google-calendar-sync", {
    method: "POST",
    body: JSON.stringify({ action, connection_id: "connection-b", event_id: "event-b" }),
  }));
  const inbound = await invoke("sync_connection");
  assert.equal(inbound.status, 410);
  assert.equal((await inbound.json()).code, "INBOUND_SYNC_DISABLED");
  assert.equal(pulled, 0);
  const outbound = await invoke("push_upsert");
  assert.equal(outbound.status, 200);
  assert.equal(pushed, 1);
});

test("direct outbound push rejects an event outside the requested organization", async () => {
  let pushed = 0;
  const handler = loadIsolatedGoogleHandler<(req: Request) => Promise<Response>>(
    "supabase/functions/google-calendar-sync/index.ts",
    {
      handleOptions: () => null,
      authenticateServiceOrUser: async () => ({
        service: false,
        profile: { id: "manager-a", organization_id: "organization-a" },
      }),
      requireUserScheduleManage: async () => null,
      supabase: { from: () => {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({
            data: { organization_id: "organization-b", user_id: "owner-b" },
            error: null,
          }),
        };
        return query;
      } },
      pushScheduleEventToGoogle: async () => { pushed += 1; },
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
      errorMessage: (error: unknown) => String(error),
    },
  );
  const response = await handler(new Request("https://example.test/google-calendar-sync", {
    method: "POST",
    body: JSON.stringify({ action: "push_upsert", event_id: "event-b" }),
  }));
  assert.equal(response.status, 404);
  assert.equal(pushed, 0);
});

test("direct delete cannot remove Google while the Vimob event still exists", async () => {
  const handler = loadIsolatedGoogleHandler<(req: Request) => Promise<Response>>(
    "supabase/functions/google-calendar-sync/index.ts",
    {
      handleOptions: () => null,
      authenticateServiceOrUser: async () => ({ service: false, profile: { id: "owner-a", organization_id: "organization-a" } }),
      requireUserScheduleManage: async () => null,
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
      errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
    },
  );
  for (const body of [
    { action: "push_delete", event_id: "event-a" },
    { action: "enqueue_event", sync_action: "push_delete", event_id: "event-a" },
  ]) {
    const response = await handler(new Request("https://example.test/google-calendar-sync", {
      method: "POST",
      body: JSON.stringify(body),
    }));
    assert.equal(response.status, 410);
    assert.equal((await response.json()).code, "DELETE_THROUGH_VIMOB_ONLY");
  }
});

test("invalid_grant marks a connection for reconnection without replacing its Vault token", async () => {
  const updates: Array<Record<string, unknown>> = [];
  let tokenWrites = 0;
  const refresh = loadIsolatedGoogleFunction<(
    connection: Record<string, unknown>,
  ) => Promise<unknown>>(
    "supabase/functions/_shared/google-calendar.ts",
    "refreshAccessToken",
    {
      readTokenSecret: async () => ({
        access_token: "expired-access",
        refresh_token: "stored-refresh",
        expires_at: "2020-01-01T00:00:00.000Z",
      }),
      getGoogleOAuthConfig: () => ({ clientId: "client-id", clientSecret: "client-secret" }),
      GOOGLE_TOKEN_URL: "https://oauth2.googleapis.com/token",
      fetch: async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      supabase: {
        from: () => ({
          update: (row: Record<string, unknown>) => {
            updates.push(row);
            return { eq: async () => ({ error: null }) };
          },
        }),
      },
      saveTokenSecret: async () => { tokenWrites += 1; },
    },
  );
  await assert.rejects(
    refresh({ id: "connection-a", token_secret_ref: "secret-a" }),
    /Reconecte sua conta/,
  );
  assert.equal(tokenWrites, 0);
  assert.deepEqual(updates, [{
    sync_status: "error",
    last_error: "Autorizacao Google expirada ou revogada. Reconecte sua conta.",
  }]);
});

test("keeps legacy private Vimob identities without accepting malformed ids", () => {
  const legacyCopy = {
    extendedProperties: {
      private: {
        vimob_event_id: "a0b1c2d3-e4f5-6789-abcd-ef0123456789",
        vimob_organization_id: "c0b1c2d3-e4f5-6789-abcd-ef0123456789",
        vimob_user_id: "d0b1c2d3-e4f5-6789-abcd-ef0123456789",
        vimob_event_type: "meeting",
      },
    },
  };

  assert.deepEqual(readVimobGoogleEventIdentity(legacyCopy), {
    eventId: "a0b1c2d3-e4f5-6789-abcd-ef0123456789",
    organizationId: "c0b1c2d3-e4f5-6789-abcd-ef0123456789",
    ownerUserId: "d0b1c2d3-e4f5-6789-abcd-ef0123456789",
    eventType: "meeting",
    source: "private",
  });
  assert.equal(readVimobGoogleEventIdentity({
    extendedProperties: {
      shared: {
        vimob_event_id: "not-a-uuid",
        vimob_organization_id: "c0b1c2d3-e4f5-6789-abcd-ef0123456789",
        vimob_user_id: "d0b1c2d3-e4f5-6789-abcd-ef0123456789",
      },
    },
  }), null);
});

test("requires billing, Agenda module and effective schedule_manage for user sync", () => {
  const now = new Date("2026-09-12T12:00:00.000Z");
  const allowed = {
    organizationActive: true,
    moduleEnabled: true,
    billing: { subscription_type: "paid", subscription_status: "active" },
    isSuperAdmin: false,
    activeMembership: true,
    membershipRole: "user",
    permissionOverride: null,
    defaultScheduleManage: true,
  } as const;

  assert.equal(resolveGoogleScheduleCapability(allowed, now).allowed, true);
  assert.deepEqual(resolveGoogleScheduleCapability({
    ...allowed,
    moduleEnabled: false,
  }, now), { allowed: false, reason: "AGENDA_MODULE_DISABLED", status: 403 });
  assert.deepEqual(resolveGoogleScheduleCapability({
    ...allowed,
    permissionOverride: false,
  }, now), { allowed: false, reason: "SCHEDULE_MANAGE_REQUIRED", status: 403 });
  assert.deepEqual(resolveGoogleScheduleCapability({
    ...allowed,
    billing: {
      subscription_type: "trial",
      subscription_status: "trial",
      trial_ends_at: "2026-09-11T12:00:00.000Z",
    },
  }, now), { allowed: false, reason: "BILLING_ACCESS_REQUIRED", status: 402 });
});

test("keeps Vimob attendance outcomes final when Google syncs the linked event", () => {
  for (const status of ["completed", "no_show", "cancelled", "canceled"]) {
    assert.equal(isFinalVimobScheduleStatus(status), true);
  }
  assert.equal(isFinalVimobScheduleStatus("scheduled"), false);
  assert.equal(isFinalVimobScheduleStatus(undefined), false);

  const sharedSource = readFileSync(
    resolve(process.cwd(), "supabase/functions/_shared/google-calendar.ts"),
    "utf8",
  );
  assert.match(sharedSource, /isFinalVimobScheduleStatus\(currentEvent\.status\)/);
  assert.match(sharedSource, /preserveFinalScheduleLifecycle/);
  assert.match(sharedSource, /\.eq\("status", "scheduled"\)/);
  assert.match(sharedSource, /applyGoogleCancellationToSchedule/);
  assert.match(sharedSource, /authority !== "owner"/);
  assert.match(sharedSource, /resolved_by: "ical_uid"/);
  assert.match(sharedSource, /buildVimobGoogleExtendedProperties\(event\)/);
});

test("persists one link per Google connection without letting attendee copies rewrite the event", () => {
  const sharedSource = readFileSync(
    resolve(process.cwd(), "supabase/functions/_shared/google-calendar.ts"),
    "utf8",
  );
  assert.match(sharedSource, /findScheduleEventForConnection/);
  assert.match(sharedSource, /access\?\.authority === "assignee"/);
  assert.match(sharedSource, /scheduleEvent = access\.event/);
  assert.match(sharedSource, /connection_id: params\.connection\.id/);
  assert.match(sharedSource, /google_ical_uid: params\.googleEvent\.iCalUID/);
  assert.match(sharedSource, /\.eq\("organization_id", connection\.organization_id\)/);
});

test("guards every user-triggered Google Agenda mutation with schedule_manage", () => {
  const syncSource = readFileSync(
    resolve(process.cwd(), "supabase/functions/google-calendar-sync/index.ts"),
    "utf8",
  );
  const guardCalls = syncSource.match(/requireUserScheduleManage\(auth\.profile\)/g) || [];
  assert.equal(guardCalls.length, 2);
  assert.match(syncSource, /action === "push_delete"[\s\S]*?DELETE_THROUGH_VIMOB_ONLY/);
  assert.match(syncSource, /GoogleScheduleCapabilityError/);
  assert.match(syncSource, /capability\.status/);
});

test("durable outbound jobs bind to tenant and owner, not a revoked audit actor", () => {
  const sharedSource = readFileSync(
    resolve(process.cwd(), "supabase/functions/_shared/google-calendar.ts"),
    "utf8",
  );

  assert.match(
    sharedSource,
    /pushScheduleEventToGoogle\(job\.schedule_event_id, job\.created_by \|\| null, \{\s*trustedJobOrganizationId: job\.organization_id,/,
  );
  assert.match(
    sharedSource,
    /deleteScheduleEventFromGoogle\([\s\S]*?trustedJobOrganizationId: job\.organization_id,[\s\S]*?fallbackOwnerUserId: job\.payload\?\.owner_user_id/,
  );
  assert.match(sharedSource, /event\.organization_id !== trustedJobOrganizationId/);
  assert.match(sharedSource, /!job\.payload\?\.owner_user_id \|\| job\.payload\.owner_user_id !== currentOwner/);
  assert.match(
    sharedSource,
    /else if \(!actorUserId\) \{\s*await assertGoogleScheduleCapability\(event\.user_id, event\.organization_id\)/,
  );
  assert.match(sharedSource, /Job Google Agenda sem tenant autorizado/);
});

test("compares webhook channel token hashes without an early string comparison", () => {
  const { constantTimeEqual } = loadGoogleCalendarContractHelpers();

  assert.equal(constantTimeEqual("abc123", "abc123"), true);
  assert.equal(constantTimeEqual("abc123", "abc124"), false);
  assert.equal(constantTimeEqual("short", "shorter"), false);
  assert.equal(constantTimeEqual("calendário", "calendário"), true);
});

test("reuses a disconnected Google account and rejects an active account switch", () => {
  const {
    normalizeGoogleAccountEmail,
    selectReusableGoogleCalendarConnection,
  } = loadGoogleCalendarContractHelpers();
  const disconnected = {
    id: "connection-1",
    account_email: "Corretor@Example.com",
    disconnected_at: "2026-09-01T00:00:00.000Z",
  };

  assert.equal(normalizeGoogleAccountEmail(" Corretor@Example.com "), "corretor@example.com");
  assert.equal(
    selectReusableGoogleCalendarConnection([disconnected], "corretor@example.com"),
    disconnected,
  );
  assert.throws(
    () => selectReusableGoogleCalendarConnection([
      { id: "active", account_email: "outra@example.com", disconnected_at: null },
    ], "corretor@example.com"),
    /Desconecte a conta Google atual/,
  );
});

test("keeps the settings integration dialog in the OAuth return URL", () => {
  const buildGoogleCalendarReturnUrl = loadGoogleCalendarReturnUrlBuilder();
  const result = new URL(buildGoogleCalendarReturnUrl(
    "https://app.vimobcrm.com.br/settings?tab=integrations&google_calendar_error=old",
  ));

  assert.equal(result.searchParams.get("tab"), "integrations");
  assert.equal(result.searchParams.get("integration"), "google-calendar");
  assert.equal(result.searchParams.has("google_calendar_error"), false);

  const agendaResult = new URL(buildGoogleCalendarReturnUrl(
    "https://app.vimobcrm.com.br/agenda?google_calendar_warning=old",
  ));
  assert.equal(agendaResult.pathname, "/agenda");
  assert.equal(agendaResult.searchParams.has("google_calendar_warning"), false);
  assert.equal(agendaResult.searchParams.has("integration"), false);
});

test("retires the insecure endpoint and keeps only outbound sync reachable", () => {
  const legacySource = readFileSync(
    resolve(process.cwd(), "supabase/functions/google-calendar-auth/index.ts"),
    "utf8",
  );
  const oauthSource = readFileSync(
    resolve(process.cwd(), "supabase/functions/google-calendar-oauth/index.ts"),
    "utf8",
  );
  const webhookSource = readFileSync(
    resolve(process.cwd(), "supabase/functions/google-calendar-webhook/index.ts"),
    "utf8",
  );
  const sharedSource = readFileSync(
    resolve(process.cwd(), "supabase/functions/_shared/google-calendar.ts"),
    "utf8",
  );
  const syncSource = readFileSync(
    resolve(process.cwd(), "supabase/functions/google-calendar-sync/index.ts"),
    "utf8",
  );
  const clientSource = readFileSync(resolve(process.cwd(), "lib/api/google-calendar.ts"), "utf8");
  const connectSource = readFileSync(
    resolve(process.cwd(), "components/features/schedule/GoogleCalendarConnect.tsx"),
    "utf8",
  );
  const migrationSource = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260907230953_google_calendar_reliability_sweep.sql"),
    "utf8",
  );
  const configSource = readFileSync(resolve(process.cwd(), "supabase/config.toml"), "utf8");

  assert.match(legacySource, /legacy_google_calendar_endpoint_retired/);
  assert.match(legacySource, /\b410\b/);
  assert.doesNotMatch(legacySource, /state\.split|access_token|refresh_token/);
  assert.doesNotMatch(oauthSource, /await syncConnectionFromGoogle|await ensureGoogleWatch/);
  assert.match(oauthSource, /INBOUND_SYNC_DISABLED/);
  assert.match(webhookSource, /INBOUND_SYNC_DISABLED/);
  assert.doesNotMatch(webhookSource, /enqueueSyncJob|schedule_events/);
  assert.match(sharedSource, /googleCalendarInboundDisabled\(\)/);
  assert.match(sharedSource, /google_calendar_claim_outbound_sync_jobs/);
  assert.match(sharedSource, /\["pull_incremental", "full_sync", "renew_watch"\]/);
  assert.match(sharedSource, /requireSyncEnabled: false/);
  assert.match(sharedSource, /google_sync_status: "conflict"/);
  assert.match(sharedSource, /durableLinkIds/);
  assert.match(syncSource, /enqueue_due_pulls/);
  assert.match(syncSource, /executeSyncJob/);
  assert.match(syncSource, /google_sync_status: "pending"/);
  assert.match(syncSource, /DELETE_THROUGH_VIMOB_ONLY/);
  assert.match(clientSource, /organizationId: requireOrganizationId\(organizationId\)/);
  assert.doesNotMatch(clientSource, /action: "sync_now"|action: "sync_connection"/);
  assert.match(connectSource, /refetchStatus/);
  assert.match(migrationSource, /google-calendar-enqueue-due-pulls/);
  assert.match(migrationSource, /reconcile_google_calendar_cron_jobs/);
  assert.match(migrationSource, /on delete set null/);
  assert.match(configSource, /\[functions\.google-calendar-auth\]\s+verify_jwt = true/);
});
