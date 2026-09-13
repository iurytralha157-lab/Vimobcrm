import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const functionsDirectory = path.join(repositoryRoot, "supabase", "functions");
const manifestPath = path.join(functionsDirectory, "production-manifest.json");
const configPath = path.join(repositoryRoot, "supabase", "config.toml");
const writeManifest = process.argv.includes("--write");
const writeConfig = process.argv.includes("--write-config");
const hashAlgorithm = "sha256-tree-utf8-lf-v1";
const managedConfigStart = "# BEGIN: production-manifest verify_jwt (generated)";
const managedConfigEnd = "# END: production-manifest verify_jwt (generated)";

const ignoredSourcePatterns = [
  /(?:^|\/)\.DS_Store$/,
  /\.test\.[cm]?[jt]sx?$/,
  /(?:^|\/)__snapshots__\//,
];
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".md",
  ".mjs",
  ".toml",
  ".ts",
  ".tsx",
]);

function normalizeText(buffer, filename) {
  if (!textExtensions.has(path.extname(filename).toLowerCase())) return buffer;
  return Buffer.from(
    buffer.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"),
    "utf8",
  );
}

async function sourceFiles(directory, relativeDirectory = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (ignoredSourcePatterns.some((pattern) => pattern.test(relativePath))) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(absolutePath, relativePath)));
    } else if (entry.isFile()) {
      files.push({ absolutePath, relativePath });
    }
  }

  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

async function treeHash(directory) {
  const hash = createHash("sha256");
  const files = await sourceFiles(directory);

  for (const file of files) {
    const content = normalizeText(await readFile(file.absolutePath), file.relativePath);
    hash.update(file.relativePath, "utf8");
    hash.update("\0");
    hash.update(String(content.byteLength), "utf8");
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }

  return hash.digest("hex");
}

async function functionDirectories() {
  const entries = await readdir(functionsDirectory, { withFileTypes: true });
  const directories = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "_shared") continue;
    const indexPath = path.join(functionsDirectory, entry.name, "index.ts");
    try {
      if ((await stat(indexPath)).isFile()) directories.push(entry.name);
    } catch {
      // A directory without index.ts is support material, not an Edge entrypoint.
    }
  }

  return directories.sort((left, right) => left.localeCompare(right));
}

function parseFunctionConfig(raw) {
  const values = new Map();
  const duplicates = [];
  let currentSlug = null;

  for (const line of raw.split(/\r?\n/)) {
    const section = line.match(/^\[functions\.([^\]]+)]\s*$/);
    if (section) {
      currentSlug = section[1];
      if (values.has(currentSlug)) duplicates.push(currentSlug);
      continue;
    }

    const value = line.match(/^verify_jwt\s*=\s*(true|false)\s*$/);
    if (value && currentSlug) {
      values.set(currentSlug, value[1] === "true");
      currentSlug = null;
    }
  }

  return { values, duplicates };
}

function looksLikeTombstone(source) {
  return (
    /retiredUserMutation|serveRetired[A-Za-z]+/.test(source) ||
    /\bretired legacy\b|\blegacy (?:function|endpoint).*\bretired\b|\bfunction retired\b/i.test(
      source,
    ) ||
    /\b(?:rota|endpoint)\b.{0,100}\bdesativad[ao]\b/is.test(source) ||
    /\blegacy Edge endpoint\b.{0,240}\btombstone\b/is.test(source) ||
    (/\bretired\b|\bdesativad[ao]\b/i.test(source) &&
      /\b410\b/.test(source))
  );
}

function lifecycleFor(entry, source) {
  if (entry?.lifecycle) return entry.lifecycle;
  if (entry?.status === "RETIRED") return "RETIRED";
  return looksLikeTombstone(source) ? "TOMBSTONE" : "LIVE";
}

function authBoundaryFor(status, verifyJwt) {
  if (status === "RETIRED") return "NOT_ROUTABLE";
  return verifyJwt ? "GATEWAY_JWT" : "HANDLER_MANAGED";
}

function validHash(value) {
  return value === null || /^[a-f0-9]{64}$/.test(value);
}

