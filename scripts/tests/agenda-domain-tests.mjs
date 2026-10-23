import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
async function collect(directory) {
  const files = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const name = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(name));
    else if (/\.test\.(?:ts|mts)$/.test(entry.name)) files.push(name);
  }
  return files;
}
const files = [
  ...await collect("components/features/schedule"),
  "lib/schedule-event-segments.test.ts", "lib/schedule-time-zone.test.ts",
  "lib/schedule-event-draft.test.ts", "lib/schedule-outcome.test.ts",
  "hooks/schedule/schedule-query-refresh.test.ts",
  "lib/validation/schedule.test.ts", "lib/validation/schedule-dashboard.test.ts",
  "lib/api/schedule-pagination.test.ts", "contexts/schedule-realtime-refresh.test.ts",
  "lib/api/schedule-errors.test.ts",
  "supabase/functions/_shared/google-calendar-event.test.ts",
  "supabase/functions/_shared/google-calendar-pilot.test.ts",
  "supabase/functions/_shared/google-calendar-delivery.test.ts",
  "supabase/functions/_shared/google-calendar-lifecycle.test.ts",
  "supabase/functions/evolution-go-webhook/notification-receipt.test.ts",
].sort();
console.log(`Agenda: ${files.length} focused test files (no services, OAuth or production writes).`);
const child = spawn(process.execPath, [
  "--experimental-transform-types", "--import", "./scripts/tests/typescript-alias-hooks.mjs", "--test", "--test-concurrency=2", ...files,
], { cwd: root, stdio: "inherit", windowsHide: true });
child.on("error", error => { console.error(error); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
