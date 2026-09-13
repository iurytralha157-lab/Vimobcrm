import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("Google sync uses the organization timezone in both directions", () => {
  const source = readFileSync(
    resolve(process.cwd(), "supabase/functions/_shared/google-calendar.ts"),
    "utf8",
  );

  assert.match(
    source,
    /\.from\("organization_attention_settings"\)[\s\S]*?\.select\("timezone"\)[\s\S]*?\.eq\("organization_id", organizationId\)/,
  );
  assert.match(source, /googleAllDayRangeToScheduleRange\(/);
  assert.match(
    source,
    /scheduleInstantToGoogleDate\(event\.start_time, timeZone\)/,
  );
  assert.match(
    source,
    /scheduleInstantToGoogleDate\(event\.end_time, timeZone\)/,
  );
  assert.match(
    source,
    /body\.start = \{ dateTime: event\.start_time, timeZone \}/,
  );
  assert.match(source, /body\.end = \{ dateTime: event\.end_time, timeZone \}/);
  assert.match(
    source,
    /const organizationTimeZone = await getOrganizationTimeZone\([\s\S]*?await upsertGoogleEventIntoSchedule\([\s\S]*?organizationTimeZone/,
  );

  assert.doesNotMatch(source, /function dateOnlyToISO/);
  assert.doesNotMatch(source, /timeZone: "America\/Sao_Paulo"/);
});
