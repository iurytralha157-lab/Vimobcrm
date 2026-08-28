import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("handler owns a durable claim before every AI response effect", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const handler = source.slice(
    source.indexOf("Deno.serve("),
    source.indexOf("function json("),
  );

  const referenceValidation = handler.indexOf("loadTenantReferenceContext(");
  const statusValidation = handler.indexOf(
    'agentConv && agentConv.status !== "active"',
  );
  const initialPause = handler.indexOf("const initialCanonicalPause");
  const claim = handler.indexOf("claimAIResponse(");
  const ownership = handler.indexOf('responseClaim.kind === "duplicate"');
  const leadBind = handler.indexOf("bindConversationLead(");
  const takeover = handler.indexOf("detectHumanTakeover(");
  const schedule = handler.indexOf("maybeCreateVisitSchedule(");
  const provider = handler.indexOf("callLovableAI(");
  const outbox = handler.indexOf("insertOutboxMessage(");

  assert.ok(referenceValidation >= 0 && statusValidation > referenceValidation);
  assert.ok(initialPause > statusValidation);
  assert.ok(claim > initialPause && ownership > claim);
  for (const effect of [leadBind, takeover, schedule, provider, outbox]) {
    assert.ok(effect > ownership, "effect must be after exclusive claim ownership");
  }
  assert.match(handler, /action: "duplicate_ignored"/);
});

test("canonical pause is rechecked before provider, visit intent and every outbox", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const handler = source.slice(
    source.indexOf("Deno.serve("),
    source.indexOf("function json("),
  );

  const claim = handler.indexOf("claimAIResponse(");
  const visitPause = handler.indexOf("const pauseBeforeVisitIntent");
  const visitIntent = handler.indexOf("maybeCreateVisitSchedule(");
  const providerPause = handler.indexOf("const pauseBeforeProvider");
  const provider = handler.indexOf("callLovableAI(");
  assert.ok(visitPause > claim && visitIntent > visitPause);
  assert.ok(providerPause > visitIntent && provider > providerPause);

  const handoffPause = handler.indexOf("const pauseBeforeHandoffOutbox");
  const handoffOutbox = handler.indexOf("insertOutboxMessage(", handoffPause);
  const responsePause = handler.indexOf("const pauseBeforeOutbox");
  const responseOutbox = handler.indexOf("insertOutboxMessage(", responsePause);
  assert.ok(handoffPause > claim && handoffOutbox > handoffPause);
  assert.ok(responsePause > provider && responseOutbox > responsePause);

  for (const [pauseIndex, effectIndex] of [
    [visitPause, visitIntent],
    [providerPause, provider],
    [handoffPause, handoffOutbox],
    [responsePause, responseOutbox],
  ]) {
    const guardedPath = handler.slice(pauseIndex, effectIndex);
    assert.match(guardedPath, /completeSuppressedAIResponseClaim\(/);
    assert.match(guardedPath, /action: "human_takeover_active"/);
  }
});

test("canonical pause read is tenant and session scoped and fails closed", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const pauseRead = source.slice(
    source.indexOf("async function getCanonicalAIPauseReason"),
    source.indexOf("async function findActiveAgent"),
  );

  assert.match(pauseRead, /\.from\("whatsapp_conversations"\)/);
  assert.match(pauseRead, /session:whatsapp_sessions\(id, organization_id\)/);
  assert.match(pauseRead, /\.eq\("organization_id", input\.organizationId\)/);
  assert.match(pauseRead, /\.eq\("session_id", input\.sessionId\)/);
  assert.match(pauseRead, /conversationReferencesBelongToTenant\(/);
  assert.match(pauseRead, /return "conversation_scope_changed"/);
  assert.match(pauseRead, /\.from\("conversation_ai_state"\)/);
  assert.match(pauseRead, /\.select\("human_override, paused_until"\)/);
  assert.match(pauseRead, /\.eq\("conversation_id", input\.conversationId\)/);
  assert.match(pauseRead, /if \(stateError\) throw stateError/);
  assert.match(pauseRead, /canonicalAIPauseReason\(state\)/);
});

