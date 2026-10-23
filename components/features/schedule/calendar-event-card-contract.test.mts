import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  getScheduleDisplayLifecycle,
  getScheduleDisplayTitle,
} from "./schedule-event-presentation";

const calendarSource = readFileSync(
  resolve(process.cwd(), "components/features/schedule/CalendarView.tsx"),
  "utf8",
);
const calendarAst = ts.createSourceFile("CalendarView.tsx", calendarSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findCalendarCalls(name: string) {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(calendarAst);
  return calls;
}

test("puts the appointment title before compact time metadata", () => {
  const compactStart = calendarSource.indexOf('density === "compact"');
  const compactEnd = calendarSource.indexOf("return (", compactStart + 1);
  const nextReturn = calendarSource.indexOf("return (", compactEnd + 1);
  const compactCard = calendarSource.slice(compactEnd, nextReturn);

  assert.ok(compactStart >= 0);
  assert.ok(compactCard.indexOf("data-calendar-event-title") >= 0);
  assert.ok(
    compactCard.indexOf("data-calendar-event-title") <
      compactCard.indexOf("data-calendar-event-time"),
  );
  assert.match(compactCard, /!isNarrow\s*&&/);
  assert.match(compactCard, /data-calendar-event-resize-handle/);
  assert.match(compactCard, /displayedDuration > 20/);
});

test("falls back to the real appointment type when a title is empty", () => {
  const labels = { call: "Ligação", email: "E-mail", meeting: "Reunião", task: "Tarefa", message: "Mensagem", visit: "Visita" };
  for (const [event_type, label] of Object.entries(labels)) {
    assert.equal(getScheduleDisplayTitle({ title: "  ", event_type }), label);
    assert.equal(getScheduleDisplayTitle({ title: "  Nome do compromisso  ", event_type }), "Nome do compromisso");
    assert.equal(getScheduleDisplayTitle({ title: "Nome privado", event_type, is_masked: true }), "Horário ocupado");
  }
  for (const event_type of [null, "unknown", "__proto__"]) assert.equal(getScheduleDisplayTitle({ title: "", event_type }), "Compromisso");
  assert.ok(findCalendarCalls("getScheduleDisplayTitle").some(call => ts.isVariableDeclaration(call.parent) && call.parent.name.getText(calendarAst) === "activityTitle" && call.arguments[0]?.getText(calendarAst) === "event"), "the rendered calendar card consumes the title policy");
});

test("short consecutive appointments keep their real slot height", () => {
  assert.doesNotMatch(calendarSource, /minHeight:\s*["']28px["']/);
  assert.equal(
    calendarSource.match(/minHeight: `\$\{Math\.min\(28, height\)\}px`/g)
      ?.length,
    2,
  );
});

test("isolates pointer resize from drag and handles every terminal pointer path", () => {
  const resizeStart = calendarSource.indexOf("const handleResizePointerDown");
  const cardClickStart = calendarSource.indexOf(
    "const handleCardClick",
    resizeStart,
  );
  const resizeSource = calendarSource.slice(resizeStart, cardClickStart);

  assert.notEqual(resizeStart, -1);
  assert.notEqual(cardClickStart, -1);
  assert.doesNotMatch(calendarSource, /onMouseDown=\{handleResizeMouseDown\}/);
  assert.match(
    calendarSource,
    /const handleResizePointerDown = \(e: React\.PointerEvent<HTMLDivElement>\)/,
  );
  assert.match(
    calendarSource,
    /resize gesture never arms the PointerSensor[\s\S]{0,120}e\.stopPropagation\(\);[\s\S]{0,80}e\.preventDefault\(\);/,
  );
  assert.match(
    calendarSource,
    /document\.addEventListener\("pointermove", onPointerMove, \{[\s\S]{0,100}passive: false/,
  );
  assert.match(
    calendarSource,
    /document\.addEventListener\("pointerup", onPointerUp, true\)/,
  );
  assert.match(
    calendarSource,
    /document\.addEventListener\("pointercancel", onPointerCancel, true\)/,
  );
  assert.match(resizeSource, /finishResize\(true\)/);
  assert.match(resizeSource, /finishResize\(false\)/);
  assert.equal(resizeSource.match(/onEventUpdate\?\.\(/g)?.length, 1);
  assert.doesNotMatch(resizeSource, /setTempHeight\(\(prev\)/);
  assert.equal(
    calendarSource.match(/onPointerDown=\{handleResizePointerDown\}/g)?.length,
    2,
  );
  assert.equal(
    calendarSource.match(/onClick=\{handleResizeClick\}/g)?.length,
    2,
  );
  assert.match(calendarSource, /suppressEditClickRef\.current/);

  const cardClickEnd = calendarSource.indexOf(
    "const handleCardKeyDown",
    cardClickStart,
  );
  const cardClickSource = calendarSource.slice(cardClickStart, cardClickEnd);
  assert.ok(
    cardClickSource.indexOf("suppressEditClickRef.current") <
      cardClickSource.indexOf("onEditEvent?.(event)"),
  );
});

test("exposes coherent keyboard editing without pointer-drag instructions", () => {
  assert.doesNotMatch(calendarSource, /\{\.\.\.attributes\}/);
  assert.equal(
    calendarSource.match(/role=\{onEditEvent \? "button"/g)?.length,
    2,
  );
  assert.equal(calendarSource.match(/tabIndex=\{onEditEvent \? 0/g)?.length, 2);
  assert.equal(
    calendarSource.match(/onKeyDown=\{handleCardKeyDown\}/g)?.length,
    2,
  );
  assert.match(calendarSource, /e\.key !== "Enter" && e\.key !== " "/);
  assert.match(calendarSource, /aria-label=\{onEditEvent \? activityAriaLabel/);
});

test("classifies compact cards in the organization civil timezone", () => {
  const event = { start_time: "2026-10-11T03:00:00.000Z", end_time: "2026-10-12T02:59:59.999Z", is_all_day: true, status: "scheduled", outcome: null };
  const now = Date.parse("2026-10-12T03:00:00.000Z");
  assert.equal(getScheduleDisplayLifecycle(event, "America/Sao_Paulo", now - 1), "open");
  assert.equal(getScheduleDisplayLifecycle(event, "America/Sao_Paulo", now), "overdue");
  assert.equal(getScheduleDisplayLifecycle(event, "UTC", now), "open");
  assert.equal(getScheduleDisplayLifecycle(event, "Asia/Tokyo", now), "open");
  assert.equal(getScheduleDisplayLifecycle({ ...event, status: "completed" }, "America/Sao_Paulo", now), "completed");
  assert.equal(getScheduleDisplayLifecycle({ ...event, is_masked: true }, "America/Sao_Paulo", now), "busy");
  assert.ok(findCalendarCalls("getScheduleDisplayLifecycle").some(call => call.arguments.map(argument => argument.getText(calendarAst)).join("|") === "event|timeZone|lifecycleNow"), "the live calendar card forwards its organization timezone and ticking clock");
});
