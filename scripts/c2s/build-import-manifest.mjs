#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

export const SCHEMA_VERSION = 1;
export const URL_NAMESPACE_UUID = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
export const SOURCE_TIME_ZONE = "America/Sao_Paulo";
export const SOURCE_UTC_OFFSET = "-03:00";
export const DEFAULT_BATCH_RECORD_LIMIT = 250;
export const DEFAULT_BATCH_BYTE_LIMIT = 5 * 1024 * 1024;
export const ESTANCIA_EXPECTED_TEMPORAL_AUDIT = Object.freeze({
  stage_resolution_by_status: {
    Arquivado: {
      latest_matching_status_event: 3_500,
      xlsx_primary_updated_at_matching_current_status_fallback: 568,
      unresolved_no_status_timestamp_evidence: 4,
    },
    "Negócio fechado": { latest_matching_status_event: 41 },
    Novo: { latest_matching_status_event: 86 },
    "Em negociação": {
      latest_matching_status_event: 44,
      xlsx_primary_updated_at_matching_current_status_fallback: 209,
    },
  },
  outcome_resolution_counts: {
    won_at: { latest_closed_marker_event: 41 },
    lost_at: {
      latest_matching_status_event: 3_500,
      xlsx_primary_updated_at_matching_current_status_fallback: 568,
      unresolved: 4,
    },
  },
  stale_primary_status_ignored: 10,
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_INPUT_PATTERN = /^[+\d\s().-]+$/;
const ACCEPTED_OWNER_MAPPINGS = new Set([
  "EXACT",
  "EXACT_NORMALIZED",
  "PROPOSED_ALIAS",
]);
const ACCEPTED_DEAL_STATUSES = new Set(["open", "won", "lost"]);
const ACCEPTED_ACTIONS = new Set(["CREATE", "NOOP", "DRIFT", "CONFLICT"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : canonicalize(item)));
  }
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) output[key] = canonicalize(value[key]);
    }
    return output;
  }
  throw new TypeError(`Canonical JSON does not support ${typeof value}`);
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Canonical(value) {
  return createHash("sha256").update(canonicalStringify(value), "utf8").digest("hex");
}

