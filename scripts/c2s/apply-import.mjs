#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  deterministicEntityId,
  sha256Canonical,
} from "./build-import-manifest.mjs";

export const IMPORT_RPC = "import_historical_lead_batch";
export const PREFLIGHT_RPC = "preflight_historical_lead_import";
export const MANIFEST_SCHEMA_VERSION = 1;
export const MAX_BATCH_RECORDS = 250;
export const MAX_BATCH_BYTES = 5 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_REST_ATTEMPTS = 4;
export const DEFAULT_RETRY_BASE_DELAY_MS = 250;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const ENTITY_ORDER = new Map([
  ["lead", 0],
  ["event", 1],
  ["chat", 2],
]);
const ALLOWED_ACTIONS = new Set(["CREATE", "NOOP"]);
const EFFECT_PROOF_SINKS = Object.freeze([
  "notifications",
  "notification_deliveries",
  "automation_event_outbox",
  "automation_executions",
  "automation_effect_dispatches",
  "automation_execution_steps",
  "outbox_messages",
  "audit_logs",
  "gamification_outbox",
  "webhook_delivery_outbox",
  "lead_funnel_events",
  "meta_crm_event_outbox",
  "operational_requests",
  "operational_timelines",
  "lead_tasks",
  "schedule_events",
  "cadence_enrollments",
  "lead_action_facts",
  "lead_assignment_cycles",
  "lead_stage_cycles",
  "lead_attention_instances",
  "lead_timeline_events",
  "assignments_log",
  "lead_assignment_history",
  "lead_stage_history",
  "commissions",
  "financial_entries",
  "round_robin_logs",
  "lead_redistribution_jobs",
  "lead_distribution_events",
  "team_distribution_events",
  "whatsapp_messages",
  "whatsapp_outbox",
]);
const REQUIRED_DATABASE_PREFLIGHT_CHECKS = Object.freeze([
  "organization_exists",
  "actor_has_lead_import",
  "scoped_phone_identity_ready",
  "legacy_global_phone_identity_absent",
  "historical_columns_ready",
  "identity_trigger_ready",
  "effect_triggers_ready",
  "periodic_scanners_ready",
  "effect_proof_helpers_ready",
  "effect_proof_sink_contract_ready",
  "rpc_acl_ready",
]);

export class ApplyImportError extends Error {
  constructor(code) {
    super(code);
    this.name = "ApplyImportError";
    this.code = code;
  }
}

function fail(code) {
  throw new ApplyImportError(code);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function readJson(filePath, code = "JSON_INVALID") {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    fail(code);
  }
}

function asPositiveInteger(value, code) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) fail(code);
  return parsed;
}

function asNonNegativeInteger(value, code) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(code);
  return value;
}

function isTimestamp(value) {
  return (
    typeof value === "string" &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function validateLeadTimestampContract(payload) {
  const provenance = payload.metadata?.timestamp_provenance;
  const fields = [
    "created_at",
    "updated_at",
    "stage_entered_at",
    "assigned_at",
    "won_at",
    "lost_at",
  ];
  if (!isPlainObject(provenance) || !isTimestamp(payload.created_at)) {
    fail("LEAD_TIMESTAMP_PROVENANCE_INVALID");
  }
  const createdAtMs = Date.parse(payload.created_at);
  const futureLimit = Date.now() + 86_400_000;
  for (const field of fields) {
    const value = payload[field] ?? null;
    const proof = provenance[field];
    if (
      !isPlainObject(proof) ||
      proof.value !== value ||
      !(proof.source_field === null || typeof proof.source_field === "string") ||
      typeof proof.confidence !== "string" ||
      typeof proof.is_inferred !== "boolean" ||
      typeof proof.rule !== "string" ||
      !(proof.parse_method === null || typeof proof.parse_method === "string")
    ) {
      fail("LEAD_TIMESTAMP_PROVENANCE_INVALID");
    }
    if (value !== null) {
      if (!isTimestamp(value)) fail("LEAD_TIMESTAMP_INVALID");
      const valueMs = Date.parse(value);
      if (valueMs < createdAtMs || valueMs > futureLimit) fail("LEAD_TIMESTAMP_INVALID");
    }
  }
  if (
    (payload.deal_status === "open" && (payload.won_at !== null || payload.lost_at !== null)) ||
    (payload.deal_status === "won" && payload.lost_at !== null) ||
    (payload.deal_status === "lost" && payload.won_at !== null)
  ) {
    fail("LEAD_DEAL_TIMESTAMP_INVALID");
  }
}

export function buildApplyConfirmation(organizationId, manifestSha256) {
  if (!UUID_PATTERN.test(String(organizationId ?? ""))) fail("ORGANIZATION_ID_INVALID");
  if (!SHA256_PATTERN.test(String(manifestSha256 ?? ""))) fail("MANIFEST_SHA256_INVALID");
  return `APPLY C2S org=${organizationId} manifest_sha256=${manifestSha256}`;
}

export function authorizeApply({ apply, confirmation, organizationId, manifestSha256 }) {
  if (apply !== true) fail("APPLY_FLAG_REQUIRED");
  const expected = buildApplyConfirmation(organizationId, manifestSha256);
  if (confirmation !== expected) fail("APPLY_CONFIRMATION_MISMATCH");
  return true;
}

export function parseDotEnv(source) {
  const entries = new Map();
  for (const rawLine of String(source).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) fail("ENV_LINE_INVALID");
    const [, key, rawValue] = match;
    if (entries.has(key)) fail("ENV_DUPLICATE_KEY");
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    } else {
      const comment = value.search(/\s+#/);
      if (comment >= 0) value = value.slice(0, comment).trimEnd();
    }
    entries.set(key, value);
  }
  return entries;
}

function normalizeSupabaseOrigin(rawValue) {
  let url;
  try {
    url = new URL(rawValue);
  } catch {
    fail("SUPABASE_URL_INVALID");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    fail("SUPABASE_URL_INVALID");
  }
  return url.origin;
}

export async function loadRealDbConfig(envFile) {
  let entries;
  try {
    entries = parseDotEnv(await readFile(envFile, "utf8"));
  } catch (error) {
    if (error instanceof ApplyImportError) throw error;
    fail("REALDB_ENV_UNREADABLE");
  }
  const supabaseUrl = normalizeSupabaseOrigin(entries.get("SUPABASE_URL") ?? "");
  const legacyKey = entries.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const secretKey = entries.get("SUPABASE_SECRET_KEY") ?? "";
  if (legacyKey && secretKey && legacyKey !== secretKey) fail("SUPABASE_SERVICE_KEYS_CONFLICT");
  const serviceRoleKey = secretKey || legacyKey;
  if (serviceRoleKey.length < 20 || /[\u0000-\u001f\u007f]/.test(serviceRoleKey)) {
    fail("SUPABASE_SERVICE_KEY_INVALID");
  }
  const config = { supabaseUrl };
  Object.defineProperty(config, "serviceRoleKey", {
    value: serviceRoleKey,
    enumerable: false,
    writable: false,
  });
  return Object.freeze(config);
}

function resolveInside(root, relativePath, code) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) fail(code);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) fail(code);
  return resolved;
}

