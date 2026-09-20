import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  authorizePrivateWorkerRequest,
  privateWorkerRequestHeaders,
} from "../../supabase/functions/_shared/private-worker-auth.ts";
import { selectSupabaseAdminSecretKey } from "../../supabase/functions/_shared/supabase-secret-keys.ts";
import {
  FIRST_RESPONSE_CHANNELS,
  parseFirstResponseRequest,
} from "../../supabase/functions/calculate-first-response/request.ts";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const leadId = "00000000-0000-4000-8000-000000000001";
const organizationId = "00000000-0000-4000-8000-000000000002";
const actorUserId = "00000000-0000-4000-8000-000000000003";
const opaqueSecret = "synthetic-private-worker-token-for-tests";
const legacyServiceRole =
  "legacyHeader0123456789.legacyPayload0123456789.legacySignature0123456789";

async function readRepositoryFile(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

function ordered(source, markers) {
  let previous = -1;
  for (const marker of markers) {
    const current = source.indexOf(marker);
    assert.ok(
      current > previous,
      `expected ${JSON.stringify(marker)} after the previous security boundary`,
    );
    previous = current;
  }
}

async function loadEdgeHandler({ createClient, environment }) {
  const source = await readRepositoryFile(
    "supabase/functions/calculate-first-response/index.ts",
  );
  const sourceFile = ts.createSourceFile(
    "calculate-first-response.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const body = sourceFile.statements
    .filter((statement) => !ts.isImportDeclaration(statement))
    .map((statement) => statement.getText(sourceFile))
    .join("\n");
  const compiled = ts.transpileModule(body, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  let handler = null;
  const context = vm.createContext({
    authorizePrivateWorkerRequest,
    console,
    createClient,
    Date,
    Deno: {
      env: {
        get(name) {
          return name === "SUPABASE_URL"
            ? "https://project.supabase.test"
            : undefined;
        },
      },
      serve(candidate) {
        handler = candidate;
      },
    },
    JSON,
    Math,
    Number,
    parseFirstResponseRequest,
    readSupabaseSecretKeyEnvironment: () => environment,
    Request,
    Response,
    selectSupabaseAdminSecretKey,
  });
  vm.runInContext(compiled, context);
  assert.equal(typeof handler, "function");
  return handler;
}

test("first-response request parsing accepts only tenant-scoped typed input", () => {
  for (const channel of FIRST_RESPONSE_CHANNELS) {
    assert.deepEqual(
      parseFirstResponseRequest({
        lead_id: leadId,
        organization_id: organizationId,
        channel,
        actor_user_id: actorUserId,
        is_automation: false,
      }),
      {
        lead_id: leadId,
        organization_id: organizationId,
        channel,
        actor_user_id: actorUserId,
        is_automation: false,
      },
    );
  }

  assert.equal(
    parseFirstResponseRequest({
      lead_id: leadId,
      organization_id: organizationId,
      channel: "phone",
      is_automation: true,
    })?.actor_user_id,
    null,
  );

  const invalidBodies = [
    null,
    [],
    {},
    {
      lead_id: "not-a-uuid",
      organization_id: organizationId,
      channel: "phone",
      is_automation: false,
    },
    {
      lead_id: leadId,
      organization_id: "not-a-uuid",
      channel: "phone",
      is_automation: false,
    },
    {
      lead_id: leadId,
      organization_id: organizationId,
      channel: "arbitrary-column-value",
      is_automation: false,
    },
    {
      lead_id: leadId,
      organization_id: organizationId,
      channel: "phone",
      actor_user_id: "cross-tenant-user",
      is_automation: false,
    },
    {
      lead_id: leadId,
      organization_id: organizationId,
      channel: "phone",
      is_automation: "false",
    },
  ];
  for (const body of invalidBodies) {
    assert.equal(parseFirstResponseRequest(body), null);
  }
});

test("private caller headers use apikey for rotation and Bearer only for legacy JWTs", () => {
  assert.deepEqual(privateWorkerRequestHeaders(opaqueSecret), {
    apikey: opaqueSecret,
  });
  assert.deepEqual(privateWorkerRequestHeaders(legacyServiceRole), {
    apikey: legacyServiceRole,
    Authorization: `Bearer ${legacyServiceRole}`,
  });
});

test("unauthenticated POST is rejected before body parsing, client creation, or data access", async () => {
  let clientCreations = 0;
  let bodyReads = 0;
  const handler = await loadEdgeHandler({
    environment: { SUPABASE_SECRET_KEY: opaqueSecret },
    createClient() {
      clientCreations += 1;
      throw new Error("unauthenticated request reached createClient");
    },
  });
  const request = new Request(
    "https://project.supabase.test/functions/v1/calculate-first-response",
    {
      method: "POST",
      body: JSON.stringify({
        lead_id: leadId,
        organization_id: organizationId,
        channel: "phone",
        is_automation: false,
      }),
    },
  );
  Object.defineProperty(request, "json", {
    value: async () => {
      bodyReads += 1;
      throw new Error("unauthenticated request body was parsed");
    },
  });

  const response = await handler(request);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "Unauthorized",
  });
  assert.equal(bodyReads, 0);
  assert.equal(clientCreations, 0);
});

test("a lead from another organization is a scoped 404 with no mutation", async () => {
  const tableCalls = [];
  const filters = [];
  let mutations = 0;
  const query = {
    select() {
      return this;
    },
    eq(column, value) {
      filters.push([column, value]);
      return this;
    },
    update() {
      mutations += 1;
      return this;
    },
    insert() {
      mutations += 1;
      return this;
    },
    async maybeSingle() {
      return { data: null, error: null };
    },
  };
  const handler = await loadEdgeHandler({
    environment: { SUPABASE_SECRET_KEY: opaqueSecret },
    createClient() {
      return {
        from(table) {
          tableCalls.push(table);
          return query;
        },
      };
    },
  });
  const response = await handler(
    new Request(
      "https://project.supabase.test/functions/v1/calculate-first-response",
      {
        method: "POST",
        headers: {
          apikey: opaqueSecret,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          lead_id: leadId,
          organization_id: organizationId,
          channel: "phone",
          actor_user_id: null,
          is_automation: false,
        }),
      },
    ),
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "Lead not found",
  });
  assert.deepEqual(tableCalls, ["leads"]);
  assert.deepEqual(filters, [
    ["organization_id", organizationId],
    ["id", leadId],
  ]);
  assert.equal(mutations, 0);
});

