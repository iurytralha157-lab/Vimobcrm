import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ApplyImportError,
  appendJournal,
  authorizeApply,
  buildApplyConfirmation,
  createSupabaseTransport,
  createSupabaseRestClient,
  executeImport,
  loadJournal,
  loadRealDbConfig,
  parseApplyCommandLine,
  parseDotEnv,
  validateDatabasePreflight,
  validateEffectProof,
  verifyImportArtifact,
} from "./apply-import.mjs";
import {
  deterministicEntityId,
  sha256Canonical,
} from "./build-import-manifest.mjs";

const ORG_ID = "002c6b70-239d-4d32-a270-0dec3fbb6b17";
const ACTOR_ID = "838ad6e5-e895-426d-a41d-0a0e0079d756";
const PIPELINE_ID = "decb1128-a678-4886-bb6b-5b94f6ebca20";
const STAGE_ID = "6512ec17-0fa6-4b36-8a12-2a6a13320376";
const EXISTING_LEAD_ID = "b34cba54-8150-4c1c-9e61-f3b697cd6762";
const LATER_NON_IMPORT_LEAD_ID = "7af8fb8d-5506-4a0b-85fa-30c2dcad9368";
const EFFECT_SINKS = [
  "notifications", "notification_deliveries", "automation_event_outbox",
  "automation_executions", "automation_effect_dispatches", "automation_execution_steps",
  "outbox_messages", "audit_logs",
  "gamification_outbox", "webhook_delivery_outbox", "lead_funnel_events",
  "meta_crm_event_outbox", "operational_requests", "operational_timelines",
  "lead_tasks", "schedule_events", "cadence_enrollments", "lead_action_facts",
  "lead_assignment_cycles", "lead_stage_cycles", "lead_attention_instances",
  "lead_timeline_events", "assignments_log", "lead_assignment_history",
  "lead_stage_history", "commissions", "financial_entries", "round_robin_logs",
  "lead_redistribution_jobs", "lead_distribution_events", "team_distribution_events",
  "whatsapp_messages", "whatsapp_outbox",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function makeRecord(entityType, externalKey, payload) {
  const targetId = deterministicEntityId(ORG_ID, externalKey);
  return {
    schema_version: 1,
    manifest_kind: "dry_run_only",
    entity_type: entityType,
    target_id: targetId,
    organization_id: ORG_ID,
    external_key: externalKey,
    payload_sha256: sha256Canonical(payload),
    payload,
    provenance: { source_system: "contact2sale", source_lead_id: payload.source_lead_id },
    validation: { ok: true, state: "READY", issues: [] },
    action: "CREATE",
    action_reason: "IDENTITY_NOT_PRESENT",
    apply_eligible: true,
  };
}

async function writeBatch(root, prefix, entityType, records) {
  const directory = path.join(root, ...prefix.split("/"));
  await mkdir(directory, { recursive: true });
  const filename = `${entityType}-0001.json`;
  const document = {
    schema_version: 1,
    manifest_kind: "dry_run_only",
    apply_requires_report_state_ready: true,
    batch: {
      entity_type: entityType,
      index: 1,
      record_count: records.length,
      record_limit: 250,
      byte_limit: 5 * 1024 * 1024,
      records_sha256: sha256Canonical(records),
    },
    records,
  };
  const serialized = `${JSON.stringify(document)}\n`;
  await writeFile(path.join(directory, filename), serialized, "utf8");
  return {
    path: `${prefix}/${filename}`,
    entity_type: entityType,
    index: 1,
    records: records.length,
    bytes: Buffer.byteLength(serialized),
    sha256: sha256(serialized),
    records_sha256: sha256Canonical(records),
  };
}

async function createApplyFixture(root) {
  const leadExternalKey = "contact2sale:Fixture:lead:100";
  const leadId = deterministicEntityId(ORG_ID, leadExternalKey);
  const createdAt = "2025-04-02T14:44:31-03:00";
  const resolvedTimestamp = (value, field) => ({
    value,
    source_field: field,
    confidence: "high",
    is_inferred: false,
    rule: "fixture",
    parse_method: "explicit_four_digit_year",
  });
  const unresolvedTimestamp = (rule) => ({
    value: null,
    source_field: null,
    confidence: "none",
    is_inferred: false,
    rule,
    parse_method: null,
  });
  const lead = makeRecord("lead", leadExternalKey, {
    source_system: "contact2sale",
    source_lead_id: "100",
    pipeline_id: PIPELINE_ID,
    stage_id: STAGE_ID,
    deal_status: "open",
    assigned_user_id: ACTOR_ID,
    name: "Sensitive Person",
    email: "sensitive@example.invalid",
    phone: "+5527999990000",
    message: "Sensitive historical note",
    source: "C2S",
    tags: [],
    created_at: createdAt,
    updated_at: createdAt,
    stage_entered_at: createdAt,
    assigned_at: null,
    won_at: null,
    lost_at: null,
    historical_import: true,
    notification_policy: "suppress_all",
    metadata: {
      source_status: "Novo",
      timestamp_provenance: {
        created_at: resolvedTimestamp(createdAt, "current.created_at_source"),
        updated_at: resolvedTimestamp(createdAt, "current.created_at_source"),
        stage_entered_at: resolvedTimestamp(createdAt, "current.created_at_source"),
        assigned_at: unresolvedTimestamp("unavailable"),
        won_at: unresolvedTimestamp("not_applicable"),
        lost_at: unresolvedTimestamp("not_applicable"),
      },
    },
  });
  const event = makeRecord("event", "contact2sale:Fixture:history:100:event", {
    source_system: "contact2sale",
    source_lead_id: "100",
    lead_id: leadId,
    sequence: 1,
    event_at: "2025-04-02T15:00:00-03:00",
    time_raw: "02/04/25 15:00:00",
    author_source: "Sensitive Operator",
    message: "Sensitive event",
    raw_text: "Sensitive raw event",
    historical_import: true,
    notification_policy: "suppress_all",
    metadata: {},
  });
  const chat = makeRecord("chat", "contact2sale:Fixture:chat:100:chat", {
    source_system: "contact2sale",
    source_lead_id: "100",
    lead_id: leadId,
    sequence: 1,
    event_at: "2025-04-02T15:01:00-03:00",
    time_raw: "15:01 02/04/25",
    author_source: "Sensitive Person",
    message: "Sensitive chat",
    direction: "inbound",
    media: [],
    historical_import: true,
    notification_policy: "suppress_all",
    metadata: {},
  });
  const records = { lead: [lead], event: [event], chat: [chat] };
  const batches = [];
  const canaryBatches = [];
  for (const entityType of ["lead", "event", "chat"]) {
    batches.push(await writeBatch(root, "batches", entityType, records[entityType]));
    canaryBatches.push(await writeBatch(root, "canary/batches", entityType, records[entityType]));
  }

  const canaryReport = {
    schema_version: 1,
    state: "READY",
    apply_authorized: false,
    selection: {
      target_id: leadId,
      event_count: 1,
      chat_count: 1,
      total_history: 2,
    },
    observed_counts: { lead: 1, event: 1, chat: 1 },
    batches: canaryBatches,
  };
  const canaryReportText = `${JSON.stringify(canaryReport, null, 2)}\n`;
  await writeFile(path.join(root, "canary", "report.json"), canaryReportText, "utf8");
  const canaryManifest = {
    schema_version: 1,
    state: "READY",
    apply_authorized: false,
    report_path: "canary/report.json",
    report_sha256: sha256(canaryReportText),
    record_count: 3,
    batches: canaryBatches,
  };
  const canaryManifestText = `${JSON.stringify(canaryManifest, null, 2)}\n`;
  await writeFile(path.join(root, "canary", "manifest.json"), canaryManifestText, "utf8");
  await writeFile(
    path.join(root, "canary", "manifest.sha256"),
    `${sha256(canaryManifestText)}  manifest.json\n`,
    "utf8",
  );

  const report = {
    schema_version: 1,
    state: "READY",
    target: { organization_id: ORG_ID, pipeline_id: PIPELINE_ID },
    blockers: [],
    selected_counts: { leads: 1, events: 1, chat: 1 },
  };
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(path.join(root, "dry-run-report.json"), reportText, "utf8");
  const manifest = {
    schema_version: 1,
    state: "READY",
    apply_authorized: false,
    report_path: "dry-run-report.json",
    report_sha256: sha256(reportText),
    batch_count: batches.length,
    record_count: 3,
    batches,
    canary_manifest_path: "canary/manifest.json",
    canary_manifest_sha256: sha256(canaryManifestText),
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(path.join(root, "manifest.json"), manifestText, "utf8");
  await writeFile(
    path.join(root, "manifest.sha256"),
    `${sha256(manifestText)}  manifest.json\n`,
    "utf8",
  );
  return { lead, event, chat };
}

function zeroEffectProof() {
  return {
    suppression_active: true,
    durable_marker_enforced: true,
    all_zero: true,
    sinks: Object.fromEntries(
      EFFECT_SINKS.map((sink, index) => [
        sink,
        { before: index, after: index, delta: 0 },
      ]),
    ),
  };
}

function databasePreflight(artifact, actorUserId, stored) {
  const body = {
    schema_version: 1,
    ready: true,
    organization_id: artifact.organizationId,
    actor_user_id: actorUserId,
    manifest_sha256: artifact.manifestSha256,
    checks: {
      organization_exists: true,
      actor_has_lead_import: true,
      scoped_phone_identity_ready: true,
      legacy_global_phone_identity_absent: true,
      historical_columns_ready: true,
      identity_trigger_ready: true,
      effect_triggers_ready: true,
      periodic_scanners_ready: true,
      effect_proof_helpers_ready: true,
      effect_proof_sink_contract_ready: true,
      rpc_acl_ready: true,
    },
    current_counts: {
      external_contact2sale_leads: stored.lead.size,
      suppressed_historical_leads: stored.lead.size,
      ledger_records: stored.lead.size + stored.event.size + stored.chat.size,
      effect_proof_sink_count: 33,
    },
    scope_note: "Database preflight; payload checks are atomic in apply.",
  };
  return { ...body, proof_sha256: sha256Canonical(body) };
}

function createMockTransport(artifact, { nonzeroFirstProof = false } = {}) {
  const stored = { lead: new Map(), event: new Map(), chat: new Map() };
  const nonImportIds = new Set([EXISTING_LEAD_ID]);
  const calls = [];
  let importCalls = 0;
  return {
    calls,
    stored,
    nonImportIds,
    async preflight(_artifact, actorUserId) {
      calls.push("preflight");
      return {
        databasePreflight: databasePreflight(artifact, actorUserId, stored),
        organizationRows: 1,
        actorRows: 1,
        actorUserId,
        pipelineRows: artifact.pipelineIds.size,
        stageRows: artifact.stageIds.size,
        ownerRows: artifact.ownerIds.size,
        contact2saleLeadIds: [...stored.lead.keys()],
        nonImportLeadIds: [...nonImportIds],
      };
    },
    async importBatch(organizationId, _actorUserId, document) {
      const entityType = document.batch.entity_type;
      calls.push(`rpc:${entityType}`);
      importCalls += 1;
      let created = 0;
      let noop = 0;
      const results = [];
      for (const record of document.records) {
        const map = stored[entityType];
        const action = map.has(record.target_id) ? "NOOP" : "CREATE";
        if (action === "CREATE") {
          map.set(record.target_id, record);
          created += 1;
        } else noop += 1;
        results.push({
          external_key: record.external_key,
          target_id: record.target_id,
          action,
        });
      }
      const effectProof = zeroEffectProof();
      if (nonzeroFirstProof && importCalls === 1) {
        effectProof.sinks.notifications.after = 1;
        effectProof.sinks.notifications.delta = 1;
        effectProof.all_zero = false;
      }
      return {
        schema_version: 1,
        organization_id: organizationId,
        entity_type: entityType,
        batch_index: document.batch.index,
        batch_sha256: sha256Canonical(document),
        records_sha256: document.batch.records_sha256,
        record_count: document.records.length,
        created_count: created,
        noop_count: noop,
        notification_policy: "suppress_all",
        results,
        effect_proof: effectProof,
      };
    },
    async readback(organizationId, entityType, technicalRecords) {
      calls.push(`readback:${entityType}`);
      return technicalRecords.map((technical) => {
        const record = stored[entityType].get(technical.targetId);
        assert.ok(record, technical.targetId);
        if (entityType === "lead") {
          return {
            id: technical.targetId,
            organization_id: organizationId,
            external_source: "contact2sale",
            external_source_id: record.payload.source_lead_id,
            metadata: {
              external_identity: { payload_sha256: record.payload_sha256 },
            },
          };
        }
        return {
          id: technical.targetId,
          organization_id: organizationId,
          lead_id: record.payload.lead_id,
          created_at: record.payload.event_at,
          type:
            entityType === "event"
              ? "note"
              : record.payload.direction === "inbound"
                ? "whatsapp_message_received"
                : "whatsapp_message_sent",
          metadata: {
            payload_sha256: record.payload_sha256,
            kind: `contact2sale:${entityType}:${record.external_key}`,
          },
        };
      });
    },
  };
}

test("apply requires both the flag and exact organization/manifest confirmation", () => {
  const manifestSha256 = "a".repeat(64);
  const confirmation = buildApplyConfirmation(ORG_ID, manifestSha256);
  assert.equal(
    confirmation,
    `APPLY C2S org=${ORG_ID} manifest_sha256=${manifestSha256}`,
  );
  assert.throws(
    () => authorizeApply({ apply: false, confirmation, organizationId: ORG_ID, manifestSha256 }),
    (error) => error.code === "APPLY_FLAG_REQUIRED",
  );
  assert.throws(
    () => authorizeApply({ apply: true, confirmation: "APPLY", organizationId: ORG_ID, manifestSha256 }),
    (error) => error.code === "APPLY_CONFIRMATION_MISMATCH",
  );
  assert.equal(
    authorizeApply({ apply: true, confirmation, organizationId: ORG_ID, manifestSha256 }),
    true,
  );
  assert.throws(
    () => parseApplyCommandLine(["--manifest-dir", "x"]),
    (error) => error.code === "APPLY_FLAG_REQUIRED",
  );
});

test("realdb env parser keeps the service key non-enumerable", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vimob-c2s-env-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const envFile = path.join(root, ".env.realdb.local");
  const secret = "service-role-secret-value-that-must-never-log";
  await writeFile(
    envFile,
    `SUPABASE_URL=https://supabase.example.test\nSUPABASE_SERVICE_ROLE_KEY=${secret}\n`,
    "utf8",
  );
  const config = await loadRealDbConfig(envFile);
  assert.equal(config.serviceRoleKey, secret);
  assert.equal(JSON.stringify(config).includes(secret), false);
  assert.equal(parseDotEnv("A='value'\nB=two # comment\n").get("B"), "two");
});

test("REST retries only network, 429, and 5xx failures with exponential backoff", async () => {
  const attempts = [];
  const delays = [];
  const outcomes = [
    new Error("network"),
    { ok: false, status: 503, headers: {}, text: async () => "unavailable" },
    { ok: false, status: 429, headers: {}, text: async () => "rate limited" },
    { ok: true, status: 200, headers: {}, text: async () => "[]" },
  ];
  const client = createSupabaseRestClient(
    { supabaseUrl: "https://supabase.example.test", serviceRoleKey: "x".repeat(32) },
    {
      fetchImpl: async () => {
        attempts.push(true);
        const outcome = outcomes.shift();
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
      maxAttempts: 4,
      retryBaseDelayMs: 5,
      sleepImpl: async (delay) => delays.push(delay),
    },
  );
  assert.deepEqual(await client.select("leads", { select: "id" }, "RETRY_TEST"), []);
  assert.equal(attempts.length, 4);
  assert.deepEqual(delays, [5, 10, 20]);

  let contractAttempts = 0;
  const contractClient = createSupabaseRestClient(
    { supabaseUrl: "https://supabase.example.test", serviceRoleKey: "x".repeat(32) },
    {
      fetchImpl: async () => {
        contractAttempts += 1;
        return { ok: false, status: 400, headers: {}, text: async () => "contract" };
      },
      maxAttempts: 4,
      retryBaseDelayMs: 0,
      sleepImpl: async () => {},
    },
  );
  await assert.rejects(
    contractClient.select("leads", { select: "id" }, "CONTRACT_TEST"),
    (error) => error.code === "REST_CONTRACT_TEST_HTTP_400",
  );
  assert.equal(contractAttempts, 1);
});

test("event readback uses activities and requests the rendered note contract", async () => {
  const calls = [];
  const transport = createSupabaseTransport({
    async select(route, query, label) {
      calls.push({ route, query, label });
      return [];
    },
  });
  await transport.readback(ORG_ID, "event", [{ targetId: ACTOR_ID }]);
  assert.deepEqual(calls, [
    {
      route: "activities",
      query: {
        organization_id: `eq.${ORG_ID}`,
        id: `in.(${ACTOR_ID})`,
        select: "id,organization_id,lead_id,type,created_at,metadata",
      },
      label: "READBACK_EVENTS",
    },
  ]);
});

test("database preflight requires the 33-sink contract check and count", () => {
  const artifact = { organizationId: ORG_ID, manifestSha256: "c".repeat(64) };
  const stored = { lead: new Map(), event: new Map(), chat: new Map() };

  const wrongCount = databasePreflight(artifact, ACTOR_ID, stored);
  wrongCount.current_counts.effect_proof_sink_count = 32;
  assert.throws(
    () => validateDatabasePreflight(wrongCount, artifact, ACTOR_ID),
    (error) => error.code === "PREFLIGHT_EFFECT_PROOF_SINK_COUNT_INVALID",
  );

  const missingContract = databasePreflight(artifact, ACTOR_ID, stored);
  missingContract.checks.effect_proof_sink_contract_ready = false;
  assert.throws(
    () => validateDatabasePreflight(missingContract, artifact, ACTOR_ID),
    (error) => error.code === "PREFLIGHT_DATABASE_CHECK_FAILED",
  );
});

test("artifact verification rejects tampering before any network operation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vimob-c2s-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createApplyFixture(root);
  const artifact = await verifyImportArtifact(root);
  assert.equal(artifact.recordCount, 3);
  assert.deepEqual(artifact.canaryCounts, { lead: 1, event: 1, chat: 1 });
  await writeFile(path.join(root, "batches", "lead-0001.json"), "{}\n", "utf8");
  await assert.rejects(
    verifyImportArtifact(root),
    (error) => error.code === "BATCH_FILE_HASH_MISMATCH",
  );
});

test("runner applies canary first, then lead-event-chat batches, and resumes from a PII-free journal", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vimob-c2s-apply-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createApplyFixture(root);
  const artifact = await verifyImportArtifact(root);
  const transport = createMockTransport(artifact);
  const journalPath = path.join(root, "apply-journal.jsonl");
  let logs = "";
  const result = await executeImport({
    artifact,
    actorUserId: ACTOR_ID,
    expectedNonImportLeadCount: 1,
    transport,
    journalPath,
    logger: (line) => {
      logs += line;
    },
  });
  assert.equal(result.state, "COMPLETE");
  assert.deepEqual(
    transport.calls.filter((entry) => entry.startsWith("rpc:")),
    ["rpc:lead", "rpc:event", "rpc:chat", "rpc:lead", "rpc:event", "rpc:chat"],
  );
  const journal = await readFile(journalPath, "utf8");
  for (const privateValue of [
    "Sensitive Person",
    "sensitive@example.invalid",
    "+5527999990000",
    "Sensitive historical note",
    "Sensitive event",
    "Sensitive chat",
  ]) {
    assert.equal(journal.includes(privateValue), false, privateValue);
    assert.equal(logs.includes(privateValue), false, privateValue);
  }
  const callsBeforeResume = transport.calls.filter((entry) => entry.startsWith("rpc:")).length;
  transport.nonImportIds.add(LATER_NON_IMPORT_LEAD_ID);
  const resumed = await executeImport({
    artifact,
    actorUserId: ACTOR_ID,
    expectedNonImportLeadCount: 1,
    transport,
    journalPath,
    logger: () => {},
  });
  assert.equal(resumed.state, "COMPLETE");
  assert.equal(
    transport.calls.filter((entry) => entry.startsWith("rpc:")).length,
    callsBeforeResume,
  );
  const journalState = await loadJournal(journalPath, {
    organizationId: ORG_ID,
    manifestSha256: artifact.manifestSha256,
    actorUserId: ACTOR_ID,
  });
  const baseline = journalState.entries.find((entry) => entry.event === "preflight_baseline");
  assert.deepEqual(baseline.non_import_lead_ids, [EXISTING_LEAD_ID]);
});

