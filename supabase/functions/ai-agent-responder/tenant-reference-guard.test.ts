import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  agentConversationReferencesBelongToTenant,
  conversationReferencesBelongToTenant,
  leadReferencesBelongToTenant,
  organizationMemberBelongsToTenant,
} from "./tenant-reference-guard.ts";

const organizationId = "organization-a";
const sessionId = "session-a";

test("conversation session and direct lead references fail closed across tenants", () => {
  const valid = {
    organization_id: organizationId,
    session_id: sessionId,
    lead_id: "lead-a",
    session: { id: sessionId, organization_id: organizationId },
    lead: { id: "lead-a", organization_id: organizationId },
  };

  assert.equal(conversationReferencesBelongToTenant(valid, organizationId), true);
  assert.equal(
    conversationReferencesBelongToTenant({
      ...valid,
      session: { id: sessionId, organization_id: "organization-b" },
    }, organizationId),
    false,
  );
  assert.equal(
    conversationReferencesBelongToTenant({
      ...valid,
      lead: { id: "lead-a", organization_id: "organization-b" },
    }, organizationId),
    false,
  );
  assert.equal(
    conversationReferencesBelongToTenant({ ...valid, session: null }, organizationId),
    false,
  );
});

test("ai_agent_conversations lead_id cannot resolve a cross-tenant lead", () => {
  const valid = {
    agent_id: "agent-a",
    lead_id: "lead-a",
    last_property_id: "property-a",
    agent: {
      id: "agent-a",
      organization_id: organizationId,
      session_id: sessionId,
    },
    lead: { id: "lead-a", organization_id: organizationId },
    last_property: { id: "property-a", organization_id: organizationId },
  };

  assert.equal(
    agentConversationReferencesBelongToTenant(
      valid,
      organizationId,
      sessionId,
    ),
    true,
  );
  assert.equal(
    agentConversationReferencesBelongToTenant({
      ...valid,
      lead: { id: "lead-a", organization_id: "organization-b" },
    }, organizationId, sessionId),
    false,
  );
  assert.equal(
    agentConversationReferencesBelongToTenant({
      ...valid,
      last_property: {
        id: "property-a",
        organization_id: "organization-b",
      },
    }, organizationId, sessionId),
    false,
  );
  assert.equal(
    agentConversationReferencesBelongToTenant({ ...valid, lead: null }, organizationId, sessionId),
    false,
  );
  assert.equal(
    agentConversationReferencesBelongToTenant({
      ...valid,
      agent: { ...valid.agent, session_id: "session-b" },
    }, organizationId, sessionId),
    false,
  );
});

test("property, pipeline, stage and assignee references are tenant-bound", () => {
  const lead = {
    id: "lead-a",
    organization_id: organizationId,
    assigned_user_id: "user-a",
    property_id: "property-a",
    interest_property_id: "property-b",
    pipeline_id: "pipeline-a",
    stage_id: "stage-a",
  };
  const references = {
    property: { id: "property-a", organization_id: organizationId },
    interestProperty: { id: "property-b", organization_id: organizationId },
    pipeline: { id: "pipeline-a", organization_id: organizationId },
    stage: {
      id: "stage-a",
      organization_id: organizationId,
      pipeline_id: "pipeline-a",
    },
    assignedMember: {
      user_id: "user-a",
      organization_id: organizationId,
      is_active: true,
    },
  };

  assert.equal(
    leadReferencesBelongToTenant(lead, references, organizationId),
    true,
  );

  for (const [key, value] of [
    ["property", { id: "property-a", organization_id: "organization-b" }],
    ["interestProperty", { id: "property-b", organization_id: "organization-b" }],
    ["pipeline", { id: "pipeline-a", organization_id: "organization-b" }],
    ["stage", { id: "stage-a", organization_id: "organization-b", pipeline_id: "pipeline-a" }],
    ["assignedMember", { user_id: "user-a", organization_id: "organization-b", is_active: true }],
  ] as const) {
    assert.equal(
      leadReferencesBelongToTenant(
        lead,
        { ...references, [key]: value },
        organizationId,
      ),
      false,
      `${key} must reject a cross-tenant row`,
    );
  }

  assert.equal(
    leadReferencesBelongToTenant(
      lead,
      {
        ...references,
        stage: { ...references.stage, pipeline_id: "pipeline-b" },
      },
      organizationId,
    ),
    false,
  );
  assert.equal(
    leadReferencesBelongToTenant(
      { ...lead, pipeline_id: null },
      { ...references, pipeline: null },
      organizationId,
    ),
    false,
  );
});