async function buildManifest(previous, configValues) {
  const previousBySlug = new Map(
    (previous.functions ?? []).map((entry) => [entry.slug, entry]),
  );
  const functions = [];

  for (const slug of await functionDirectories()) {
    const previousEntry = previousBySlug.get(slug);
    const source = await readFile(
      path.join(functionsDirectory, slug, "index.ts"),
      "utf8",
    );
    const status = previousEntry?.status ?? "ACTIVE";
    const verifyJwt =
      previousEntry?.verify_jwt ?? configValues.get(slug) ?? true;

    functions.push({
      slug,
      status,
      lifecycle: lifecycleFor(previousEntry, source),
      version: previousEntry?.version ?? null,
      verify_jwt: verifyJwt,
      auth_boundary: authBoundaryFor(status, verifyJwt),
      captured_deployment_sha256:
        previousEntry?.captured_deployment_sha256 ?? previousEntry?.sha256 ?? null,
      source_sha256: await treeHash(path.join(functionsDirectory, slug)),
    });
  }

  return {
    schema_version: 2,
    source_project_ref: previous.source_project_ref,
    captured_at: previous.captured_at,
    purpose:
      "Canonical Edge Function deployment inventory. ACTIVE entries are routable; RETIRED entries are inventory-only.",
    source_hash_algorithm: hashAlgorithm,
    shared_source_sha256: await treeHash(
      path.join(functionsDirectory, "_shared"),
    ),
    functions,
  };
}

function stripManagedConfig(raw) {
  const start = raw.indexOf(managedConfigStart);
  if (start === -1) return raw.trimEnd();
  const end = raw.indexOf(managedConfigEnd, start);
  if (end === -1) {
    throw new Error(`Found ${managedConfigStart} without its closing marker.`);
  }
  return `${raw.slice(0, start)}${raw.slice(end + managedConfigEnd.length)}`.trimEnd();
}

function managedConfig(raw, manifest) {
  const base = stripManagedConfig(raw);
  const manuallyConfigured = parseFunctionConfig(base).values;
  const generated = manifest.functions
    .filter(
      (entry) =>
        entry.status === "ACTIVE" && !manuallyConfigured.has(entry.slug),
    )
    .map(
      (entry) =>
        `[functions.${entry.slug}]\nverify_jwt = ${String(entry.verify_jwt)}`,
    );

  if (generated.length === 0) return `${base}\n`;
  return `${base}\n\n${managedConfigStart}\n# Do not edit this block manually. Update production-manifest.json and run:\n# node scripts/supabase/verify-edge-functions.mjs --write-config\n${generated.join("\n\n")}\n${managedConfigEnd}\n`;
}