test("a concurrent compare-and-set loser returns the winner without timeline duplication", async () => {
  let leadReads = 0;
  let leadUpdates = 0;
  let timelineInserts = 0;
  const winnerTimestamp = "2026-09-19T12:00:00.000Z";

  function queryFor(table) {
    let operation = "read";
    const query = {
      select() {
        return this;
      },
      update() {
        operation = "update";
        leadUpdates += 1;
        return this;
      },
      insert() {
        timelineInserts += 1;
        return Promise.resolve({ data: null, error: null });
      },
      eq() {
        return this;
      },
      is() {
        return this;
      },
      order() {
        return this;
      },
      limit() {
        return this;
      },
      async maybeSingle() {
        if (table === "lead_timeline_events") {
          return { data: null, error: null };
        }
        if (table === "leads" && operation === "update") {
          return { data: null, error: null };
        }
        if (table === "leads") {
          leadReads += 1;
          return leadReads === 1
            ? {
              data: {
                first_response_at: null,
                pipeline_id: null,
                created_at: "2026-09-19T11:55:00.000Z",
              },
              error: null,
            }
            : {
              data: {
                first_response_at: winnerTimestamp,
                first_response_seconds: 300,
              },
              error: null,
            };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    return query;
  }

  const handler = await loadEdgeHandler({
    environment: { SUPABASE_SECRET_KEY: opaqueSecret },
    createClient() {
      return { from: queryFor };
    },
  });
  const response = await handler(
    new Request(
      "https://project.supabase.test/functions/v1/calculate-first-response",
      {
        method: "POST",
        headers: {
          apikey: opaqueSecret,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          lead_id: leadId,
          organization_id: organizationId,
          channel: "phone",
          actor_user_id: null,
          is_automation: false,
        }),
      },
    ),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    message: "Already calculated",
    first_response_at: winnerTimestamp,
    first_response_seconds: 300,
  });
  assert.equal(leadUpdates, 1);
  assert.equal(timelineInserts, 0);
});

test("calculate-first-response authenticates before privileged client creation or I/O", async () => {
  const source = await readRepositoryFile(
    "supabase/functions/calculate-first-response/index.ts",
  );
  const handler = source.slice(source.indexOf("Deno.serve(async (req) =>"));

  assert.match(source, /Access-Control-Allow-Methods": "POST, OPTIONS"/);
  assert.match(source, /if \(req\.method === "OPTIONS"\)/);
  assert.match(source, /if \(req\.method !== "POST"\)/);
  assert.match(source, /Allow: "POST, OPTIONS"/);
  assert.doesNotMatch(source, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);

  ordered(handler, [
    'if (req.method !== "POST")',
    "authorizePrivateWorkerRequest(req, secretEnvironment)",
    "requestBody = await req.json()",
    "parseFirstResponseRequest(requestBody)",
    "selectSupabaseAdminSecretKey(secretEnvironment)",
    "createClient(supabaseUrl, supabaseAdminKey)",
    '.from("leads")',
  ]);
});

test("all privileged first-response reads and writes are tenant scoped", async () => {
  const source = await readRepositoryFile(
    "supabase/functions/calculate-first-response/index.ts",
  );

  assert.match(
    source,
    /\.from\("leads"\)\s*\.select\("first_response_at, pipeline_id, created_at"\)\s*\.eq\("organization_id", organizationId\)\s*\.eq\("id", leadId\)/,
  );
  assert.match(
    source,
    /\.from\("users"\)\s*\.select\("id"\)\s*\.eq\("organization_id", organizationId\)\s*\.eq\("id", actorUserId\)/,
  );
  assert.match(
    source,
    /\.from\("pipelines"\)[\s\S]*?\.eq\("organization_id", organizationId\)\s*\.eq\("id", lead\.pipeline_id\)/,
  );
  assert.match(
    source,
    /\.from\("lead_timeline_events"\)\s*\.select\("event_at"\)\s*\.eq\("organization_id", organizationId\)\s*\.eq\("lead_id", leadId\)/,
  );
  assert.match(
    source,
    /\.from\("leads"\)\s*\.update\(updateData\)\s*\.eq\("organization_id", organizationId\)\s*\.eq\("id", leadId\)\s*\.is\("first_response_at", null\)/,
  );
  assert.match(
    source,
    /organization_id: organizationId,\s*lead_id: leadId,\s*event_type: "first_response"/,
  );
});

test("lead update is a compare-and-set owner before batched timeline effects", async () => {
  const source = await readRepositoryFile(
    "supabase/functions/calculate-first-response/index.ts",
  );
  const updateStart = source.indexOf("const { data: updatedLead");
  const lostOwnership = source.indexOf("if (!updatedLead)", updateStart);
  const timelineRows = source.indexOf("const timelineEvents", lostOwnership);
  const timelineInsert = source.indexOf('.from("lead_timeline_events")', timelineRows);

  assert.ok(updateStart >= 0);
  assert.ok(lostOwnership > updateStart);
  assert.ok(timelineRows > lostOwnership);
  assert.ok(timelineInsert > timelineRows);
  assert.match(
    source.slice(updateStart, lostOwnership),
    /\.is\("first_response_at", null\)[\s\S]*\.select\("first_response_at, first_response_seconds"\)[\s\S]*\.maybeSingle\(\)/,
  );
  assert.match(
    source.slice(lostOwnership, timelineRows),
    /message: "Already calculated"[\s\S]*return jsonResponse\([\s\S]*409/,
  );
  assert.match(
    source.slice(timelineRows, timelineInsert + 200),
    /\.insert\(timelineEvents\)/,
  );
});

test("all internal callers send tenant identity and private-worker credentials", async () => {
  const [messageSender, evolutionWebhook, threeCPlus] = await Promise.all([
    readRepositoryFile("supabase/functions/message-sender/index.ts"),
    readRepositoryFile("supabase/functions/evolution-webhook/index.ts"),
    readRepositoryFile("supabase/functions/threecplus-webhook/index.ts"),
  ]);

  const messageCallStart = messageSender.indexOf(
    "/functions/v1/calculate-first-response",
  );
  const messageCall = messageSender.slice(messageCallStart, messageCallStart + 800);
  assert.ok(messageCallStart >= 0);
  assert.match(
    messageCall,
    /\.\.\.privateWorkerRequestHeaders\(INTERNAL_FUNCTION_KEY\)/,
  );
  assert.match(messageCall, /organization_id: message\.organization_id/);

  const evolutionCallStart = evolutionWebhook.indexOf(
    "/functions/v1/calculate-first-response",
  );
  const evolutionCall = evolutionWebhook.slice(
    evolutionCallStart,
    evolutionCallStart + 900,
  );
  assert.ok(evolutionCallStart >= 0);
  assert.match(
    evolutionCall,
    /\.\.\.privateWorkerRequestHeaders\(supabaseKey\)/,
  );
  assert.match(evolutionCall, /organization_id: session\.organization_id/);

  assert.match(threeCPlus, /readSupabaseSecretKeyEnvironment\(\)/);
  assert.match(
    threeCPlus,
    /selectSupabaseAdminSecretKey\(secretEnvironment\)/,
  );
  assert.match(threeCPlus, /createClient\(supabaseUrl, supabaseAdminKey\)/);
  assert.doesNotMatch(
    threeCPlus,
    /Deno\.env\.get\(['"]SUPABASE_SERVICE_ROLE_KEY['"]\)/,
  );
  const threeCCallStart = threeCPlus.indexOf(
    "/functions/v1/calculate-first-response",
  );
  const threeCCall = threeCPlus.slice(threeCCallStart, threeCCallStart + 900);
  assert.ok(threeCCallStart >= 0);
  assert.match(
    threeCCall,
    /\.\.\.privateWorkerRequestHeaders\(supabaseAdminKey\)/,
  );
  assert.match(threeCCall, /organization_id: organizationId/);
  assert.match(threeCCall, /if \(!firstResponseResult\.ok\)/);
});
