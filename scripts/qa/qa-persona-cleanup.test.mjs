import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CleanupError,
  buildCleanupConfig,
  normalizeLedger,
  parseCommandLine,
  runPersonaCleanup,
  serializeCleanupAuditEvent,
  validateServerOnlySecret,
} from "./qa-persona-cleanup.mjs";

const API_ORIGIN = "https://api.qa.example.invalid";
const SUPABASE_ORIGIN = "https://qa-project.supabase.co";
const ACCESS_TOKEN = "superadmin-access-token-test-000";
const SERVER_SECRET = "sb_secret_qa_cleanup_test_000";
const RUN_LABEL = "VIMOB-QA-20260816-A1B2";
const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPERATOR_ID = "99999999-9999-4999-8999-999999999999";

const PERSONAS = Object.freeze([
  Object.freeze({
    role: "admin",
    userId: "11111111-1111-4111-8111-111111111111",
    email: "qa-admin-20260816@example.invalid",
  }),
  Object.freeze({
    role: "leader",
    userId: "22222222-2222-4222-8222-222222222222",
    email: "qa-leader-20260816@example.invalid",
  }),
  Object.freeze({
    role: "user",
    userId: "33333333-3333-4333-8333-333333333333",
    email: "qa-user-20260816@example.invalid",
  }),
]);

function ledger(overrides = {}) {
  return {
    runLabel: RUN_LABEL,
    organizationId: ORGANIZATION_ID,
    personas: PERSONAS.map((persona) => ({ ...persona })),
    ...overrides,
  };
}

