import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function readScheduleSource(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("routes attendance appointment timing changes through explicit rescheduling", () => {
  const sheetSource = readScheduleSource(
    "components/features/schedule/EventSheet.tsx",
  );
  const timingSource = readScheduleSource(
    "components/features/schedule/event-sheet/EventTimingSection.tsx",
  );
  const actionsSource = readScheduleSource(
    "components/features/schedule/event-sheet/EventSheetActions.tsx",
  );

  assert.match(
    sheetSource,
    /preservesAppointmentTiming\s*=\s*isExisting\s*&&\s*requiresAttendanceOutcome/,
  );
  assert.match(
    sheetSource,
    /preserveAppointmentTiming:\s*preservesAppointmentTiming/,
  );
  assert.match(sheetSource, /timingLocked=\{preservesAppointmentTiming\}/);
  assert.match(
    timingSource,
    /Para alterar data ou horário, use “Resultado ou remarcar”/,
  );
  assert.match(timingSource, /value=\{reminderValue\}/);
  assert.match(actionsSource, /"Resultado ou remarcar"/);
});

test("keeps calendar drag and resize away from attendance appointments", () => {
  const calendarSource = readScheduleSource(
    "components/features/schedule/CalendarView.tsx",
  );

  assert.match(calendarSource, /const isEventTimingEditable = useCallback/);
  assert.match(
    calendarSource,
    /!isAttendanceScheduleType\(event\.event_type\)/,
  );
  assert.match(
    calendarSource,
    /if \(!isEventTimingEditable\(scheduleEvent\)\) return/,
  );
  assert.doesNotMatch(calendarSource, /editable=\{isEventEditable\(event\)\}/);
});
