import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  conversationBelongsToRequestTenant,
  guardAiAgentResponderRequest,
  type AiAgentResponderInput,
} from "./request-guard.ts";

const opaqueSecret = "sb_secret_ai_responder_0123456789abcdef";
const legacyJwt =
  "legacyHeader0123456789.legacyPayload0123456789.legacySignature0123456789";
const validBody = {
  conversation_id: "conversation-a",
  session_id: "session-a",
  organization_id: "organization-a",
  provider_message_id: "provider-message-a",
  message: "Olá",
  contact_name: "Contato",
};

function instrumentedRequest(
  method: string,
  headers: HeadersInit,
  body: unknown,
  trace: string[],
) {
  return {
    method,
    headers: new Headers(headers),
    async json() {
      trace.push("body");
      return body;
    },
  } as Request;
}

function matchingConversation(input: AiAgentResponderInput) {
  return {
    id: input.conversation_id,
    organization_id: input.organization_id,
    session_id: input.session_id,
    session: { organization_id: input.organization_id },
  };
}

test("preflight and non-POST methods never parse a body or load a conversation", async () => {
  for (const [method, expectedKind] of [
    ["OPTIONS", "preflight"],
    ["GET", "method_not_allowed"],
    ["PUT", "method_not_allowed"],
    ["DELETE", "method_not_allowed"],
  ] as const) {
    const trace: string[] = [];
    const result = await guardAiAgentResponderRequest(
      instrumentedRequest(method, { apikey: opaqueSecret }, validBody, trace),
      async (input) => {
        trace.push("conversation");
        return matchingConversation(input);
      },
      { SUPABASE_SECRET_KEY: opaqueSecret },
    );

    assert.equal(result.kind, expectedKind);
    assert.deepEqual(trace, []);
  }
});

test("authentication runs before body parsing and privileged conversation access", async () => {
  const trace: string[] = [];
  const result = await guardAiAgentResponderRequest(
    instrumentedRequest("POST", {}, validBody, trace),
    async (input) => {
      trace.push("conversation");
      return matchingConversation(input);
    },
    { SUPABASE_SECRET_KEY: opaqueSecret },
  );

  assert.equal(result.kind, "unauthorized");
  assert.deepEqual(trace, []);
});

test("opaque apikey and exact legacy service-role Bearer remain compatible", async () => {
  const cases = [
    {
      headers: { apikey: opaqueSecret },
      environment: { SUPABASE_SECRET_KEY: opaqueSecret },
    },
    {
      headers: { authorization: `Bearer ${legacyJwt}` },
      environment: { SUPABASE_SERVICE_ROLE_KEY: legacyJwt },
    },
  ];

  for (const { headers, environment } of cases) {
    const trace: string[] = [];
    const result = await guardAiAgentResponderRequest(
      instrumentedRequest("POST", headers, validBody, trace),
      async (input) => {
        trace.push("conversation");
        return matchingConversation(input);
      },
      environment,
    );

    assert.equal(result.kind, "allowed");
    assert.deepEqual(trace, ["body", "conversation"]);
  }
});

test("malformed authenticated payloads stop before privileged conversation access", async () => {
  for (const body of [
    null,
    {},
    { ...validBody, conversation_id: "" },
    { ...validBody, organization_id: 123 },
    { ...validBody, provider_message_id: "" },
    { ...validBody, provider_message_id: "x".repeat(513) },
    { ...validBody, session_id: "   " },
  ]) {
    const trace: string[] = [];
    const result = await guardAiAgentResponderRequest(
      instrumentedRequest(
        "POST",
        { apikey: opaqueSecret },
        body,
        trace,
      ),
      async (input) => {
        trace.push("conversation");
        return matchingConversation(input);
      },
      { SUPABASE_SECRET_KEY: opaqueSecret },
    );

    assert.equal(result.kind, "invalid_payload");
    assert.deepEqual(trace, ["body"]);
  }
});

