#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 10_000;
// Admin user verification is intentionally global so a duplicate e-mail under
// another UUID cannot hide outside a tenant-scoped page. Keep it bounded while
// leaving room for the CRM's expected 5-6k-user release scale.
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_LEDGER_BYTES = 64 * 1024;

const PERSONA_ROLES = Object.freeze(["admin", "leader", "user"]);
const AUDIT_EVENTS = new Set([
  "cleanup_started",
  "authority_verified",
  "target_verified",
  "organization_deleted",
  "organization_absence_verified",
  "auth_user_deleted",
  "auth_absence_verified",
  "crm_absence_verified",
  "cleanup_completed",
  "cleanup_failed",
]);
const AUDIT_STATUSES = new Set(["started", "ok", "failed", "skipped"]);

export class CleanupError extends Error {
  constructor(code) {
    super(code);
    this.name = "CleanupError";
    this.code = code;
  }
}

function fail(code) {
  throw new CleanupError(code);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUUID(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    && value.toLocaleLowerCase("en-US") !== "00000000-0000-0000-0000-000000000000";
}

function normalizeUUID(value, code) {
  if (!isUUID(value)) fail(code);
  return value.toLocaleLowerCase("en-US");
}

function normalizeEmail(value) {
  if (
    typeof value !== "string"
    || value !== value.trim()
    || value.length < 3
    || value.length > 320
    || /[\s\r\n]/u.test(value)
    || !/^[^@]+@[^@]+\.[^@]+$/u.test(value)
  ) {
    fail("ledger_email_invalid");
  }
  return value.toLocaleLowerCase("en-US");
}

function normalizeRunLabel(value) {
  if (
    typeof value !== "string"
    || value !== value.trim()
    || value.length < 12
    || value.length > 180
    || !value.startsWith("VIMOB-QA-")
    || !/^VIMOB-QA-[A-Z0-9][A-Z0-9-]*$/u.test(value)
  ) {
    fail("ledger_run_label_invalid");
  }
  return value;
}

export function normalizeLedger(rawLedger) {
  if (!isPlainObject(rawLedger)) fail("ledger_invalid");

  const runLabel = normalizeRunLabel(rawLedger.runLabel);
  const organizationId = normalizeUUID(rawLedger.organizationId, "ledger_organization_id_invalid");
  if (!Array.isArray(rawLedger.personas) || rawLedger.personas.length !== 3) {
    fail("ledger_requires_exactly_three_personas");
  }

  const roles = new Set();
  const userIds = new Set();
  const emails = new Set();
  const personas = rawLedger.personas.map((rawPersona) => {
    if (!isPlainObject(rawPersona) || !PERSONA_ROLES.includes(rawPersona.role)) {
      fail("ledger_persona_role_invalid");
    }
    if (roles.has(rawPersona.role)) fail("ledger_persona_role_duplicate");
    roles.add(rawPersona.role);

    const userId = normalizeUUID(rawPersona.userId, "ledger_user_id_invalid");
    const email = normalizeEmail(rawPersona.email);
    if (userIds.has(userId)) fail("ledger_user_id_duplicate");
    if (emails.has(email)) fail("ledger_email_duplicate");
    if (userId === organizationId) fail("ledger_id_collision");
    userIds.add(userId);
    emails.add(email);

    return Object.freeze({ role: rawPersona.role, userId, email });
  });

  if (roles.size !== PERSONA_ROLES.length || PERSONA_ROLES.some((role) => !roles.has(role))) {
    fail("ledger_persona_roles_incomplete");
  }

  personas.sort((left, right) => PERSONA_ROLES.indexOf(left.role) - PERSONA_ROLES.indexOf(right.role));
  return Object.freeze({
    runLabel,
    organizationId,
    personas: Object.freeze(personas),
  });
}

export async function readLedgerFile(filePath) {
  if (typeof filePath !== "string" || filePath.trim() === "") fail("ledger_file_required");

  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch {
    fail("ledger_file_unreadable");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_LEDGER_BYTES) {
    fail("ledger_file_unsafe");
  }

  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    fail("ledger_file_unreadable");
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_LEDGER_BYTES) fail("ledger_file_unsafe");

  try {
    return normalizeLedger(JSON.parse(raw));
  } catch (error) {
    if (error instanceof CleanupError) throw error;
    fail("ledger_json_invalid");
  }
}

