import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const calendarSource = readFileSync(
  resolve(process.cwd(), "components/features/schedule/CalendarView.tsx"),
  "utf8",
);

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
  assert.match(calendarSource, /event\.title\.trim\(\)\s*\|\|/);
  assert.match(calendarSource, /eventTypeLabels\[event\.event_type\]/);
  assert.match(calendarSource, /data-calendar-event-density=\{density\}/);
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
  assert.match(calendarSource, /timeZone:\s*string/);
  assert.match(calendarSource, /timeZone,\s*now:\s*lifecycleNow/);
  assert.equal(calendarSource.match(/timeZone=\{timeZone\}/g)?.length, 4);
});
