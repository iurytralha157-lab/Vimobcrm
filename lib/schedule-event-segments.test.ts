import assert from "node:assert/strict";
import test from "node:test";
import { splitScheduleEventByDay } from "./schedule-event-segments";
import {
  buildScheduleEventInterval,
  buildScheduleEventTimingPatch,
} from "./schedule-event-draft";
import {
  applyTeamSelection,
  buildDisplayAssignees,
  formatPropertyPrice,
  getAvailableAssignees,
  getClockRangeDurationMinutes,
  getDefaultDurationMinutes,
  getInitialStartDate,
  getNextFutureQuarterHour,
  getReminderLabel,
  getReminderSelectValue,
  getStoredDurationMinutes,
  isRecurrenceRule,
  parseReminderSelectValue,
} from "../components/features/schedule/event-sheet/model";

test("keeps a same-day event in one segment", () => {
  const segments = splitScheduleEventByDay({
    id: "same-day",
    start_time: "2026-07-27T12:00:00",
    end_time: "2026-07-27T13:30:00",
  });

  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.dateKey, "2026-07-27");
  assert.equal(segments[0]?.isFirst, true);
  assert.equal(segments[0]?.isLast, true);
});

test("splits an overnight event into the correct day columns", () => {
  const segments = splitScheduleEventByDay({
    id: "overnight",
    start_time: "2026-07-27T12:00:00",
    end_time: "2026-07-28T08:45:00",
  });

  assert.deepEqual(
    segments.map((segment) => segment.dateKey),
    ["2026-07-27", "2026-07-28"],
  );
  assert.equal(segments[0]?.start.getHours(), 12);
  assert.equal(segments[0]?.end.getHours(), 0);
  assert.equal(segments[0]?.isLast, false);
  assert.equal(segments[1]?.start.getHours(), 0);
  assert.equal(segments[1]?.end.getHours(), 8);
  assert.equal(segments[1]?.end.getMinutes(), 45);
  assert.equal(segments[1]?.isFirst, false);
  assert.equal(segments[1]?.isLast, true);
});

test("does not create an empty segment when an event ends at midnight", () => {
  const segments = splitScheduleEventByDay({
    id: "midnight-end",
    start_time: "2026-07-27T22:00:00",
    end_time: "2026-07-28T00:00:00",
  });

  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.dateKey, "2026-07-27");
});

test("splits and groups events at the organization civil midnight", () => {
  const allDay = splitScheduleEventByDay(
    {
      id: "all-day-sp",
      start_time: "2026-09-12T03:00:00.000Z",
      end_time: "2026-09-13T02:59:59.999Z",
    },
    "America/Sao_Paulo",
  );
  assert.deepEqual(
    allDay.map((segment) => segment.dateKey),
    ["2026-09-12"],
  );

  const overnight = splitScheduleEventByDay(
    {
      id: "overnight-sp",
      start_time: "2026-09-13T02:30:00.000Z",
      end_time: "2026-09-13T03:30:00.000Z",
    },
    "America/Sao_Paulo",
  );
  assert.deepEqual(
    overnight.map((segment) => segment.dateKey),
    ["2026-09-12", "2026-09-13"],
  );
  assert.equal(overnight[0]?.end.toISOString(), "2026-09-13T03:00:00.000Z");
});

test("rejects invalid or non-positive intervals", () => {
  assert.deepEqual(
    splitScheduleEventByDay({
      id: "invalid",
      start_time: "invalid",
      end_time: "2026-07-28T00:00:00",
    }),
    [],
  );

  assert.deepEqual(
    splitScheduleEventByDay({
      id: "backwards",
      start_time: "2026-07-28T01:00:00",
      end_time: "2026-07-28T00:00:00",
    }),
    [],
  );
});

