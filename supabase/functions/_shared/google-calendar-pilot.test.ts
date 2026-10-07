import assert from "node:assert/strict";
import test from "node:test";
import { resolveGoogleCalendarConnectGate } from "./google-calendar-pilot.ts";

const PILOT_USER = "b423146e-0553-4e52-821b-79778dcedbe1";
const OTHER_USER = "62cdf447-a4e8-432e-933b-85a9427c8090";

test("new Google OAuth connections fail closed without a rollout mode", () => {
  assert.deepEqual(resolveGoogleCalendarConnectGate(PILOT_USER, undefined, PILOT_USER), {
    allowed: false,
    restriction: "GOOGLE_CALENDAR_CONNECT_DISABLED",
  });
  assert.deepEqual(resolveGoogleCalendarConnectGate(PILOT_USER, "unexpected", PILOT_USER), {
    allowed: false,
    restriction: "GOOGLE_CALENDAR_CONNECT_DISABLED",
  });
  assert.deepEqual(resolveGoogleCalendarConnectGate(PILOT_USER, "disabled", PILOT_USER), {
    allowed: false,
    restriction: "GOOGLE_CALENDAR_CONNECT_DISABLED",
  });
});

test("pilot mode requires an exact authenticated Vimob user UUID", () => {
  assert.deepEqual(resolveGoogleCalendarConnectGate(PILOT_USER, "pilot", undefined), {
    allowed: false,
    restriction: "GOOGLE_CALENDAR_PILOT_ONLY",
  });
  assert.deepEqual(resolveGoogleCalendarConnectGate(OTHER_USER, "pilot", PILOT_USER), {
    allowed: false,
    restriction: "GOOGLE_CALENDAR_PILOT_ONLY",
  });
  assert.deepEqual(
    resolveGoogleCalendarConnectGate(
      PILOT_USER.toUpperCase(),
      " pilot ",
      `ignored-email@example.com, ${OTHER_USER}, ${PILOT_USER}`,
    ),
    { allowed: true, restriction: null },
  );
});

test("all mode opens new OAuth connections independently of the pilot list", () => {
  assert.deepEqual(resolveGoogleCalendarConnectGate(OTHER_USER, "all", ""), {
    allowed: true,
    restriction: null,
  });
});
