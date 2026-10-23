import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { whatsappCTWAConfirmationMethod } from "../_shared/whatsapp-ctwa.ts";
import { isWhatsAppPostFormFollowUp } from "../_shared/whatsapp-post-form.ts";

// Execute production functions without loading Deno, credentials or its client.
const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true);
const declarations = ast.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(ast));
const compiled = ts.transpileModule(declarations.join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const cases = JSON.parse(readFileSync(new URL("../../../apps/api/internal/whatsapp/testdata/post_form_followup.json", import.meta.url), "utf8"));
const followUp = cases.find(fixture => fixture.want).content;
const org = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const leadId = "44444444-4444-4444-8444-444444444444";
const session = { id: sessionId, organization_id: org };

function runtime(supabase = {}) {
  const context = vm.createContext({ whatsappCTWAConfirmationMethod, isWhatsAppPostFormFollowUp, TextEncoder, Date, supabase });
  vm.runInContext(compiled, context);
  return context;
}

function message(content = followUp, extra = {}) {
  return {
    messageId: "synthetic-provider-event", providerMessageIdSynthetic: false,
    fromMe: false, isGroup: false, messageType: "text", content,
    remoteJid: "5511000000000@s.whatsapp.net", legacyContextualIntake: false,
    providerOccurredAt: "2026-10-16T12:00:00Z",
    referral: { entry_point_conversion_source: "ctwa_ad", explicit_source_type: "ad", ctwa_clid: "synthetic-click-proof" },
    ...extra,
  };
}

function snapshot(extra = {}) {
  return {
    state: "unlinked", contextKind: "organic", contextProof: "post_form_followup_v1",
    targetMode: "snapshot", unlinkedCapturePolicy: "v1", capturedAt: "2026-10-16T12:00:01Z",
    inboxEventKey: "synthetic-inbox-key", ingressSequence: 1,
    eventLeadId: null, currentLeadId: null, activeBindingId: null, conversationId: null,
    managedMessageDistribution: false, managedEventPending: false, managedEventHandled: false,
    ...extra,
  };
}

test("post-form continuation retains ad proof while excluding only new lead intake", () => {
  const context = runtime();
  const input = message();
  const before = JSON.stringify(input.referral);
  assert.equal(context.isConfirmedClickToWhatsAppAd(input), true);
  assert.equal(context.isEligibleClickToWhatsAppLeadIntake(input), false);
  assert.equal(context.clickToWhatsAppAdConfirmationMethod(input), "entry_point_ctwa_ad");
  assert.equal(JSON.stringify(input.referral), before);
  assert.equal(context.isEligibleClickToWhatsAppLeadIntake(message("Tenho interesse no apartamento")), true);
  assert.equal(context.isEligibleClickToWhatsAppLeadIntake(message("Preenchi seu formulário, podemos conversar?")), true);
});

test("every shared post-form fixture has the same narrow intake decision", () => {
  const context = runtime();
  for (const fixture of cases) {
    assert.equal(context.isEligibleClickToWhatsAppLeadIntake(message(fixture.content)), !fixture.want, fixture.name);
  }
});

test("the new organic marker requires this exact post-form message and preserves legacy replay", () => {
  const context = runtime();
  assert.equal(context.hasOrdinaryWhatsAppCaptureContext(message(), snapshot()), true);
  assert.equal(context.hasOrdinaryWhatsAppCaptureContext(message(), snapshot({ contextProof: "post_form_followup_v2" })), false);
  assert.equal(context.hasOrdinaryWhatsAppCaptureContext(message("Mensagem normal"), snapshot()), false);
  assert.equal(context.hasOrdinaryWhatsAppCaptureContext(message(), snapshot({ contextProof: null })), false);
  assert.equal(context.hasOrdinaryWhatsAppCaptureContext(message("Mensagem normal", { referral: null }), snapshot({ contextProof: null })), true);
  assert.equal(context.hasOrdinaryWhatsAppCaptureContext(message(), snapshot({ contextKind: "contextual_intake" })), false);
  assert.equal(context.isEligibleClickToWhatsAppLeadIntake(message(followUp, { legacyContextualIntake: true })), true);
  assert.equal(context.isConfirmedClickToWhatsAppAd(message(followUp, { fromMe: true })), false);
  assert.equal(context.isConfirmedClickToWhatsAppAd(message(followUp, { isGroup: true })), false);
});

test("only an accepted new ingress decision changes intake during a mixed-version rollout", () => {
  const context = runtime();
  for (const [accepted, eligible] of [
    [null, true],
    [snapshot({ contextKind: "contextual_intake", contextProof: "entry_point_ctwa_ad" }), true],
    [snapshot(), false],
  ]) {
    const input = message();
    input.legacyContextualIntake = context.usesLegacyCTWAIntakeDecision(accepted);
    assert.equal(context.isEligibleClickToWhatsAppLeadIntake(input), eligible);
    assert.equal(context.isConfirmedClickToWhatsAppAd(input), true);
  }
  assert.match(source, /message\.legacyContextualIntake = usesLegacyCTWAIntakeDecision\(ingressRoutingSnapshot\)/);
});

test("ingress validates the new marker against its content, authority and tenant before capture", () => {
  const context = runtime();
  const input = message();
  const row = {
    version: 1, organization_id: org, session_id: sessionId, provider_message_id: input.messageId,
    state: "unlinked", context_kind: "organic", context_proof: "post_form_followup_v1",
    unlinked_capture_policy: "v1", captured_at: "2026-10-16T12:00:01Z",
    inbox_event_key: "synthetic-inbox-key", processing_lane: "live", routing_key: input.remoteJid,
    binding_eligible: true, target_mode: "snapshot", ingress_sequence: 1,
    managed_message_distribution: false, managed_event_pending: false, managed_event_handled: false,
  };
  function parse(changes = {}, actualMessage = input, contract = "internal_worker_lease") {
    return context.ingressRoutingSnapshotForMessage(
      { __vimob_ingress: { routing_snapshot: { version: 1, messages: [{ ...row, ...changes }] } } },
      session, actualMessage, { contract },
    );
  }
  assert.equal(parse().contextProof, "post_form_followup_v1");
  assert.throws(() => parse({}, message("Mensagem normal")), /whatsapp_ingress_snapshot_contract_invalid/);
  assert.throws(() => parse({}, message(), "provider_callback"), /whatsapp_durable_ingress_required/);
  for (const changes of [
    { managed_message_distribution: true }, { managed_event_pending: true }, { managed_event_handled: true },
    { rule_id: leadId }, { origin_round_robin_id: leadId }, { context_kind: "contextual_intake" },
  ]) {
    assert.throws(() => parse(changes), /whatsapp_ingress_snapshot_contract_invalid/);
  }
  assert.throws(() => parse({ organization_id: leadId }), /whatsapp_ingress_snapshot_scope_invalid/);
  assert.throws(() => parse({ session_id: leadId }), /whatsapp_ingress_snapshot_scope_invalid/);
});

test("unlinked continuation does not discover a later form or invoke the lead creator", async () => {
  const writes = [];
  const context = runtime({
    from(table) { writes.push(table); throw new Error("unlinked snapshot must not look up mutable leads"); },
    rpc(name) { writes.push(name); throw new Error("post-form must not create or distribute a lead"); },
  });
  const result = await context.ensureLead(session, message(), null, false, null, null, snapshot());
  assert.equal(result, null);
  assert.deepEqual(writes, []);
});

test("existing exact lead remains the destination without creation or reentry", async () => {
  const context = runtime({ rpc() { throw new Error("must not create a card or a reentry"); } });
  const existing = { id: leadId, organization_id: org };
  let loaded;
  context.loadScopedWhatsAppLead = async (actualSession, id) => {
    loaded = [actualSession.organization_id, id];
    return existing;
  };
  const result = await context.ensureLead(session, message(), null, false, leadId, leadId, snapshot({
    state: "bound", eventLeadId: leadId, currentLeadId: leadId,
    activeBindingId: "55555555-5555-4555-8555-555555555555", conversationId,
  }));
  assert.equal(result, existing);
  assert.deepEqual(loaded, [org, leadId]);
});

test("new post-form message stays visible in its authorized unlinked conversation", async () => {
  const calls = [];
  const query = {
    select() { return query; }, eq() { return query; },
    async maybeSingle() { return { data: { created_at: "2026-10-16T12:00:01Z" }, error: null }; },
  };
  const context = runtime({
    from(table) { assert.equal(table, "whatsapp_webhook_inbox"); return query; },
    async rpc(name, params) {
      calls.push([name, params.p_organization_id, params.p_session_id, params.p_conversation_id]);
      assert.equal(name, "resolve_whatsapp_unlinked_history_capture");
      return { data: { capture_state: "unlinked_ephemeral", lead_id: null }, error: null };
    },
  });
  context.sha256Hex = async () => "synthetic-fingerprint";
  const result = await context.resolveWhatsAppAttendanceCapture(
    session, { id: conversationId, lead_id: null }, null, false, null,
    snapshot(), null, message(), null, null, false,
  );
  assert.equal(result.captureState, "unlinked_ephemeral");
  assert.deepEqual(calls, [["resolve_whatsapp_unlinked_history_capture", org, sessionId, conversationId]]);
});

test("queue rule remains valid for direct CTWA and is not selected for a post-form continuation", async () => {
  const rule = { id: "rule", session_id: sessionId, target_round_robin_id: "55555555-5555-4555-8555-555555555555" };
  const query = { select() { return query; }, eq() { return query; }, order() { return query; },
    then(resolve, reject) { return Promise.resolve({ data: [rule], error: null }).then(resolve, reject); } };
  const context = runtime({ from() { return query; } });
  context.ruleMatches = () => true;
  context.isManagedWhatsAppMessageDistributionRule = async () => true;
  assert.equal(await context.findInboundRule(session, message()), null);
  const selected = await context.findInboundRule(session, message("Tenho interesse no anúncio"));
  assert.equal(selected.target_round_robin_id, rule.target_round_robin_id);
  assert.equal(selected.__managed_whatsapp_message_distribution, true);
});

function scopedCaptureRuntime({ manualAttendance = false } = {}) {
  const bindingId = "55555555-5555-4555-8555-555555555555";
  const ownerId = "66666666-6666-4666-8666-666666666666";
  const attendanceId = "77777777-7777-4777-8777-777777777777";
  const reads = [];
  const rpcCalls = [];
  const context = runtime({
    from(table) {
      const filters = new Map();
      const query = {
        select() { return query; },
        eq(key, value) { filters.set(key, value); return query; },
        is() { return query; }, lte() { return query; }, lt() { return query; },
        order() { return query; }, limit() { return query; },
        async maybeSingle() {
          reads.push(table);
          assert.equal(filters.get("organization_id"), org);
          if (table === "whatsapp_sessions") {
            assert.equal(filters.get("id"), sessionId);
            return { data: { owner_user_id: ownerId, is_active: true }, error: null };
          }
          assert.equal(filters.get("session_id"), sessionId);
          if (table === "whatsapp_webhook_inbox") {
            assert.equal(filters.get("event_key"), "synthetic-inbox-key");
            return { data: { created_at: "2026-10-16T12:00:01Z" }, error: null };
          }
          assert.equal(filters.get("conversation_id"), conversationId);
          assert.equal(filters.get("lead_id"), leadId);
          if (table === "whatsapp_conversation_lead_bindings") {
            return { data: { id: bindingId }, error: null };
          }
          assert.equal(table, "whatsapp_attendance_entries");
          assert.equal(filters.get("binding_id"), bindingId);
          assert.equal(filters.get("user_id"), ownerId);
          const data = manualAttendance && filters.get("entry_source") === "manual"
            ? { id: attendanceId }
            : null;
          return { data, error: null };
        },
      };
      return query;
    },
    rpc(name) {
      rpcCalls.push(name);
      throw new Error(`post-form capture must not create, redistribute or auto-enter: ${name}`);
    },
  });
  context.sha256Hex = async () => "a".repeat(64);
  context.resolveActiveSessionOwner = async (actualSession) => {
    assert.equal(actualSession.organization_id, org);
    assert.equal(actualSession.id, sessionId);
    assert.equal(actualSession.owner_user_id, ownerId);
    return ownerId;
  };
  const accepted = snapshot({
    state: "bound", eventLeadId: leadId, currentLeadId: leadId,
    activeBindingId: bindingId, conversationId, ingressSequence: 2,
    providerMessageId: message().messageId,
  });
  const resolve = (ingress = accepted, inherited = null, stored = null) =>
    context.resolveWhatsAppAttendanceCapture(
      session, { id: conversationId, lead_id: leadId }, leadId, true, null,
      ingress, inherited, message(), { id: leadId }, stored, false,
    );
  return { accepted, bindingId, attendanceId, reads, rpcCalls, resolve };
}

test("bound post-form history stays visible without creating a lead or reentry", async () => {
  const harness = scopedCaptureRuntime();
  const result = await harness.resolve();
  assert.equal(result.captureState, "observed_unattended");
  assert.equal(result.reason, "organic_bound_without_attendance");
  assert.equal(result.bindingId, harness.bindingId);
  assert.deepEqual(harness.rpcCalls, []);
});

test("first exact lead match retains post-form history without intake effects", async () => {
  const harness = scopedCaptureRuntime();
  const result = await harness.resolve({
    ...harness.accepted, state: "lead_match", currentLeadId: null,
    activeBindingId: null, conversationId: null,
  });
  assert.equal(result.captureState, "observed_unattended");
  assert.equal(result.reason, "organic_first_lead_match_without_attendance");
  assert.deepEqual(harness.rpcCalls, []);
});

test("post-form history follows the proven predecessor without rerunning intake", async () => {
  const harness = scopedCaptureRuntime();
  const result = await harness.resolve({
    ...harness.accepted, state: "predecessor_inherit", targetMode: "inherit_predecessor",
    eventLeadId: null, currentLeadId: null, activeBindingId: null, conversationId: null,
    bindingEligible: true, predecessorProviderMessageId: "synthetic-predecessor",
    predecessorInboxEventKey: "synthetic-predecessor-inbox", predecessorProcessingLane: "live",
  }, {
    ready: true, terminal: false, conversationId, leadId,
    activeBindingId: harness.bindingId, predecessorProviderMessageId: "synthetic-predecessor",
    predecessorIngressSequence: 1,
  });
  assert.equal(result.captureState, "observed_unattended");
  assert.equal(result.reason, "organic_inherited_without_attendance");
  assert.deepEqual(harness.rpcCalls, []);
});

test("effective manual attendance preserves normal post-form message capture", async () => {
  const harness = scopedCaptureRuntime({ manualAttendance: true });
  const result = await harness.resolve();
  assert.equal(result.captureState, "captured");
  assert.equal(result.reason, "attendance_entry_effective_for_ingress");
  assert.equal(result.attendanceEntryId, harness.attendanceId);
  assert.deepEqual(harness.rpcCalls, []);
});

test("suppressed post-form replay cannot rehydrate history after attendance starts", async () => {
  const harness = scopedCaptureRuntime({ manualAttendance: true });
  const result = await harness.resolve(harness.accepted, null, {
    capture_state: "suppressed", metadata: {},
  });
  assert.equal(result.captureState, "suppressed");
  assert.equal(result.reason, "persisted_suppressed");
  assert.deepEqual(harness.reads, []);
  assert.deepEqual(harness.rpcCalls, []);
});
