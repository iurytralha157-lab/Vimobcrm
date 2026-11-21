import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// No database URL is accepted: this always uses a fresh, in-memory runtime.
const modulePath = process.argv[2];
if (!modulePath || !path.isAbsolute(modulePath)) {
  throw new Error("Usage: node scripts/supabase/test-google-tasks-lifecycle-sql.mjs <absolute pinned PGlite dist/index.js>");
}
const { PGlite } = await import(pathToFileURL(modulePath).href);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
async function expand(file) {
  const source = await readFile(file, "utf8");
  return (await Promise.all(source.split("\n").map(line => {
    const include = /^\\ir\s+(.+)\s*$/.exec(line);
    return include ? expand(path.resolve(path.dirname(file), include[1].trim())) : line;
  }))).join("\n");
}
const database = await PGlite.create({ dataDir: "memory://", username: "postgres" });
try {
  const results = await database.exec(await expand(path.join(root, "supabase/tests/google_tasks_outbound.fixture.sql")));
  console.log(`PASS Google Tasks two-tenant lifecycle: ${results.length} SQL statements, including DDL and assertions.`);
} catch (error) {
  console.error(JSON.stringify({ message: error.message, code: error.code, detail: error.detail, where: error.where }));
  process.exitCode = 1;
} finally {
  await database.close();
}
