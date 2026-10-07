import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "plan-google-calendar-edge-release.mjs");

function invoke(...args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
}

test("enumera apenas OAuth e envio da Agenda, sem webhook", () => {
  const result = invoke("--json");
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);

  assert.deepEqual(
    plan.release_directories.map((entry) => entry.path),
    [
      "supabase/functions/google-calendar-oauth",
      "supabase/functions/google-calendar-sync",
    ],
  );
  for (const dependency of [
    "supabase/functions/_shared/google-calendar-access.ts",
    "supabase/functions/_shared/google-calendar-event.ts",
    "supabase/functions/_shared/google-calendar-pilot.ts",
    "supabase/functions/_shared/google-calendar-time.ts",
    "supabase/functions/_shared/google-calendar.ts",
  ]) {
    assert.ok(plan.shared_files.includes(dependency), `${dependency} ausente do plano`);
  }
  assert.ok(plan.shared_files.every((name) => name.startsWith("supabase/functions/_shared/")));
  assert.equal(Object.hasOwn(plan, "canary"), false);
  assert.match(plan.access_policy.vimob, /^pilot users with Agenda access only/);
  assert.equal(plan.access_policy.connect_mode, "pilot");
  assert.deepEqual(plan.access_policy.required_edge_env, [
    "GOOGLE_CALENDAR_CONNECT_MODE=pilot",
    "GOOGLE_CALENDAR_PILOT_USER_IDS=<Vimob user UUID>",
  ]);
  assert.equal(plan.access_policy.user_uuid_allowlist_required, true);
  assert.equal(plan.access_policy.google_cloud_oauth_audience_verified, false);
  assert.equal(
    plan.database_prerequisite.rpc,
    "public.google_calendar_claim_outbound_sync_jobs(integer, text)",
  );
  assert.equal(plan.database_prerequisite.required_before_sync_worker, true);
  assert.equal(plan.database_prerequisite.runtime_verified, false);
  assert.equal(plan.legacy_tombstone.publish_for_one_way, false);
  assert.equal(plan.inbound_webhook.publish_for_one_way, false);
  assert.equal(plan.runtime_router_and_mount_verified, false);
  assert.equal(plan.observed_runtime_slugs, null);
});

test("evidencia as rotas existentes que o roteador versionado bloquearia", () => {
  const result = invoke(
    "--json",
    "--runtime-slugs",
    "asaas-create-charge,asaas-webhook,evolution-go-webhook,hello,meta-oauth",
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);

  assert.equal(plan.observed_runtime_slugs.length, 5);
  assert.deepEqual(plan.would_be_denied_by_repository_router, ["hello", "meta-oauth"]);
});

test("recusa inventario ambiguo antes de executar o gate", () => {
  const result = invoke("--runtime-slugs", "hello,hello");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /slug vazio, invalido ou duplicado/);
});
