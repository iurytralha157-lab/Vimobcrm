import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("gates the WhatsApp lead Agenda panel and query by the Agenda module", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "components/features/whatsapp/ConversationLeadPanel.tsx",
    ),
    "utf8",
  );

  assert.match(source, /const hasScheduleModule = hasModule\("agenda"\)/);
  assert.match(
    source,
    /const canViewSchedule =\s*hasScheduleModule && hasPermission\("schedule_view"\)/,
  );
  assert.match(source, /enabled: canViewSchedule/);
  assert.match(source, /\{hasScheduleModule && canViewSchedule && \(/);
  assert.match(
    source,
    /import \{ CompactScheduleEventsList \} from "@\/components\/features\/schedule\/CompactScheduleEventsList"/,
  );
  assert.match(source, /emptyLabel="Nenhum compromisso agendado"/);
  assert.doesNotMatch(source, /function CompactScheduleEventsList\(/);
});

test("shared compact Agenda cards use live lifecycle and organization timezone", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "components/features/schedule/CompactScheduleEventsList.tsx",
    ),
    "utf8",
  );

  assert.match(source, /useScheduleCapabilities\(/);
  assert.match(source, /setInterval\([\s\S]*?60_000/);
  assert.match(source, /getScheduleLifecycleState\(\{/);
  assert.match(source, /endTime: event\.end_time/);
  assert.match(source, /isAllDay: event\.is_all_day \?\? false/);
  assert.match(source, /timeZone,/);
  assert.match(source, /getScheduleLifecycleLabel\(lifecycle\)/);
});