test("claim is tied to the canonical inbound row and insert ownership", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const claim = source.slice(
    source.indexOf("async function claimAIResponse"),
    source.indexOf("function responseClaimMetadata"),
  );

  for (const predicate of [
    /\.eq\("organization_id", input\.organizationId\)/,
    /\.eq\("session_id", input\.sessionId\)/,
    /\.eq\("conversation_id", input\.conversationId\)/,
    /\.eq\("message_id", input\.providerMessageId\)/,
    /\.eq\("from_me", false\)/,
    /\.eq\("message_type", "text"\)/,
  ]) assert.match(claim, predicate);

  assert.match(claim, /\.from\("ai_interaction_logs"\)/);
  assert.match(claim, /onConflict: "id"/);
  assert.match(claim, /ignoreDuplicates: true/);
  assert.match(claim, /\.select\("id"\)\s*\.maybeSingle\(\)/s);
  assert.match(claim, /inserted\?\.id === id/);
});

test("completion keeps tenant/session ownership and outbox IDs are deterministic", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const completion = source.slice(
    source.indexOf("async function completeAIResponseClaim"),
    source.indexOf("async function findActiveAgent"),
  );
  const outbox = source.slice(
    source.indexOf("async function insertOutboxMessage"),
    source.indexOf("async function upsertAgentConversation"),
  );

  assert.match(completion, /\.eq\("id", claim\.id\)/);
  assert.match(
    completion,
    /\.eq\("organization_id", claim\.organizationId\)/,
  );
  assert.match(
    completion,
    /\.eq\("conversation_id", claim\.conversationId\)/,
  );
  assert.match(
    completion,
    /\.eq\("metadata->>session_id", claim\.sessionId\)/,
  );
  assert.match(outbox, /buildAIOutboxClientMessageId\(/);
  assert.doesNotMatch(outbox, /randomUUID\(/);
});

test("multi-chunk outbox stops on a canonical takeover and records suppression", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const handler = source.slice(
    source.indexOf("Deno.serve("),
    source.indexOf("function json("),
  );
  const outbox = source.slice(
    source.indexOf("async function insertOutboxMessage"),
    source.indexOf("async function upsertAgentConversation"),
  );

  const chunkLoop = outbox.indexOf("for (const [chunkIndex, chunk]");
  const pauseRead = outbox.indexOf("getCanonicalAIPauseReason(", chunkLoop);
  const insert = outbox.indexOf('.from("outbox_messages").insert(', chunkLoop);
  assert.ok(chunkLoop >= 0 && pauseRead > chunkLoop && insert > pauseRead);
  assert.match(
    outbox.slice(pauseRead, insert),
    /return \{ kind: "suppressed", reason: pauseReason, queuedChunks \}/,
  );
  assert.match(outbox, /return \{ kind: "queued", queuedChunks \}/);
  assert.match(outbox, /conversationUpdate\.eq\("last_message_at"/);
  assert.match(outbox, /conversationUpdate\.is\("last_message_at", null\)/);
  assert.match(outbox, /conversationUpdate\.eq\("last_message"/);
  assert.match(outbox, /conversationUpdate\.is\("last_message", null\)/);
  assert.match(outbox, /conversationUpdateError/);
  assert.match(outbox, /Conversation changed before AI outbox finalization/);

  for (const resultName of ["handoffOutboxResult", "outboxResult"]) {
    const resultCheck = handler.indexOf(
      `${resultName}.kind === "suppressed"`,
    );
    const normalCompletion = handler.indexOf(
      "completeAIResponseClaim(",
      resultCheck,
    );
    assert.ok(resultCheck >= 0 && normalCompletion > resultCheck);
    assert.match(
      handler.slice(resultCheck, normalCompletion),
      /completeSuppressedAIResponseClaim\(/,
    );
    assert.match(
      handler.slice(resultCheck, normalCompletion),
      /return json\(\{ success: true, action: "human_takeover_active" \}\)/,
    );
  }
  assert.match(source, /auto_reply_partially_queued_before_human_takeover/);
});

test("agent conversation transitions use CAS and never upsert terminal state", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const activeTransition = source.slice(
    source.indexOf("async function upsertAgentConversation"),
    source.indexOf("async function markHandedOff"),
  );
  const handoffTransition = source.slice(
    source.indexOf("async function markHandedOff"),
    source.indexOf("async function detectHumanTakeover"),
  );

  for (const transition of [activeTransition, handoffTransition]) {
    assert.doesNotMatch(transition, /\.upsert\(/);
    assert.match(transition, /\.insert\(/);
    assert.match(transition, /\.update\(/);
    assert.match(transition, /\.eq\("conversation_id",/);
    assert.match(transition, /\.eq\("agent_id",/);
    assert.match(transition, /\.eq\("status", "active"\)/);
    assert.match(transition, /\.eq\("updated_at",/);
    assert.match(transition, /\.select\("id, status, updated_at"\)/);
    assert.match(transition, /if \(error\) throw error/);
    assert.match(transition, /changed concurrently|no longer active/);
  }

  const activeCommit = source.slice(
    source.indexOf("async function upsertAgentConversation"),
    source.indexOf("async function markAgentConversationAIMessageQueued"),
  );
  const aiQueuedCommit = source.slice(
    source.indexOf("async function markAgentConversationAIMessageQueued"),
    source.indexOf("async function markHandedOff"),
  );
  assert.doesNotMatch(activeCommit, /last_ai_message_at/);
  assert.match(aiQueuedCommit, /last_ai_message_at/);
  assert.match(aiQueuedCommit, /\.eq\("status", "active"\)/);
  assert.match(aiQueuedCommit, /\.eq\("updated_at", input\.state\.updated_at\)/);

  const handler = source.slice(
    source.indexOf("Deno.serve("),
    source.indexOf("function json("),
  );
  const outbox = handler.indexOf("const outboxResult = await insertOutboxMessage(");
  const suppressed = handler.indexOf('outboxResult.kind === "suppressed"', outbox);
  const aiQueued = handler.indexOf("markAgentConversationAIMessageQueued(", suppressed);
  const normalCompletion = handler.indexOf("completeAIResponseClaim(", aiQueued);
  assert.ok(outbox >= 0 && suppressed > outbox && aiQueued > suppressed);
  assert.ok(normalCompletion > aiQueued);
});

test("visit automation is fail-closed without an atomic agenda primitive", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const handler = source.slice(
    source.indexOf("Deno.serve("),
    source.indexOf("function json("),
  );
  const schedule = source.slice(
    source.indexOf("async function maybeCreateVisitSchedule"),
    source.indexOf("async function moveLeadToVisitStage"),
  );
  const moveLead = source.slice(
    source.indexOf("async function moveLeadToVisitStage"),
    source.indexOf("async function getCompactHistory"),
  );

  assert.match(schedule, /reason: "manual_confirmation_required"/);
  assert.match(schedule, /created: false/);
  assert.doesNotMatch(schedule, /\.from\(/);
  assert.doesNotMatch(schedule, /\.insert\(/);
  assert.doesNotMatch(schedule, /moveLeadToVisitStage|notifyUser/);
  assert.doesNotMatch(handler, /moveLeadToVisitStage\(/);
  assert.match(source, /\[ACAO NAO EXECUTADA\]/);
  assert.match(source, /Nao diga que a visita foi agendada/);

  assert.match(moveLead, /if \(stagesError\) throw stagesError/);
  assert.match(moveLead, /\.eq\("organization_id", organizationId\)/);
  assert.match(moveLead, /\.eq\("pipeline_id", lead\.pipeline_id\)/);
  assert.match(moveLead, /update\.eq\("stage_id", lead\.stage_id\)/);
  assert.match(moveLead, /update\.is\("stage_id", null\)/);
  assert.match(moveLead, /\.select\("id, pipeline_id, stage_id"\)/);
  assert.match(moveLead, /if \(moveError\) throw moveError/);
});