test("normalizes EventSheet creation dates without discarding valid future selections", () => {
  const now = new Date(2026, 6, 27, 10, 7, 30);
  const fallback = getNextFutureQuarterHour(now);

  assert.equal(fallback.getHours(), 10);
  assert.equal(fallback.getMinutes(), 15);
  assert.equal(fallback.getSeconds(), 0);

  assert.equal(getInitialStartDate({ now, fallback }), fallback);
  assert.equal(
    getInitialStartDate({
      defaultDate: new Date(2026, 6, 27, 0, 0, 0),
      now,
      fallback,
    }),
    fallback,
  );
  assert.equal(
    getInitialStartDate({
      defaultDate: new Date(2026, 6, 27, 9, 30, 0),
      now,
      fallback,
    }),
    fallback,
  );

  const futureToday = new Date(2026, 6, 27, 14, 0, 0);
  const normalizedFuture = getInitialStartDate({
    defaultDate: futureToday,
    now,
    fallback,
  });
  assert.notEqual(normalizedFuture, futureToday);
  assert.equal(normalizedFuture.getTime(), futureToday.getTime());

  const futureDayAtMidnight = new Date(2026, 6, 28, 0, 0, 0);
  assert.equal(
    getInitialStartDate({
      defaultDate: futureDayAtMidnight,
      now,
      fallback,
    }).getTime(),
    futureDayAtMidnight.getTime(),
  );
});

test("preserves EventSheet duration defaults, stored intervals, and overnight edits", () => {
  assert.equal(getDefaultDurationMinutes("visit"), 60);
  assert.equal(getDefaultDurationMinutes("meeting"), 60);
  assert.equal(getDefaultDurationMinutes("task"), 30);

  const start = new Date(2026, 6, 27, 23, 45, 0);
  assert.equal(
    getStoredDurationMinutes({
      start,
      end: new Date(2026, 6, 28, 1, 15, 0),
      eventType: "task",
    }),
    90,
  );
  assert.equal(
    getStoredDurationMinutes({
      start,
      end: new Date("invalid"),
      eventType: "visit",
    }),
    60,
  );
  assert.equal(
    getClockRangeDurationMinutes({
      date: start,
      startTime: "23:45",
      endTime: "00:15",
    }),
    30,
  );
  assert.equal(
    getClockRangeDurationMinutes({
      date: start,
      startTime: "09:00",
      endTime: "09:00",
    }),
    24 * 60,
  );
});

test("calculates EventSheet clock ranges by real elapsed time across DST", () => {
  const springForwardDate = new Date(2026, 2, 8, 12, 0, 0);
  assert.equal(
    getClockRangeDurationMinutes({
      date: springForwardDate,
      startTime: "01:30",
      endTime: "03:30",
      timeZone: "America/New_York",
    }),
    60,
  );
  assert.equal(
    getClockRangeDurationMinutes({
      date: springForwardDate,
      startTime: "01:30",
      endTime: "01:30",
      timeZone: "America/New_York",
    }),
    23 * 60,
  );

  const fallBackDate = new Date(2026, 10, 1, 12, 0, 0);
  assert.equal(
    getClockRangeDurationMinutes({
      date: fallBackDate,
      startTime: "01:30",
      endTime: "02:30",
      timeZone: "America/New_York",
      preferredStartTime: "2026-11-01T05:30:00.000Z",
    }),
    120,
  );
  assert.equal(
    getClockRangeDurationMinutes({
      date: fallBackDate,
      startTime: "01:30",
      endTime: "02:30",
      timeZone: "America/New_York",
      preferredStartTime: "2026-11-01T06:30:00.000Z",
    }),
    60,
  );
  assert.equal(
    getClockRangeDurationMinutes({
      date: fallBackDate,
      startTime: "01:15",
      endTime: "01:45",
      timeZone: "America/New_York",
      preferredStartTime: "2026-11-01T06:15:00.000Z",
    }),
    30,
  );
});

test("keeps EventSheet recurrence and property presentation contracts", () => {
  for (const rule of ["none", "daily", "weekly", "monthly", "yearly"]) {
    assert.equal(isRecurrenceRule(rule), true);
  }
  assert.equal(isRecurrenceRule("weekdays"), false);
  assert.equal(isRecurrenceRule(null), false);

  assert.equal(formatPropertyPrice(null, null), "Preço não informado");
  assert.equal(formatPropertyPrice(2500, "Aluguel"), "R$ 2.500/mês");
  assert.equal(formatPropertyPrice(850000, "Venda"), "R$ 850.000");
});

