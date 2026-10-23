import assert from "node:assert/strict";
import test from "node:test";
import { navigateAgendaPeriod, getAgendaLocalPeriod, getAgendaEventsPage } from "./agenda-period";
import { formatScheduleTimestamp, getSchedulePerformerName } from "./event-sheet/model";

test("month and list navigate civil months including short months", () => {
  for (const mode of ["month", "list"] as const) {
    const next = navigateAgendaPeriod(new Date(2026, 9, 1), mode, 1);
    assert.equal(next.getMonth(), 10);
    assert.equal(next.getDate(), 1);
    const february = navigateAgendaPeriod(new Date(2026, 0, 31), mode, 1);
    assert.equal(february.getMonth(), 1);
    assert.equal(february.getDate(), 28);
  }
  assert.equal(navigateAgendaPeriod(new Date(2024, 1, 29), "year", 1).getMonth(), 1);
});

test("list period matches the displayed month and contains past and future days", () => {
  const { start, end } = getAgendaLocalPeriod(new Date(2026, 9, 12), "list");
  assert.equal(start.getDate(), 1);
  assert.equal(end.getDate(), 31);
  assert.equal(start.getMonth(), 9);
  assert.equal(end.getMonth(), 9);
});

test("event pages keep all statuses and make every event reachable", () => {
  const events = Array.from({ length: 51 }, (_, id) => ({ id, status: id % 2 ? "completed" : "scheduled" }));
  assert.equal(getAgendaEventsPage(events, 20).items.length, 20);
  assert.equal(getAgendaEventsPage(events, 20).hasMore, true);
  const last = getAgendaEventsPage(events, 60);
  assert.deepEqual(last.items, events);
  assert.equal(last.hasMore, false);
  assert.equal(last.total, 51);
});

test("history timestamps use the organization timezone and reject invalid instants", () => {
  assert.equal(formatScheduleTimestamp("2026-10-12T12:00:00.000Z", "America/Sao_Paulo"), "12/10 09:00");
  assert.equal(formatScheduleTimestamp("2026-10-12T12:00:00.000Z", "Europe/Lisbon"), "12/10 13:00");
  assert.equal(formatScheduleTimestamp("invalid"), "Data indisponível");
});

test("the recorder is not presumed to have executed an activity", () => {
  assert.equal(getSchedulePerformerName({ completed_by: "recorder", completed_by_user: { name: "Registrou" } }), null);
  assert.equal(getSchedulePerformerName({ performed_by: "executor", completed_by: "recorder", completed_by_user: { name: "Registrou" } }), null);
  assert.equal(getSchedulePerformerName({ performed_by: "executor", completed_by: "executor", completed_by_user: { name: "Executou" } }), "Executou");
  assert.equal(getSchedulePerformerName({ performed_by: "executor", completed_by: "recorder", performed_by_user: { name: "Executou" }, completed_by_user: { name: "Registrou" } }), "Executou");
});
