import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("lead details render Agenda only with module and schedule_view", () => {
  const source = readFileSync(
    resolve(process.cwd(), "components/features/leads/LeadDetailDialog.tsx"),
    "utf8",
  );
  const actionsSource = readFileSync(
    resolve(process.cwd(), "components/features/leads/lead-detail/LeadDetailActions.tsx"),
    "utf8",
  );

  assert.match(
    source,
    /const canViewLeadSchedule = hasAgendaModule && hasPermission\('schedule_view'\)/,
  );
  assert.match(source, /<LeadDetailActions\b[\s\S]*?schedule=\{\{\s*visible: canViewLeadSchedule/);
  assert.match(source, /\{renderActionSections\(true\)\}/);
  assert.match(source, /\{renderActionSections\(false\)\}/);
  assert.match(actionsSource, /\{schedule\.visible && \(\s*<section[^>]*lead-agenda-card/);
  assert.doesNotMatch(source, /\{hasAgendaModule && <section[^>]*lead-agenda-card/);
});
