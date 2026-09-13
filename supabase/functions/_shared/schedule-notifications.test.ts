import assert from "node:assert/strict";
import test from "node:test";

import { buildNotificationTargetUrl } from "./notification-target.ts";
import {
  getScheduleReminderDecision,
  isScheduleOutcomePromptDue,
  normalizeScheduleReminderMinutes,
  scheduleNotificationRecipientIds,
} from "./schedule-notifications.ts";

const NOW = new Date("2026-09-12T15:00:00.000Z");
const EVENT_ID = "10000000-0000-4000-8000-000000000001";
const OWNER_ID = "20000000-0000-4000-8000-000000000001";
const ASSIGNEE_ID = "30000000-0000-4000-8000-000000000001";

test("sends exactly the configured reminder for scheduled events", () => {
  assert.deepEqual(
    getScheduleReminderDecision(
      {
        status: "scheduled",
        start_time: "2026-09-12T15:30:00.000Z",
        reminder_minutes: 30,
      },
      NOW,
    ),
    {
      minutes: 30,
      dueAt: "2026-09-12T15:00:00.000Z",
      when: "começa em 30 minutos",
    },
  );

  assert.equal(
    getScheduleReminderDecision(
      {
        status: "completed",
        start_time: "2026-09-12T15:30:00.000Z",
        reminder_minutes: 30,
      },
      NOW,
    ),
    null,
  );
  assert.equal(
    getScheduleReminderDecision(
      {
        status: "no_show",
        start_time: "2026-09-12T15:30:00.000Z",
        reminder_minutes: 30,
      },
      NOW,
    ),
    null,
  );
  assert.equal(
    getScheduleReminderDecision(
      {
        status: "scheduled",
        start_time: "2026-09-12T15:15:00.000Z",
        reminder_minutes: null,
      },
      NOW,
    ),
    null,
  );
});

test("bounds reminder values to the worker query window", () => {
  assert.equal(normalizeScheduleReminderMinutes(0), 0);
  assert.equal(normalizeScheduleReminderMinutes(60), 60);
  assert.equal(normalizeScheduleReminderMinutes(120), 120);
  assert.equal(normalizeScheduleReminderMinutes(121), null);
  assert.equal(normalizeScheduleReminderMinutes(-1), null);
  assert.equal(normalizeScheduleReminderMinutes(10.5), null);
});

test("catches up a delayed scheduler without lying about the remaining time", () => {
  assert.deepEqual(
    getScheduleReminderDecision(
      {
        status: "scheduled",
        start_time: "2026-09-12T15:55:00.000Z",
        reminder_minutes: 60,
      },
      NOW,
    ),
    {
      minutes: 60,
      dueAt: "2026-09-12T14:55:00.000Z",
      when: "começa em 55 minutos",
    },
  );

  assert.deepEqual(
    getScheduleReminderDecision(
      {
        status: "scheduled",
        start_time: "2026-09-12T14:58:00.000Z",
        reminder_minutes: 0,
      },
      NOW,
    ),
    {
      minutes: 0,
      dueAt: "2026-09-12T14:58:00.000Z",
      when: "começou há 2 minutos",
    },
  );

  assert.equal(
    getScheduleReminderDecision(
      {
        status: "scheduled",
        start_time: "2026-09-12T15:19:00.000Z",
        reminder_minutes: 30,
      },
      NOW,
    ),
    null,
  );
});

test("asks for an outcome only after meetings and property visits", () => {
  for (const eventType of ["meeting", "visit"]) {
    assert.equal(
      isScheduleOutcomePromptDue(
        {
          status: "scheduled",
          event_type: eventType,
          end_time: "2026-09-12T14:50:00.000Z",
        },
        NOW,
      ),
      true,
    );
  }
  assert.equal(
    isScheduleOutcomePromptDue(
      {
        status: "scheduled",
        event_type: "meeting",
        end_time: "2026-09-12T14:01:00.000Z",
      },
      NOW,
    ),
    true,
  );

  for (const eventType of ["call", "task", "message", "email"]) {
    assert.equal(
      isScheduleOutcomePromptDue(
        {
          status: "scheduled",
          event_type: eventType,
          end_time: "2026-09-12T14:50:00.000Z",
        },
        NOW,
      ),
      false,
    );
  }
  assert.equal(
    isScheduleOutcomePromptDue(
      {
        status: "completed",
        event_type: "meeting",
        end_time: "2026-09-12T14:50:00.000Z",
      },
      NOW,
    ),
    false,
  );

  assert.equal(
    isScheduleOutcomePromptDue(
      {
        status: "scheduled",
        event_type: "meeting",
        end_time: "2026-09-12T13:59:00.000Z",
      },
      NOW,
    ),
    false,
  );
});

test("notifies the primary owner and unique additional assignees", () => {
  assert.deepEqual(
    scheduleNotificationRecipientIds(OWNER_ID, [
      { user_id: ASSIGNEE_ID },
      { user_id: OWNER_ID.toUpperCase() },
      { user_id: "invalid" },
    ]),
    [OWNER_ID, ASSIGNEE_ID],
  );
});

test("routes schedule notifications directly to the event", () => {
  assert.equal(
    buildNotificationTargetUrl(
      "appointment_outcome_pending",
      { schedule_event_id: EVENT_ID },
      OWNER_ID,
    ),
    `/agenda?event=${EVENT_ID}`,
  );
  assert.equal(
    buildNotificationTargetUrl(
      "lead_assigned",
      { schedule_event_id: EVENT_ID },
      OWNER_ID,
    ),
    `/crm/conversas?lead=${OWNER_ID}`,
  );
  assert.equal(
    buildNotificationTargetUrl(
      "appointment_reminder",
      { schedule_event_id: "../settings" },
      "",
    ),
    "/notifications",
  );
});
