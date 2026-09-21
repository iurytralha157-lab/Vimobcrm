import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const migration = source(
  "../migrations/20260921115616_add_silent_historical_lead_import.sql",
);
const stageClockRepair = source(
  "../migrations/20260921132800_guard_historical_stage_clock.sql",
);
const poolChecker = source("./pool-checker/index.ts");

test("historical import keeps external identity separate from phone identity", () => {
  assert.match(migration, /external_source text/);
  assert.match(migration, /external_source_id text/);
  assert.match(migration, /leads_org_external_identity_unique/);
  assert.match(migration, /external:<source>:<source_id>/);
  assert.match(migration, /lead_intake_scope_for_external/);
  assert.match(migration, /leads_org_scope_phone_unique/);
  assert.match(migration, /historical_import_legacy_global_phone_identity_active/);
  assert.match(migration, /lead_external_identity_requires_import_capability/);
  assert.match(
    migration,
    /context\.organization_id = new\.organization_id/,
  );
});

test("historical mode is capability-bound and never disables triggers", () => {
  assert.match(migration, /historical_lead_import_contexts/);
  assert.match(migration, /pg_current_xact_id\(\)/);
  assert.match(migration, /vimob\.historical_import_token/);
  assert.match(migration, /historical_import_effects_suppressed/);
  assert.doesNotMatch(migration, /set\s+(?:local\s+)?session_replication_role/i);
  assert.doesNotMatch(migration, /alter\s+table[\s\S]*disable\s+trigger/i);
});

test("durable suppression covers periodic scanners and direct pool discovery", () => {
  assert.match(migration, /operational_effects_suppressed boolean[\s\S]*not null default false/);
  assert.match(migration, /historical_imported_at timestamptz/);

  const scannerFilters = migration.match(
    /l\.operational_effects_suppressed = false/g,
  ) || [];
  assert.ok(
    scannerFilters.length >= 2,
    "SLA and automation inactivity scanners must both exclude historical leads",
  );

  const poolFilters = poolChecker.match(
    /\.eq\("operational_effects_suppressed", false\)/g,
  ) || [];
  assert.equal(
    poolFilters.length,
    2,
    "warning and redistribution discovery must both exclude historical leads",
  );

  assert.match(
    migration,
    /create or replace function public\.get_sla_pending_leads\(\)[\s\S]*?set search_path = 'public'[\s\S]*?and l\.operational_effects_suppressed = false[\s\S]*?\$\$;/,
  );
});

test("guarded trigger shapes retain the audited live event definitions", () => {
  const clockGuard = migration.match(
    /create trigger trg_guard_lead_clocks[\s\S]*?execute function private\.guard_lead_clocks\(\);/,
  )?.[0];
  assert.ok(clockGuard, "clock guard trigger must be recreated");
  assert.match(
    clockGuard,
    /before insert or update of\s+stage_id,\s+pipeline_id,\s+stage_entered_at,\s+board_order_at,\s+assigned_user_id,\s+assigned_at,\s+source,\s+attention_eligible,\s+attention_enrolled_at\s+on public\.leads/,
  );
  assert.doesNotMatch(clockGuard, /\b(?:team_id|reentry_count)\b/);
});

test("C2S action logs and chats are visible activities with stable UI identity", () => {
  const activityInserts = migration.match(
    /^\s*insert into public\.activities/gm,
  ) || [];
  assert.equal(activityInserts.length, 2);
  assert.doesNotMatch(
    migration,
    /^\s*insert into public\.lead_timeline_events/gm,
  );
  assert.match(migration, /'note'/);
  assert.match(migration, /'whatsapp_message_received'/);
  assert.match(migration, /'whatsapp_message_sent'/);
  assert.match(migration, /'kind', v_source_system \|\| ':event:' \|\| v_source_id/);
  assert.match(migration, /'kind', v_source_system \|\| ':chat:' \|\| v_source_id/);
});

