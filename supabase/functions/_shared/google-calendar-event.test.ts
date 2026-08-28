import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  buildGoogleEventAttendees,
  buildGoogleEventDescription,
  buildGoogleEventSummary,
} from "./google-calendar-event";

type GoogleCalendarUrlBuilder = (path: string) => string;

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
});
