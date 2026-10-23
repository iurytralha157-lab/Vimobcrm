import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Requires an explicitly supplied, locally installed PGlite module. This runner
// accepts no database URL and always creates a fresh in-memory SQL database.
const modulePath = process.argv[2];
if (!modulePath || !path.isAbsolute(modulePath)) {
  throw new Error("Usage: node scripts/supabase/test-google-calendar-lifecycle-sql.mjs <absolute path to pinned PGlite dist/index.js>");
}
const { PGlite } = await import(pathToFileURL(modulePath).href);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
async function expand(file) {
  const source = await readFile(file, "utf8");
  const expanded = [];
  for (const line of source.split("\n")) {
    const include = /^\\ir\s+(.+)\s*$/.exec(line);
    expanded.push(include ? await expand(path.resolve(path.dirname(file), include[1].trim())) : line);
  }
  return expanded.join("\n");
}
const database = await PGlite.create({ dataDir: "memory://", username: "postgres" });
try {
  console.log((await database.query("select version() as engine")).rows[0]);
  for (const file of [
    "supabase/tests/google_calendar_activation_status_export.fixture.sql",
    // Previous protocol assertions run against the new forward definitions.
    "supabase/tests/google_calendar_outbound_protocol.test.sql",
  ]) {
    const results = await database.exec(await expand(path.join(root, file)));
    console.log(`PASS ${file}: ${results.length} SQL results (includes setup/DDL, not an assertion count).`);
    console.log((await database.query("select session_user,current_user,current_setting('role') as role,has_function_privilege('service_role','public.google_calendar_get_token_secret(uuid)','execute') as service_secret_execute")).rows[0]);
  }
} catch (error) {
  console.error(JSON.stringify({ message: error.message, code: error.code, detail: error.detail, where: error.where }));
  process.exitCode = 1;
} finally {
  await database.close();
}
