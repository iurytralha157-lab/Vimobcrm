import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("lead details render Agenda only with module and schedule_view", () => {
  const source = readFileSync(
    resolve(process.cwd(), "components/features/leads/LeadDetailDialog.tsx"),
    "utf8",
  );

  assert.match(
    source,
    /const canViewLeadSchedule = hasAgendaModule && hasPermission\('schedule_view'\)/,
  );
  assert.equal(
    source.match(/\{canViewLeadSchedule && <section(?: data-tour="lead-detail-agenda")? className="lead-agenda-card/g)?.length,
    2,
  );
  assert.doesNotMatch(source, /\{hasAgendaModule && <section[^>]*lead-agenda-card/);
});