async function ensureRealFileInside(root, relativePath, code) {
  const expected = resolveInside(root, relativePath, code);
  let [realRoot, realFile, fileStat] = await Promise.all([
    realpath(root),
    realpath(expected),
    stat(expected),
  ]).catch(() => fail(code));
  realRoot = path.resolve(realRoot);
  realFile = path.resolve(realFile);
  if (!fileStat.isFile() || !realFile.startsWith(`${realRoot}${path.sep}`)) fail(code);
  return realFile;
}

function normalizeManifestBatchMetadata(metadata) {
  if (!isPlainObject(metadata)) fail("BATCH_METADATA_INVALID");
  // Artifact verification normalizes batch metadata once and execution passes
  // that verified object back through this guard. Accept both representations
  // so every call site gets the same validation without weakening the contract.
  const entityType = String(metadata.entity_type ?? metadata.entityType ?? "");
  if (!ENTITY_ORDER.has(entityType)) fail("BATCH_ENTITY_INVALID");
  const index = asPositiveInteger(metadata.index, "BATCH_INDEX_INVALID");
  const records = asPositiveInteger(metadata.records, "BATCH_RECORD_COUNT_INVALID");
  const bytes = asPositiveInteger(metadata.bytes, "BATCH_BYTE_COUNT_INVALID");
  const fileSha256 = String(metadata.sha256 ?? metadata.fileSha256 ?? "").toLowerCase();
  const recordsSha256 = String(
    metadata.records_sha256 ?? metadata.recordsSha256 ?? "",
  ).toLowerCase();
  if (!SHA256_PATTERN.test(fileSha256) || !SHA256_PATTERN.test(recordsSha256)) {
    fail("BATCH_HASH_INVALID");
  }
  if (records > MAX_BATCH_RECORDS || bytes > MAX_BATCH_BYTES) fail("BATCH_LIMIT_INVALID");
  return {
    path: String(metadata.path ?? ""),
    entityType,
    index,
    records,
    bytes,
    fileSha256,
    recordsSha256,
  };
}

function validateRecord(record, entityType, organizationId) {
  if (!isPlainObject(record) || !isPlainObject(record.payload)) fail("RECORD_SHAPE_INVALID");
  if (record.entity_type !== entityType || record.organization_id !== organizationId) {
    fail("RECORD_SCOPE_INVALID");
  }
  if (!record.validation?.ok || record.validation?.state !== "READY" || record.apply_eligible !== true) {
    fail("RECORD_NOT_READY");
  }
  if (!ALLOWED_ACTIONS.has(record.action)) fail("RECORD_ACTION_INVALID");
  if (record.payload.historical_import !== true || record.payload.notification_policy !== "suppress_all") {
    fail("RECORD_SUPPRESSION_INVALID");
  }
  const externalKey = String(record.external_key ?? "");
  const targetId = String(record.target_id ?? "");
  if (!externalKey || !UUID_PATTERN.test(targetId)) fail("RECORD_IDENTITY_INVALID");
  if (deterministicEntityId(organizationId, externalKey) !== targetId) {
    fail("RECORD_TARGET_ID_NONDETERMINISTIC");
  }
  const payloadSha256 = String(record.payload_sha256 ?? "").toLowerCase();
  if (!SHA256_PATTERN.test(payloadSha256) || sha256Canonical(record.payload) !== payloadSha256) {
    fail("RECORD_PAYLOAD_HASH_MISMATCH");
  }
  if (record.payload.source_system !== "contact2sale" || !String(record.payload.source_lead_id ?? "")) {
    fail("RECORD_SOURCE_IDENTITY_INVALID");
  }
  if (entityType !== "lead" && !UUID_PATTERN.test(String(record.payload.lead_id ?? ""))) {
    fail("RECORD_PARENT_LEAD_INVALID");
  }
  if (entityType === "lead") {
    validateLeadTimestampContract(record.payload);
  } else {
    if (!isTimestamp(record.payload.event_at)) fail("HISTORY_TIMESTAMP_INVALID");
    const message = String(record.payload.message ?? "");
    if (entityType === "event" && !message.trim()) fail("EVENT_CONTENT_INVALID");
    if (entityType === "chat") {
      if (!new Set(["inbound", "outbound"]).has(record.payload.direction)) {
        fail("CHAT_DIRECTION_INVALID");
      }
      if (!Array.isArray(record.payload.media)) fail("CHAT_MEDIA_INVALID");
      if (!message && record.payload.media.length === 0) fail("CHAT_CONTENT_INVALID");
      if (
        record.payload.metadata?.source_message_empty === true &&
        (
          message !== "[Mensagem sem conteúdo no C2S]" ||
          record.payload.metadata?.data_quality_warning !== true ||
          String(record.payload.metadata?.source_message_raw ?? "").trim() !== ""
        )
      ) {
        fail("CHAT_EMPTY_SOURCE_RESOLUTION_INVALID");
      }
    }
  }
  return {
    entityType,
    targetId,
    externalKey,
    payloadSha256,
    leadId: entityType === "lead" ? targetId : record.payload.lead_id,
    pipelineId: entityType === "lead" ? record.payload.pipeline_id : null,
    stageId: entityType === "lead" ? record.payload.stage_id : null,
    ownerId: entityType === "lead" ? record.payload.assigned_user_id : null,
  };
}

export async function readAndVerifyBatch(manifestDir, rawMetadata, organizationId) {
  const metadata = normalizeManifestBatchMetadata(rawMetadata);
  const filePath = await ensureRealFileInside(manifestDir, metadata.path, "BATCH_PATH_INVALID");
  const buffer = await readFile(filePath);
  if (buffer.length !== metadata.bytes || sha256(buffer) !== metadata.fileSha256) {
    fail("BATCH_FILE_HASH_MISMATCH");
  }
  let document;
  try {
    document = JSON.parse(buffer.toString("utf8"));
  } catch {
    fail("BATCH_JSON_INVALID");
  }
  if (
    document.schema_version !== MANIFEST_SCHEMA_VERSION ||
    !isPlainObject(document.batch) ||
    !Array.isArray(document.records) ||
    document.batch.entity_type !== metadata.entityType ||
    Number(document.batch.index) !== metadata.index ||
    Number(document.batch.record_count) !== metadata.records ||
    document.records.length !== metadata.records ||
    Number(document.batch.record_limit) > MAX_BATCH_RECORDS ||
    Number(document.batch.byte_limit) > MAX_BATCH_BYTES
  ) {
    fail("BATCH_ENVELOPE_INVALID");
  }
  const recordsSha256 = sha256Canonical(document.records);
  if (
    recordsSha256 !== metadata.recordsSha256 ||
    String(document.batch.records_sha256 ?? "").toLowerCase() !== recordsSha256
  ) {
    fail("BATCH_RECORDS_HASH_MISMATCH");
  }
  const records = document.records.map((record) => validateRecord(record, metadata.entityType, organizationId));
  return {
    metadata,
    document,
    records,
    canonicalBatchSha256: sha256Canonical(document),
  };
}

