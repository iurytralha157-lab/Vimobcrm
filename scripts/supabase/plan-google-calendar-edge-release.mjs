import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const functionsRoot = path.join(repositoryRoot, "supabase", "functions");
const manifestPath = path.join(functionsRoot, "production-manifest.json");
const verifierPath = path.join(repositoryRoot, "scripts", "supabase", "verify-edge-functions.mjs");
const releaseSlugs = ["google-calendar-oauth", "google-calendar-sync"];
const legacySlug = "google-calendar-auth";
const outboundClaimMigration = "supabase/migrations/20261006150000_claim_google_calendar_outbound_jobs.sql";

function parseArguments(args) {
  let runtimeSlugs = null;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
    } else if (argument === "--runtime-slugs") {
      if (runtimeSlugs !== null || !args[index + 1]) {
        throw new Error("Use --runtime-slugs uma vez, seguido dos slugs atuais separados por virgula.");
      }
      runtimeSlugs = args[++index].split(",").map((slug) => slug.trim());
      if (
        runtimeSlugs.some((slug) => !/^[a-z0-9][a-z0-9-]*$/.test(slug)) ||
        new Set(runtimeSlugs).size !== runtimeSlugs.length
      ) {
        throw new Error("O inventario do runtime contem slug vazio, invalido ou duplicado.");
      }
    } else {
      throw new Error(`Argumento desconhecido: ${argument}`);
    }
  }

  return { runtimeSlugs, json };
}

function verifyManifest() {
  const result = spawnSync(process.execPath, [verifierPath], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`O gate do manifesto falhou:\n${result.stdout}${result.stderr}`);
  }
  return result.stdout.trim();
}

