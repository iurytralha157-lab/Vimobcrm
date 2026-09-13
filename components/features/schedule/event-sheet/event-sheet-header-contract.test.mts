import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("locks only the event type when attendance history requires lineage", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "components/features/schedule/event-sheet/EventSheetHeader.tsx",
    ),
    "utf8",
  );

  const titleStart = source.indexOf('data-tour="agenda-event-title"');
  const typeStart = source.indexOf('data-tour="agenda-event-type"');
  assert.notEqual(titleStart, -1);
  assert.notEqual(typeStart, -1);
  assert.match(source.slice(0, titleStart), /\{locked \? \(/);
  assert.doesNotMatch(
    source.slice(0, titleStart),
    /\{locked \|\| typeLocked \? \(/,
  );
  assert.match(
    source.slice(titleStart, typeStart),
    /\{locked \|\| typeLocked \? \(/,
  );
});