function assertBatchOrdering(batches) {
  let priorEntityOrder = -1;
  const nextIndex = new Map();
  const seenKeys = new Set();
  for (const raw of batches) {
    const metadata = normalizeManifestBatchMetadata(raw);
    const entityOrder = ENTITY_ORDER.get(metadata.entityType);
    if (entityOrder < priorEntityOrder) fail("MANIFEST_BATCH_ORDER_INVALID");
    priorEntityOrder = entityOrder;
    const expectedIndex = (nextIndex.get(metadata.entityType) ?? 0) + 1;
    if (metadata.index !== expectedIndex) fail("MANIFEST_BATCH_SEQUENCE_INVALID");
    nextIndex.set(metadata.entityType, metadata.index);
    const key = `${metadata.entityType}:${metadata.index}`;
    if (seenKeys.has(key)) fail("MANIFEST_BATCH_DUPLICATE");
    seenKeys.add(key);
  }
}

async function verifyChecksumFile(manifestDir, relativeManifest, relativeChecksum, code) {
  const manifestPath = await ensureRealFileInside(manifestDir, relativeManifest, code);
  const checksumPath = await ensureRealFileInside(manifestDir, relativeChecksum, code);
  const [buffer, checksumText] = await Promise.all([
    readFile(manifestPath),
    readFile(checksumPath, "utf8"),
  ]);
  const declared = checksumText.trim().split(/\s+/)[0]?.toLowerCase();
  if (!SHA256_PATTERN.test(declared ?? "") || sha256(buffer) !== declared) fail(code);
  let document;
  try {
    document = JSON.parse(buffer.toString("utf8"));
  } catch {
    fail(code);
  }
  return { document, sha256: declared, buffer };
}

export async function verifyImportArtifact(manifestDirectory) {
  let manifestDir;
  try {
    manifestDir = await realpath(path.resolve(manifestDirectory));
  } catch {
    fail("MANIFEST_DIRECTORY_INVALID");
  }
  const main = await verifyChecksumFile(
    manifestDir,
    "manifest.json",
    "manifest.sha256",
    "MANIFEST_CHECKSUM_INVALID",
  );
  const manifest = main.document;
  if (
    manifest.schema_version !== MANIFEST_SCHEMA_VERSION ||
    manifest.state !== "READY" ||
    !Array.isArray(manifest.batches) ||
    Number(manifest.batch_count) !== manifest.batches.length
  ) {
    fail("MANIFEST_NOT_READY");
  }
  assertBatchOrdering(manifest.batches);

  const reportPath = await ensureRealFileInside(
    manifestDir,
    String(manifest.report_path ?? ""),
    "REPORT_PATH_INVALID",
  );
  const reportBuffer = await readFile(reportPath);
  if (sha256(reportBuffer) !== String(manifest.report_sha256 ?? "").toLowerCase()) {
    fail("REPORT_HASH_MISMATCH");
  }
  let report;
  try {
    report = JSON.parse(reportBuffer.toString("utf8"));
  } catch {
    fail("REPORT_JSON_INVALID");
  }
  const organizationId = String(report.target?.organization_id ?? "");
  if (
    report.state !== "READY" ||
    !UUID_PATTERN.test(organizationId) ||
    (Array.isArray(report.blockers) && report.blockers.length > 0)
  ) {
    fail("REPORT_NOT_READY");
  }

  const canary = await verifyChecksumFile(
    manifestDir,
    "canary/manifest.json",
    "canary/manifest.sha256",
    "CANARY_MANIFEST_CHECKSUM_INVALID",
  );
  if (
    canary.sha256 !== String(manifest.canary_manifest_sha256 ?? "").toLowerCase() ||
    canary.document.state !== "READY" ||
    !Array.isArray(canary.document.batches)
  ) {
    fail("CANARY_MANIFEST_NOT_READY");
  }
  assertBatchOrdering(canary.document.batches);
  const canaryReportPath = await ensureRealFileInside(
    manifestDir,
    String(canary.document.report_path ?? ""),
    "CANARY_REPORT_PATH_INVALID",
  );
  const canaryReportBuffer = await readFile(canaryReportPath);
  if (sha256(canaryReportBuffer) !== String(canary.document.report_sha256 ?? "").toLowerCase()) {
    fail("CANARY_REPORT_HASH_MISMATCH");
  }

  const canaryRecords = new Map();
  let canaryLeadId = null;
  const canaryCounts = { lead: 0, event: 0, chat: 0 };
  for (const rawMetadata of canary.document.batches) {
    const batch = await readAndVerifyBatch(manifestDir, rawMetadata, organizationId);
    for (let index = 0; index < batch.records.length; index += 1) {
      const technical = batch.records[index];
      canaryCounts[technical.entityType] += 1;
      if (technical.entityType === "lead") {
        if (canaryLeadId) fail("CANARY_LEAD_COUNT_INVALID");
        canaryLeadId = technical.targetId;
      }
      canaryRecords.set(`${technical.entityType}:${technical.targetId}`, technical.payloadSha256);
    }
  }
  if (!canaryLeadId || canaryCounts.lead !== 1) fail("CANARY_LEAD_COUNT_INVALID");

  const seenTargetIds = new Set();
  const leadIds = new Set();
  const pipelineIds = new Set();
  const stageIds = new Set();
  const ownerIds = new Set();
  const matchedCanary = new Set();
  const canaryHistoryCounts = { event: 0, chat: 0 };
  let recordCount = 0;
  for (const rawMetadata of manifest.batches) {
    const batch = await readAndVerifyBatch(manifestDir, rawMetadata, organizationId);
    for (const technical of batch.records) {
      recordCount += 1;
      const identity = `${technical.entityType}:${technical.targetId}`;
      if (seenTargetIds.has(identity)) fail("MANIFEST_TARGET_ID_DUPLICATE");
      seenTargetIds.add(identity);
      if (technical.entityType === "lead") {
        leadIds.add(technical.targetId);
        if (!UUID_PATTERN.test(String(technical.pipelineId ?? ""))) fail("LEAD_PIPELINE_ID_INVALID");
        if (!UUID_PATTERN.test(String(technical.stageId ?? ""))) fail("LEAD_STAGE_ID_INVALID");
        if (!UUID_PATTERN.test(String(technical.ownerId ?? ""))) fail("LEAD_OWNER_ID_INVALID");
        pipelineIds.add(technical.pipelineId);
        stageIds.add(technical.stageId);
        ownerIds.add(technical.ownerId);
      } else {
        if (!leadIds.has(technical.leadId)) fail("HISTORY_PARENT_NOT_IN_MANIFEST");
        if (technical.leadId === canaryLeadId) canaryHistoryCounts[technical.entityType] += 1;
      }
      const expectedCanaryHash = canaryRecords.get(identity);
      if (expectedCanaryHash !== undefined) {
        if (expectedCanaryHash !== technical.payloadSha256) fail("CANARY_FULL_PAYLOAD_MISMATCH");
        matchedCanary.add(identity);
      }
    }
  }
  if (
    recordCount !== Number(manifest.record_count) ||
    matchedCanary.size !== canaryRecords.size ||
    canaryHistoryCounts.event !== canaryCounts.event ||
    canaryHistoryCounts.chat !== canaryCounts.chat
  ) {
    fail("MANIFEST_COUNT_RECONCILIATION_FAILED");
  }

  return Object.freeze({
    manifestDir,
    manifestSha256: main.sha256,
    organizationId,
    report,
    batches: manifest.batches.map(normalizeManifestBatchMetadata),
    canaryBatches: canary.document.batches.map(normalizeManifestBatchMetadata),
    recordCount,
    leadIds,
    pipelineIds,
    stageIds,
    ownerIds,
    canaryLeadId,
    canaryCounts,
  });
}