test("builds EventSheet intervals in the organization timezone", () => {
  const date = new Date(2026, 8, 12, 12, 0, 0);
  assert.deepEqual(
    buildScheduleEventInterval({
      date,
      time: "09:30",
      isAllDay: false,
      durationMinutes: 30,
      timeZone: "America/Manaus",
    }),
    {
      startTime: "2026-09-12T13:30:00.000Z",
      endTime: "2026-09-12T14:00:00.000Z",
    },
  );
  assert.deepEqual(
    buildScheduleEventInterval({
      date,
      time: "09:30",
      isAllDay: true,
      durationMinutes: 30,
      timeZone: "America/Manaus",
    }),
    {
      startTime: "2026-09-12T04:00:00.000Z",
      endTime: "2026-09-13T03:59:59.999Z",
    },
  );
});

test("builds an ambiguous EventSheet interval from its exact occurrence", () => {
  const date = new Date(2026, 10, 1, 12, 0, 0);
  assert.deepEqual(
    buildScheduleEventInterval({
      date,
      time: "01:30",
      isAllDay: false,
      durationMinutes: 30,
      timeZone: "America/New_York",
      preferredStartTime: "2026-11-01T06:30:00.000Z",
    }),
    {
      startTime: "2026-11-01T06:30:00.000Z",
      endTime: "2026-11-01T07:00:00.000Z",
    },
  );
});

test("keeps reminder choices explicit while preserving legacy values", () => {
  assert.equal(getReminderSelectValue(null), "none");
  assert.equal(getReminderSelectValue(30), "30");
  assert.equal(parseReminderSelectValue("none"), null);
  assert.equal(parseReminderSelectValue("0"), 0);
  assert.equal(parseReminderSelectValue("60"), 60);
  assert.equal(parseReminderSelectValue("90"), 90);
  assert.equal(parseReminderSelectValue("120"), 120);
  assert.equal(getReminderLabel(null), "Sem lembrete");
  assert.equal(getReminderLabel(30), "30 min antes");
  assert.equal(getReminderLabel(120), "2 horas antes");
  assert.equal(getReminderLabel(1440), "1440 min antes");
});

test("omits timing fields from normal attendance appointment edits", () => {
  const timing = {
    startTime: "2026-09-20T14:00:00.000Z",
    endTime: "2026-09-20T15:00:00.000Z",
    isAllDay: false,
    reminderMinutes: 30,
  };

  assert.deepEqual(
    buildScheduleEventTimingPatch({
      ...timing,
      preserveAppointmentTiming: true,
    }),
    { reminder_minutes: 30 },
  );
  assert.deepEqual(
    buildScheduleEventTimingPatch({
      ...timing,
      preserveAppointmentTiming: false,
    }),
    {
      start_time: timing.startTime,
      end_time: timing.endTime,
      is_all_day: false,
      reminder_minutes: 30,
    },
  );
});

test("builds the EventSheet assignee draft with primary fallback and stable deduplication", () => {
  const users = [
    { id: "primary", name: "Principal", avatar_url: null },
    { id: "second", name: "Segundo", avatar_url: null },
    { id: "third", name: "Terceiro", avatar_url: null },
  ];
  const loadedAssignees = [
    { id: "second", name: "Segundo atualizado", avatar_url: "avatar.png" },
  ];

  assert.deepEqual(
    buildDisplayAssignees({
      users,
      loadedAssignees,
      draftAssigneeIds: ["second", "second", "primary", "missing"],
      primaryUserId: "primary",
      eventUser: null,
      isMasked: false,
    }),
    [
      { ...users[0], primary: true },
      { ...loadedAssignees[0], primary: false },
    ],
  );
  assert.deepEqual(
    buildDisplayAssignees({
      users,
      loadedAssignees,
      draftAssigneeIds: ["second"],
      primaryUserId: "primary",
      eventUser: null,
      isMasked: true,
    }),
    [],
  );
  assert.deepEqual(
    getAvailableAssignees(users, "primary", ["second"]).map((user) => user.id),
    ["third"],
  );

  assert.deepEqual(
    applyTeamSelection({
      memberIds: ["primary", "second", "second"],
      primaryUserId: "",
      draftAssigneeIds: ["third"],
    }),
    {
      primaryUserId: "primary",
      draftAssigneeIds: ["third", "primary", "second"],
    },
  );
});