async function validateManifest(manifest, configRaw) {
  const problems = [];
  const directories = await functionDirectories();
  const directorySet = new Set(directories);
  const manifestEntries = manifest.functions ?? [];
  const bySlug = new Map();

  if (manifest.schema_version !== 2) {
    problems.push(`manifest schema_version must be 2, got ${manifest.schema_version}`);
  }
  if (manifest.source_hash_algorithm !== hashAlgorithm) {
    problems.push(
      `manifest source_hash_algorithm must be ${hashAlgorithm}, got ${manifest.source_hash_algorithm}`,
    );
  }

  const currentSharedHash = await treeHash(
    path.join(functionsDirectory, "_shared"),
  );
  if (manifest.shared_source_sha256 !== currentSharedHash) {
    problems.push(
      `_shared source changed (manifest ${manifest.shared_source_sha256}, current ${currentSharedHash})`,
    );
  }

  for (const entry of manifestEntries) {
    if (!entry?.slug || typeof entry.slug !== "string") {
      problems.push("manifest contains an entry without a slug");
      continue;
    }
    if (bySlug.has(entry.slug)) {
      problems.push(`${entry.slug}: duplicate manifest entry`);
      continue;
    }
    bySlug.set(entry.slug, entry);

    if (!directorySet.has(entry.slug)) {
      problems.push(`${entry.slug}: manifest entry has no local index.ts`);
      continue;
    }
    if (!['ACTIVE', 'RETIRED'].includes(entry.status)) {
      problems.push(`${entry.slug}: invalid status ${entry.status}`);
    }
    if (!['LIVE', 'TOMBSTONE', 'RETIRED'].includes(entry.lifecycle)) {
      problems.push(`${entry.slug}: invalid lifecycle ${entry.lifecycle}`);
    }
    if (entry.status === "RETIRED" && entry.lifecycle !== "RETIRED") {
      problems.push(`${entry.slug}: RETIRED status requires RETIRED lifecycle`);
    }
    if (entry.status === "ACTIVE" && entry.lifecycle === "RETIRED") {
      problems.push(`${entry.slug}: ACTIVE status cannot have RETIRED lifecycle`);
    }
    if (typeof entry.verify_jwt !== "boolean") {
      problems.push(`${entry.slug}: verify_jwt must be boolean`);
    }

    const expectedBoundary = authBoundaryFor(entry.status, entry.verify_jwt);
    if (entry.auth_boundary !== expectedBoundary) {
      problems.push(
        `${entry.slug}: auth_boundary must be ${expectedBoundary}, got ${entry.auth_boundary}`,
      );
    }
    if (!validHash(entry.captured_deployment_sha256)) {
      problems.push(`${entry.slug}: captured_deployment_sha256 is malformed`);
    }

    const sourcePath = path.join(functionsDirectory, entry.slug);
    const currentHash = await treeHash(sourcePath);
    if (entry.source_sha256 !== currentHash) {
      problems.push(
        `${entry.slug}: source changed (manifest ${entry.source_sha256}, current ${currentHash})`,
      );
    }

    const source = await readFile(path.join(sourcePath, "index.ts"), "utf8");
    const tombstoneSource = looksLikeTombstone(source);
    if (entry.lifecycle === "TOMBSTONE" && !tombstoneSource) {
      problems.push(`${entry.slug}: TOMBSTONE source has no retirement marker`);
    }
    if (entry.lifecycle === "LIVE" && tombstoneSource) {
      problems.push(`${entry.slug}: retirement source is incorrectly marked LIVE`);
    }
    if (
      entry.lifecycle === "TOMBSTONE" &&
      /createClient|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_URL|Deno\.env|getenv\s*\(|fetch\s*\(/i.test(
        source,
      )
    ) {
      problems.push(`${entry.slug}: TOMBSTONE still contains privileged/runtime I/O`);
    }
  }

  for (const slug of directories) {
    if (!bySlug.has(slug)) problems.push(`${slug}: local function is absent from manifest`);
  }

  const { values: configValues, duplicates } = parseFunctionConfig(configRaw);
  for (const slug of duplicates) {
    problems.push(`${slug}: duplicate [functions.${slug}] config section`);
  }
  for (const [slug, verifyJwt] of configValues) {
    const entry = bySlug.get(slug);
    if (!entry) {
      problems.push(`${slug}: config section is absent from manifest`);
    } else if (entry.status === "RETIRED") {
      problems.push(`${slug}: RETIRED function must not have an executable config section`);
    } else if (entry.verify_jwt !== verifyJwt) {
      problems.push(
        `${slug}: config verify_jwt=${verifyJwt} differs from manifest ${entry.verify_jwt}`,
      );
    }
  }
  for (const entry of manifestEntries) {
    if (entry.status === "ACTIVE" && !configValues.has(entry.slug)) {
      problems.push(`${entry.slug}: ACTIVE function has no explicit config section`);
    }
  }

  return problems;
}

let configRaw = await readFile(configPath, "utf8");
let manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (writeManifest) {
  manifest = await buildManifest(manifest, parseFunctionConfig(configRaw).values);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Updated source hashes for ${manifest.functions.length} Edge Functions.`);
}

if (writeConfig) {
  configRaw = managedConfig(configRaw, manifest);
  await writeFile(configPath, configRaw, "utf8");
  console.log("Synchronized explicit Edge Function verify_jwt configuration.");
}

const problems = await validateManifest(manifest, configRaw);
if (problems.length > 0) {
  console.error("Supabase Edge Function release gate failed:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  const counts = manifest.functions.reduce(
    (result, entry) => {
      result[entry.lifecycle] += 1;
      return result;
    },
    { LIVE: 0, TOMBSTONE: 0, RETIRED: 0 },
  );
  console.log(
    `Supabase Edge Function manifest OK (${counts.LIVE} live, ${counts.TOMBSTONE} tombstones, ${counts.RETIRED} retired).`,
  );
}