function sanitizeRestPath(value) {
  return String(value).replace(/^\/+/, "");
}

function defaultSleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function shouldRetryHttpStatus(status) {
  return status === 429 || status >= 500;
}

export function createSupabaseRestClient(
  config,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_REST_ATTEMPTS,
    retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
    sleepImpl = defaultSleep,
  } = {},
) {
  if (typeof fetchImpl !== "function") fail("FETCH_UNAVAILABLE");
  if (typeof sleepImpl !== "function") fail("SLEEP_INVALID");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 8) {
    fail("REST_MAX_ATTEMPTS_INVALID");
  }
  if (!Number.isInteger(retryBaseDelayMs) || retryBaseDelayMs < 0 || retryBaseDelayMs > 10_000) {
    fail("REST_RETRY_DELAY_INVALID");
  }
  const baseOrigin = normalizeSupabaseOrigin(config.supabaseUrl);
  const serviceRoleKey = config.serviceRoleKey;
  if (!serviceRoleKey) fail("SUPABASE_SERVICE_KEY_INVALID");

  async function request({ method = "GET", route, query, body, headers = {}, label }) {
    const url = new URL(`/rest/v1/${sanitizeRestPath(route)}`, baseOrigin);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const requestBody = body === undefined ? undefined : JSON.stringify(body);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(url, {
          method,
          redirect: "error",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            ...(requestBody === undefined ? {} : { "Content-Type": "application/json" }),
            ...headers,
          },
          body: requestBody,
        });
      } catch {
        clearTimeout(timer);
        if (attempt === maxAttempts) fail(`REST_${label}_REQUEST_FAILED`);
        await sleepImpl(retryBaseDelayMs * 2 ** (attempt - 1));
        continue;
      }

      let text;
      try {
        text = await response.text();
      } catch {
        clearTimeout(timer);
        if (attempt === maxAttempts) fail(`REST_${label}_RESPONSE_UNREADABLE`);
        await sleepImpl(retryBaseDelayMs * 2 ** (attempt - 1));
        continue;
      }
      clearTimeout(timer);
      if (Buffer.byteLength(text, "utf8") > 16 * 1024 * 1024) {
        fail(`REST_${label}_RESPONSE_TOO_LARGE`);
      }
      if (!response.ok) {
        if (shouldRetryHttpStatus(response.status) && attempt < maxAttempts) {
          await sleepImpl(retryBaseDelayMs * 2 ** (attempt - 1));
          continue;
        }
        fail(`REST_${label}_HTTP_${response.status}`);
      }
      if (!text) return { data: null, headers: response.headers };
      try {
        return { data: JSON.parse(text), headers: response.headers };
      } catch {
        fail(`REST_${label}_JSON_INVALID`);
      }
    }
    fail(`REST_${label}_REQUEST_FAILED`);
  }

  return Object.freeze({
    request,
    async select(route, query, label) {
      const response = await request({ method: "GET", route, query, label });
      if (!Array.isArray(response.data)) fail(`REST_${label}_ROWS_INVALID`);
      return response.data;
    },
    async rpcImport(organizationId, actorUserId, batch) {
      const response = await request({
        method: "POST",
        route: `rpc/${IMPORT_RPC}`,
        label: "IMPORT_RPC",
        body: {
          p_organization_id: organizationId,
          p_actor_user_id: actorUserId,
          p_batch: batch,
        },
      });
      if (Array.isArray(response.data) && response.data.length === 1) return response.data[0];
      return response.data;
    },
    async rpcPreflight(organizationId, actorUserId, manifestSha256) {
      const response = await request({
        method: "POST",
        route: `rpc/${PREFLIGHT_RPC}`,
        label: "PREFLIGHT_RPC",
        body: {
          p_organization_id: organizationId,
          p_actor_user_id: actorUserId,
          p_manifest_sha256: manifestSha256,
        },
      });
      if (Array.isArray(response.data) && response.data.length === 1) return response.data[0];
      return response.data;
    },
  });
}

function inFilter(values) {
  return `in.(${[...values].sort().join(",")})`;
}

async function selectPaged(client, route, query, label, pageSize = 1_000) {
  const output = [];
  for (let offset = 0; ; offset += pageSize) {
    const rows = await client.select(
      route,
      { ...query, limit: pageSize, offset, order: query.order ?? "id.asc" },
      label,
    );
    output.push(...rows);
    if (rows.length < pageSize) return output;
  }
}

function hashTechnicalIds(ids) {
  return sha256Canonical([...ids].sort());
}