function normalizeOrigin(rawValue, label) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") fail(`${label}_url_required`);

  let url;
  try {
    url = new URL(rawValue);
  } catch {
    fail(`${label}_url_invalid`);
  }

  const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (
    url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== "/"
    || (!isLoopback && url.protocol !== "https:")
    || (isLoopback && !["http:", "https:"].includes(url.protocol))
  ) {
    fail(`${label}_url_invalid`);
  }
  return url.origin;
}

function decodeJWTServiceRole(secret) {
  const segments = secret.split(".");
  if (segments.length !== 3 || segments.some((segment) => segment === "")) return false;
  try {
    const payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

export function validateServerOnlySecret(secret) {
  if (typeof secret !== "string" || secret.length < 16 || secret !== secret.trim()) {
    fail("supabase_server_secret_invalid");
  }
  if (secret.startsWith("sb_publishable_") || secret.startsWith("sb_anon_")) {
    fail("supabase_server_secret_public");
  }
  if (!secret.startsWith("sb_secret_") && !decodeJWTServiceRole(secret)) {
    fail("supabase_server_secret_not_privileged");
  }
  return secret;
}

function validateAccessToken(token) {
  if (typeof token !== "string" || token.length < 16 || token !== token.trim()) {
    fail("superadmin_access_token_invalid");
  }
  return token;
}

export function buildCleanupConfig({
  apiURL,
  supabaseURL,
  accessToken,
  supabaseSecret,
  ledger,
  confirmRunLabel,
  confirmOrganizationId,
  acknowledgePermanentAuthDeletion = false,
  resumeCleanup = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const normalizedLedger = normalizeLedger(ledger);
  const apiOrigin = normalizeOrigin(apiURL, "api");
  const supabaseOrigin = normalizeOrigin(supabaseURL, "supabase");
  if (apiOrigin === supabaseOrigin) fail("api_and_supabase_origins_must_differ");

  const normalizedAccessToken = validateAccessToken(accessToken);
  const normalizedSecret = validateServerOnlySecret(supabaseSecret);
  if (normalizedAccessToken === normalizedSecret) fail("credentials_must_differ");
  if (confirmRunLabel !== normalizedLedger.runLabel) fail("run_label_confirmation_mismatch");
  if (
    !isUUID(confirmOrganizationId)
    || confirmOrganizationId.toLocaleLowerCase("en-US") !== normalizedLedger.organizationId
  ) {
    fail("organization_id_confirmation_mismatch");
  }
  if (acknowledgePermanentAuthDeletion !== true) fail("permanent_auth_deletion_not_acknowledged");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    fail("timeout_invalid");
  }

  return Object.freeze({
    apiOrigin,
    supabaseOrigin,
    accessToken: normalizedAccessToken,
    supabaseSecret: normalizedSecret,
    ledger: normalizedLedger,
    resumeCleanup: resumeCleanup === true,
    timeoutMs,
  });
}

async function readBoundedText(response) {
  const advertisedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_RESPONSE_BYTES) {
    fail("response_too_large");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        fail("response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

async function requestJSON({
  fetchImpl,
  url,
  method = "GET",
  headers,
  body,
  allowedStatuses,
  timeoutMs,
  requireJSON = true,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
    const raw = await readBoundedText(response);
    if (!allowedStatuses.includes(response.status)) fail(`unexpected_http_status_${response.status}`);
    if (!requireJSON || response.status >= 400 || response.status === 204 || raw.trim() === "") {
      return { status: response.status, payload: null };
    }

    try {
      return { status: response.status, payload: JSON.parse(raw) };
    } catch {
      fail("response_json_invalid");
    }
  } catch (error) {
    if (error instanceof CleanupError) throw error;
    if (error?.name === "AbortError") fail("network_request_timeout");
    fail("network_request_failed");
  } finally {
    clearTimeout(timeout);
  }
}

function apiHeaders(config, includeBody = false) {
  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${config.accessToken}`,
  });
  if (includeBody) headers.set("Content-Type", "application/json");
  return headers;
}

function supabaseHeaders(config) {
  const headers = new Headers({
    Accept: "application/json",
    apikey: config.supabaseSecret,
  });
  if (decodeJWTServiceRole(config.supabaseSecret)) {
    headers.set("Authorization", `Bearer ${config.supabaseSecret}`);
  }
  return headers;
}

function exactOrganizationMatches(payload, ledger) {
  if (!isPlainObject(payload) || !Array.isArray(payload.data)) fail("organizations_envelope_invalid");
  return payload.data.filter((organization) => (
    isPlainObject(organization)
    && typeof organization.name === "string"
    && organization.name.trim().toLocaleLowerCase("pt-BR")
      === ledger.runLabel.toLocaleLowerCase("pt-BR")
  ));
}

function parseCRMUsers(payload) {
  if (!isPlainObject(payload) || !Array.isArray(payload.data)) fail("admin_users_envelope_invalid");
  return payload.data;
}

function findCRMTarget(users, persona) {
  return users.filter((user) => (
    isPlainObject(user)
    && (
      (typeof user.id === "string" && user.id.toLocaleLowerCase("en-US") === persona.userId)
      || (typeof user.email === "string" && user.email.toLocaleLowerCase("en-US") === persona.email)
    )
  ));
}

function assertCRMTargetsBound(users, ledger, { allowMissing }) {
  if (!allowMissing) {
    const organizationUsers = users.filter((user) => (
      isPlainObject(user)
      && typeof user.organization_id === "string"
      && user.organization_id.toLocaleLowerCase("en-US") === ledger.organizationId
    ));
    if (organizationUsers.length !== 3) fail("crm_organization_user_count_invalid");
  }

  for (const persona of ledger.personas) {
    const matches = findCRMTarget(users, persona);
    if (matches.length === 0 && allowMissing) continue;
    if (matches.length !== 1) fail("crm_persona_binding_invalid");
    const [match] = matches;
    if (
      typeof match.id !== "string"
      || match.id.toLocaleLowerCase("en-US") !== persona.userId
      || typeof match.email !== "string"
      || match.email.toLocaleLowerCase("en-US") !== persona.email
      || typeof match.organization_id !== "string"
      || match.organization_id.toLocaleLowerCase("en-US") !== ledger.organizationId
    ) {
      fail("crm_persona_binding_invalid");
    }
  }
}

function extractAuthUser(payload) {
  if (!isPlainObject(payload)) fail("auth_user_envelope_invalid");
  return isPlainObject(payload.user) ? payload.user : payload;
}

function assertAuthUserBound(payload, persona) {
  const user = extractAuthUser(payload);
  if (
    typeof user.id !== "string"
    || user.id.toLocaleLowerCase("en-US") !== persona.userId
    || typeof user.email !== "string"
    || user.email.toLocaleLowerCase("en-US") !== persona.email
  ) {
    fail("auth_persona_binding_invalid");
  }
}

function assertCRMTargetsAbsent(users, ledger) {
  for (const persona of ledger.personas) {
    if (findCRMTarget(users, persona).length !== 0) fail("crm_persona_still_present");
  }
}

function organizationSearchURL(config) {
  const url = new URL("/v1/admin/organizations", `${config.apiOrigin}/`);
  url.searchParams.set("search", config.ledger.runLabel);
  return url;
}

function authUserURL(config, userId) {
  return new URL(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, `${config.supabaseOrigin}/`);
}

async function getOrganizations(config, fetchImpl) {
  const result = await requestJSON({
    fetchImpl,
    url: organizationSearchURL(config),
    headers: apiHeaders(config),
    allowedStatuses: [200],
    timeoutMs: config.timeoutMs,
  });
  return exactOrganizationMatches(result.payload, config.ledger);
}

async function assertOrganizationAbsent(config, fetchImpl) {
  if ((await getOrganizations(config, fetchImpl)).length !== 0) {
    fail("organization_still_present");
  }

  const allOrganizations = await requestJSON({
    fetchImpl,
    url: new URL("/v1/admin/organizations", `${config.apiOrigin}/`),
    headers: apiHeaders(config),
    allowedStatuses: [200],
    timeoutMs: config.timeoutMs,
  });
  if (!isPlainObject(allOrganizations.payload) || !Array.isArray(allOrganizations.payload.data)) {
    fail("organizations_envelope_invalid");
  }
  const residue = allOrganizations.payload.data.some((organization) => (
    isPlainObject(organization)
    && (
      (typeof organization.id === "string"
        && organization.id.toLocaleLowerCase("en-US") === config.ledger.organizationId)
      || (typeof organization.name === "string"
        && organization.name.trim().toLocaleLowerCase("pt-BR")
          === config.ledger.runLabel.toLocaleLowerCase("pt-BR"))
    )
  ));
  if (residue) fail("organization_still_present");
}

async function getCRMUsers(config, fetchImpl) {
  const result = await requestJSON({
    fetchImpl,
    url: new URL("/v1/admin/users", `${config.apiOrigin}/`),
    headers: apiHeaders(config),
    allowedStatuses: [200],
    timeoutMs: config.timeoutMs,
  });
  return parseCRMUsers(result.payload);
}

async function requestAuthUser(config, fetchImpl, persona) {
  return requestJSON({
    fetchImpl,
    url: authUserURL(config, persona.userId),
    headers: supabaseHeaders(config),
    allowedStatuses: [200, 404],
    timeoutMs: config.timeoutMs,
    requireJSON: true,
  });
}

export function serializeCleanupAuditEvent(input = {}) {
  const event = AUDIT_EVENTS.has(input.event) ? input.event : "cleanup_failed";
  const output = {
    timestamp: new Date().toISOString(),
    event,
    status: AUDIT_STATUSES.has(input.status) ? input.status : "failed",
  };
  if (PERSONA_ROLES.includes(input.role)) output.role = input.role;
  if (Number.isSafeInteger(input.index) && input.index >= 1 && input.index <= 3) {
    output.index = input.index;
  }
  if (Number.isSafeInteger(input.count) && input.count >= 0 && input.count <= 3) {
    output.count = input.count;
  }
  return `${JSON.stringify(output)}\n`;
}

function emitAudit(auditSink, event) {
  auditSink(serializeCleanupAuditEvent(event));
}

export async function runPersonaCleanup({
  fetchImpl = globalThis.fetch,
  auditSink = (line) => process.stderr.write(line),
  ...rawConfig
} = {}) {
  if (typeof fetchImpl !== "function") fail("fetch_implementation_required");
  if (typeof auditSink !== "function") fail("audit_sink_invalid");

  let config;
  try {
    config = buildCleanupConfig(rawConfig);
    emitAudit(auditSink, { event: "cleanup_started", status: "started" });

    const me = await requestJSON({
      fetchImpl,
      url: new URL("/v1/me", `${config.apiOrigin}/`),
      headers: apiHeaders(config),
      allowedStatuses: [200],
      timeoutMs: config.timeoutMs,
    });
    const operatorId = me.payload?.context?.userId;
    if (me.payload?.context?.isSuperAdmin !== true || !isUUID(operatorId)) {
      fail("superadmin_authority_not_confirmed");
    }
    if (config.ledger.personas.some((persona) => persona.userId === operatorId.toLocaleLowerCase("en-US"))) {
      fail("superadmin_is_cleanup_target");
    }
    emitAudit(auditSink, { event: "authority_verified", status: "ok" });

    const organizationMatches = await getOrganizations(config, fetchImpl);
    const organizationPresent = organizationMatches.length > 0;
    if (organizationPresent) {
      if (
        organizationMatches.length !== 1
        || !isUUID(organizationMatches[0].id)
        || organizationMatches[0].id.toLocaleLowerCase("en-US") !== config.ledger.organizationId
      ) {
        fail("organization_binding_invalid");
      }
    } else if (!config.resumeCleanup) {
      fail("organization_missing_without_resume_acknowledgement");
    }
    const resumingAfterTenantPurge = !organizationPresent && config.resumeCleanup;

    const crmUsers = await getCRMUsers(config, fetchImpl);
    assertCRMTargetsBound(crmUsers, config.ledger, { allowMissing: resumingAfterTenantPurge });

    const authPresence = new Map();
    for (const persona of config.ledger.personas) {
      const authResult = await requestAuthUser(config, fetchImpl, persona);
      if (authResult.status === 404) {
        if (!resumingAfterTenantPurge) fail("auth_persona_missing_without_resume_acknowledgement");
        authPresence.set(persona.userId, false);
        continue;
      }
      assertAuthUserBound(authResult.payload, persona);
      authPresence.set(persona.userId, true);
    }
    emitAudit(auditSink, { event: "target_verified", status: "ok", count: 3 });

    if (organizationPresent) {
      const deletion = await requestJSON({
        fetchImpl,
        url: new URL(
          `/v1/admin/organizations/${encodeURIComponent(config.ledger.organizationId)}`,
          `${config.apiOrigin}/`,
        ),
        method: "DELETE",
        headers: apiHeaders(config, true),
        body: { confirmation_name: config.ledger.runLabel },
        allowedStatuses: [200],
        timeoutMs: config.timeoutMs,
      });
      if (
        deletion.payload?.ok !== true
        || deletion.payload?.deleted_users !== 0
        || !Array.isArray(deletion.payload?.cleanup_warnings)
        || deletion.payload.cleanup_warnings.length !== 0
      ) {
        fail("organization_delete_contract_invalid");
      }
      emitAudit(auditSink, { event: "organization_deleted", status: "ok" });
    } else {
      emitAudit(auditSink, { event: "organization_deleted", status: "skipped" });
    }

    await assertOrganizationAbsent(config, fetchImpl);
    emitAudit(auditSink, { event: "organization_absence_verified", status: "ok" });

    let deletedCount = 0;
    for (const [index, persona] of config.ledger.personas.entries()) {
      if (authPresence.get(persona.userId)) {
        await requestJSON({
          fetchImpl,
          url: authUserURL(config, persona.userId),
          method: "DELETE",
          headers: supabaseHeaders(config),
          allowedStatuses: [200, 204],
          timeoutMs: config.timeoutMs,
          requireJSON: false,
        });
        deletedCount += 1;
        emitAudit(auditSink, {
          event: "auth_user_deleted",
          status: "ok",
          role: persona.role,
          index: index + 1,
        });
      } else {
        emitAudit(auditSink, {
          event: "auth_user_deleted",
          status: "skipped",
          role: persona.role,
          index: index + 1,
        });
      }
    }

    for (const [index, persona] of config.ledger.personas.entries()) {
      const verification = await requestAuthUser(config, fetchImpl, persona);
      if (verification.status !== 404) fail("auth_persona_still_present");
      emitAudit(auditSink, {
        event: "auth_absence_verified",
        status: "ok",
        role: persona.role,
        index: index + 1,
      });
    }

    const finalCRMUsers = await getCRMUsers(config, fetchImpl);
    assertCRMTargetsAbsent(finalCRMUsers, config.ledger);
    emitAudit(auditSink, { event: "crm_absence_verified", status: "ok", count: 3 });
    emitAudit(auditSink, { event: "cleanup_completed", status: "ok", count: 3 });

    return Object.freeze({
      ok: true,
      organizationAbsent: true,
      authUsersAbsent: 3,
      crmUsersAbsent: 3,
      authUsersDeletedThisRun: deletedCount,
    });
  } catch (error) {
    emitAudit(auditSink, { event: "cleanup_failed", status: "failed" });
    throw error;
  }
}

export function parseCommandLine(argv) {
  const options = {
    acknowledgePermanentAuthDeletion: false,
    resumeCleanup: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail("cli_argument_missing_value");
      index += 1;
      return value;
    };

    switch (argument) {
      case "--api-url":
        options.apiURL = nextValue();
        break;
      case "--supabase-url":
        options.supabaseURL = nextValue();
        break;
      case "--ledger-file":
        options.ledgerFile = nextValue();
        break;
      case "--confirm-run-label":
        options.confirmRunLabel = nextValue();
        break;
      case "--confirm-organization-id":
        options.confirmOrganizationId = nextValue();
        break;
      case "--audit-file":
        options.auditFile = nextValue();
        break;
      case "--acknowledge-permanent-auth-deletion":
        options.acknowledgePermanentAuthDeletion = true;
        break;
      case "--resume-cleanup":
        options.resumeCleanup = true;
        break;
      case "--help":
        options.help = true;
        break;
      default:
        fail("cli_argument_unknown");
    }
  }
  return options;
}

function requiredSecretEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value === "") fail("required_secret_environment_missing");
  return value;
}

function usage() {
  return `Usage:
  node scripts/qa/qa-persona-cleanup.mjs \\
    --api-url https://api.example.invalid \\
    --supabase-url https://project-ref.supabase.co \\
    --ledger-file C:\\secure\\vimob-qa-ledger.json \\
    --confirm-run-label VIMOB-QA-YYYYMMDD-XXXX \\
    --confirm-organization-id 00000000-0000-4000-8000-000000000000 \\
    --acknowledge-permanent-auth-deletion

Secrets are read only from QA_SUPERADMIN_ACCESS_TOKEN and
QA_SUPABASE_SECRET_KEY. This script never loads .env files. Use
--resume-cleanup only after a prior run already removed the tenant or one of
the three Auth users. Help mode performs no file or network access.
`;
}

function createAuditWriter(filePath) {
  if (!filePath) return { write: (line) => process.stderr.write(line), close: () => {} };
  const stream = createWriteStream(filePath, { flags: "a", encoding: "utf8", mode: 0o600 });
  return {
    write: (line) => stream.write(line),
    close: () => stream.end(),
  };
}

async function main() {
  const options = parseCommandLine(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const ledger = await readLedgerFile(options.ledgerFile);
  const auditWriter = createAuditWriter(options.auditFile);
  try {
    const result = await runPersonaCleanup({
      apiURL: options.apiURL,
      supabaseURL: options.supabaseURL,
      accessToken: requiredSecretEnvironment("QA_SUPERADMIN_ACCESS_TOKEN"),
      supabaseSecret: requiredSecretEnvironment("QA_SUPABASE_SECRET_KEY"),
      ledger,
      confirmRunLabel: options.confirmRunLabel,
      confirmOrganizationId: options.confirmOrganizationId,
      acknowledgePermanentAuthDeletion: options.acknowledgePermanentAuthDeletion,
      resumeCleanup: options.resumeCleanup,
      auditSink: auditWriter.write,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    auditWriter.close();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((error) => {
    const code = error instanceof CleanupError ? error.code : "internal_failure";
    process.stderr.write(`QA persona cleanup failed: ${code}\n`);
    process.exitCode = 1;
  });
}
