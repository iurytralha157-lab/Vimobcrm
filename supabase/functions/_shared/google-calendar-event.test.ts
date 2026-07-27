import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleEventAttendees,
  buildGoogleEventDescription,
  buildGoogleEventSummary,
} from "./google-calendar-event";

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
