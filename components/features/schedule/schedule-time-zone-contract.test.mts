import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

test("Agenda creation and rescheduling use the organization timezone", () => {
  const eventSheet = read("components/features/schedule/EventSheet.tsx");
  const outcomeDialog = read(
    "components/features/schedule/ScheduleOutcomeDialog.tsx",
  );

  assert.match(eventSheet, /useScheduleCapabilities\(/);
  assert.match(eventSheet, /timeZone: scheduleTimeZone/);
  assert.match(eventSheet, /getScheduleCivilDateKey\(/);
  assert.match(eventSheet, /scheduleCivilDateKeyToLocalDate\(/);
  assert.match(eventSheet, /formatScheduleZonedTime\(/);
  assert.match(eventSheet, /timeZone=\{scheduleTimeZone\}/);
  assert.match(outcomeDialog, /getScheduleCivilDayRange\(/);
  assert.match(outcomeDialog, /scheduleCivilDateTimeToDate\(/);
});

test("EventSheet waits for capabilities without resetting an active draft", () => {
  const eventSheet = read("components/features/schedule/EventSheet.tsx");

  assert.match(
    eventSheet,
    /scheduleCapabilitiesQuery\.isSuccess\s*&&\s*Boolean\(scheduleCapabilities\?\.timeZone\)/,
  );
  assert.match(
    eventSheet,
    /initializedDraftIdentityRef\.current\s*===\s*draftIdentity/,
  );
  assert.match(
    eventSheet,
    /if \(!canManageSchedule \|\| isMasked \|\| !draftReady\) return/,
  );
  assert.match(eventSheet, /const draftLocked = locked \|\| !draftReady/);
  assert.doesNotMatch(eventSheet, /scheduleInstantToLocalDateProxy/);
  assert.match(
    eventSheet,
    /getScheduleCivilDateKey\(\s*event\.start_time \|\| Date\.now\(\),\s*scheduleTimeZone/,
  );
  assert.match(
    eventSheet,
    /formatScheduleZonedTime\(event\.start_time, scheduleTimeZone\)/,
  );
  assert.match(
    eventSheet,
    /`\$\{organizationId \|\| ["']none["']\}:event:\$\{event\.id\}`/,
  );
  assert.match(eventSheet, /draftOrganizationIdRef\.current = organizationId/);
  assert.match(eventSheet, /if \(open\) onOpenChange\(false\)/);
});

test("EventSheet accepts a civil quick-create date and a separate validated clock", () => {
  const eventSheet = read("components/features/schedule/EventSheet.tsx");

  assert.match(eventSheet, /defaultTime\?: string/);
  assert.match(
    eventSheet,
    /scheduleClockInputSchema\.safeParse\(defaultTime\)/,
  );
  assert.match(
    eventSheet,
    /const time = parsedDefaultTime\.success\s*\? parsedDefaultTime\.data\s*:\s*localClock/,
  );
  assert.match(eventSheet, /getNextScheduleQuarterHourDraft\(now, timeZone\)/);
  assert.match(eventSheet, /preferredStartTime: nextInstant\.toISOString\(\)/);
  assert.match(eventSheet, /scheduleFutureCivilDateTimeToDate\(/);
  assert.match(
    eventSheet,
    /setPreferredStartTime\(event\.start_time \|\| null\)/,
  );
  assert.match(
    eventSheet,
    /const handleTimeChange = \(value: string\) => \{\s*setPreferredStartTime\(null\)/,
  );
  assert.match(
    eventSheet,
    /getClockRangeDurationMinutes\(\{[\s\S]*?timeZone: scheduleTimeZone,[\s\S]*?preferredStartTime/,
  );
  assert.doesNotMatch(eventSheet, /\.setHours\(/);
});

test("calendar and list group, position and label by organization timezone", () => {
  const calendar = read("components/features/schedule/CalendarView.tsx");
  const geometry = read(
    "components/features/schedule/calendar-event-geometry.ts",
  );
  const list = read("components/features/schedule/EventsList.tsx");

  assert.match(calendar, /splitScheduleEventByDay\(event, timeZone\)/);
  assert.match(calendar, /scheduleCivilDateTimeToDate\(/);
  assert.match(calendar, /formatScheduleZonedTime\(/);
  assert.match(
    calendar,
    /const CALENDAR_HOURS = Array\.from\(\{ length: 24 \}/,
  );
  assert.doesNotMatch(calendar, /eachHourOfInterval/);
  assert.match(calendar, /onQuickCreate\?\.\(pivotDate, halfHourStart\)/);
  assert.match(calendar, /onQuickCreate\?\.\(day, halfHourStart\)/);
  assert.match(calendar, /layoutScheduleCalendarSegments\(/);
  assert.match(calendar, /disabled=\{[\s\S]*?scheduleCivilDateTimeToDate\(/);
  assert.match(
    geometry,
    /getScheduleZonedClockMinutes\(segment\.start, timeZone\)/,
  );
  assert.doesNotMatch(calendar, /clickDate\.setHours\(/);
  assert.match(list, /getScheduleCivilDateKey\(event\.start_time, timeZone\)/);
  assert.match(list, /formatScheduleZonedTime\(/);
});

test("timezone settings invalidate every Agenda timezone consumer", () => {
  const attentionHook = read("hooks/attention/use-attention.ts");
  const settingsMutation = attentionHook.slice(
    attentionHook.indexOf("export function useUpdateAttentionSettings"),
  );

  assert.match(settingsMutation, /queryKey: \[["']schedule-capabilities["']\]/);
  assert.match(
    settingsMutation,
    /invalidateScheduleDashboardCaches\(queryClient\)/,
  );
});

test("Agenda clears organization-bound calendar state before realigning time", () => {
  const agenda = read("components/features/schedule/AgendaScreen.tsx");

  assert.match(agenda, /previousOrganizationIdRef/);
  assert.match(agenda, /forceTimeZoneAlignmentRef\.current = true/);
  assert.ok(
    agenda.indexOf("forceTimeZoneAlignmentRef.current = true") <
      agenda.indexOf(
        "const forceAlignment = forceTimeZoneAlignmentRef.current",
      ),
    "organization reset must run before the alignment effect",
  );
  assert.match(
    agenda,
    /agendaNow,\s*organizationId,\s*pivotDate,\s*scheduleCapabilities\?\.timeZone/,
  );
  assert.match(agenda, /setSelectedUserId\(null\)/);
  assert.match(agenda, /setSheetEvent\(null\)/);
  assert.match(agenda, /setSheetOpen\(false\)/);
});

test("same-day rescheduling preserves the active repeated-hour occurrence", () => {
  const dialog = read("components/features/schedule/ScheduleOutcomeDialog.tsx");

  assert.match(
    dialog,
    /rescheduleDate === today[\s\S]*?scheduleFutureCivilDateTimeToDate\(/,
  );
});