export function validatePreflightSnapshot(
  snapshot,
  artifact,
  actorUserId,
  expectedNonImportLeadCount,
  { requireExactNonImportCount = true } = {},
) {
  if (!isPlainObject(snapshot)) fail("PREFLIGHT_SHAPE_INVALID");
  const databaseProof = validateDatabasePreflight(
    snapshot.databasePreflight,
    artifact,
    actorUserId,
  );
  if (snapshot.organizationRows !== 1 || snapshot.actorRows !== 1) fail("PREFLIGHT_TARGET_ACCESS_INVALID");
  if (snapshot.pipelineRows !== artifact.pipelineIds.size) fail("PREFLIGHT_PIPELINES_INVALID");
  if (snapshot.stageRows !== artifact.stageIds.size) fail("PREFLIGHT_STAGES_INVALID");
  if (snapshot.ownerRows !== artifact.ownerIds.size) fail("PREFLIGHT_OWNERS_INVALID");
  if (snapshot.actorUserId !== actorUserId) fail("PREFLIGHT_ACTOR_INVALID");
  if (!Array.isArray(snapshot.nonImportLeadIds) || !Array.isArray(snapshot.contact2saleLeadIds)) {
    fail("PREFLIGHT_LEAD_IDS_INVALID");
  }
  const nonImportLeadIds = [...new Set(snapshot.nonImportLeadIds.map(String))].sort();
  const contact2saleLeadIds = [...new Set(snapshot.contact2saleLeadIds.map(String))].sort();
  if (
    nonImportLeadIds.length !== snapshot.nonImportLeadIds.length ||
    contact2saleLeadIds.length !== snapshot.contact2saleLeadIds.length ||
    [...nonImportLeadIds, ...contact2saleLeadIds].some((id) => !UUID_PATTERN.test(id))
  ) {
    fail("PREFLIGHT_LEAD_IDS_INVALID");
  }
  if (requireExactNonImportCount && nonImportLeadIds.length !== expectedNonImportLeadCount) {
    fail("PREFLIGHT_EXISTING_LEAD_COUNT_MISMATCH");
  }
  for (const id of nonImportLeadIds) {
    if (artifact.leadIds.has(id)) fail("PREFLIGHT_NON_IMPORT_ID_COLLISION");
  }
  for (const id of contact2saleLeadIds) {
    if (!artifact.leadIds.has(id)) fail("PREFLIGHT_UNKNOWN_CONTACT2SALE_LEAD");
  }
  if (databaseProof.external_contact2sale_leads !== contact2saleLeadIds.length) {
    fail("PREFLIGHT_DATABASE_COUNT_MISMATCH");
  }
  return {
    organization_id: artifact.organizationId,
    actor_user_id: actorUserId,
    non_import_lead_count: nonImportLeadIds.length,
    non_import_lead_ids: nonImportLeadIds,
    non_import_lead_ids_sha256: hashTechnicalIds(nonImportLeadIds),
    contact2sale_lead_count: contact2saleLeadIds.length,
    contact2sale_lead_ids_sha256: hashTechnicalIds(contact2saleLeadIds),
    pipeline_count: snapshot.pipelineRows,
    stage_count: snapshot.stageRows,
    owner_count: snapshot.ownerRows,
    database_preflight_sha256: databaseProof.proof_sha256,
    ledger_record_count: databaseProof.ledger_records,
  };
}

export function validateDatabasePreflight(preflight, artifact, actorUserId) {
  if (
    !isPlainObject(preflight) ||
    preflight.schema_version !== MANIFEST_SCHEMA_VERSION ||
    preflight.ready !== true ||
    preflight.organization_id !== artifact.organizationId ||
    preflight.actor_user_id !== actorUserId ||
    preflight.manifest_sha256 !== artifact.manifestSha256 ||
    !isPlainObject(preflight.checks) ||
    !isPlainObject(preflight.current_counts)
  ) {
    fail("PREFLIGHT_DATABASE_NOT_READY");
  }
  for (const check of REQUIRED_DATABASE_PREFLIGHT_CHECKS) {
    if (preflight.checks[check] !== true) fail("PREFLIGHT_DATABASE_CHECK_FAILED");
  }
  const externalContact2saleLeads = asNonNegativeInteger(
    preflight.current_counts.external_contact2sale_leads,
    "PREFLIGHT_DATABASE_COUNTS_INVALID",
  );
  const suppressedHistoricalLeads = asNonNegativeInteger(
    preflight.current_counts.suppressed_historical_leads,
    "PREFLIGHT_DATABASE_COUNTS_INVALID",
  );
  const ledgerRecords = asNonNegativeInteger(
    preflight.current_counts.ledger_records,
    "PREFLIGHT_DATABASE_COUNTS_INVALID",
  );
  const effectProofSinkCount = asNonNegativeInteger(
    preflight.current_counts.effect_proof_sink_count,
    "PREFLIGHT_DATABASE_COUNTS_INVALID",
  );
  if (effectProofSinkCount !== EFFECT_PROOF_SINKS.length) {
    fail("PREFLIGHT_EFFECT_PROOF_SINK_COUNT_INVALID");
  }
  const declaredProofSha256 = String(preflight.proof_sha256 ?? "").toLowerCase();
  const proofBody = { ...preflight };
  delete proofBody.proof_sha256;
  if (
    !SHA256_PATTERN.test(declaredProofSha256) ||
    sha256Canonical(proofBody) !== declaredProofSha256
  ) {
    fail("PREFLIGHT_DATABASE_PROOF_INVALID");
  }
  return {
    proof_sha256: declaredProofSha256,
    external_contact2sale_leads: externalContact2saleLeads,
    suppressed_historical_leads: suppressedHistoricalLeads,
    ledger_records: ledgerRecords,
    effect_proof_sink_count: effectProofSinkCount,
  };
}

export function createSupabaseTransport(client) {
  return Object.freeze({
    async preflight(artifact, actorUserId) {
      const [databasePreflight, organizations, actorMemberships, pipelines, stages, owners, contactLeads, nonImportLeads] =
        await Promise.all([
          client.rpcPreflight(
            artifact.organizationId,
            actorUserId,
            artifact.manifestSha256,
          ),
          client.select(
            "organizations",
            { select: "id", id: `eq.${artifact.organizationId}`, limit: 2 },
            "PREFLIGHT_ORGANIZATION",
          ),
          client.select(
            "organization_members",
            {
              select: "user_id,organization_id,is_active",
              organization_id: `eq.${artifact.organizationId}`,
              user_id: `eq.${actorUserId}`,
              is_active: "eq.true",
              limit: 2,
            },
            "PREFLIGHT_ACTOR",
          ),
          client.select(
            "pipelines",
            {
              select: "id,organization_id,is_active",
              organization_id: `eq.${artifact.organizationId}`,
              id: inFilter(artifact.pipelineIds),
              is_active: "eq.true",
            },
            "PREFLIGHT_PIPELINES",
          ),
          client.select(
            "stages",
            {
              select: "id,organization_id,pipeline_id,is_active,is_lost,is_won",
              organization_id: `eq.${artifact.organizationId}`,
              id: inFilter(artifact.stageIds),
              is_active: "eq.true",
            },
            "PREFLIGHT_STAGES",
          ),
          client.select(
            "organization_members",
            {
              select: "user_id,organization_id,is_active",
              organization_id: `eq.${artifact.organizationId}`,
              user_id: inFilter(artifact.ownerIds),
              is_active: "eq.true",
            },
            "PREFLIGHT_OWNERS",
          ),
          selectPaged(
            client,
            "leads",
            {
              select: "id,external_source_id",
              organization_id: `eq.${artifact.organizationId}`,
              external_source: "eq.contact2sale",
            },
            "PREFLIGHT_CONTACT2SALE_LEADS",
          ),
          selectPaged(
            client,
            "leads",
            {
              select: "id",
              organization_id: `eq.${artifact.organizationId}`,
              or: "(external_source.is.null,external_source.neq.contact2sale)",
            },
            "PREFLIGHT_NON_IMPORT_LEADS",
          ),
        ]);
      return {
        databasePreflight,
        organizationRows: organizations.length,
        actorRows: actorMemberships.length,
        actorUserId: actorMemberships[0]?.user_id ?? null,
        pipelineRows: pipelines.length,
        stageRows: stages.length,
        ownerRows: owners.length,
        contact2saleLeadIds: contactLeads.map((row) => String(row.id)),
        nonImportLeadIds: nonImportLeads.map((row) => String(row.id)),
      };
    },
    async importBatch(organizationId, actorUserId, batch) {
      return client.rpcImport(organizationId, actorUserId, batch);
    },
    async readback(organizationId, entityType, records) {
      const ids = records.map((record) => record.targetId);
      const base = {
        organization_id: `eq.${organizationId}`,
        id: inFilter(ids),
      };
      if (entityType === "lead") {
        return client.select(
          "leads",
          {
            ...base,
            select: "id,organization_id,external_source,external_source_id,metadata",
          },
          "READBACK_LEADS",
        );
      }
      return client.select(
        "activities",
        { ...base, select: "id,organization_id,lead_id,type,created_at,metadata" },
        entityType === "event" ? "READBACK_EVENTS" : "READBACK_CHAT",
      );
    },
  });
}