function uuidToBytes(uuid) {
  if (!UUID_PATTERN.test(uuid)) throw new TypeError(`Invalid UUID namespace: ${uuid}`);
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

function bytesToUuid(bytes) {
  const hex = Buffer.from(bytes).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function uuidV5(name, namespace = URL_NAMESPACE_UUID) {
  const digest = createHash("sha1")
    .update(uuidToBytes(namespace))
    .update(String(name), "utf8")
    .digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  return bytesToUuid(digest.subarray(0, 16));
}

export function deterministicEntityId(organizationId, externalKey) {
  if (!UUID_PATTERN.test(organizationId)) {
    throw new TypeError(`Invalid organization UUID: ${organizationId}`);
  }
  if (!String(externalKey ?? "").trim()) throw new TypeError("externalKey is required");
  return uuidV5(`${organizationId}:${externalKey}`);
}

function hasValidParenthesisStructure(value) {
  let depth = 0;
  for (const character of value) {
    if (character === "(") {
      if (depth !== 0) return false;
      depth = 1;
    } else if (character === ")") {
      if (depth !== 1) return false;
      depth = 0;
    }
  }
  return depth === 0;
}

// Mirrors lib/phone-utils.ts without importing application code into an offline tool.
export function normalizePhoneToE164(phone) {
  if (!phone) return null;
  const trimmed = String(phone).trim();
  if (
    !trimmed ||
    trimmed.length > 40 ||
    !PHONE_INPUT_PATTERN.test(trimmed) ||
    !hasValidParenthesisStructure(trimmed)
  ) {
    return null;
  }
  const plusCount = (trimmed.match(/\+/g) ?? []).length;
  if (plusCount > 1 || (plusCount === 1 && !trimmed.startsWith("+"))) return null;

  const digits = trimmed.replace(/\D/g, "");
  let internationalDigits;
  if (trimmed.startsWith("+")) internationalDigits = digits;
  else if (trimmed.startsWith("00")) internationalDigits = digits.slice(2);
  else if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    internationalDigits = digits;
  } else if (digits.length === 10 || digits.length === 11) {
    internationalDigits = `55${digits}`;
  } else if (digits.length >= 12 && digits.length <= 15) {
    internationalDigits = digits;
  } else {
    return null;
  }

  const normalized = `+${internationalDigits}`;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

export function normalizePhoneLikeDatabase(phone) {
  if (phone === null || phone === undefined || String(phone).trim() === "") return null;
  const digits = String(phone).replace(/[^0-9]/g, "");
  if (!digits) return null;
  if (digits.length > 11 && digits.startsWith("55")) return digits;
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isValidCalendarDate(year, month, day, hour, minute, second) {
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return false;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function resolvedDate(raw, parts, metadata) {
  const { year, month, day, hour, minute, second } = parts;
  if (!isValidCalendarDate(year, month, day, hour, minute, second)) {
    return {
      value: null,
      raw,
      method: "unresolved",
      time_zone: SOURCE_TIME_ZONE,
      utc_offset: SOURCE_UTC_OFFSET,
      issue: "INVALID_CALENDAR_DATE",
    };
  }
  return {
    value: `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}${SOURCE_UTC_OFFSET}`,
    raw,
    method: metadata.method,
    source_field: metadata.sourceField,
    inferred_year: metadata.inferredYear ?? null,
    inference_anchor: metadata.inferenceAnchor ?? null,
    time_zone: SOURCE_TIME_ZONE,
    utc_offset: SOURCE_UTC_OFFSET,
  };
}

const PORTUGUESE_MONTHS = new Map([
  ["janeiro", 1],
  ["fevereiro", 2],
  ["marco", 3],
  ["abril", 4],
  ["maio", 5],
  ["junho", 6],
  ["julho", 7],
  ["agosto", 8],
  ["setembro", 9],
  ["outubro", 10],
  ["novembro", 11],
  ["dezembro", 12],
]);

function normalizeWord(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function extractionCalendar(extractedAt) {
  const parsed = new Date(extractedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate(),
  };
}

export function parseSourceDate(rawValue, { extractedAt = null, sourceField = null } = {}) {
  const raw = String(rawValue ?? "").trim();
  if (!raw) {
    return {
      value: null,
      raw,
      method: "missing",
      source_field: sourceField,
      inferred_year: null,
      inference_anchor: null,
      time_zone: SOURCE_TIME_ZONE,
      utc_offset: SOURCE_UTC_OFFSET,
      issue: "MISSING_SOURCE_DATE",
    };
  }

  let match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (match) {
    return resolvedDate(
      raw,
      {
        day: Number(match[1]),
        month: Number(match[2]),
        year: Number(match[3]),
        hour: Number(match[4]),
        minute: Number(match[5]),
        second: Number(match[6]),
      },
      { method: "explicit_four_digit_year", sourceField },
    );
  }

  match = raw.match(/^(\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (match) {
    return resolvedDate(
      raw,
      {
        day: Number(match[1]),
        month: Number(match[2]),
        year: 2000 + Number(match[3]),
        hour: Number(match[4]),
        minute: Number(match[5]),
        second: Number(match[6]),
      },
      { method: "explicit_two_digit_year", sourceField },
    );
  }

  match = raw.match(/^(\d{2}):(\d{2}) (\d{2})\/(\d{2})\/(\d{2})$/);
  if (match) {
    return resolvedDate(
      raw,
      {
        hour: Number(match[1]),
        minute: Number(match[2]),
        second: 0,
        day: Number(match[3]),
        month: Number(match[4]),
        year: 2000 + Number(match[5]),
      },
      { method: "explicit_two_digit_year", sourceField },
    );
  }

  match = raw.match(/^(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (match) {
    const anchor = extractionCalendar(extractedAt);
    if (!anchor) {
      return {
        value: null,
        raw,
        method: "unresolved",
        source_field: sourceField,
        inferred_year: null,
        inference_anchor: extractedAt,
        time_zone: SOURCE_TIME_ZONE,
        utc_offset: SOURCE_UTC_OFFSET,
        issue: "MISSING_INFERENCE_ANCHOR",
      };
    }
    const day = Number(match[1]);
    const month = Number(match[2]);
    const occursAfterExtractionDay =
      month > anchor.month || (month === anchor.month && day > anchor.day);
    const inferredYear = occursAfterExtractionDay ? anchor.year - 1 : anchor.year;
    return resolvedDate(
      raw,
      {
        day,
        month,
        year: inferredYear,
        hour: Number(match[3]),
        minute: Number(match[4]),
        second: Number(match[5]),
      },
      {
        method: "year_inferred_from_extraction_calendar",
        sourceField,
        inferredYear,
        inferenceAnchor: extractedAt,
      },
    );
  }

  match = raw.match(
    /(?:Recebido|Interagido) em (\d{1,2}) de ([A-Za-zÀ-ÿ]+), (\d{2}):(\d{2}) de (\d{4})/i,
  );
  if (match) {
    const month = PORTUGUESE_MONTHS.get(normalizeWord(match[2]));
    if (month) {
      return resolvedDate(
        raw,
        {
          day: Number(match[1]),
          month,
          year: Number(match[5]),
          hour: Number(match[3]),
          minute: Number(match[4]),
          second: 0,
        },
        { method: "explicit_portuguese_year", sourceField },
      );
    }
  }

  return {
    value: null,
    raw,
    method: "unresolved",
    source_field: sourceField,
    inferred_year: null,
    inference_anchor: extractedAt,
    time_zone: SOURCE_TIME_ZONE,
    utc_offset: SOURCE_UTC_OFFSET,
    issue: "UNSUPPORTED_SOURCE_DATE_FORMAT",
  };
}

function cleanText(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function issue(code, severity, field, message) {
  return { code, severity, field, message };
}

function validationState(issues) {
  return issues.some((entry) => entry.severity === "error") ? "BLOCKED" : "READY";
}

function validateLeadFields(lead, ownerMapping, statusMapping, createdAt, approvedDataQualityPolicy) {
  const issues = [];
  const current = lead.current ?? {};
  const nameRaw = cleanText(current.name);
  let name = nameRaw;
  const email = cleanText(current.email);
  const phone = cleanText(current.phone);
  let phoneCanonical = normalizePhoneToE164(phone);
  const dataQualityResolutions = [];

  if (!/^\d+$/.test(cleanText(lead.source_lead_id))) {
    issues.push(issue("INVALID_SOURCE_LEAD_ID", "error", "source_lead_id", "Expected numeric C2S id"));
  }
  if (name.length > 180) {
    issues.push(issue("INVALID_NAME_LENGTH", "error", "name", "Expected at most 180 characters"));
  } else if (name.length < 2) {
    if (approvedDataQualityPolicy && name.length === 0) {
      name = `Sem nome (C2S ${cleanText(lead.source_lead_id)})`;
      issues.push(
        issue(
          "EMPTY_NAME_NEUTRAL_LABEL_APPLIED",
          "warning",
          "name",
          "Approved neutral label applied; raw value remains in metadata",
        ),
      );
      dataQualityResolutions.push({
        field: "name",
        resolution: "approved_neutral_c2s_label",
        source_value_preserved_in: "metadata.name_raw",
      });
    } else if (approvedDataQualityPolicy && name.length === 1) {
      issues.push(
        issue(
          "ONE_CHARACTER_NAME_PRESERVED",
          "warning",
          "name",
          "Approved faithful source value; database accepts one character",
        ),
      );
      dataQualityResolutions.push({
        field: "name",
        resolution: "approved_preserve_one_character_source_value",
        source_value_preserved_in: "metadata.name_raw",
      });
    } else {
      issues.push(issue("INVALID_NAME_LENGTH", "error", "name", "Expected 2 to 180 characters"));
    }
  }
  if (email && (email.length > 254 || !EMAIL_PATTERN.test(email))) {
    issues.push(issue("INVALID_EMAIL", "error", "email", "Email is not valid"));
  }
  if (phone && !phoneCanonical) {
    if (approvedDataQualityPolicy) {
      phoneCanonical = null;
      issues.push(
        issue(
          "INVALID_PHONE_STORED_AS_RAW_ONLY",
          "warning",
          "phone",
          "Approved null target phone; raw value remains in metadata",
        ),
      );
      dataQualityResolutions.push({
        field: "phone",
        resolution: "approved_null_invalid_phone",
        source_value_preserved_in: "metadata.phone_raw",
      });
    } else {
      issues.push(issue("INVALID_PHONE", "error", "phone", "Phone cannot be normalized to E.164"));
    }
  }
  if (!phone) {
    issues.push(issue("MISSING_PHONE", "warning", "phone", "Lead has no phone"));
  }
  if (!UUID_PATTERN.test(ownerMapping?.target_id ?? "")) {
    issues.push(issue("INVALID_OWNER_MAPPING", "error", "assigned_user_id", "Owner target id is missing or invalid"));
  }
  if (!statusMapping || !ACCEPTED_DEAL_STATUSES.has(statusMapping.target_deal_status)) {
    issues.push(issue("INVALID_STATUS_MAPPING", "error", "deal_status", "Status has no explicit target deal status"));
  }
  if (!UUID_PATTERN.test(statusMapping?.target_stage_id ?? "")) {
    issues.push(issue("MISSING_TARGET_STAGE", "error", "stage_id", "Status has no explicit target stage id"));
  }
  if (!createdAt.value) {
    issues.push(issue("UNRESOLVED_CREATED_AT", "error", "created_at", createdAt.issue));
  }
  if (cleanText(current.observation).length > 2_000) {
    issues.push(
      issue(
        "STANDARD_IMPORT_MESSAGE_LIMIT_EXCEEDED",
        "warning",
        "message",
        "Historical loader must preserve the full value instead of using the standard 2000 character input",
      ),
    );
  }
  return {
    issues,
    name,
    nameRaw,
    phoneCanonical,
    dataQualityResolutions,
  };
}

function validateHistoryFields(entityType, record, occurredAt, selectedLeadIds) {
  const issues = [];
  if (!selectedLeadIds.has(cleanText(record.source_lead_id))) {
    issues.push(issue("PARENT_LEAD_NOT_SELECTED", "error", "source_lead_id", "Parent lead is not selected"));
  }
  if (!Number.isInteger(record.sequence) || record.sequence < 1) {
    issues.push(issue("INVALID_SEQUENCE", "error", "sequence", "Sequence must be a positive integer"));
  }
  if (!cleanText(record.external_key)) {
    issues.push(issue("MISSING_EXTERNAL_KEY", "error", "external_key", "External key is required"));
  }
  if (!occurredAt.value) {
    issues.push(issue("UNRESOLVED_OCCURRED_AT", "error", "occurred_at", occurredAt.issue));
  }
  const media = Array.isArray(record.media) ? record.media : [];
  if (entityType === "chat" && !cleanText(record.message) && media.length === 0) {
    issues.push(
      issue(
        "EMPTY_CHAT_CONTENT_PLACEHOLDER_APPLIED",
        "warning",
        "message",
        "Empty source chat is preserved with an explicit neutral placeholder",
      ),
    );
  }
  return issues;
}

function resolveLeadCreatedAt(lead) {
  const current = lead.current ?? {};
  const extractedAt = lead.extraction?.fetched_at ?? null;
  const primary = parseSourceDate(current.created_at_source, {
    extractedAt,
    sourceField: "current.created_at_source",
  });
  if (primary.value) return primary;
  const fallback = parseSourceDate(current.received_at_raw, {
    extractedAt,
    sourceField: "current.received_at_raw",
  });
  if (!fallback.value) return primary;
  return { ...fallback, method: `fallback_${fallback.method}` };
}

function timestampProvenanceFromParsed(parsed, { rule, confidence, isInferred, extra = {} }) {
  return {
    value: parsed.value ?? null,
    raw: parsed.raw ?? null,
    source_field: parsed.source_field ?? null,
    parse_method: parsed.method ?? null,
    confidence,
    is_inferred: isInferred,
    rule,
    ...extra,
  };
}

function unavailableTimestampProvenance(rule, evidence = {}) {
  return {
    value: null,
    raw: evidence.raw ?? null,
    source_field: evidence.source_field ?? null,
    source_status: evidence.source_status ?? null,
    current_status: evidence.current_status ?? null,
    parse_method: evidence.parse_method ?? null,
    confidence: "none",
    is_inferred: false,
    rule,
    source_external_key: evidence.source_external_key ?? null,
    source_sequence: evidence.source_sequence ?? null,
    source_row: evidence.source_row ?? null,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function chooseLaterTimestamp(current, candidate) {
  if (!candidate?.value) return current ?? null;
  if (!current?.value) return candidate;
  const currentMs = Date.parse(current.value);
  const candidateMs = Date.parse(candidate.value);
  if (candidateMs !== currentMs) return candidateMs > currentMs ? candidate : current;
  const currentSequence = Number(current.source_sequence ?? -1);
  const candidateSequence = Number(candidate.source_sequence ?? -1);
  if (candidateSequence !== currentSequence) {
    return candidateSequence > currentSequence ? candidate : current;
  }
  return String(candidate.source_external_key ?? "").localeCompare(
    String(current.source_external_key ?? ""),
  ) > 0
    ? candidate
    : current;
}

function parsedTimestampCandidate(parsed, details) {
  return {
    value: parsed.value,
    raw: parsed.raw,
    source_field: parsed.source_field,
    parse_method: parsed.method,
    confidence: details.confidence ?? (parsed.inferred_year ? "medium" : "high"),
    is_inferred: details.is_inferred ?? Boolean(parsed.inferred_year),
    rule: details.rule,
    source_external_key: details.source_external_key ?? null,
    source_sequence: details.source_sequence ?? null,
    source_row: details.source_row ?? null,
  };
}

function timestampCandidateIsInWindow(candidate, createdAt, extractedAt) {
  if (!candidate?.value) return false;
  const candidateMs = Date.parse(candidate.value);
  const createdMs = Date.parse(createdAt?.value ?? "");
  const extractedMs = Date.parse(extractedAt ?? "");
  if (!Number.isFinite(candidateMs)) return false;
  if (Number.isFinite(createdMs) && candidateMs < createdMs) return false;
  if (Number.isFinite(extractedMs) && candidateMs > extractedMs + 86_400_000) return false;
  return true;
}

async function collectLeadTemporalEvidence(inputDir, ownerBySource) {
  const contexts = new Map();
  for await (const lead of readNdjson(path.join(inputDir, "normalized", "leads.ndjson"))) {
    const sourceOwner = cleanText(lead.current?.owner_source);
    const mappingStatus = cleanText(ownerBySource.get(sourceOwner)?.mapping_status);
    if (!ACCEPTED_OWNER_MAPPINGS.has(mappingStatus)) continue;
    const sourceLeadId = cleanText(lead.source_lead_id);
    const currentStatus = cleanText(lead.current?.status_source);
    contexts.set(sourceLeadId, {
      createdAt: resolveLeadCreatedAt(lead),
      extractedAt: lead.extraction?.fetched_at ?? null,
      currentStatus,
      statusPattern: new RegExp(
        `^O\\s+status\\s+foi\\s+alterado\\s+para\\s+${escapeRegExp(currentStatus)}\\s+por\\b`,
        "iu",
      ),
      evidence: {
        latestFactualHistory: null,
        latestMatchingStatusEvent: null,
        latestClosedMarkerEvent: null,
        matchingStatusEventCount: 0,
        closedMarkerEventCount: 0,
      },
    });
  }

  for (const [entityType, filename] of [["event", "events.ndjson"], ["chat", "chat.ndjson"]]) {
    for await (const record of readNdjson(path.join(inputDir, "normalized", filename))) {
      const context = contexts.get(cleanText(record.source_lead_id));
      if (!context) continue;
      const parsed = parseSourceDate(record.time_raw, {
        extractedAt: context.extractedAt,
        sourceField: `normalized/${filename}.time_raw`,
      });
      const candidate = parsedTimestampCandidate(parsed, {
        rule: `latest_factual_${entityType}_timestamp`,
        source_external_key: cleanText(record.external_key),
        source_sequence: record.sequence,
      });
      if (!timestampCandidateIsInWindow(candidate, context.createdAt, context.extractedAt)) continue;
      context.evidence.latestFactualHistory = chooseLaterTimestamp(
        context.evidence.latestFactualHistory,
        candidate,
      );
      if (entityType !== "event") continue;

      const message = cleanText(record.message).replace(/\s+/g, " ");
      if (context.statusPattern.test(message)) {
        context.evidence.matchingStatusEventCount += 1;
        const statusCandidate = {
          ...candidate,
          rule: "latest_matching_status_event",
          confidence: parsed.inferred_year ? "medium" : "high",
          is_inferred: Boolean(parsed.inferred_year),
        };
        context.evidence.latestMatchingStatusEvent = chooseLaterTimestamp(
          context.evidence.latestMatchingStatusEvent,
          statusCandidate,
        );
      }
      if (/\bmarcou\s+como\s+neg[oó]cio\s+fechado\s+no\s+dia\s*:/iu.test(message)) {
        context.evidence.closedMarkerEventCount += 1;
        const closedCandidate = {
          ...candidate,
          rule: "latest_closed_marker_event",
          confidence: parsed.inferred_year ? "medium" : "high",
          is_inferred: Boolean(parsed.inferred_year),
        };
        context.evidence.latestClosedMarkerEvent = chooseLaterTimestamp(
          context.evidence.latestClosedMarkerEvent,
          closedCandidate,
        );
      }
    }
  }
  return new Map([...contexts].map(([sourceLeadId, context]) => [sourceLeadId, context.evidence]));
}

function provenanceFromCandidate(candidate, rule = candidate?.rule) {
  if (!candidate) return unavailableTimestampProvenance(rule ?? "unresolved");
  return {
    value: candidate.value,
    raw: candidate.raw ?? null,
    source_field: candidate.source_field ?? null,
    parse_method: candidate.parse_method ?? null,
    confidence: candidate.confidence,
    is_inferred: candidate.is_inferred,
    rule,
    source_external_key: candidate.source_external_key ?? null,
    source_sequence: candidate.source_sequence ?? null,
    source_row: candidate.source_row ?? null,
  };
}

function resolveLeadLifecycleTimestamps(lead, statusMapping, createdAt, temporalEvidence) {
  const currentStatus = cleanText(lead.current?.status_source);
  const associations = Array.isArray(lead.xlsx_associations) ? lead.xlsx_associations : [];
  const primary = associations.find(
    (association) => Number(association.row_number) === Number(lead.xlsx_primary_row),
  );
  const stalePrimaryStatusIgnored = Boolean(primary && cleanText(primary.status) !== currentStatus);
  let xlsxCandidate = null;
  if (primary && !stalePrimaryStatusIgnored) {
    const parsed = parseSourceDate(primary.updated_at, {
      extractedAt: lead.extraction?.fetched_at ?? null,
      sourceField: "xlsx_associations.primary.updated_at",
    });
    const candidate = parsedTimestampCandidate(parsed, {
      rule: "xlsx_primary_updated_at_matching_current_status_fallback",
      confidence: "fallback",
      is_inferred: true,
      source_row: primary.row_number,
    });
    if (timestampCandidateIsInWindow(candidate, createdAt, lead.extraction?.fetched_at)) {
      xlsxCandidate = candidate;
    }
  }

  const createdCandidate = parsedTimestampCandidate(createdAt, {
    rule: "created_at_only_factual_floor",
    confidence: createdAt.inferred_year ? "medium" : "high",
    is_inferred: Boolean(createdAt.inferred_year),
  });
  let updatedAtCandidate = createdCandidate.value ? createdCandidate : null;
  updatedAtCandidate = chooseLaterTimestamp(
    updatedAtCandidate,
    temporalEvidence?.latestFactualHistory,
  );
  updatedAtCandidate = chooseLaterTimestamp(updatedAtCandidate, xlsxCandidate);

  const stageCandidate = temporalEvidence?.latestMatchingStatusEvent ?? xlsxCandidate;
  const stageRule = stageCandidate?.rule ?? "unresolved_no_status_timestamp_evidence";
  const dealStatus = cleanText(statusMapping.target_deal_status);
  const wonCandidate = dealStatus === "won"
    ? temporalEvidence?.latestClosedMarkerEvent ?? stageCandidate
    : null;
  const lostCandidate = dealStatus === "lost" ? stageCandidate : null;
  const notApplicable = () => unavailableTimestampProvenance(
    `not_applicable_for_deal_status_${dealStatus || "unknown"}`,
  );
  const unresolvedOutcome = (outcome) => unavailableTimestampProvenance(
    `unresolved_no_${outcome}_timestamp_evidence`,
    {
      raw: stalePrimaryStatusIgnored ? cleanText(primary.updated_at) : null,
      source_field: stalePrimaryStatusIgnored ? "xlsx_associations.primary.updated_at" : null,
      source_status: stalePrimaryStatusIgnored ? cleanText(primary.status) : null,
      current_status: currentStatus,
      source_row: stalePrimaryStatusIgnored ? primary.row_number : null,
    },
  );
  return {
    values: {
      updatedAt: updatedAtCandidate?.value ?? null,
      stageEnteredAt: stageCandidate?.value ?? null,
      assignedAt: null,
      wonAt: wonCandidate?.value ?? null,
      lostAt: lostCandidate?.value ?? null,
    },
    rule: stageRule,
    audit: {
      current_status: currentStatus,
      stage_rule: stageRule,
      outcome_rule:
        dealStatus === "won"
          ? wonCandidate?.rule ?? "unresolved"
          : dealStatus === "lost"
            ? lostCandidate?.rule ?? "unresolved"
            : "not_applicable",
      matching_status_event_count: temporalEvidence?.matchingStatusEventCount ?? 0,
      closed_marker_event_count: temporalEvidence?.closedMarkerEventCount ?? 0,
      stale_primary_status_ignored: stalePrimaryStatusIgnored,
    },
    provenance: {
      created_at: timestampProvenanceFromParsed(createdAt, {
        rule: "source_created_at_resolved",
        confidence: createdAt.inferred_year ? "medium" : "high",
        isInferred: Boolean(createdAt.inferred_year),
      }),
      updated_at: provenanceFromCandidate(
        updatedAtCandidate,
        `latest_factual_timestamp:${updatedAtCandidate?.rule ?? "unresolved"}`,
      ),
      stage_entered_at: stageCandidate
        ? provenanceFromCandidate(stageCandidate)
        : unresolvedOutcome("stage_entered"),
      assigned_at: unavailableTimestampProvenance(
        "unavailable_no_explicit_assignment_timestamp",
      ),
      won_at:
        dealStatus === "won"
          ? wonCandidate
            ? provenanceFromCandidate(wonCandidate)
            : unresolvedOutcome("won")
          : notApplicable(),
      lost_at:
        dealStatus === "lost"
          ? lostCandidate
            ? provenanceFromCandidate(lostCandidate)
            : unresolvedOutcome("lost")
          : notApplicable(),
    },
  };
}

function buildLeadPayload(lead, ownerMapping, statusMapping, createdAt, lifecycle, resolvedFields) {
  const current = lead.current ?? {};
  const lost = statusMapping.target_deal_status === "lost";
  return {
    source_system: "contact2sale",
    source_lead_id: cleanText(lead.source_lead_id),
    pipeline_id: lead.target.pipeline_id,
    stage_id: statusMapping.target_stage_id ?? null,
    deal_status: statusMapping.target_deal_status ?? null,
    lost_reason: lost ? "Arquivado no C2S" : null,
    assigned_user_id: ownerMapping.target_id,
    name: resolvedFields.name,
    email: cleanText(current.email) || null,
    phone: resolvedFields.phoneCanonical,
    source: cleanText(current.source) || "C2S",
    message: cleanText(current.observation) || null,
    tags: Array.isArray(current.tags_source) ? current.tags_source : [],
    created_at: createdAt.value,
    updated_at: lifecycle.values.updatedAt,
    stage_entered_at: lifecycle.values.stageEnteredAt,
    assigned_at: lifecycle.values.assignedAt,
    won_at: lifecycle.values.wonAt,
    lost_at: lifecycle.values.lostAt,
    historical_import: true,
    notification_policy: "suppress_all",
    metadata: {
      source_company: cleanText(lead.source_company),
      source_status: cleanText(current.status_source),
      source_owner: cleanText(current.owner_source),
      source_team: cleanText(current.team_source),
      source_channel: cleanText(current.channel) || null,
      name_raw: resolvedFields.nameRaw,
      phone_raw: cleanText(current.phone) || null,
      phone_secondary_raw: cleanText(current.phone2) || null,
      city: cleanText(current.city) || null,
      neighbourhood: cleanText(current.neighbourhood) || null,
      source_interest_raw: cleanText(current.interest_raw) || null,
      created_at_resolution: createdAt,
      timestamp_provenance: lifecycle.provenance,
      received_at_raw: cleanText(current.received_at_raw) || null,
      interacted_at_raw: cleanText(current.interacted_at_raw) || null,
      lost_reason_resolution: lost ? "default_from_source_status" : null,
      automation_policy: "suppress_all",
      distribution_policy: "preserve_owner_without_distribution",
      data_quality_warning: resolvedFields.dataQualityResolutions.length > 0,
      data_quality_resolutions: resolvedFields.dataQualityResolutions,
    },
  };
}

function buildHistoryPayload(entityType, record, organizationId, leadId, occurredAt) {
  const media = Array.isArray(record.media) ? record.media : [];
  const sourceMessage = cleanText(record.message);
  const emptyChatSource = entityType === "chat" && !sourceMessage && media.length === 0;
  const common = {
    source_system: "contact2sale",
    source_lead_id: cleanText(record.source_lead_id),
    lead_id: leadId,
    sequence: record.sequence,
    event_at: occurredAt.value,
    time_raw: cleanText(record.time_raw),
    author_source: cleanText(record.author_source) || null,
    message: emptyChatSource ? "[Mensagem sem conteúdo no C2S]" : sourceMessage,
    historical_import: true,
    notification_policy: "suppress_all",
    metadata: {
      event_at_resolution: occurredAt,
      source_payload_sha256: cleanText(record.payload_sha256) || null,
      automation_policy: "suppress_all",
      data_quality_warning: emptyChatSource,
      source_message_empty: emptyChatSource,
      source_message_raw: emptyChatSource ? String(record.message ?? "") : null,
      data_quality_resolutions: emptyChatSource
        ? ["empty_chat_content_preserved_with_neutral_placeholder"]
        : [],
    },
  };
  if (entityType === "event") {
    return { ...common, raw_text: cleanText(record.raw_text) || null };
  }
  return {
    ...common,
    direction: cleanText(record.direction) || null,
    media,
  };
}

function blankActionCounts() {
  return { CREATE: 0, NOOP: 0, DRIFT: 0, CONFLICT: 0 };
}

function addCount(object, key, amount = 1) {
  object[key] = (object[key] ?? 0) + amount;
}

function snapshotKey(entityType, value) {
  return `${entityType}:${value}`;
}

export function createSnapshotIndex(records = []) {
  const byExternalKey = new Map();
  const byId = new Map();
  for (const record of records) {
    const entityType = cleanText(record.entity_type);
    const externalKey = cleanText(record.external_key);
    const id = cleanText(record.id ?? record.target_id);
    if (!entityType || !externalKey || !id) {
      throw new TypeError("Snapshot rows require entity_type, external_key and id/target_id");
    }
    const normalized = {
      entity_type: entityType,
      external_key: externalKey,
      id,
      payload_sha256:
        cleanText(record.payload_sha256) || (record.payload ? sha256Canonical(record.payload) : ""),
    };
    const externalBucket = byExternalKey.get(snapshotKey(entityType, externalKey)) ?? [];
    externalBucket.push(normalized);
    byExternalKey.set(snapshotKey(entityType, externalKey), externalBucket);
    const idBucket = byId.get(snapshotKey(entityType, id)) ?? [];
    idBucket.push(normalized);
    byId.set(snapshotKey(entityType, id), idBucket);
  }
  return { byExternalKey, byId, size: records.length };
}

export function classifyAgainstSnapshot(record, snapshotIndex) {
  const keyMatches =
    snapshotIndex.byExternalKey.get(snapshotKey(record.entity_type, record.external_key)) ?? [];
  if (keyMatches.length > 1) {
    return { action: "CONFLICT", reason: "SNAPSHOT_DUPLICATE_EXTERNAL_KEY" };
  }
  if (keyMatches.length === 1) {
    const current = keyMatches[0];
    if (current.id !== record.target_id) {
      return { action: "CONFLICT", reason: "EXTERNAL_KEY_TARGET_ID_MISMATCH" };
    }
    if (!current.payload_sha256) {
      return { action: "CONFLICT", reason: "SNAPSHOT_PAYLOAD_HASH_MISSING" };
    }
    return current.payload_sha256 === record.payload_sha256
      ? { action: "NOOP", reason: "CANONICAL_PAYLOAD_MATCH" }
      : { action: "DRIFT", reason: "CANONICAL_PAYLOAD_MISMATCH" };
  }

  const idMatches = snapshotIndex.byId.get(snapshotKey(record.entity_type, record.target_id)) ?? [];
  if (idMatches.length > 0) {
    return { action: "CONFLICT", reason: "TARGET_ID_BOUND_TO_OTHER_EXTERNAL_KEY" };
  }
  return { action: "CREATE", reason: "IDENTITY_NOT_PRESENT" };
}

function finalizeRecord({ entityType, organizationId, externalKey, payload, provenance, issues }, snapshot) {
  const targetId = deterministicEntityId(organizationId, externalKey);
  const payloadSha256 = sha256Canonical(payload);
  const base = {
    schema_version: SCHEMA_VERSION,
    manifest_kind: "dry_run_only",
    entity_type: entityType,
    target_id: targetId,
    organization_id: organizationId,
    external_key: externalKey,
    payload_sha256: payloadSha256,
    payload,
    provenance,
    validation: {
      ok: validationState(issues) === "READY",
      state: validationState(issues),
      issues,
    },
  };
  const classification = classifyAgainstSnapshot(base, snapshot);
  if (classification.action === "CONFLICT") {
    base.validation.issues.push(
      issue(classification.reason, "error", "identity", "Destination identity conflict"),
    );
    base.validation.state = "BLOCKED";
    base.validation.ok = false;
  }
  return {
    ...base,
    action: classification.action,
    action_reason: classification.reason,
    apply_eligible:
      base.validation.state === "READY" &&
      (classification.action === "CREATE" || classification.action === "NOOP"),
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function* readNdjson(filePath) {
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch (error) {
      throw new SyntaxError(`${path.basename(filePath)}:${lineNumber}: ${error.message}`);
    }
  }
}

async function loadSnapshot(filePath) {
  if (!filePath) return { records: [], path: null, sha256: null };
  const raw = await readFile(filePath, "utf8");
  const trimmed = raw.trim();
  if (!trimmed) return { records: [], path: filePath, sha256: sha256Text(raw) };
  let records;
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) records = parsed;
    else if (Array.isArray(parsed.records)) records = parsed.records;
    else records = [parsed];
  } else {
    records = trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  }
  return { records, path: filePath, sha256: sha256Text(raw) };
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyRequiredInputFiles(inputDir) {
  const requiredPaths = [
    "mappings/owners.json",
    "mappings/status.json",
    "normalized/leads.ndjson",
    "normalized/events.ndjson",
    "normalized/chat.ndjson",
  ];
  const manifestPath = path.join(inputDir, "manifest.json");
  const manifestChecksumPath = path.join(inputDir, "manifest.sha256");
  const [manifest, checksumText, manifestSha256] = await Promise.all([
    readJson(manifestPath),
    readFile(manifestChecksumPath, "utf8"),
    sha256File(manifestPath),
  ]);
  const declaredManifestSha256 = checksumText.trim().split(/\s+/)[0]?.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(declaredManifestSha256 ?? "")) {
    throw new Error("Invalid source manifest.sha256 format");
  }
  if (declaredManifestSha256 !== manifestSha256) {
    throw new Error("Source manifest checksum mismatch");
  }
  const sealedAtUtc = cleanText(manifest.sealed_at_utc);
  if (!sealedAtUtc || !Number.isFinite(Date.parse(sealedAtUtc))) {
    throw new Error("Source manifest sealed_at_utc is missing or invalid");
  }
  const manifestFiles = new Map(
    (manifest.files ?? []).map((entry) => [String(entry.path).replaceAll("\\", "/"), entry]),
  );
  const verifiedFiles = [];
  for (const relativePath of requiredPaths) {
    const declared = manifestFiles.get(relativePath);
    if (!declared || !/^[0-9a-f]{64}$/i.test(declared.sha256 ?? "")) {
      throw new Error(`Required source file missing from manifest: ${relativePath}`);
    }
    const absolutePath = path.join(inputDir, ...relativePath.split("/"));
    const actualSha256 = await sha256File(absolutePath);
    if (actualSha256 !== String(declared.sha256).toLowerCase()) {
      throw new Error(`Source checksum mismatch: ${relativePath}`);
    }
    verifiedFiles.push({ path: relativePath, sha256: actualSha256 });
  }
  return {
    manifest_sha256: manifestSha256,
    sealed_at_utc: sealedAtUtc,
    required_files_verified: verifiedFiles.length,
    files: verifiedFiles,
  };
}

class JsonBatchWriter {
  constructor({ directory, entityType, recordLimit, byteLimit, manifestPrefix = "batches" }) {
    this.directory = directory;
    this.entityType = entityType;
    this.recordLimit = recordLimit;
    this.byteLimit = byteLimit;
    this.manifestPrefix = manifestPrefix;
    this.records = [];
    this.estimatedBytes = 0;
    this.nextIndex = 1;
    this.files = [];
  }

  async add(record) {
    const recordBytes = Buffer.byteLength(canonicalStringify(record), "utf8");
    if (recordBytes + 8_192 > this.byteLimit) {
      throw new RangeError(`${this.entityType} record exceeds batch byte limit`);
    }
    if (
      this.records.length > 0 &&
      (this.records.length >= this.recordLimit ||
        this.estimatedBytes + recordBytes + 8_192 > this.byteLimit)
    ) {
      await this.flush();
    }
    this.records.push(record);
    this.estimatedBytes += recordBytes + 1;
  }

  async flush() {
    if (this.records.length === 0) return;
    const records = this.records;
    this.records = [];
    this.estimatedBytes = 0;
    await this.#writeSplit(records);
  }

  async #writeSplit(records) {
    const index = this.nextIndex;
    const recordsSha256 = sha256Canonical(records);
    const envelope = {
      schema_version: SCHEMA_VERSION,
      manifest_kind: "dry_run_only",
      apply_requires_report_state_ready: true,
      batch: {
        entity_type: this.entityType,
        index,
        record_count: records.length,
        record_limit: this.recordLimit,
        byte_limit: this.byteLimit,
        records_sha256: recordsSha256,
      },
      records,
    };
    let serialized = `${canonicalStringify(envelope)}\n`;
    let bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > this.byteLimit && records.length > 1) {
      const middle = Math.ceil(records.length / 2);
      await this.#writeSplit(records.slice(0, middle));
      await this.#writeSplit(records.slice(middle));
      return;
    }
    if (bytes > this.byteLimit) {
      throw new RangeError(`${this.entityType} record cannot fit the configured batch byte limit`);
    }

    const filename = `${this.entityType}-${String(index).padStart(4, "0")}.json`;
    const target = path.join(this.directory, filename);
    await writeFile(target, serialized, { encoding: "utf8", flag: "wx" });
    const fileSha256 = sha256Text(serialized);
    this.files.push({
      path: path.posix.join(this.manifestPrefix, filename),
      entity_type: this.entityType,
      index,
      records: records.length,
      bytes,
      sha256: fileSha256,
      records_sha256: recordsSha256,
    });
    this.nextIndex += 1;
  }
}

function newEntityReport() {
  return {
    records: 0,
    ready: 0,
    blocked: 0,
    actions: blankActionCounts(),
    issue_counts: {},
    date_resolution_counts: {},
  };
}

function observeRecord(report, record, dateResolution) {
  report.records += 1;
  addCount(report, record.validation.state === "READY" ? "ready" : "blocked");
  addCount(report.actions, record.action);
  for (const entry of record.validation.issues) addCount(report.issue_counts, entry.code);
  if (dateResolution) addCount(report.date_resolution_counts, dateResolution.method);
}

function statusMappingWithOverride(statusMappings, archivedStageId) {
  const copy = structuredClone(statusMappings);
  if (archivedStageId) {
    if (!UUID_PATTERN.test(archivedStageId)) throw new TypeError("--archived-stage-id must be a UUID");
    if (!copy.Arquivado) throw new TypeError("Status map has no Arquivado entry");
    copy.Arquivado.target_stage_id = archivedStageId;
    copy.Arquivado.status = "READY_EXPLICIT_OVERRIDE";
  }
  return copy;
}

async function ensureOutputDoesNotExist(outputDir) {
  try {
    await stat(outputDir);
    throw new Error(`Output already exists: ${outputDir}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function assertSafeTemporaryOutput(tempDir, outputDir) {
  const resolvedTemp = path.resolve(tempDir);
  const resolvedOutput = path.resolve(outputDir);
  const expectedPrefix = `${path.basename(resolvedOutput)}.tmp-`;
  if (
    path.dirname(resolvedTemp) !== path.dirname(resolvedOutput) ||
    !path.basename(resolvedTemp).startsWith(expectedPrefix)
  ) {
    throw new Error("Refusing to clean an unexpected temporary output path");
  }
}

function assertExpected(label, actual, expected, issues) {
  if (expected === null || expected === undefined) return;
  if (actual !== expected) {
    issues.push({ code: `EXPECTED_${label.toUpperCase()}_MISMATCH`, expected, actual });
  }
}

function timestampAuditContractView(audit) {
  return {
    stage_resolution_by_status: audit.stage_resolution_by_status,
    outcome_resolution_counts: audit.outcome_resolution_counts,
    stale_primary_status_ignored: audit.stale_primary_status_ignored,
  };
}

export async function buildImportManifest(options) {
  const inputDir = path.resolve(options.inputDir);
  const outputDir = path.resolve(options.outputDir);
  const batchRecordLimit = options.batchRecordLimit ?? DEFAULT_BATCH_RECORD_LIMIT;
  const batchByteLimit = options.batchByteLimit ?? DEFAULT_BATCH_BYTE_LIMIT;
  if (!Number.isInteger(batchRecordLimit) || batchRecordLimit < 1) {
    throw new TypeError("batchRecordLimit must be a positive integer");
  }
  if (!Number.isInteger(batchByteLimit) || batchByteLimit < 16_384) {
    throw new TypeError("batchByteLimit must be an integer of at least 16384 bytes");
  }
  await ensureOutputDoesNotExist(outputDir);

  const tempDir = `${outputDir}.tmp-${process.pid}-${Date.now()}`;
  const batchDir = path.join(tempDir, "batches");
  const canaryBatchDir = path.join(tempDir, "canary", "batches");
  await mkdir(batchDir, { recursive: true });
  await mkdir(canaryBatchDir, { recursive: true });

  try {
    const sourceIntegrity = await verifyRequiredInputFiles(inputDir);
    const ownerMappings = await readJson(path.join(inputDir, "mappings", "owners.json"));
    const rawStatusMappings = await readJson(path.join(inputDir, "mappings", "status.json"));
    const statusMappings = statusMappingWithOverride(rawStatusMappings, options.archivedStageId);
    const snapshot = await loadSnapshot(options.snapshotPath);
    const snapshotIndex = createSnapshotIndex(snapshot.records);
    const ownerBySource = new Map(ownerMappings.map((row) => [cleanText(row.source_owner), row]));
    const temporalEvidenceByLead = await collectLeadTemporalEvidence(inputDir, ownerBySource);
    const selectedLeadIds = new Set();
    const leadIdentityBySourceId = new Map();
    const sourceLeadIdsSeen = new Set();
    const sourceExternalKeysSeen = new Set();
    const sourceTargetIdsSeen = new Set();
    const sourceIntegrityIssues = [];
    const excludedOwnerCounts = {};
    const ownerMappingCounts = {};
    const ownerObservedCounts = new Map();
    const statusReport = {};
    const phoneGroups = new Map();
    const canaryCandidates = [];
    const reports = {
      lead: newEntityReport(),
      event: newEntityReport(),
      chat: newEntityReport(),
    };
    const sourceCounts = { leads: 0, events: 0, chat: 0, excluded_unresolved: 0 };
    const selectedHistoryExpected = { event: 0, chat: 0 };
    const timestampAudit = {
      resolution_counts: {},
      stage_resolution_by_status: {},
      outcome_resolution_counts: { won_at: {}, lost_at: {} },
      stale_primary_status_ignored: 0,
      multiple_matching_status_event_leads_by_status: {},
      fields: {
        updated_at: { resolved: 0, null_with_technical_storage_fallback: 0 },
        stage_entered_at: { resolved: 0, null: 0 },
        assigned_at: { resolved: 0, null: 0 },
        won_at: { resolved: 0, null: 0 },
        lost_at: { resolved: 0, null: 0 },
      },
    };
    let pipelineId = null;

    const writers = {
      lead: new JsonBatchWriter({
        directory: batchDir,
        entityType: "lead",
        recordLimit: batchRecordLimit,
        byteLimit: batchByteLimit,
      }),
      event: new JsonBatchWriter({
        directory: batchDir,
        entityType: "event",
        recordLimit: batchRecordLimit,
        byteLimit: batchByteLimit,
      }),
      chat: new JsonBatchWriter({
        directory: batchDir,
        entityType: "chat",
        recordLimit: batchRecordLimit,
        byteLimit: batchByteLimit,
      }),
    };

    let organizationId = null;
    for await (const lead of readNdjson(path.join(inputDir, "normalized", "leads.ndjson"))) {
      sourceCounts.leads += 1;
      const sourceLeadId = cleanText(lead.source_lead_id);
      const sourceOwner = cleanText(lead.current?.owner_source);
      const ownerMapping = ownerBySource.get(sourceOwner);
      const mappingStatus = cleanText(ownerMapping?.mapping_status) || "MISSING_MAPPING";
      addCount(ownerMappingCounts, mappingStatus);
      ownerObservedCounts.set(sourceOwner, (ownerObservedCounts.get(sourceOwner) ?? 0) + 1);

      if (mappingStatus === "UNRESOLVED" || !ACCEPTED_OWNER_MAPPINGS.has(mappingStatus)) {
        sourceCounts.excluded_unresolved += 1;
        addCount(excludedOwnerCounts, mappingStatus || "MISSING_MAPPING");
        continue;
      }

      const leadOrganizationId = cleanText(lead.target?.organization_id);
      if (!organizationId) organizationId = leadOrganizationId;
      if (leadOrganizationId !== organizationId || !UUID_PATTERN.test(leadOrganizationId)) {
        sourceIntegrityIssues.push({
          code: "ORGANIZATION_ID_MISMATCH",
          source_lead_id_sha256: sha256Text(sourceLeadId),
        });
      }
      const leadPipelineId = cleanText(lead.target?.pipeline_id);
      if (!pipelineId) pipelineId = leadPipelineId;
      if (leadPipelineId !== pipelineId || !UUID_PATTERN.test(leadPipelineId)) {
        sourceIntegrityIssues.push({
          code: "PIPELINE_ID_MISMATCH",
          source_lead_id_sha256: sha256Text(sourceLeadId),
        });
      }
      selectedLeadIds.add(sourceLeadId);
      if (sourceLeadIdsSeen.has(sourceLeadId)) {
        sourceIntegrityIssues.push({
          code: "DUPLICATE_SOURCE_LEAD_ID",
          source_lead_id_sha256: sha256Text(sourceLeadId),
        });
      }
      sourceLeadIdsSeen.add(sourceLeadId);

      const externalKey = cleanText(lead.external_key);
      const targetId = deterministicEntityId(leadOrganizationId, externalKey);
      if (sourceExternalKeysSeen.has(externalKey)) {
        sourceIntegrityIssues.push({ code: "DUPLICATE_SOURCE_EXTERNAL_KEY", external_key_sha256: sha256Text(externalKey) });
      }
      if (sourceTargetIdsSeen.has(targetId)) {
        sourceIntegrityIssues.push({ code: "DUPLICATE_DETERMINISTIC_TARGET_ID", target_id: targetId });
      }
      sourceExternalKeysSeen.add(externalKey);
      sourceTargetIdsSeen.add(targetId);
      leadIdentityBySourceId.set(sourceLeadId, { externalKey, targetId, extractedAt: lead.extraction?.fetched_at });
      selectedHistoryExpected.event += Number(lead.counts?.action_log ?? 0);
      selectedHistoryExpected.chat += Number(lead.counts?.chat ?? 0);

      const sourceStatus = cleanText(lead.current?.status_source);
      const statusMapping = statusMappings[sourceStatus] ?? null;
      const createdAt = resolveLeadCreatedAt(lead);
      const lifecycle = resolveLeadLifecycleTimestamps(
        lead,
        statusMapping ?? {},
        createdAt,
        temporalEvidenceByLead.get(sourceLeadId),
      );
      addCount(timestampAudit.resolution_counts, lifecycle.rule);
      const stageStatusAudit = (timestampAudit.stage_resolution_by_status[sourceStatus] ??= {});
      addCount(stageStatusAudit, lifecycle.audit.stage_rule);
      if (lifecycle.audit.stale_primary_status_ignored) {
        timestampAudit.stale_primary_status_ignored += 1;
      }
      if (lifecycle.audit.matching_status_event_count > 1) {
        addCount(timestampAudit.multiple_matching_status_event_leads_by_status, sourceStatus);
      }
      if (statusMapping?.target_deal_status === "won") {
        addCount(timestampAudit.outcome_resolution_counts.won_at, lifecycle.audit.outcome_rule);
      } else if (statusMapping?.target_deal_status === "lost") {
        addCount(timestampAudit.outcome_resolution_counts.lost_at, lifecycle.audit.outcome_rule);
      }
      const lifecycleFieldValues = {
        updated_at: lifecycle.values.updatedAt,
        stage_entered_at: lifecycle.values.stageEnteredAt,
        assigned_at: lifecycle.values.assignedAt,
        won_at: lifecycle.values.wonAt,
        lost_at: lifecycle.values.lostAt,
      };
      for (const [field, value] of Object.entries(lifecycleFieldValues)) {
        if (value) timestampAudit.fields[field].resolved += 1;
        else if (field === "updated_at") {
          timestampAudit.fields[field].null_with_technical_storage_fallback += 1;
        } else timestampAudit.fields[field].null += 1;
      }
      const fieldValidation = validateLeadFields(
        lead,
        ownerMapping,
        statusMapping,
        createdAt,
        options.applyApprovedDataQualityPolicy === true,
      );
      const payload = buildLeadPayload(
        lead,
        ownerMapping,
        statusMapping ?? {},
        createdAt,
        lifecycle,
        fieldValidation,
      );
      const record = finalizeRecord({
        entityType: "lead",
        organizationId: leadOrganizationId,
        externalKey,
        payload,
        provenance: {
          source_system: "contact2sale",
          source_lead_id: sourceLeadId,
          source_company: cleanText(lead.source_company),
          source_presence: cleanText(lead.source_presence),
          history_chunk: cleanText(lead.history_chunk),
          owner_mapping_status: mappingStatus,
          owner_mapping_confidence: cleanText(ownerMapping.confidence),
          status_mapping_status: cleanText(statusMapping?.status) || "UNRESOLVED_STATUS",
          source_payload_sha256: sha256Canonical(lead),
        },
        issues: fieldValidation.issues,
      }, snapshotIndex);
      await writers.lead.add(record);
      observeRecord(reports.lead, record, createdAt);
      const statusBucket = (statusReport[sourceStatus] ??= {
        source_status: sourceStatus,
        target_stage_id: statusMapping?.target_stage_id ?? null,
        target_deal_status: statusMapping?.target_deal_status ?? null,
        mapping_status: statusMapping?.status ?? "UNRESOLVED_STATUS",
        records: 0,
        ready: 0,
        blocked: 0,
      });
      statusBucket.records += 1;
      statusBucket[record.validation.state === "READY" ? "ready" : "blocked"] += 1;

      const identityPhoneKey = normalizePhoneLikeDatabase(lead.current?.phone);
      if (identityPhoneKey) {
        const group = phoneGroups.get(identityPhoneKey) ?? [];
        group.push(sourceLeadId);
        phoneGroups.set(identityPhoneKey, group);
      }
      canaryCandidates.push({
        sourceLeadId,
        sourceStatus,
        phoneKey: normalizePhoneLikeDatabase(record.payload.phone),
        eventCount: Number(lead.counts?.action_log ?? 0),
        chatCount: Number(lead.counts?.chat ?? 0),
        record,
      });
    }
    await writers.lead.flush();

    for (const mapping of ownerMappings) {
      if (!Number.isInteger(mapping.lead_count)) continue;
      const actual = ownerObservedCounts.get(cleanText(mapping.source_owner)) ?? 0;
      if (actual !== mapping.lead_count) {
        sourceIntegrityIssues.push({
          code: "OWNER_MAPPING_COUNT_MISMATCH",
          source_owner_sha256: sha256Text(cleanText(mapping.source_owner)),
          expected: mapping.lead_count,
          actual,
        });
      }
    }

    const eligibleCanaryCandidates = canaryCandidates.filter(
      (candidate) =>
        candidate.record.apply_eligible &&
        candidate.phoneKey &&
        candidate.eventCount >= 1 &&
        candidate.chatCount >= 1 &&
        (phoneGroups.get(candidate.phoneKey)?.length ?? 0) === 1,
    );
    const preferredCanaryCandidates = eligibleCanaryCandidates.filter((candidate) =>
      candidate.sourceStatus === "Novo" || candidate.sourceStatus === "Em negociação",
    );
    const canaryPool =
      preferredCanaryCandidates.length > 0
        ? preferredCanaryCandidates
        : eligibleCanaryCandidates;
    const statusPriority = new Map([
      ["Novo", 0],
      ["Em negociação", 1],
    ]);
    canaryPool.sort((left, right) => {
      const leftHistory = left.eventCount + left.chatCount;
      const rightHistory = right.eventCount + right.chatCount;
      if (leftHistory !== rightHistory) return leftHistory - rightHistory;
      const statusDifference =
        (statusPriority.get(left.sourceStatus) ?? 2) -
        (statusPriority.get(right.sourceStatus) ?? 2);
      if (statusDifference !== 0) return statusDifference;
      return left.sourceLeadId.localeCompare(right.sourceLeadId, "en", { numeric: true });
    });
    const selectedCanary = canaryPool[0] ?? null;
    if (!selectedCanary) {
      sourceIntegrityIssues.push({ code: "NO_ELIGIBLE_CANARY_LEAD" });
    }
    const canaryWriters = {
      lead: new JsonBatchWriter({
        directory: canaryBatchDir,
        entityType: "lead",
        recordLimit: batchRecordLimit,
        byteLimit: batchByteLimit,
        manifestPrefix: "canary/batches",
      }),
      event: new JsonBatchWriter({
        directory: canaryBatchDir,
        entityType: "event",
        recordLimit: batchRecordLimit,
        byteLimit: batchByteLimit,
        manifestPrefix: "canary/batches",
      }),
      chat: new JsonBatchWriter({
        directory: canaryBatchDir,
        entityType: "chat",
        recordLimit: batchRecordLimit,
        byteLimit: batchByteLimit,
        manifestPrefix: "canary/batches",
      }),
    };
    if (selectedCanary) await canaryWriters.lead.add(selectedCanary.record);
    await canaryWriters.lead.flush();
    const canaryObserved = { lead: selectedCanary ? 1 : 0, event: 0, chat: 0 };

    async function processHistory(entityType, filename) {
      const externalKeysSeen = new Set();
      const targetIdsSeen = new Set();
      for await (const sourceRecord of readNdjson(path.join(inputDir, "normalized", filename))) {
        sourceCounts[entityType === "event" ? "events" : "chat"] += 1;
        const sourceLeadId = cleanText(sourceRecord.source_lead_id);
        if (!selectedLeadIds.has(sourceLeadId)) continue;
        const leadIdentity = leadIdentityBySourceId.get(sourceLeadId);
        assert(leadIdentity, "selected lead identity must exist");
        const occurredAt = parseSourceDate(sourceRecord.time_raw, {
          extractedAt: leadIdentity.extractedAt,
          sourceField: "time_raw",
        });
        const issues = validateHistoryFields(
          entityType,
          sourceRecord,
          occurredAt,
          selectedLeadIds,
        );
        const externalKey = cleanText(sourceRecord.external_key);
        const targetId = deterministicEntityId(organizationId, externalKey);
        if (externalKeysSeen.has(externalKey)) {
          issues.push(issue("DUPLICATE_SOURCE_EXTERNAL_KEY", "error", "external_key", "External key is duplicated"));
        }
        if (targetIdsSeen.has(targetId)) {
          issues.push(issue("DUPLICATE_DETERMINISTIC_TARGET_ID", "error", "target_id", "Target id is duplicated"));
        }
        externalKeysSeen.add(externalKey);
        targetIdsSeen.add(targetId);
        const payload = buildHistoryPayload(
          entityType,
          sourceRecord,
          organizationId,
          leadIdentity.targetId,
          occurredAt,
        );
        const record = finalizeRecord({
          entityType,
          organizationId,
          externalKey,
          payload,
          provenance: {
            source_system: "contact2sale",
            source_lead_id: sourceLeadId,
            source_sequence: sourceRecord.sequence,
            identity_confidence: cleanText(sourceRecord.identity_confidence),
            source_payload_sha256: cleanText(sourceRecord.payload_sha256) || sha256Canonical(sourceRecord),
          },
          issues,
        }, snapshotIndex);
        await writers[entityType].add(record);
        observeRecord(reports[entityType], record, occurredAt);
        if (selectedCanary?.sourceLeadId === sourceLeadId) {
          await canaryWriters[entityType].add(record);
          canaryObserved[entityType] += 1;
        }
      }
      await writers[entityType].flush();
      await canaryWriters[entityType].flush();
    }

    await processHistory("event", "events.ndjson");
    await processHistory("chat", "chat.ndjson");

    if (reports.event.records !== selectedHistoryExpected.event) {
      sourceIntegrityIssues.push({
        code: "LEAD_EVENT_COUNT_RECONCILIATION_FAILED",
        expected: selectedHistoryExpected.event,
        actual: reports.event.records,
      });
    }
    if (reports.chat.records !== selectedHistoryExpected.chat) {
      sourceIntegrityIssues.push({
        code: "LEAD_CHAT_COUNT_RECONCILIATION_FAILED",
        expected: selectedHistoryExpected.chat,
        actual: reports.chat.records,
      });
    }
    if (
      selectedCanary &&
      (canaryObserved.event !== selectedCanary.eventCount ||
        canaryObserved.chat !== selectedCanary.chatCount)
    ) {
      sourceIntegrityIssues.push({
        code: "CANARY_HISTORY_RECONCILIATION_FAILED",
        expected: {
          event: selectedCanary.eventCount,
          chat: selectedCanary.chatCount,
        },
        actual: { event: canaryObserved.event, chat: canaryObserved.chat },
      });
    }

    const duplicatePhoneGroups = [...phoneGroups.values()].filter((ids) => ids.length > 1);
    const batches = [...writers.lead.files, ...writers.event.files, ...writers.chat.files];
    const expectedMismatches = [];
    assertExpected("selected_leads", reports.lead.records, options.expected?.selectedLeads, expectedMismatches);
    assertExpected("excluded_leads", sourceCounts.excluded_unresolved, options.expected?.excludedLeads, expectedMismatches);
    assertExpected("events", reports.event.records, options.expected?.events, expectedMismatches);
    assertExpected("chat", reports.chat.records, options.expected?.chat, expectedMismatches);
    if (
      options.expectedTemporalAudit &&
      canonicalStringify(timestampAuditContractView(timestampAudit)) !==
        canonicalStringify(options.expectedTemporalAudit)
    ) {
      sourceIntegrityIssues.push({
        code: "TEMPORAL_EVIDENCE_COUNT_MISMATCH",
        expected: options.expectedTemporalAudit,
        actual: timestampAuditContractView(timestampAudit),
      });
    }

    const blockers = [];
    for (const [entityType, entityReport] of Object.entries(reports)) {
      if (entityReport.blocked > 0) {
        blockers.push({ code: `${entityType.toUpperCase()}_VALIDATION_BLOCKED`, count: entityReport.blocked });
      }
      if (entityReport.actions.CONFLICT > 0) {
        blockers.push({ code: `${entityType.toUpperCase()}_DESTINATION_CONFLICT`, count: entityReport.actions.CONFLICT });
      }
      if (entityReport.actions.DRIFT > 0) {
        blockers.push({ code: `${entityType.toUpperCase()}_DESTINATION_DRIFT`, count: entityReport.actions.DRIFT });
      }
    }
    if (sourceIntegrityIssues.length > 0) {
      blockers.push({ code: "SOURCE_INTEGRITY_ISSUES", count: sourceIntegrityIssues.length });
    }
    if (expectedMismatches.length > 0) {
      blockers.push({ code: "EXPECTED_COUNT_MISMATCH", count: expectedMismatches.length });
    }

    const state = blockers.length === 0 ? "READY" : "HOLD";
    const canaryBatches = [
      ...canaryWriters.lead.files,
      ...canaryWriters.event.files,
      ...canaryWriters.chat.files,
    ];
    const canaryReport = {
      schema_version: SCHEMA_VERSION,
      state:
        selectedCanary &&
        selectedCanary.record.apply_eligible &&
        canaryObserved.event === selectedCanary.eventCount &&
        canaryObserved.chat === selectedCanary.chatCount
          ? "READY"
          : "HOLD",
      apply_authorized: false,
      selection_policy: {
        preferred_statuses: ["Novo", "Em negociação"],
        normalized_phone_must_be_unique: true,
        minimum_history: { event: 1, chat: 1 },
        ordering: ["total_history_ascending", "status_priority", "source_lead_id_numeric"],
      },
      selection: selectedCanary
        ? {
            target_id: selectedCanary.record.target_id,
            external_key_sha256: sha256Text(selectedCanary.record.external_key),
            source_lead_id_sha256: sha256Text(selectedCanary.sourceLeadId),
            source_status: selectedCanary.sourceStatus,
            event_count: selectedCanary.eventCount,
            chat_count: selectedCanary.chatCount,
            total_history: selectedCanary.eventCount + selectedCanary.chatCount,
            payload_sha256: selectedCanary.record.payload_sha256,
          }
        : null,
      observed_counts: canaryObserved,
      batches: canaryBatches,
    };
    const report = {
      schema_version: SCHEMA_VERSION,
      manifest_kind: "c2s_historical_import_dry_run",
      state,
      apply_authorized: false,
      generated_at: sourceIntegrity.sealed_at_utc,
      generated_at_basis: "sealed_source_manifest_timestamp",
      input: {
        directory: inputDir,
        owner_mapping_file: "mappings/owners.json",
        status_mapping_file: "mappings/status.json",
        integrity: sourceIntegrity,
      },
      destination_snapshot: {
        path: snapshot.path,
        sha256: snapshot.sha256,
        records: snapshot.records.length,
      },
      target: { organization_id: organizationId, pipeline_id: pipelineId },
      policies: {
        identity: "uuidv5(organization_id + ':' + external_key)",
        distinct_source_lead_ids_are_never_merged_by_phone: true,
        historical_notifications: "suppress_all",
        historical_automations: "suppress_all",
        unresolved_owner: "exclude",
        missing_status_stage: "fail_closed",
        empty_chat_content:
          "neutral_placeholder_with_raw_empty_and_data_quality_warning",
        lifecycle_timestamps:
          "latest_matching_status_event; then matching_primary_xlsx_updated_at_fallback; otherwise null",
        source_time_zone: SOURCE_TIME_ZONE,
        source_utc_offset: SOURCE_UTC_OFFSET,
        approved_data_quality_policy:
          options.applyApprovedDataQualityPolicy === true
            ? "empty_name_neutral_label; one_character_name_preserved; invalid_phone_null_raw_preserved"
            : "disabled",
      },
      source_counts: sourceCounts,
      selected_counts: {
        leads: reports.lead.records,
        events: reports.event.records,
        chat: reports.chat.records,
      },
      entity_reports: reports,
      owner_mapping_counts: ownerMappingCounts,
      excluded_owner_mapping_counts: excludedOwnerCounts,
      status_counts: Object.values(statusReport).sort((a, b) => a.source_status.localeCompare(b.source_status)),
      phone_identity_audit: {
        normalized_phone_groups: phoneGroups.size,
        duplicate_phone_groups: duplicatePhoneGroups.length,
        leads_in_duplicate_phone_groups: duplicatePhoneGroups.reduce((sum, ids) => sum + ids.length, 0),
        distinct_source_lead_ids_preserved: true,
      },
      timestamp_audit: timestampAudit,
      blockers,
      source_integrity_issues: sourceIntegrityIssues,
      expected_count_mismatches: expectedMismatches,
      batch_limits: {
        max_records: batchRecordLimit,
        max_bytes: batchByteLimit,
      },
      batches,
      canary: canaryReport,
    };
    const manifest = {
      schema_version: SCHEMA_VERSION,
      state,
      apply_authorized: false,
      report_path: "dry-run-report.json",
      report_sha256: null,
      batch_count: batches.length,
      record_count: batches.reduce((sum, batch) => sum + batch.records, 0),
      batches,
      canary_manifest_path: "canary/manifest.json",
    };
    const canaryManifest = {
      schema_version: SCHEMA_VERSION,
      state: canaryReport.state,
      apply_authorized: false,
      report_path: "canary/report.json",
      record_count: canaryBatches.reduce((sum, batch) => sum + batch.records, 0),
      batches: canaryBatches,
    };

    const statusReportDocument = {
      schema_version: SCHEMA_VERSION,
      state,
      status_counts: report.status_counts,
      owner_mapping_counts: ownerMappingCounts,
      selected_counts: report.selected_counts,
      timestamp_audit: timestampAudit,
      blockers,
    };
    const canaryReportSerialized = `${JSON.stringify(canaryReport, null, 2)}\n`;
    canaryManifest.report_sha256 = sha256Text(canaryReportSerialized);
    const canaryManifestSerialized = `${JSON.stringify(canaryManifest, null, 2)}\n`;
    manifest.canary_manifest_sha256 = sha256Text(canaryManifestSerialized);
    const reportSerialized = `${JSON.stringify(report, null, 2)}\n`;
    manifest.report_sha256 = sha256Text(reportSerialized);
    const manifestSerialized = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(
      path.join(tempDir, "status-report.json"),
      `${JSON.stringify(statusReportDocument, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    await writeFile(path.join(tempDir, "dry-run-report.json"), reportSerialized, {
      encoding: "utf8",
      flag: "wx",
    });
    await writeFile(path.join(tempDir, "manifest.json"), manifestSerialized, {
      encoding: "utf8",
      flag: "wx",
    });
    await writeFile(path.join(tempDir, "canary", "report.json"), canaryReportSerialized, {
      encoding: "utf8",
      flag: "wx",
    });
    await writeFile(path.join(tempDir, "canary", "manifest.json"), canaryManifestSerialized, {
      encoding: "utf8",
      flag: "wx",
    });
    await writeFile(
      path.join(tempDir, "canary", "manifest.sha256"),
      `${sha256Text(canaryManifestSerialized)}  manifest.json\n`,
      { encoding: "utf8", flag: "wx" },
    );
    await writeFile(path.join(tempDir, "manifest.sha256"), `${sha256Text(manifestSerialized)}  manifest.json\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await mkdir(path.dirname(outputDir), { recursive: true });
    await rename(tempDir, outputDir);
    return { outputDir, report, manifest };
  } catch (error) {
    assertSafeTemporaryOutput(tempDir, outputDir);
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

export function parseCommandLine(argv) {
  const output = { expected: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      index += 1;
      if (index >= argv.length) throw new TypeError(`${argument} requires a value`);
      return argv[index];
    };
    if (argument === "--input") output.inputDir = value();
    else if (argument === "--output") output.outputDir = value();
    else if (argument === "--snapshot") output.snapshotPath = value();
    else if (argument === "--archived-stage-id") output.archivedStageId = value();
    else if (argument === "--batch-records") output.batchRecordLimit = Number(value());
    else if (argument === "--batch-bytes") output.batchByteLimit = Number(value());
    else if (argument === "--expect-selected") output.expected.selectedLeads = Number(value());
    else if (argument === "--expect-excluded") output.expected.excludedLeads = Number(value());
    else if (argument === "--expect-events") output.expected.events = Number(value());
    else if (argument === "--expect-chat") output.expected.chat = Number(value());
    else if (argument === "--validate-estancia-temporal-evidence") {
      output.expectedTemporalAudit = ESTANCIA_EXPECTED_TEMPORAL_AUDIT;
    }
    else if (argument === "--allow-hold-exit-zero") output.allowHoldExitZero = true;
    else if (argument === "--apply-approved-data-quality-policy") {
      output.applyApprovedDataQualityPolicy = true;
    }
    else if (argument === "--help" || argument === "-h") output.help = true;
    else throw new TypeError(`Unknown argument: ${argument}`);
  }
  if (!output.help && (!output.inputDir || !output.outputDir)) {
    throw new TypeError("--input and --output are required");
  }
  return output;
}

export function helpText() {
  return `Usage:
  node scripts/c2s/build-import-manifest.mjs --input <bundle> --output <new-directory> [options]

Options:
  --snapshot <file>            Destination snapshot (JSON, JSON array or NDJSON)
  --archived-stage-id <uuid>   Explicit stage override for Arquivado; never inferred
  --batch-records <n>          Maximum records per JSON batch (default 250)
  --batch-bytes <n>            Maximum bytes per JSON batch (default 5242880)
  --expect-selected <n>        Fail-closed count assertion for selected leads
  --expect-excluded <n>        Fail-closed count assertion for excluded leads
  --expect-events <n>          Fail-closed count assertion for selected events
  --expect-chat <n>            Fail-closed count assertion for selected chat messages
  --validate-estancia-temporal-evidence
                               Require the reviewed status/outcome timestamp evidence counts
  --apply-approved-data-quality-policy
                               Apply the explicitly approved empty-name/invalid-phone rules
  --allow-hold-exit-zero       Return 0 after producing a HOLD report (dry-run only)
`;
}

async function main() {
  const options = parseCommandLine(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  const result = await buildImportManifest(options);
  const summary = {
    event: "c2s_import_dry_run_complete",
    state: result.report.state,
    output_directory: result.outputDir,
    selected_counts: result.report.selected_counts,
    action_counts: Object.fromEntries(
      Object.entries(result.report.entity_reports).map(([key, value]) => [key, value.actions]),
    ),
    blockers: result.report.blockers,
    manifest_sha256: sha256Text(`${JSON.stringify(result.manifest, null, 2)}\n`),
  };
  // This is intentionally the only CLI data log. It contains no lead fields or source values.
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (result.report.state !== "READY" && !options.allowHoldExitZero) process.exitCode = 2;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ event: "c2s_import_dry_run_failed", error_code: error.name })}\n`,
    );
    process.exitCode = 1;
  });
}