test("business clocks require evidence and are never fabricated from created_at", () => {
  const pipelineDefaultGuard = migration.match(
    /create trigger tr_ensure_lead_pipeline[\s\S]*?execute function public\.ensure_lead_has_pipeline\(\);/,
  )?.[0];
  assert.ok(
    pipelineDefaultGuard,
    "pipeline default trigger must be recreated with a historical clock guard",
  );
  assert.match(
    pipelineDefaultGuard,
    /not private\.historical_import_effects_suppressed\(\)[\s\S]*?new\.operational_effects_suppressed = false/,
  );
  assert.match(
    migration,
    /v_stage_entered_at\s*:=\s*\n\s*nullif\(v_payload->>'stage_entered_at', ''\)::timestamptz/,
  );
  assert.match(
    migration,
    /v_assigned_at\s*:=\s*\n\s*nullif\(v_payload->>'assigned_at', ''\)::timestamptz/,
  );
  assert.match(
    migration,
    /when v_deal_status = 'won'[\s\S]*?then nullif\(v_payload->>'won_at', ''\)::timestamptz/,
  );
  assert.match(
    migration,
    /when v_deal_status = 'lost'[\s\S]*?then nullif\(v_payload->>'lost_at', ''\)::timestamptz/,
  );
  assert.doesNotMatch(
    migration,
    /v_(?:stage_entered|assigned|won|lost)_at\s*:=\s*coalesce\([\s\S]{0,160}?v_created_at/,
  );
  assert.match(migration, /historical_import_timestamp_provenance_required/);
  for (const field of [
    "created_at",
    "updated_at",
    "stage_entered_at",
    "assigned_at",
    "won_at",
    "lost_at",
  ]) {
    assert.match(migration, new RegExp(`'${field}'`));
  }
});

test("forward clock repair is bounded, idempotent and effect-checked", () => {
  assert.match(stageClockRepair, /^begin;/m);
  assert.match(stageClockRepair, /create trigger tr_ensure_lead_pipeline/);
  assert.match(
    stageClockRepair,
    /not private\.historical_import_effects_suppressed\(\)[\s\S]*?new\.operational_effects_suppressed = false/,
  );
  assert.match(stageClockRepair, /v_target_count <> 4/);
  assert.match(stageClockRepair, /v_non_null_count not in \(0, 4\)/);
  assert.match(stageClockRepair, /lock table public\.leads in share row exclusive mode/);
  assert.match(stageClockRepair, /disable trigger update_leads_updated_at/);
  assert.match(stageClockRepair, /enable trigger update_leads_updated_at/);
  assert.match(stageClockRepair, /historical_stage_clock_updated_at_trigger_readback_failed/);
  assert.match(stageClockRepair, /private\.canonical_jsonb_sha256\(ledger\.payload\)/);
  assert.match(stageClockRepair, /ledger\.source_id = expected\.source_id/);
  assert.match(stageClockRepair, /ledger\.target_id = expected\.lead_id/);
  assert.match(stageClockRepair, /ledger\.payload_sha256 = expected\.payload_sha256/);
  assert.match(stageClockRepair, /set stage_entered_at = null/);
  assert.match(
    stageClockRepair,
    /unresolved_no_stage_entered_timestamp_evidence/,
  );
  assert.match(stageClockRepair, /historical_import_effect_counts/);
  assert.match(stageClockRepair, /historical_import_effect_delta/);
  assert.match(stageClockRepair, /historical_stage_clock_side_effect_detected/);
  assert.match(stageClockRepair, /historical_stage_clock_final_readback_failed/);
  assert.match(stageClockRepair, /historical_stage_clock_trigger_readback_failed/);
  assert.match(stageClockRepair, /commit;\s*$/);
});

test("apply validates canonical hashes and returns per-sink zero-effect proof", () => {
  assert.match(migration, /historical_import_records_hash_mismatch/);
  assert.match(migration, /private\.canonical_jsonb_sha256\(v_records\)/);
  assert.match(migration, /historical_import_side_effect_detected/);
  assert.match(migration, /'records_sha256', v_declared_records_sha256/);
  assert.match(migration, /'effect_proof'/);
  assert.match(migration, /'suppression_active'/);
  assert.match(migration, /'durable_marker_enforced', true/);
  assert.match(migration, /'sinks', v_effect_sinks/);
  assert.match(migration, /'all_zero', v_effect_all_zero/);
});

test("effect proof has 33 cohort-scoped sinks and a matching preflight contract", () => {
  const effectCounts = migration.match(
    /create or replace function private\.historical_import_effect_counts\([\s\S]*?\n\$\$;/,
  )?.[0];
  assert.ok(effectCounts, "effect-count helper must exist");
  assert.match(
    effectCounts,
    /p_organization_id uuid,\s*p_lead_ids uuid\[\],\s*p_entity_ids uuid\[\]/,
  );

  const sinkNames = [...effectCounts.matchAll(/^    '([^']+)', \(/gm)]
    .map((match) => match[1]);
  assert.equal(sinkNames.length, 33);
  assert.ok(sinkNames.includes("outbox_messages"));
  assert.ok(sinkNames.includes("audit_logs"));
  assert.match(
    effectCounts,
    /outbox_message\.organization_id = p_organization_id[\s\S]*?outbox_message\.lead_id = any\(v_lead_ids\)/,
  );
  assert.match(
    effectCounts,
    /audit_log\.organization_id = p_organization_id[\s\S]*?audit_log\.entity_id = any\(v_entity_id_texts\)/,
  );
  assert.doesNotMatch(effectCounts, /ai_outbox_messages/);
  assert.match(
    migration,
    /public\.ai_outbox_messages is intentionally excluded:[\s\S]*?organization-wide delta/,
  );
  assert.match(
    migration,
    /to_regprocedure\(\s*'private\.historical_import_effect_counts\(uuid,uuid\[\],uuid\[\]\)'\s*\)/,
  );
  assert.match(migration, /v_effect_sink_count = 33/);
  assert.match(
    migration,
    /'effect_proof_sink_contract_ready', v_effect_sink_contract_ready/,
  );
  assert.match(migration, /'effect_proof_sink_count', v_effect_sink_count/);
});

test("PostgREST boundaries expose only service-role public RPCs", () => {
  assert.match(
    migration,
    /create or replace function public\.import_historical_lead_batch[\s\S]*?security definer[\s\S]*?set search_path = ''/,
  );
  assert.match(
    migration,
    /revoke all on function public\.import_historical_lead_batch\(uuid, uuid, jsonb\)[\s\S]*?from public, anon, authenticated, service_role;[\s\S]*?grant execute on function public\.import_historical_lead_batch\(uuid, uuid, jsonb\)[\s\S]*?to service_role;/,
  );
  assert.match(
    migration,
    /revoke all on function private\.import_historical_lead_batch\(uuid, uuid, jsonb\)[\s\S]*?from public, anon, authenticated, service_role;/,
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function private\.import_historical_lead_batch/,
  );
  assert.match(migration, /public\.preflight_historical_lead_import/);
});

test("migration does not resurrect the three triggers absent from live", () => {
  for (const triggerName of [
    "trg_stop_redistribution_on_stage_move",
    "trg_reserve_managed_whatsapp_distribution_auto_reply",
    "trg_enqueue_managed_whatsapp_auto_reply",
  ]) {
    assert.doesNotMatch(
      migration,
      new RegExp(`create\\s+trigger\\s+${triggerName}`, "i"),
    );
  }
});