export function validateEffectProof(proof) {
  const sinkKeys = isPlainObject(proof?.sinks) ? Object.keys(proof.sinks).sort() : [];
  if (
    !isPlainObject(proof) ||
    proof.suppression_active !== true ||
    proof.durable_marker_enforced !== true ||
    proof.all_zero !== true ||
    !isPlainObject(proof.sinks) ||
    sinkKeys.length !== EFFECT_PROOF_SINKS.length ||
    EFFECT_PROOF_SINKS.some((sink) => !Object.hasOwn(proof.sinks, sink))
  ) {
    fail("RPC_EFFECT_PROOF_INVALID");
  }
  for (const value of Object.values(proof.sinks)) {
    if (
      !isPlainObject(value) ||
      !Number.isSafeInteger(value.before) ||
      value.before < 0 ||
      !Number.isSafeInteger(value.after) ||
      value.after < 0 ||
      !Number.isInteger(value.delta) ||
      value.delta !== 0 ||
      value.after !== value.before
    ) {
      fail("RPC_EFFECT_PROOF_NONZERO");
    }
  }
  return sha256Canonical(proof);
}

export function validateRpcResponse(response, batch) {
  if (!isPlainObject(response)) fail("RPC_RESPONSE_INVALID");
  const expectedBatchSha256 = sha256Canonical(batch.document);
  if (
    response.schema_version !== MANIFEST_SCHEMA_VERSION ||
    response.organization_id !== batch.document.records[0]?.organization_id ||
    response.entity_type !== batch.metadata.entityType ||
    Number(response.batch_index) !== batch.metadata.index ||
    response.batch_sha256 !== expectedBatchSha256 ||
    response.records_sha256 !== batch.metadata.recordsSha256 ||
    Number(response.record_count) !== batch.records.length ||
    Number(response.created_count) + Number(response.noop_count) !== batch.records.length ||
    response.notification_policy !== "suppress_all" ||
    !Array.isArray(response.results) ||
    response.results.length !== batch.records.length
  ) {
    fail("RPC_RESPONSE_CONTRACT_INVALID");
  }
  const expected = new Map(batch.records.map((record) => [record.targetId, record.externalKey]));
  for (const result of response.results) {
    if (
      !expected.has(result.target_id) ||
      expected.get(result.target_id) !== result.external_key ||
      !ALLOWED_ACTIONS.has(result.action)
    ) {
      fail("RPC_RESULT_RECONCILIATION_FAILED");
    }
    expected.delete(result.target_id);
  }
  if (expected.size !== 0) fail("RPC_RESULT_RECONCILIATION_FAILED");
  const effectProofSha256 = validateEffectProof(response.effect_proof);
  return {
    batch_sha256: expectedBatchSha256,
    created_count: Number(response.created_count),
    noop_count: Number(response.noop_count),
    response_sha256: sha256Canonical(response),
    effect_proof_sha256: effectProofSha256,
  };
}

function readbackPayloadHash(entityType, row) {
  if (entityType === "lead") return row.metadata?.external_identity?.payload_sha256;
  return row.metadata?.payload_sha256;
}

export function validateReadback(organizationId, entityType, records, rows) {
  if (!Array.isArray(rows) || rows.length !== records.length) fail("READBACK_COUNT_MISMATCH");
  const expected = new Map(records.map((record) => [record.targetId, record]));
  const proofRows = [];
  for (const row of rows) {
    const record = expected.get(String(row.id));
    if (!record || row.organization_id !== organizationId) fail("READBACK_IDENTITY_MISMATCH");
    if (entityType === "lead") {
      if (
        row.external_source !== "contact2sale" ||
        String(row.external_source_id) !== String(record.documentPayload?.source_lead_id ?? "")
      ) {
        // documentPayload is attached immediately before validation by executeImport.
        fail("READBACK_EXTERNAL_IDENTITY_MISMATCH");
      }
    } else {
      if (row.lead_id !== record.leadId) fail("READBACK_PARENT_MISMATCH");
      const expectedType = entityType === "event"
        ? "note"
        : record.documentPayload?.direction === "inbound"
          ? "whatsapp_message_received"
          : "whatsapp_message_sent";
      const expectedKind = `contact2sale:${entityType}:${record.externalKey}`;
      if (row.type !== expectedType || row.metadata?.kind !== expectedKind) {
        fail("READBACK_ACTIVITY_REPRESENTATION_MISMATCH");
      }
    }
    const storedPayloadSha256 = String(readbackPayloadHash(entityType, row) ?? "").toLowerCase();
    if (storedPayloadSha256 !== record.payloadSha256) fail("READBACK_PAYLOAD_HASH_MISMATCH");
    proofRows.push({
      id: row.id,
      organization_id: row.organization_id,
      lead_id: entityType === "lead" ? row.id : row.lead_id,
      payload_sha256: storedPayloadSha256,
    });
    expected.delete(String(row.id));
  }
  if (expected.size !== 0) fail("READBACK_IDENTITY_MISMATCH");
  proofRows.sort((left, right) => left.id.localeCompare(right.id));
  return {
    count: proofRows.length,
    proof_sha256: sha256Canonical(proofRows),
  };
}

function journalEntryHash(entryWithoutHash) {
  return sha256Canonical(entryWithoutHash);
}