test("runner rejects removal of a baseline non-C2S lead even when the count is unchanged", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vimob-c2s-baseline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createApplyFixture(root);
  const artifact = await verifyImportArtifact(root);
  const transport = createMockTransport(artifact);
  const journalPath = path.join(root, "apply-journal.jsonl");
  await executeImport({
    artifact,
    actorUserId: ACTOR_ID,
    expectedNonImportLeadCount: 1,
    transport,
    journalPath,
    canaryOnly: true,
    logger: () => {},
  });
  transport.nonImportIds.delete(EXISTING_LEAD_ID);
  transport.nonImportIds.add(LATER_NON_IMPORT_LEAD_ID);
  await assert.rejects(
    executeImport({
      artifact,
      actorUserId: ACTOR_ID,
      expectedNonImportLeadCount: 1,
      transport,
      journalPath,
      canaryOnly: true,
      logger: () => {},
    }),
    (error) => error.code === "NON_IMPORT_LEAD_BASELINE_CHANGED",
  );
});

test("non-zero effect proof stops before journal verification", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vimob-c2s-effects-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createApplyFixture(root);
  const artifact = await verifyImportArtifact(root);
  const transport = createMockTransport(artifact, { nonzeroFirstProof: true });
  const journalPath = path.join(root, "apply-journal.jsonl");
  await assert.rejects(
    executeImport({
      artifact,
      actorUserId: ACTOR_ID,
      expectedNonImportLeadCount: 1,
      transport,
      journalPath,
      logger: () => {},
    }),
    (error) => error.code === "RPC_EFFECT_PROOF_INVALID",
  );
  const state = await loadJournal(journalPath, {
    organizationId: ORG_ID,
    manifestSha256: artifact.manifestSha256,
    actorUserId: ACTOR_ID,
  });
  assert.equal(state.entries.some((entry) => entry.event === "batch_verified"), false);
  assert.equal(transport.calls.filter((entry) => entry.startsWith("rpc:")).length, 1);
});

test("effect proof independently rejects a non-zero sink", () => {
  const proof = zeroEffectProof();
  proof.sinks.notifications.after = 1;
  proof.sinks.notifications.delta = 1;
  assert.throws(
    () => validateEffectProof({ ...proof, all_zero: true }),
    (error) => error.code === "RPC_EFFECT_PROOF_NONZERO",
  );
});

test("effect proof requires the exact 33-sink name set", () => {
  const missing = zeroEffectProof();
  delete missing.sinks.audit_logs;
  assert.throws(
    () => validateEffectProof(missing),
    (error) => error.code === "RPC_EFFECT_PROOF_INVALID",
  );

  const unexpected = zeroEffectProof();
  unexpected.sinks.ai_outbox_messages = { before: 0, after: 0, delta: 0 };
  assert.throws(
    () => validateEffectProof(unexpected),
    (error) => error.code === "RPC_EFFECT_PROOF_INVALID",
  );
});
