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
  isFinalVimobScheduleStatus,
  readVimobGoogleEventIdentity,
  stripVimobLinkedDescription,
} from "./google-calendar-event";
import { resolveGoogleScheduleCapability } from "./google-calendar-access";

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
  assert.equal(guardCalls.length, 4);
  assert.match(syncSource, /GoogleScheduleCapabilityError/);
  assert.match(syncSource, /capability\.status/);
});

test("revalidates trusted backend jobs without collapsing team scope to participation", () => {
  const sharedSource = readFileSync(
    resolve(process.cwd(), "supabase/functions/_shared/google-calendar.ts"),
    "utf8",
  );

  assert.match(
    sharedSource,
    /pushScheduleEventToGoogle\(job\.schedule_event_id, job\.created_by, \{\s*trustedJobOrganizationId: job\.organization_id,/,
  );
  assert.match(
    sharedSource,
    /deleteScheduleEventFromGoogle\([\s\S]*?\{ trustedJobOrganizationId: job\.organization_id \},/,
  );
  assert.match(sharedSource, /event\.organization_id !== trustedJobOrganizationId/);
  assert.match(
    sharedSource,
    /await assertGoogleScheduleCapability\(actorUserId, trustedJobOrganizationId\)/,
  );
  assert.match(
    sharedSource,
    /!trustedJobOrganizationId\s*&&\s*!\(await canManageScheduleEvent\(event, actorUserId\)\)/,
  );
  assert.match(sharedSource, /Job Google Agenda sem tenant ou autor autorizado/);
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

test("retires the insecure legacy endpoint and preserves durable sync contracts", () => {
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
  assert.match(oauthSource, /stopGoogleWatches/);
  assert.match(webhookSource, /constantTimeEqual/);
  assert.match(webhookSource, /SYNC_DISABLED/);
  assert.match(sharedSource, /response\.status === 410 && syncToken/);
  assert.match(sharedSource, /seenGoogleEventIds\.clear\(\)/);
  assert.doesNotMatch(sharedSource, /do \{[\s\S]*response\.status === 410[\s\S]*\} while \(pageToken\)/);
  assert.match(sharedSource, /requireSyncEnabled: false/);
  assert.match(sharedSource, /google_sync_status: "error"/);
  assert.match(sharedSource, /durableLinkIds/);
  assert.match(syncSource, /enqueue_due_pulls/);
  assert.match(syncSource, /executeSyncJob/);
  assert.match(syncSource, /google_sync_status: "pending"/);
  assert.match(syncSource, /link_ids/);
  assert.match(clientSource, /organizationId: requireOrganizationId\(organizationId\)/);
  assert.match(clientSource, /action: "enqueue_event"/);
  assert.match(connectSource, /google_calendar_warning/);
  assert.match(connectSource, /refetchStatus/);
  assert.match(migrationSource, /google-calendar-enqueue-due-pulls/);
  assert.match(migrationSource, /reconcile_google_calendar_cron_jobs/);
  assert.match(migrationSource, /on delete set null/);
  assert.match(configSource, /\[functions\.google-calendar-auth\]\s+verify_jwt = true/);
});
