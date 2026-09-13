import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_GOOGLE_CALENDAR_TIME_ZONE,
  googleAllDayRangeToScheduleRange,
  nextGoogleCivilDate,
  normalizeGoogleCalendarTimeZone,
  scheduleInstantToGoogleDate,
} from "./google-calendar-time";

test("converts a one-day Google event into a complete Sao Paulo civil day", () => {
  assert.deepEqual(
    googleAllDayRangeToScheduleRange(
      "2026-09-12",
      "2026-09-13",
      "America/Sao_Paulo",
    ),
    {
      startTime: "2026-09-12T03:00:00.000Z",
      endTime: "2026-09-13T02:59:59.999Z",
    },
  );
});

test("preserves multi-day ranges and the organization offset", () => {
  assert.deepEqual(
    googleAllDayRangeToScheduleRange(
      "2026-09-12",
      "2026-09-15",
      "America/Manaus",
    ),
    {
      startTime: "2026-09-12T04:00:00.000Z",
      endTime: "2026-09-15T03:59:59.999Z",
    },
  );
});

test("uses civil midnights across DST instead of assuming a 24-hour day", () => {
  const springForward = googleAllDayRangeToScheduleRange(
    "2026-03-08",
    "2026-03-09",
    "America/New_York",
  );
  const fallBack = googleAllDayRangeToScheduleRange(
    "2026-11-01",
    "2026-11-02",
    "America/New_York",
  );

  assert.deepEqual(springForward, {
    startTime: "2026-03-08T05:00:00.000Z",
    endTime: "2026-03-09T03:59:59.999Z",
  });
  assert.deepEqual(fallBack, {
    startTime: "2026-11-01T04:00:00.000Z",
    endTime: "2026-11-02T04:59:59.999Z",
  });
});

test("uses the first valid instant when a DST transition skips midnight", () => {
  assert.deepEqual(
    googleAllDayRangeToScheduleRange(
      "2018-11-04",
      "2018-11-05",
      "America/Sao_Paulo",
    ),
    {
      startTime: "2018-11-04T03:00:00.000Z",
      endTime: "2018-11-05T01:59:59.999Z",
    },
  );
});

test("round-trips Vimob instants to Google civil dates", () => {
  assert.equal(
    scheduleInstantToGoogleDate(
      "2026-09-13T02:59:59.999Z",
      "America/Sao_Paulo",
    ),
    "2026-09-12",
  );
  assert.equal(nextGoogleCivilDate("2026-09-12"), "2026-09-13");
});

test("falls back safely for invalid timezones and rejects invalid ranges", () => {
  assert.equal(
    normalizeGoogleCalendarTimeZone("Fuso/Inexistente"),
    DEFAULT_GOOGLE_CALENDAR_TIME_ZONE,
  );
  assert.throws(
    () =>
      googleAllDayRangeToScheduleRange(
        "2026-09-12",
        "2026-09-12",
        "America/Sao_Paulo",
      ),
    /Fim exclusivo/,
  );
  assert.throws(() => nextGoogleCivilDate("2026-02-30"), /Data civil invalida/);
  assert.throws(
    () =>
      googleAllDayRangeToScheduleRange(
        "2011-12-30",
        "2011-12-31",
        "Pacific\/Apia",
      ),
    /nao existe/,
  );
});