export async function loadJournal(journalPath, context) {
  let text = "";
  try {
    text = await readFile(journalPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") fail("JOURNAL_UNREADABLE");
  }
  const entries = [];
  let previous = null;
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      fail("JOURNAL_JSON_INVALID");
    }
    const entrySha256 = entry.entry_sha256;
    const withoutHash = { ...entry };
    delete withoutHash.entry_sha256;
    if (
      entry.sequence !== entries.length + 1 ||
      entry.previous_entry_sha256 !== previous ||
      entrySha256 !== journalEntryHash(withoutHash) ||
      entry.organization_id !== context.organizationId ||
      entry.manifest_sha256 !== context.manifestSha256 ||
      entry.actor_user_id !== context.actorUserId
    ) {
      fail("JOURNAL_CHAIN_INVALID");
    }
    entries.push(entry);
    previous = entrySha256;
  }
  return { entries, previous };
}

export async function appendJournal(journalPath, state, context, event) {
  const base = {
    schema_version: 1,
    sequence: state.entries.length + 1,
    previous_entry_sha256: state.previous,
    organization_id: context.organizationId,
    manifest_sha256: context.manifestSha256,
    actor_user_id: context.actorUserId,
    recorded_at: new Date().toISOString(),
    ...event,
  };
  const entry = { ...base, entry_sha256: journalEntryHash(base) };
  const temporaryPath = `${journalPath}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    const completeJournal = [...state.entries, entry]
      .map((item) => JSON.stringify(item))
      .join("\n");
    await handle.writeFile(`${completeJournal}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, journalPath);
  } catch {
    if (handle) await handle.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
    fail("JOURNAL_APPEND_FAILED");
  }
  state.entries.push(entry);
  state.previous = entry.entry_sha256;
  return entry;
}

function journalBatchKey(phase, metadata) {
  return `${phase}:${metadata.entityType}:${metadata.index}:${metadata.fileSha256}`;
}

function verifiedJournalBatches(journalState) {
  return new Set(
    journalState.entries
      .filter((entry) => entry.event === "batch_verified")
      .map((entry) => entry.batch_key),
  );
}

function journalBaseline(journalState) {
  return journalState.entries.find((entry) => entry.event === "preflight_baseline") ?? null;
}

function safeLog(logger, value) {
  logger(`${JSON.stringify(value)}\n`);
}

function compareBaseline(summary, baseline) {
  if (
    !Array.isArray(baseline.non_import_lead_ids) ||
    baseline.non_import_lead_ids.length !== baseline.non_import_lead_count ||
    hashTechnicalIds(baseline.non_import_lead_ids) !== baseline.non_import_lead_ids_sha256
  ) {
    fail("NON_IMPORT_LEAD_BASELINE_INVALID");
  }
  const currentIds = new Set(summary.non_import_lead_ids);
  if (baseline.non_import_lead_ids.some((id) => !currentIds.has(id))) {
    fail("NON_IMPORT_LEAD_BASELINE_CHANGED");
  }
}

async function applyPhase({
  phase,
  batchMetadata,
  artifact,
  actorUserId,
  transport,
  journalPath,
  journalState,
  context,
  logger,
}) {
  const verified = verifiedJournalBatches(journalState);
  for (const metadata of batchMetadata) {
    const key = journalBatchKey(phase, metadata);
    const batch = await readAndVerifyBatch(artifact.manifestDir, metadata, artifact.organizationId);
    for (let index = 0; index < batch.records.length; index += 1) {
      batch.records[index].documentPayload = batch.document.records[index].payload;
    }
    if (verified.has(key)) {
      const rows = await transport.readback(artifact.organizationId, metadata.entityType, batch.records);
      validateReadback(artifact.organizationId, metadata.entityType, batch.records, rows);
      safeLog(logger, {
        event: "c2s_batch_resume_readback_verified",
        phase,
        entity_type: metadata.entityType,
        batch_index: metadata.index,
        records: metadata.records,
        batch_file_sha256: metadata.fileSha256,
      });
      continue;
    }

    const response = await transport.importBatch(
      artifact.organizationId,
      actorUserId,
      batch.document,
    );
    const rpcProof = validateRpcResponse(response, batch);
    const rows = await transport.readback(artifact.organizationId, metadata.entityType, batch.records);
    const readbackProof = validateReadback(
      artifact.organizationId,
      metadata.entityType,
      batch.records,
      rows,
    );
    await appendJournal(journalPath, journalState, context, {
      event: "batch_verified",
      phase,
      batch_key: key,
      entity_type: metadata.entityType,
      batch_index: metadata.index,
      record_count: metadata.records,
      batch_file_sha256: metadata.fileSha256,
      batch_canonical_sha256: rpcProof.batch_sha256,
      created_count: rpcProof.created_count,
      noop_count: rpcProof.noop_count,
      rpc_response_sha256: rpcProof.response_sha256,
      effect_proof_sha256: rpcProof.effect_proof_sha256,
      readback_count: readbackProof.count,
      readback_proof_sha256: readbackProof.proof_sha256,
    });
    safeLog(logger, {
      event: "c2s_batch_verified",
      phase,
      entity_type: metadata.entityType,
      batch_index: metadata.index,
      records: metadata.records,
      created: rpcProof.created_count,
      noop: rpcProof.noop_count,
      batch_file_sha256: metadata.fileSha256,
    });
  }
}

async function acquireJournalLock(journalPath, context) {
  const lockPath = `${journalPath}.lock`;
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.write(
      `${JSON.stringify({
        schema_version: 1,
        organization_id: context.organizationId,
        manifest_sha256: context.manifestSha256,
        process_id: process.pid,
        created_at: new Date().toISOString(),
      })}\n`,
      null,
      "utf8",
    );
    await handle.sync();
  } catch {
    if (handle) await handle.close().catch(() => {});
    fail("JOURNAL_LOCK_UNAVAILABLE");
  }
  await handle.close();
  return async () => {
    const resolvedLock = path.resolve(lockPath);
    if (resolvedLock !== path.resolve(`${journalPath}.lock`)) fail("JOURNAL_LOCK_PATH_INVALID");
    await rm(resolvedLock, { force: true }).catch(() => fail("JOURNAL_LOCK_RELEASE_FAILED"));
  };
}

