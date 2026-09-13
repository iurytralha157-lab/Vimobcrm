import assert from "node:assert/strict";
import test from "node:test";

import {
  formatScheduleZonedTime,
  getNextScheduleCivilDate,
  getScheduleCivilDateKey,
  getScheduleCivilDayRange,
  getScheduleZonedClockMinutes,
  scheduleCivilDateKeyToLocalDate,
  scheduleCivilDateTimeToDate,
  scheduleFutureCivilDateTimeToDate,
  scheduleInstantToLocalDateProxy,
} from "./schedule-time-zone";

test("builds all-day boundaries in the organization civil timezone", () => {
  assert.deepEqual(getScheduleCivilDayRange("2026-09-12", "America/Manaus"), {
    startTime: "2026-09-12T04:00:00.000Z",
    endTime: "2026-09-13T03:59:59.999Z",
  });
});

test("maps civil clock input to the organization instant", () => {
  assert.equal(
    scheduleCivilDateTimeToDate(
      "2026-09-12",
      "09:30",
      "America/Manaus",
    )?.toISOString(),
    "2026-09-12T13:30:00.000Z",
  );
  assert.equal(
    scheduleCivilDateTimeToDate("2026-03-08", "02:30", "America/New_York"),
    null,
  );
});

test("chooses the first occurrence throughout a repeated DST hour", () => {
  const expectedInstants = {
    "01:00": "2026-11-01T05:00:00.000Z",
    "01:15": "2026-11-01T05:15:00.000Z",
    "01:30": "2026-11-01T05:30:00.000Z",
    "01:45": "2026-11-01T05:45:00.000Z",
  };

  for (const [clock, expected] of Object.entries(expectedInstants)) {
    assert.equal(
      scheduleCivilDateTimeToDate(
        "2026-11-01",
        clock,
        "America/New_York",
      )?.toISOString(),
      expected,
    );
  }
});

test("preserves the preferred occurrence of a repeated DST clock", () => {
  assert.equal(
    scheduleCivilDateTimeToDate("2026-11-01", "01:30", "America/New_York", {
      preferredInstant: "2026-11-01T06:15:00.000Z",
    })?.toISOString(),
    "2026-11-01T06:30:00.000Z",
  );
  assert.equal(
    scheduleCivilDateTimeToDate("2026-11-01", "01:30", "America/New_York", {
      occurrence: "last",
    })?.toISOString(),
    "2026-11-01T06:30:00.000Z",
  );
  assert.equal(
    scheduleCivilDateTimeToDate("2026-11-01", "01:30", "America/New_York", {
      preferredInstant: "2026-11-02T06:15:00.000Z",
    })?.toISOString(),
    "2026-11-01T05:30:00.000Z",
  );
});

test("selects the next real occurrence of a repeated civil clock", () => {
  assert.equal(
    scheduleFutureCivilDateTimeToDate(
      "2026-11-01",
      "01:30",
      "America/New_York",
      "2026-11-01T05:50:00.000Z",
    )?.toISOString(),
    "2026-11-01T06:30:00.000Z",
  );
  assert.equal(
    scheduleFutureCivilDateTimeToDate(
      "2026-11-01",
      "01:30",
      "America/New_York",
      "2026-11-01T06:10:00.000Z",
    )?.toISOString(),
    "2026-11-01T06:30:00.000Z",
  );
  assert.equal(
    scheduleFutureCivilDateTimeToDate(
      "2026-11-01",
      "01:30",
      "America/New_York",
      "2026-11-01T06:30:00.000Z",
    ),
    null,
  );
  assert.equal(
    scheduleFutureCivilDateTimeToDate(
      "2026-03-08",
      "02:30",
      "America/New_York",
      "2026-03-08T00:00:00.000Z",
    ),
    null,
  );
});

test("formats and groups instants by organization time instead of browser time", () => {
  const instant = "2026-09-13T02:30:00.000Z";
  assert.equal(
    getScheduleCivilDateKey(instant, "America/Sao_Paulo"),
    "2026-09-12",
  );
  assert.equal(formatScheduleZonedTime(instant, "America/Sao_Paulo"), "23:30");
  assert.equal(
    getScheduleZonedClockMinutes(instant, "America/Sao_Paulo"),
    23 * 60 + 30,
  );
});

test("creates DST-safe local-noon proxies for organization civil dates", () => {
  const proxy = scheduleInstantToLocalDateProxy(
    "2026-09-12T13:30:00.000Z",
    "America/Manaus",
  );
  assert.equal(proxy?.getFullYear(), 2026);
  assert.equal(proxy?.getMonth(), 8);
  assert.equal(proxy?.getDate(), 12);
  assert.equal(proxy?.getHours(), 12);
  assert.equal(proxy?.getMinutes(), 0);

  const browserGapProxy = scheduleInstantToLocalDateProxy(
    "2026-03-08T02:30:00.000Z",
    "UTC",
  );
  assert.equal(browserGapProxy?.getFullYear(), 2026);
  assert.equal(browserGapProxy?.getMonth(), 2);
  assert.equal(browserGapProxy?.getDate(), 8);
  assert.equal(browserGapProxy?.getHours(), 12);

  const date = scheduleCivilDateKeyToLocalDate("2026-09-12");
  assert.equal(date?.getDate(), 12);
  assert.equal(getNextScheduleCivilDate("2026-12-31"), "2027-01-01");
});

test("uses the first valid instant when a civil day skips midnight", () => {
  assert.deepEqual(
    getScheduleCivilDayRange("2018-11-04", "America/Sao_Paulo"),
    {
      startTime: "2018-11-04T03:00:00.000Z",
      endTime: "2018-11-05T01:59:59.999Z",
    },
  );
});