function cleanupArguments(overrides = {}) {
  return {
    apiURL: API_ORIGIN,
    supabaseURL: SUPABASE_ORIGIN,
    accessToken: ACCESS_TOKEN,
    supabaseSecret: SERVER_SECRET,
    ledger: ledger(),
    confirmRunLabel: RUN_LABEL,
    confirmOrganizationId: ORGANIZATION_ID,
    acknowledgePermanentAuthDeletion: true,
    ...overrides,
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function emptyResponse(status = 204) {
  return new Response(null, { status });
}

function createMockHTTP({
  organizationInitiallyPresent = true,
  authInitiallyMissing = [],
  authBindingMismatchFor,
  organizationDeletedUsers = 0,
  organizationWarnings = [],
  keepOrganizationAfterDelete = false,
  renameOrganizationAfterDelete = false,
  keepAuthAfterDeleteFor,
  keepCRMAfterAuthDeleteFor,
  extraCRMUser = false,
} = {}) {
  const calls = [];
  let organizationPresent = organizationInitiallyPresent;
  let organizationName = RUN_LABEL;
  const authPresent = new Set(
    PERSONAS
      .filter((persona) => !authInitiallyMissing.includes(persona.userId))
      .map((persona) => persona.userId),
  );

  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method || "GET";
    const headers = new Headers(init.headers);
    const call = {
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      method,
      headers,
      body: init.body,
    };
    calls.push(call);

    if (url.origin === API_ORIGIN) {
      assert.equal(headers.get("authorization"), `Bearer ${ACCESS_TOKEN}`);
      assert.equal(headers.get("apikey"), null);

      if (method === "GET" && url.pathname === "/v1/me") {
        return jsonResponse({ context: { isSuperAdmin: true, userId: OPERATOR_ID } });
      }
      if (method === "GET" && url.pathname === "/v1/admin/organizations") {
        const search = url.searchParams.get("search");
        assert.ok(search === RUN_LABEL || search === null);
        const matchesSearch = search === null || organizationName.includes(search);
        return jsonResponse({
          data: organizationPresent && matchesSearch
            ? [{ id: ORGANIZATION_ID, name: organizationName }]
            : [],
        });
      }
      if (method === "GET" && url.pathname === "/v1/admin/users") {
        const users = PERSONAS
          .filter((persona) => (
            authPresent.has(persona.userId) || keepCRMAfterAuthDeleteFor === persona.userId
          ))
          .map((persona) => ({
            id: persona.userId,
            email: persona.email,
            organization_id: ORGANIZATION_ID,
          }));
        if (extraCRMUser) {
          users.push({
            id: "44444444-4444-4444-8444-444444444444",
            email: "qa-unexpected@example.invalid",
            organization_id: ORGANIZATION_ID,
          });
        }
        return jsonResponse({
          data: users,
        });
      }
      if (
        method === "DELETE"
        && url.pathname === `/v1/admin/organizations/${ORGANIZATION_ID}`
      ) {
        assert.equal(headers.get("content-type"), "application/json");
        assert.deepEqual(JSON.parse(init.body), { confirmation_name: RUN_LABEL });
        if (renameOrganizationAfterDelete) {
          organizationPresent = true;
          organizationName = "RENAMED-QA-TENANT";
        } else if (!keepOrganizationAfterDelete) {
          organizationPresent = false;
        }
        return jsonResponse({
          ok: true,
          deleted_users: organizationDeletedUsers,
          cleanup_warnings: organizationWarnings,
        });
      }
      return jsonResponse({ code: "not_found" }, 404);
    }

    if (url.origin === SUPABASE_ORIGIN) {
      assert.equal(headers.get("apikey"), SERVER_SECRET);
      assert.equal(
        headers.get("authorization"),
        null,
        "opaque sb_secret keys must not be sent as Bearer tokens",
      );

      const prefix = "/auth/v1/admin/users/";
      assert.ok(url.pathname.startsWith(prefix));
      const userId = decodeURIComponent(url.pathname.slice(prefix.length));
      const persona = PERSONAS.find((candidate) => candidate.userId === userId);
      assert.ok(persona, "the executor may address only the three ledger UUIDs");

      if (method === "GET") {
        if (!authPresent.has(userId)) return jsonResponse({ message: "not found" }, 404);
        return jsonResponse({
          id: persona.userId,
          email: authBindingMismatchFor === userId ? "wrong-person@example.invalid" : persona.email,
        });
      }
      if (method === "DELETE") {
        if (keepAuthAfterDeleteFor !== userId) authPresent.delete(userId);
        return emptyResponse();
      }
      return jsonResponse({ message: "method not allowed" }, 405);
    }

    assert.fail("unexpected mock HTTP origin");
  };

  return { fetchImpl, calls };
}

test("cleanup uses the official tenant and Auth Admin paths and proves all absences", async () => {
  const { fetchImpl, calls } = createMockHTTP();
  const auditLines = [];

  const result = await runPersonaCleanup({
    ...cleanupArguments(),
    fetchImpl,
    auditSink: (line) => auditLines.push(line),
  });

  assert.deepEqual(result, {
    ok: true,
    organizationAbsent: true,
    authUsersAbsent: 3,
    crmUsersAbsent: 3,
    authUsersDeletedThisRun: 3,
  });

  const destructiveCalls = calls.filter((call) => call.method === "DELETE");
  assert.equal(destructiveCalls.length, 4);
  assert.equal(destructiveCalls[0].origin, API_ORIGIN);
  assert.equal(destructiveCalls[0].pathname, `/v1/admin/organizations/${ORGANIZATION_ID}`);
  assert.deepEqual(
    destructiveCalls.slice(1).map((call) => call.pathname),
    PERSONAS.map((persona) => `/auth/v1/admin/users/${persona.userId}`),
  );

  const organizationAbsenceCheck = calls.findIndex((call, index) => (
    index > calls.indexOf(destructiveCalls[0])
    && call.method === "GET"
    && call.pathname === "/v1/admin/organizations"
  ));
  const firstAuthDelete = calls.indexOf(destructiveCalls[1]);
  assert.ok(organizationAbsenceCheck > calls.indexOf(destructiveCalls[0]));
  assert.ok(organizationAbsenceCheck < firstAuthDelete);

  const audit = auditLines.join("");
  for (const forbidden of [
    ACCESS_TOKEN,
    SERVER_SECRET,
    RUN_LABEL,
    ORGANIZATION_ID,
    ...PERSONAS.flatMap((persona) => [persona.userId, persona.email]),
  ]) {
    assert.equal(audit.includes(forbidden), false, forbidden);
  }
  for (const line of auditLines) {
    const parsed = JSON.parse(line);
    assert.deepEqual(
      Object.keys(parsed).filter((key) => !["timestamp", "event", "status", "role", "index", "count"].includes(key)),
      [],
    );
  }
});

test("ledger is strict about prefix, unique UUIDs/e-mails, and exactly three roles", () => {
  assert.equal(normalizeLedger(ledger()).personas.length, 3);
  assert.throws(
    () => normalizeLedger(ledger({ runLabel: "OTHER-QA-20260816-A1B2" })),
    (error) => error instanceof CleanupError && error.code === "ledger_run_label_invalid",
  );
  assert.throws(
    () => normalizeLedger(ledger({ personas: PERSONAS.slice(0, 2) })),
    /ledger_requires_exactly_three_personas/,
  );
  assert.throws(
    () => normalizeLedger(ledger({
      personas: PERSONAS.map((persona, index) => ({
        ...persona,
        userId: index === 2 ? PERSONAS[0].userId : persona.userId,
      })),
    })),
    /ledger_user_id_duplicate/,
  );
  assert.throws(
    () => normalizeLedger(ledger({
      personas: PERSONAS.map((persona, index) => ({
        ...persona,
        email: index === 2 ? PERSONAS[0].email.toUpperCase() : persona.email,
      })),
    })),
    /ledger_email_duplicate/,
  );
});

test("config requires explicit origins, both exact confirmations, acknowledgement, and server secret", () => {
  assert.doesNotThrow(() => buildCleanupConfig(cleanupArguments()));

  for (const override of [
    { apiURL: undefined },
    { supabaseURL: undefined },
    { apiURL: "http://api.qa.example.invalid" },
    { supabaseURL: "https://user:secret@qa-project.supabase.co" },
    { confirmRunLabel: `${RUN_LABEL}-WRONG` },
    { confirmOrganizationId: PERSONAS[0].userId },
    { acknowledgePermanentAuthDeletion: false },
    { supabaseSecret: "sb_publishable_public_test_key" },
  ]) {
    assert.throws(() => buildCleanupConfig(cleanupArguments(override)), CleanupError);
  }

  assert.equal(validateServerOnlySecret(SERVER_SECRET), SERVER_SECRET);
});

test("an Auth UUID/e-mail mismatch fails before every destructive request", async () => {
  const { fetchImpl, calls } = createMockHTTP({
    authBindingMismatchFor: PERSONAS[1].userId,
  });

  await assert.rejects(
    runPersonaCleanup({ ...cleanupArguments(), fetchImpl, auditSink: () => {} }),
    /auth_persona_binding_invalid/,
  );
  assert.equal(calls.some((call) => call.method === "DELETE"), false);
});

test("an unexpected fourth CRM user blocks tenant deletion", async () => {
  for (const resumeCleanup of [false, true]) {
    const { fetchImpl, calls } = createMockHTTP({ extraCRMUser: true });

    await assert.rejects(
      runPersonaCleanup({
        ...cleanupArguments({ resumeCleanup }),
        fetchImpl,
        auditSink: () => {},
      }),
      /crm_organization_user_count_invalid/,
    );
    assert.equal(calls.some((call) => call.method === "DELETE"), false);
  }
});

test("tenant purge must preserve identities and report no cleanup warning", async () => {
  for (const variation of [
    { organizationDeletedUsers: 1 },
    { organizationWarnings: ["provider warning"] },
  ]) {
    const { fetchImpl, calls } = createMockHTTP(variation);
    await assert.rejects(
      runPersonaCleanup({ ...cleanupArguments(), fetchImpl, auditSink: () => {} }),
      /organization_delete_contract_invalid/,
    );
    assert.equal(
      calls.some((call) => call.origin === SUPABASE_ORIGIN && call.method === "DELETE"),
      false,
    );
  }
});

test("Auth deletion never starts until organization absence is proven", async () => {
  const { fetchImpl, calls } = createMockHTTP({ keepOrganizationAfterDelete: true });

  await assert.rejects(
    runPersonaCleanup({ ...cleanupArguments(), fetchImpl, auditSink: () => {} }),
    /organization_still_present/,
  );
  assert.equal(
    calls.some((call) => call.origin === SUPABASE_ORIGIN && call.method === "DELETE"),
    false,
  );
});

test("organization absence is verified by UUID even if its name changes", async () => {
  const { fetchImpl, calls } = createMockHTTP({ renameOrganizationAfterDelete: true });

  await assert.rejects(
    runPersonaCleanup({ ...cleanupArguments(), fetchImpl, auditSink: () => {} }),
    /organization_still_present/,
  );
  assert.equal(
    calls.some((call) => call.origin === SUPABASE_ORIGIN && call.method === "DELETE"),
    false,
  );
  assert.equal(
    calls.some((call) => call.pathname === "/v1/admin/organizations" && call.search === ""),
    true,
  );
});

test("getUserById must prove every identity absent after delete", async () => {
  const { fetchImpl } = createMockHTTP({ keepAuthAfterDeleteFor: PERSONAS[2].userId });

  await assert.rejects(
    runPersonaCleanup({ ...cleanupArguments(), fetchImpl, auditSink: () => {} }),
    /auth_persona_still_present/,
  );
});

test("admin CRM must prove every UUID and e-mail absent after Auth deletion", async () => {
  const { fetchImpl } = createMockHTTP({ keepCRMAfterAuthDeleteFor: PERSONAS[1].userId });

  await assert.rejects(
    runPersonaCleanup({ ...cleanupArguments(), fetchImpl, auditSink: () => {} }),
    /crm_persona_still_present/,
  );
});

test("resume is separately acknowledged and skips only already-absent ledger targets", async () => {
  const missingId = PERSONAS[0].userId;
  const blocked = createMockHTTP({
    organizationInitiallyPresent: false,
    authInitiallyMissing: [missingId],
  });
  await assert.rejects(
    runPersonaCleanup({ ...cleanupArguments(), fetchImpl: blocked.fetchImpl, auditSink: () => {} }),
    /organization_missing_without_resume_acknowledgement/,
  );
  assert.equal(blocked.calls.some((call) => call.method === "DELETE"), false);

  const resumed = createMockHTTP({
    organizationInitiallyPresent: false,
    authInitiallyMissing: [missingId],
  });
  const result = await runPersonaCleanup({
    ...cleanupArguments({ resumeCleanup: true }),
    fetchImpl: resumed.fetchImpl,
    auditSink: () => {},
  });
  assert.equal(result.authUsersDeletedThisRun, 2);
  assert.deepEqual(
    resumed.calls
      .filter((call) => call.origin === SUPABASE_ORIGIN && call.method === "DELETE")
      .map((call) => call.pathname),
    PERSONAS.slice(1).map((persona) => `/auth/v1/admin/users/${persona.userId}`),
  );
});

test("audit serialization drops caller-controlled secrets and complete e-mails", () => {
  const line = serializeCleanupAuditEvent({
    event: "secret-event-value",
    status: "secret-status-value",
    role: "secret-role-value",
    token: ACCESS_TOKEN,
    secret: SERVER_SECRET,
    password: "password-secret-value",
    email: PERSONAS[0].email,
  });
  const parsed = JSON.parse(line);

  assert.deepEqual(Object.keys(parsed), ["timestamp", "event", "status"]);
  assert.equal(parsed.event, "cleanup_failed");
  assert.equal(parsed.status, "failed");
  for (const forbidden of [ACCESS_TOKEN, SERVER_SECRET, "password-secret-value", PERSONAS[0].email]) {
    assert.equal(line.includes(forbidden), false);
  }
});

test("CLI has no token/secret flags and source has no dotenv, SQL, or database driver", async () => {
  const options = parseCommandLine([
    "--api-url", API_ORIGIN,
    "--supabase-url", SUPABASE_ORIGIN,
    "--ledger-file", "C:\\secure\\ledger.json",
    "--confirm-run-label", RUN_LABEL,
    "--confirm-organization-id", ORGANIZATION_ID,
    "--acknowledge-permanent-auth-deletion",
  ]);
  assert.equal(options.apiURL, API_ORIGIN);
  assert.throws(() => parseCommandLine(["--token", ACCESS_TOKEN]), /cli_argument_unknown/);
  assert.throws(() => parseCommandLine(["--secret", SERVER_SECRET]), /cli_argument_unknown/);

  const source = await readFile(new URL("./qa-persona-cleanup.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+["']dotenv["']|require\(["']dotenv["']\)/u);
  assert.doesNotMatch(source, /\b(pg|postgres|mysql2|better-sqlite3)\b/u);
  assert.doesNotMatch(source, /\b(SELECT|INSERT|UPDATE|TRUNCATE|DROP|ALTER)\b/u);
});