export async function executeImport({
  artifact,
  actorUserId,
  expectedNonImportLeadCount,
  transport,
  journalPath,
  canaryOnly = false,
  logger = (line) => process.stdout.write(line),
}) {
  if (!UUID_PATTERN.test(actorUserId)) fail("ACTOR_USER_ID_INVALID");
  const context = {
    organizationId: artifact.organizationId,
    manifestSha256: artifact.manifestSha256,
    actorUserId,
  };
  await mkdir(path.dirname(journalPath), { recursive: true });
  const releaseLock = await acquireJournalLock(journalPath, context);
  try {
    const journalState = await loadJournal(journalPath, context);
    if (journalState.entries.length === 0) {
      await appendJournal(journalPath, journalState, context, { event: "run_initialized" });
    }

    const existingBaseline = journalBaseline(journalState);
    const initialRaw = await transport.preflight(artifact, actorUserId);
    const initial = validatePreflightSnapshot(
      initialRaw,
      artifact,
      actorUserId,
      expectedNonImportLeadCount,
      { requireExactNonImportCount: !existingBaseline },
    );
    if (existingBaseline) compareBaseline(initial, existingBaseline);
    else {
      await appendJournal(journalPath, journalState, context, {
        event: "preflight_baseline",
        ...initial,
      });
    }
    safeLog(logger, {
      event: "c2s_preflight_verified",
      phase: "before_canary",
      non_import_leads: initial.non_import_lead_count,
      contact2sale_leads: initial.contact2sale_lead_count,
      preflight_sha256: sha256Canonical(initial),
    });

    await applyPhase({
      phase: "canary",
      batchMetadata: artifact.canaryBatches,
      artifact,
      actorUserId,
      transport,
      journalPath,
      journalState,
      context,
      logger,
    });

    const afterCanaryRaw = await transport.preflight(artifact, actorUserId);
    const afterCanary = validatePreflightSnapshot(
      afterCanaryRaw,
      artifact,
      actorUserId,
      expectedNonImportLeadCount,
      { requireExactNonImportCount: false },
    );
    compareBaseline(afterCanary, journalBaseline(journalState));
    if (!afterCanaryRaw.contact2saleLeadIds.includes(artifact.canaryLeadId)) {
      fail("CANARY_LEAD_NOT_VISIBLE_AFTER_APPLY");
    }
    safeLog(logger, {
      event: "c2s_preflight_verified",
      phase: "after_canary",
      non_import_leads: afterCanary.non_import_lead_count,
      contact2sale_leads: afterCanary.contact2sale_lead_count,
      preflight_sha256: sha256Canonical(afterCanary),
    });
    if (canaryOnly) {
      await appendJournal(journalPath, journalState, context, {
        event: "canary_only_complete",
        preflight_sha256: sha256Canonical(afterCanary),
      });
      return { state: "CANARY_COMPLETE", journalEntries: journalState.entries.length };
    }

    await applyPhase({
      phase: "full",
      batchMetadata: artifact.batches,
      artifact,
      actorUserId,
      transport,
      journalPath,
      journalState,
      context,
      logger,
    });

    const finalRaw = await transport.preflight(artifact, actorUserId);
    const final = validatePreflightSnapshot(
      finalRaw,
      artifact,
      actorUserId,
      expectedNonImportLeadCount,
      { requireExactNonImportCount: false },
    );
    compareBaseline(final, journalBaseline(journalState));
    if (
      finalRaw.contact2saleLeadIds.length !== artifact.leadIds.size ||
      ![...artifact.leadIds].every((id) => finalRaw.contact2saleLeadIds.includes(id))
    ) {
      fail("FINAL_IMPORTED_LEAD_SET_MISMATCH");
    }
    await appendJournal(journalPath, journalState, context, {
      event: "full_import_complete",
      imported_lead_count: final.contact2sale_lead_count,
      final_preflight_sha256: sha256Canonical(final),
    });
    safeLog(logger, {
      event: "c2s_import_complete",
      imported_leads: final.contact2sale_lead_count,
      manifest_sha256: artifact.manifestSha256,
      journal_entries: journalState.entries.length,
    });
    return { state: "COMPLETE", journalEntries: journalState.entries.length };
  } finally {
    await releaseLock();
  }
}

export function parseApplyCommandLine(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      index += 1;
      if (index >= argv.length) fail("CLI_VALUE_MISSING");
      return argv[index];
    };
    if (argument === "--manifest-dir") options.manifestDir = value();
    else if (argument === "--actor-user-id") options.actorUserId = value();
    else if (argument === "--env-file") options.envFile = value();
    else if (argument === "--journal") options.journalPath = value();
    else if (argument === "--confirm") options.confirmation = value();
    else if (argument === "--expect-existing-leads") {
      options.expectedNonImportLeadCount = Number(value());
    } else if (argument === "--timeout-ms") options.timeoutMs = Number(value());
    else if (argument === "--apply") options.apply = true;
    else if (argument === "--canary-only") options.canaryOnly = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else fail("CLI_ARGUMENT_UNKNOWN");
  }
  if (options.help) return options;
  if (!options.apply) fail("APPLY_FLAG_REQUIRED");
  if (!options.manifestDir || !options.actorUserId || options.confirmation === undefined) {
    fail("CLI_REQUIRED_ARGUMENT_MISSING");
  }
  if (!Number.isInteger(options.expectedNonImportLeadCount) || options.expectedNonImportLeadCount < 0) {
    fail("EXPECTED_EXISTING_LEADS_REQUIRED");
  }
  options.envFile = options.envFile ?? path.resolve(".env.realdb.local");
  options.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 300_000) {
    fail("TIMEOUT_INVALID");
  }
  return options;
}

export function applyHelpText() {
  return `Usage:
  node scripts/c2s/apply-import.mjs --apply --manifest-dir <dir> --actor-user-id <uuid> \\
    --expect-existing-leads <count> --confirm "<exact confirmation>" [options]

Required safety gates:
  --apply
  --confirm "APPLY C2S org=<organization uuid> manifest_sha256=<manifest file sha256>"
  --expect-existing-leads <count>   Expected non-C2S baseline (1 for this onboarding)

Options:
  --env-file <path>       Defaults to .env.realdb.local
  --journal <path>        Must stay inside the manifest directory
  --canary-only           Apply and verify only the deterministic canary
  --timeout-ms <n>        REST timeout from 1000 to 300000 (default 60000)
`;
}

async function runCli() {
  const options = parseApplyCommandLine(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(applyHelpText());
    return;
  }
  const artifact = await verifyImportArtifact(options.manifestDir);
  authorizeApply({
    apply: options.apply,
    confirmation: options.confirmation,
    organizationId: artifact.organizationId,
    manifestSha256: artifact.manifestSha256,
  });
  if (!UUID_PATTERN.test(options.actorUserId)) fail("ACTOR_USER_ID_INVALID");

  const journalPath = path.resolve(
    options.journalPath ?? path.join(artifact.manifestDir, "apply-journal.jsonl"),
  );
  const relativeJournal = path.relative(artifact.manifestDir, journalPath);
  if (!relativeJournal || relativeJournal.startsWith("..") || path.isAbsolute(relativeJournal)) {
    fail("JOURNAL_PATH_OUTSIDE_MANIFEST");
  }

  const config = await loadRealDbConfig(path.resolve(options.envFile));
  const client = createSupabaseRestClient(config, { timeoutMs: options.timeoutMs });
  const transport = createSupabaseTransport(client);
  await executeImport({
    artifact,
    actorUserId: options.actorUserId,
    expectedNonImportLeadCount: options.expectedNonImportLeadCount,
    transport,
    journalPath,
    canaryOnly: options.canaryOnly,
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli().catch((error) => {
    const code = error instanceof ApplyImportError ? error.code : "UNEXPECTED_FAILURE";
    process.stderr.write(`${JSON.stringify({ event: "c2s_apply_failed", error_code: code })}\n`);
    process.exitCode = 1;
  });
}
