import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const calendarSource = readFileSync(
  resolve(process.cwd(), "components/features/schedule/CalendarView.tsx"),
  "utf8",
);
const globalStyles = readFileSync(
  resolve(process.cwd(), "app/globals.css"),
  "utf8",
);

test("keeps compact weekly and monthly day headers fixed as full-width soft strips", () => {
  assert.match(
    calendarSource,
    /data-calendar-header="week"[\s\S]{0,140}schedule-calendar-days-header sticky top-0 z-20 flex h-9 shrink-0/,
  );
  assert.match(
    calendarSource,
    /aria-hidden="true"[\s\S]{0,120}h-9 w-16 flex-shrink-0 border-r/,
  );
  assert.match(
    calendarSource,
    /data-calendar-header="month"[\s\S]{0,140}schedule-calendar-days-header sticky top-0 z-20 grid h-8 shrink-0 grid-cols-7/,
  );
  assert.match(
    globalStyles,
    /\.schedule-calendar-days-header \{[\s\S]*?linear-gradient\(var\(--app-surface-soft\), var\(--app-surface-soft\)\),[\s\S]*?var\(--app-surface-solid\)/,
  );
});

test("distinguishes weekends, selected date and today without detaching the header from navigation", () => {
  const weekHeaderStart = calendarSource.indexOf('data-calendar-header="week"');
  const gridStart = calendarSource.indexOf("{/* Grid */}", weekHeaderStart);
  assert.notEqual(weekHeaderStart, -1);
  assert.notEqual(gridStart, -1);
  const weekHeader = calendarSource.slice(weekHeaderStart, gridStart);

  assert.match(weekHeader, /const weekendKind = isWeekend\(day\)/);
  assert.match(weekHeader, /\? "sunday"[\s\S]*?: "saturday"/);
  assert.match(weekHeader, /data-weekend=\{weekendKind\}/);
  assert.match(weekHeader, /data-selected=\{isSelected \|\| undefined\}/);
  assert.match(weekHeader, /data-today=\{isDayToday \|\| undefined\}/);
  assert.match(weekHeader, /aria-current=\{isDayToday \? "date" : undefined\}/);
  assert.match(weekHeader, /aria-pressed=\{isSelected\}/);
  assert.match(
    weekHeader,
    /onClick=\{\(\) => \{[\s\S]*?onDateSelect\(day\);[\s\S]*?onPivotChange\(day\);/,
  );

  assert.match(
    globalStyles,
    /data-weekend="saturday"[\s\S]{0,180}data-weekend="sunday"[\s\S]{0,180}var\(--app-text-primary\) 2\.4%/,
  );
  assert.match(
    globalStyles,
    /data-selected="true"[\s\S]{0,160}var\(--primary\) 9%/,
  );
  assert.match(
    globalStyles,
    /data-today="true"[\s\S]{0,180}\.schedule-calendar-days-header__date[\s\S]{0,140}background: var\(--primary\)/,
  );
});
