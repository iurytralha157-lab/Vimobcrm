import assert from "node:assert/strict";
import test from "node:test";
import {
  apiScheduleCapabilitiesResponseSchema,
  apiScheduleEventSchema,
  completeScheduleEventInputSchema,
  createScheduleEventInputSchema,
  rescheduleScheduleEventInputSchema,
  scheduleCommentInputSchema,
  scheduleListQuerySchema,
  updateScheduleEventInputSchema,
} from "./schedule";
import { normalizeScheduleEventBody } from "../api/schedule-body";

test("requires an explicit organization timezone before capabilities can confirm civil-time writes", () => {
  assert.equal(
    apiScheduleCapabilitiesResponseSchema.parse({
      data: { isTeamLeader: false, timeZone: "America/Manaus" },
    }).data.timeZone,
    "America/Manaus",
  );
  assert.equal(apiScheduleCapabilitiesResponseSchema.safeParse({ data: { isTeamLeader: true } }).success, false);
  assert.equal(apiScheduleCapabilitiesResponseSchema.safeParse({ data: { isTeamLeader: true, timeZone: "Unknown/Timezone" } }).success, false);
});

test("rejects ambiguous timestamps and zero-duration new events", () => {
  const base = { title: "Tarefa", start_time: "2026-10-12T09:00:00-03:00", end_time: "2026-10-12T09:30:00-03:00" };
  assert.equal(createScheduleEventInputSchema.safeParse(base).success, true);
  assert.equal(createScheduleEventInputSchema.safeParse({ ...base, start_time: "2026-10-12" }).success, false);
  assert.equal(createScheduleEventInputSchema.safeParse({ ...base, end_time: base.start_time }).success, false);
  assert.equal(updateScheduleEventInputSchema.safeParse({ start_time: base.start_time, end_time: base.start_time }).success, false);
});

test("accepts optional server Google destinations without adding a writable provider selector", () => {
  const event = {
    id: "30000000-0000-4000-8000-000000000001", organization_id: "10000000-0000-4000-8000-000000000001",
    user_id: "20000000-0000-4000-8000-000000000001", lead_id: null, property_id: null,
    title: "Tarefa sintética", description: null, event_type: "task", start_time: "2026-11-04T12:00:00Z",
    end_time: "2026-11-04T13:00:00Z", is_all_day: false, location: null, status: "scheduled",
    reminder_minutes: null, google_event_id: null, completed_by: null, completed_at: null, created_at: null, updated_at: null,
  };
  assert.equal(apiScheduleEventSchema.safeParse(event).success, true);
  assert.equal(apiScheduleEventSchema.parse({ ...event, google_sync_target: "tasks", google_task_id: "synthetic-task", google_sync_status: "pending" }).google_sync_target, "tasks");
  assert.equal(apiScheduleEventSchema.safeParse({ ...event, google_sync_target: "unsupported" }).success, false);
  assert.equal(apiScheduleEventSchema.safeParse({ ...event, google_task_id: [] }).success, false);
  assert.equal(createScheduleEventInputSchema.safeParse({ title: event.title, start_time: event.start_time, end_time: event.end_time, google_sync_target: "tasks" }).success, false);
  assert.equal(updateScheduleEventInputSchema.safeParse({ title: event.title, google_task_id: "synthetic-task" }).success, false);
});

test("preserves command identity and version guard while rejecting malformed commands", () => {
  const requestId = "65aa213a-5c41-4a33-89c7-66a683248b4f";
  const version = "2026-10-12T12:00:00.123456Z";
  assert.equal(scheduleCommentInputSchema.parse({ content: "Anotacao", client_request_id: requestId }).client_request_id, requestId);
  assert.equal(completeScheduleEventInputSchema.parse({ status: "completed", expected_updated_at: version }).expected_updated_at, version);
  assert.equal(updateScheduleEventInputSchema.parse({ title: "Novo titulo", expected_updated_at: version }).expected_updated_at, version);
  assert.equal(updateScheduleEventInputSchema.safeParse({ expected_updated_at: version }).success, false);
  assert.equal(updateScheduleEventInputSchema.safeParse({ title: "Novo titulo", recurrence_rule: "monthly" }).success, false);
  assert.equal(scheduleCommentInputSchema.safeParse({ content: "Anotacao", client_request_id: "another-event" }).success, false);
});

test("requires a bounded general calendar interval but keeps focused event and lead queries", () => {
  assert.equal(scheduleListQuerySchema.safeParse({}).success, false);
  assert.equal(scheduleListQuerySchema.safeParse({ startDate: new Date("2026-10-12T00:00:00Z") }).success, false);
  assert.equal(scheduleListQuerySchema.safeParse({ eventId: "65aa213a-5c41-4a33-89c7-66a683248b4f" }).success, true);
  assert.equal(scheduleListQuerySchema.safeParse({ leadId: "65aa213a-5c41-4a33-89c7-66a683248b4f" }).success, true);
  assert.equal(scheduleListQuerySchema.safeParse({ startDate: new Date("2026-10-12T00:00:00Z"), endDate: new Date("2026-10-11T00:00:00Z") }).success, false);
  assert.equal(scheduleListQuerySchema.safeParse({ startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2028-01-01T00:00:00Z") }).success, false);
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
