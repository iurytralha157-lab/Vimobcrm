import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const migrationsDirectory = path.join(repositoryRoot, "supabase", "migrations");
const lockPath = path.join(repositoryRoot, "supabase", "migrations.source-lock.json");
const writeMode = process.argv.includes("--write");

function normalizedSql(source) {
  return source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

function sha256(source) {
  return createHash("sha256").update(normalizedSql(source), "utf8").digest("hex");
}

function validTimestamp(raw) {
  const match = raw.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
  );
  if (!match) return false;

  const [, year, month, day, hour, minute, second] = match.map(Number);
  const value = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day &&
    value.getUTCHours() === hour &&
    value.getUTCMinutes() === minute &&
    value.getUTCSeconds() === second
  );
}

async function inventoryMigrations() {
  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  const problems = [];
  const timestamps = new Set();
  const descriptions = new Set();
  const migrations = [];

  for (const filename of filenames) {
    const match = filename.match(/^(\d{14})_([a-z0-9][a-z0-9_]*)\.sql$/);
    if (!match || !validTimestamp(match[1])) {
      problems.push(
        `${filename}: expected YYYYMMDDHHMMSS_descriptive_snake_case.sql`,
      );
      continue;
    }

    const [, timestamp, description] = match;
    if (timestamps.has(timestamp)) {
      problems.push(`${filename}: duplicate migration timestamp ${timestamp}`);
    }
    timestamps.add(timestamp);

    if (descriptions.has(description)) {
      problems.push(
        `${filename}: duplicate migration description ${description}; use a precise new name`,
      );
    }
    descriptions.add(description);

    const source = await readFile(path.join(migrationsDirectory, filename), "utf8");
    if (!normalizedSql(source).trim()) {
      problems.push(`${filename}: migration is empty`);
      continue;
    }

    migrations.push({ file: filename, sha256: sha256(source) });
  }

  return { migrations, problems };
}

function lockDocument(migrations) {
  return {
    schema_version: 1,
    algorithm: "sha256-utf8-lf-v1",
    purpose:
      "Detect edits, removals, reordering collisions, and empty files in the active Supabase migration chain.",
    migrations,
  };
}

function compareLock(expected, actual) {
  const problems = [];
  if (expected.schema_version !== 1) {
    problems.push(`unsupported lock schema_version ${expected.schema_version}`);
  }
  if (expected.algorithm !== "sha256-utf8-lf-v1") {
    problems.push(`unsupported lock algorithm ${expected.algorithm}`);
  }

  const expectedByFile = new Map(
    (expected.migrations ?? []).map((entry) => [entry.file, entry.sha256]),
  );
  const actualByFile = new Map(actual.map((entry) => [entry.file, entry.sha256]));

  for (const [file, expectedHash] of expectedByFile) {
    const actualHash = actualByFile.get(file);
    if (!actualHash) {
      problems.push(`${file}: locked migration is missing`);
    } else if (actualHash !== expectedHash) {
      problems.push(
        `${file}: source changed (lock ${expectedHash}, current ${actualHash})`,
      );
    }
  }

  for (const file of actualByFile.keys()) {
    if (!expectedByFile.has(file)) {
      problems.push(
        `${file}: new migration is not locked; review it, then run this script with --write`,
      );
    }
  }

  return problems;
}

const { migrations, problems: inventoryProblems } = await inventoryMigrations();
if (inventoryProblems.length > 0) {
  console.error("Supabase migration inventory is invalid:");
  for (const problem of inventoryProblems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else if (writeMode) {
  await writeFile(
    lockPath,
    `${JSON.stringify(lockDocument(migrations), null, 2)}\n`,
    "utf8",
  );
  console.log(`Locked ${migrations.length} active Supabase migrations.`);
} else {
  let expected;
  try {
    expected = JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    console.error(
      `Unable to read ${path.relative(repositoryRoot, lockPath)}: ${error.message}`,
    );
    process.exitCode = 1;
  }

  if (expected) {
    const lockProblems = compareLock(expected, migrations);
    if (lockProblems.length > 0) {
      console.error("Supabase migration source lock failed:");
      for (const problem of lockProblems) console.error(`- ${problem}`);
      process.exitCode = 1;
    } else {
      console.log(
        `Supabase migration source lock OK (${migrations.length} non-empty migrations).`,
      );
    }
  }
}