test("organization, optional session and related session tenant mismatches fail closed", async () => {
  const mismatches = [
    {
      organization_id: "organization-b",
      session_id: "session-a",
      session: { organization_id: "organization-b" },
    },
    {
      organization_id: "organization-a",
      session_id: "session-b",
      session: { organization_id: "organization-a" },
    },
    {
      organization_id: "organization-a",
      session_id: "session-a",
      session: { organization_id: "organization-b" },
    },
  ];

  for (const conversation of mismatches) {
    const trace: string[] = [];
    const result = await guardAiAgentResponderRequest(
      instrumentedRequest(
        "POST",
        { apikey: opaqueSecret },
        validBody,
        trace,
      ),
      async () => {
        trace.push("conversation");
        return conversation;
      },
      { SUPABASE_SECRET_KEY: opaqueSecret },
    );

    assert.equal(result.kind, "conversation_not_found");
    assert.deepEqual(trace, ["body", "conversation"]);
  }
});

test("tenant ownership accepts a matching conversation and scopes session only when supplied", () => {
  const input: AiAgentResponderInput = {
    ...validBody,
    session_id: null,
  };

  assert.equal(
    conversationBelongsToRequestTenant(
      {
        organization_id: input.organization_id,
        session_id: "another-session",
        session: [{ organization_id: input.organization_id }],
      },
      input,
    ),
    true,
  );
});

test("checked-in handler preserves the security order and blocks downstream effects", async () => {
  const [handler, guard, caller] = await Promise.all([
    readFile(new URL("./index.ts", import.meta.url), "utf8"),
    readFile(new URL("./request-guard.ts", import.meta.url), "utf8"),
    readFile(new URL("../evolution-webhook/index.ts", import.meta.url), "utf8"),
  ]);

  const method = guard.indexOf('if (request.method !== "POST")');
  const auth = guard.indexOf("authorizePrivateWorkerRequest(request");
  const body = guard.indexOf("body = await request.json()");
  const tenantRead = guard.indexOf("await loadConversation(input)");
  const tenantCheck = guard.indexOf(
    "conversationBelongsToRequestTenant(",
    tenantRead,
  );
  assert.ok(method >= 0 && auth > method && body > auth && tenantRead > body);
  assert.ok(tenantCheck > tenantRead);

  assert.doesNotMatch(handler, /await req\.json\(/);
  const guardCall = handler.indexOf("guardAiAgentResponderRequest(");
  const secretRead = handler.indexOf("readSupabaseSecretKeyEnvironment()");
  const adminClient = handler.indexOf("createClient(supabaseUrl, adminSecret)");
  const firstTenantRead = handler.indexOf("getConversationForTenant(");
  const firstAdditionalRead = handler.indexOf("findActiveAgent(");
  const firstSchedule = handler.indexOf("maybeCreateVisitSchedule(");
  const firstOutbox = handler.indexOf("insertOutboxMessage(");
  assert.ok(guardCall >= 0 && secretRead > guardCall && adminClient > secretRead);
  assert.ok(firstTenantRead > adminClient && firstAdditionalRead > firstTenantRead);
  assert.ok(firstSchedule > firstAdditionalRead && firstOutbox > firstAdditionalRead);

  const tenantFunction = handler.slice(
    handler.indexOf("async function getConversationForTenant"),
    handler.indexOf("async function getAgentConversation"),
  );
  assert.match(tenantFunction, /\.eq\("id", conversationId\)/);
  assert.match(tenantFunction, /\.eq\("organization_id", organizationId\)/);
  assert.match(tenantFunction, /query = query\.eq\("session_id", sessionId\)/);

  const callerStart = caller.indexOf("/functions/v1/ai-agent-responder");
  const internalCall = caller.slice(callerStart, callerStart + 700);
  assert.ok(callerStart >= 0);
  assert.match(internalCall, /method:\s*"POST"/);
  assert.match(internalCall, /apikey:\s*supabaseKey/);
  assert.match(internalCall, /Authorization:\s*`Bearer \$\{supabaseKey\}`/);
  assert.match(internalCall, /provider_message_id:\s*messageId/);
});
