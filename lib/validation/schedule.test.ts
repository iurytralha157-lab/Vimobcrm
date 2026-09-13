import assert from "node:assert/strict";
import test from "node:test";
import {
  apiScheduleCapabilitiesResponseSchema,
  completeScheduleEventInputSchema,
  createScheduleEventInputSchema,
  rescheduleScheduleEventInputSchema,
  updateScheduleEventInputSchema,
} from "./schedule";
import { normalizeScheduleEventBody } from "../api/schedule-body";

test("keeps the organization timezone in Agenda capabilities with a rollout fallback", () => {
  assert.equal(
    apiScheduleCapabilitiesResponseSchema.parse({
      data: { isTeamLeader: false, timeZone: "America/Manaus" },
    }).data.timeZone,
    "America/Manaus",
  );
  assert.equal(
    apiScheduleCapabilitiesResponseSchema.parse({
      data: { isTeamLeader: true },
    }).data.timeZone,
    "America/Sao_Paulo",
  );
});

test("preserves explicit null reminders while omitting undefined fields", () => {
  const baseEvent = {
    title: "Visita ao imóvel",
    event_type: "visit" as const,
    start_time: "2026-09-15T13:00:00.000Z",
    end_time: "2026-09-15T14:00:00.000Z",
  };
  const disabled = createScheduleEventInputSchema.parse(
    normalizeScheduleEventBody({
      ...baseEvent,
      reminder_minutes: null,
      description: undefined,
    }),
  );
  const omitted = createScheduleEventInputSchema.parse(
    normalizeScheduleEventBody({
      ...baseEvent,
      reminder_minutes: undefined,
    }),
  );
  const updateDisabled = updateScheduleEventInputSchema.parse(
    normalizeScheduleEventBody({ reminder_minutes: null }),
  );
  const rescheduleDisabled = rescheduleScheduleEventInputSchema.parse(
    normalizeScheduleEventBody({
      start_time: baseEvent.start_time,
      end_time: baseEvent.end_time,
      reminder_minutes: null,
    }),
  );

  assert.equal(
    Object.prototype.hasOwnProperty.call(disabled, "reminder_minutes"),
    true,
  );
  assert.equal(disabled.reminder_minutes, null);
  assert.equal(
    Object.prototype.hasOwnProperty.call(disabled, "description"),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(omitted, "reminder_minutes"),
    false,
  );
  assert.equal(updateDisabled.reminder_minutes, null);
  assert.equal(rescheduleDisabled.reminder_minutes, null);
});

test("accepts the canonical attendance outcome matrix", () => {
  assert.equal(
    completeScheduleEventInputSchema.safeParse({
      status: "completed",
      outcome: "visit_completed",
      performed_by: "65aa213a-5c41-4a33-89c7-66a683248b4f",
    }).success,
    true,
  );
  assert.equal(
    completeScheduleEventInputSchema.safeParse({
      status: "no_show",
      outcome: "no_show",
    }).success,
    true,
  );
  assert.equal(
    completeScheduleEventInputSchema.safeParse({
      status: "cancelled",
      outcome: "rescheduled",
    }).success,
    true,
  );
});

test("validates an atomic reschedule interval and preserves reminders up to two hours", () => {
  const valid = rescheduleScheduleEventInputSchema.safeParse({
    start_time: "2026-09-15T13:00:00.000Z",
    end_time: "2026-09-15T14:00:00.000Z",
    is_all_day: false,
    reminder_minutes: 120,
    outcome_notes: "Cliente pediu um novo horário.",
  });
  assert.equal(valid.success, true);

  const unsupportedReminder = rescheduleScheduleEventInputSchema.safeParse({
    start_time: "2026-09-15T13:00:00.000Z",
    end_time: "2026-09-15T14:00:00.000Z",
    reminder_minutes: 121,
  });
  assert.equal(unsupportedReminder.success, false);

  const invalid = rescheduleScheduleEventInputSchema.safeParse({
    start_time: "2026-09-15T14:00:00.000Z",
    end_time: "2026-09-15T14:00:00.000Z",
  });
  assert.equal(invalid.success, false);

  const unexpectedField = rescheduleScheduleEventInputSchema.safeParse({
    start_time: "2026-09-15T13:00:00.000Z",
    end_time: "2026-09-15T14:00:00.000Z",
    status: "completed",
  });
  assert.equal(unexpectedField.success, false);
});