test("organization members are verified by both user and tenant", () => {
  assert.equal(
    organizationMemberBelongsToTenant(
      "user-a",
      { user_id: "user-a", organization_id: organizationId, is_active: true },
      organizationId,
    ),
    true,
  );
  assert.equal(
    organizationMemberBelongsToTenant(
      "user-a",
      { user_id: "user-a", organization_id: "organization-b", is_active: true },
      organizationId,
    ),
    false,
  );
  assert.equal(
    organizationMemberBelongsToTenant(
      "user-a",
      { user_id: "user-a", organization_id: organizationId, is_active: false },
      organizationId,
    ),
    false,
  );
});

test("handler applies tenant references before provider and side effects", async () => {
  const handler = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const main = handler.slice(
    handler.indexOf("Deno.serve("),
    handler.indexOf("function json("),
  );
  const identityRead = main.indexOf("getAgentConversationReferenceIdentity(");
  const referenceGuard = main.indexOf("loadTenantReferenceContext(");
  const fullAgentConversationRead = main.indexOf(
    "getAgentConversation(",
    referenceGuard,
  );
  const genericReferenceFailure = main.indexOf(
    'error: "Related resource not found"',
    referenceGuard,
  );
  const firstOutbox = main.indexOf("insertOutboxMessage(");
  const firstSchedule = main.indexOf("maybeCreateVisitSchedule(");
  const provider = main.indexOf("callLovableAI(");
  const responseClaim = main.indexOf("claimAIResponse(");
  const duplicateExit = main.indexOf(
    'responseClaim.kind === "duplicate"',
    responseClaim,
  );

  assert.ok(identityRead >= 0 && referenceGuard > identityRead);
  assert.ok(fullAgentConversationRead > referenceGuard);
  assert.ok(genericReferenceFailure > referenceGuard);
  assert.ok(responseClaim > referenceGuard && duplicateExit > responseClaim);
  assert.ok(firstOutbox > duplicateExit);
  assert.ok(firstSchedule > duplicateExit);
  assert.ok(provider > duplicateExit);

  const conversationLoader = handler.slice(
    handler.indexOf("async function getConversationForTenant"),
    handler.indexOf("async function getAgentConversation"),
  );
  assert.match(conversationLoader, /lead:leads\(id, organization_id\)/);
  assert.match(
    conversationLoader,
    /session:whatsapp_sessions\(id, owner_user_id, organization_id\)/,
  );

  const agentConversationLoader = handler.slice(
    handler.indexOf("async function getAgentConversation"),
    handler.indexOf("async function loadTenantReferenceContext"),
  );
  const identityLoader = agentConversationLoader.slice(
    0,
    agentConversationLoader.indexOf(
      "async function getAgentConversation(supabase",
    ),
  );
  assert.doesNotMatch(identityLoader, /\.select\("\*"\)/);
  assert.match(
    agentConversationLoader,
    /agent:ai_agents\(id, organization_id, session_id\)/,
  );
  assert.match(agentConversationLoader, /lead:leads\(id, organization_id\)/);
  assert.match(
    agentConversationLoader,
    /last_property:properties\(id, organization_id\)/,
  );

  const fetchLead = handler.slice(
    handler.indexOf("async function fetchLead"),
    handler.indexOf("function leadSelect"),
  );
  const fetchProperty = handler.slice(
    handler.indexOf("async function fetchPropertyById"),
    handler.indexOf("async function findMentionedProperties"),
  );
  assert.match(fetchLead, /\.eq\("organization_id", organizationId\)/);
  assert.match(fetchProperty, /\.eq\("organization_id", organizationId\)/);

  const history = handler.slice(
    handler.indexOf("async function getCompactHistory"),
    handler.indexOf("function buildSystemPrompt"),
  );
  const schedule = handler.slice(
    handler.indexOf("async function maybeCreateVisitSchedule"),
    handler.indexOf("async function moveLeadToVisitStage"),
  );
  const outbox = handler.slice(
    handler.indexOf("async function insertOutboxMessage"),
    handler.indexOf("async function upsertAgentConversation"),
  );
  assert.match(history, /\.eq\("organization_id", organizationId\)/);
  assert.match(history, /query = query\.eq\("session_id", sessionId\)/);
  assert.match(schedule, /reason: "manual_confirmation_required"/);
  assert.doesNotMatch(schedule, /\.from\(|\.insert\(/);
  assert.match(outbox, /conversationReferencesBelongToTenant\(/);
  assert.match(outbox, /\.eq\("organization_id", organizationId\)/);
  assert.match(outbox, /\.eq\("session_id", conversation\.session_id\)/);
});
