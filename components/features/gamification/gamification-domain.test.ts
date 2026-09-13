import assert from "node:assert/strict";
import test from "node:test";

// The Node type-stripping runner requires the explicit TypeScript extension.
// @ts-expect-error -- production imports remain extensionless for Next.js.
import { formatDateTime, getEventLabel, getInitials, getProgress, normalizeActionKey, tabFromHash } from "./gamification-domain.ts";

test("maps legacy and current tab hashes without widening the route contract", () => {
  assert.equal(tabFromHash("#rankings"), "arena");
  assert.equal(tabFromHash("#admin"), "config");
  assert.equal(tabFromHash("#history"), "history");
  assert.equal(tabFromHash("#unknown"), "arena");
});

test("normalizes legacy action aliases and keeps unknown action labels readable", () => {
  assert.equal(normalizeActionKey(" Visita-Realizada "), "visit_confirmed");
  assert.equal(getEventLabel("lead_ganho"), "Venda concluida");
  assert.equal(getEventLabel("custom_event"), "custom event");
});

test("preserves initials, invalid date, and bounded level progress behavior", () => {
  assert.equal(getInitials("  Ana Maria Souza "), "AM");
  assert.equal(formatDateTime("not-a-date"), "--");
  assert.equal(
    getProgress({ xpCurrentLevel: 120, xpNextLevel: 100 } as Parameters<
      typeof getProgress
    >[0]),
    100,
  );
  assert.equal(
    getProgress({ xpCurrentLevel: 50, xpNextLevel: 0 } as Parameters<
      typeof getProgress
    >[0]),
    0,
  );
});