function relativeName(filePath) {
  return path.relative(functionsRoot, filePath).split(path.sep).join("/");
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function resolveRelativeImport(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const relative = path.relative(functionsRoot, base);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Import relativo fora de supabase/functions: ${specifier}`);
  }
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;
  }
  throw new Error(`Import relativo nao encontrado: ${relativeName(fromFile)} -> ${specifier}`);
}

async function localDependencies(filePath, seen = new Set()) {
  if (seen.has(filePath)) return seen;
  seen.add(filePath);
  const source = await readFile(filePath, "utf8");
  const relativeImports = [
    ...source.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)["'](\.{1,2}\/[^"']+)["']/g),
  ];
  for (const match of relativeImports) {
    const dependency = await resolveRelativeImport(filePath, match[1]);
    const name = relativeName(dependency);
    if (!name.startsWith("_shared/") && !releaseSlugs.some((slug) => name.startsWith(`${slug}/`))) {
      throw new Error(`Dependencia local fora do pacote Google Calendar: ${name}`);
    }
    await localDependencies(dependency, seen);
  }
  return seen;
}

async function buildPlan(runtimeSlugs) {
  const manifestCheck = verifyManifest();
  if (!(await isFile(path.join(repositoryRoot, outboundClaimMigration)))) {
    throw new Error(`Pre-requisito de banco ausente: ${outboundClaimMigration}`);
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const bySlug = new Map(manifest.functions.map((entry) => [entry.slug, entry]));

  for (const slug of releaseSlugs) {
    const entry = bySlug.get(slug);
    if (entry?.status !== "ACTIVE" || entry.lifecycle !== "LIVE" || entry.verify_jwt !== false) {
      throw new Error(`${slug}: esperado ACTIVE/LIVE com verify_jwt=false.`);
    }
  }
  const legacy = bySlug.get(legacySlug);
  if (legacy?.status !== "ACTIVE" || legacy.lifecycle !== "TOMBSTONE" || legacy.verify_jwt !== true) {
    throw new Error(`${legacySlug}: esperado ACTIVE/TOMBSTONE com verify_jwt=true.`);
  }

  const dependencies = new Set();
  for (const slug of releaseSlugs) {
    await localDependencies(path.join(functionsRoot, slug, "index.ts"), dependencies);
  }
  const sharedFiles = [...dependencies]
    .map(relativeName)
    .filter((name) => name.startsWith("_shared/"))
    .sort();
  const routable = new Set(
    manifest.functions
      .filter((entry) => entry.status === "ACTIVE" && ["LIVE", "TOMBSTONE"].includes(entry.lifecycle))
      .map((entry) => entry.slug),
  );

  return {
    scope: "local-read-only-plan; no copy, deploy, SSH, secrets or production changes",
    manifest_check: manifestCheck,
    source_manifest_captured_at: manifest.captured_at,
    source_project_ref: manifest.source_project_ref,
    release_directories: releaseSlugs.map((slug) => ({
      path: `supabase/functions/${slug}`,
      verify_jwt: bySlug.get(slug).verify_jwt,
    })),
    shared_files: sharedFiles.map((name) => `supabase/functions/${name}`),
    access_policy: {
      vimob: "pilot users with Agenda access only; existing connections remain readable and continue outbound sync",
      connect_mode: "pilot",
      required_edge_env: ["GOOGLE_CALENDAR_CONNECT_MODE=pilot", "GOOGLE_CALENDAR_PILOT_USER_IDS=<Vimob user UUID>"],
      user_uuid_allowlist_required: true,
      google_cloud_oauth_audience_verified: false,
    },
    database_prerequisite: {
      migration: outboundClaimMigration,
      rpc: "public.google_calendar_claim_outbound_sync_jobs(integer, text)",
      runtime_verified: false,
      required_before_sync_worker: true,
    },
    versioned_router_requires: [
      "supabase/functions/production-manifest.json",
      "deploy/supabase-self-hosted/functions-main/index.ts",
    ],
    legacy_tombstone: {
      path: `supabase/functions/${legacySlug}`,
      publish_for_one_way: false,
    },
    inbound_webhook: {
      path: "supabase/functions/google-calendar-webhook",
      publish_for_one_way: false,
    },
    observed_runtime_slugs: runtimeSlugs,
    would_be_denied_by_repository_router: runtimeSlugs?.filter((slug) => !routable.has(slug)) ?? null,
    runtime_router_and_mount_verified: false,
  };
}

function printPlan(plan) {
  console.log("Plano local de Edge Functions Google Calendar (nenhuma publicacao executada)");
  console.log(plan.manifest_check);
  console.log(`Manifesto historico: ${plan.source_manifest_captured_at}, projeto ${plan.source_project_ref}`);
  console.log(`Diretorios: ${plan.release_directories.map((item) => item.path).join(", ")}`);
  console.log(`Dependencias _shared: ${plan.shared_files.join(", ")}`);
  console.log(`Acesso no Vimob: ${plan.access_policy.vimob}. Configure ${plan.access_policy.required_edge_env.join(" e ")}; sem essas variaveis novas conexoes ficam bloqueadas. Confirme o publico e a verificacao do OAuth no Google Cloud.`);
  console.log(`Pre-requisito do worker: ${plan.database_prerequisite.migration} (${plan.database_prerequisite.rpc}), aplicar somente apos reconciliacao do banco.`);
  console.log(`Fora do fluxo de mao unica: ${plan.inbound_webhook.path}, ${plan.legacy_tombstone.path}`);
  if (plan.observed_runtime_slugs) {
    console.log(`Rotas observadas a preservar: ${plan.observed_runtime_slugs.join(", ")}`);
    console.log(
      `Rotas que o roteador versionado rejeitaria: ${plan.would_be_denied_by_repository_router.join(", ") || "nenhuma nesta lista"}`,
    );
  } else {
    console.log("Inventario atual do runtime: NAO INFORMADO; confirme no host antes do release.");
  }
  console.log("Roteador e mount atuais: NAO VERIFICADOS. Nao substitua roteador, manifesto ou _shared em producao por este plano.");
}

try {
  const { runtimeSlugs, json } = parseArguments(process.argv.slice(2));
  const plan = await buildPlan(runtimeSlugs);
  if (json) console.log(JSON.stringify(plan, null, 2));
  else printPlan(plan);
} catch (error) {
  console.error(`Preflight Google Calendar falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
