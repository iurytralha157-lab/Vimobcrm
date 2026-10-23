import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./index.ts", import.meta.url),
  "utf8",
);

test("ingress is POST/OPTIONS only and authenticates before privileged work", () => {
  assert.doesNotMatch(source, /req\.method === "GET"/);
  assert.match(source, /req\.method === "OPTIONS"/);
  assert.match(source, /req\.method !== "POST"/);
  assert.doesNotMatch(source, /await req\.json\(/);

  const auth = source.indexOf("authorizeEvolutionGoWebhookIngress(req");
  const client = source.indexOf("supabase = createClient(", auth);
  const body = source.indexOf("readBoundedJsonBody<any>(req)", auth);
  const session = source.indexOf("resolveSession(payload, url)", auth);
  assert.ok(auth > 0 && auth < client && client < body && body < session);
});

test("missing or mismatched session state cannot be acknowledged as ignored", () => {
  const sessionResolution = source.indexOf("const resolved = await resolveSession(");
  const sessionBinding = source.indexOf("validateEvolutionGoSessionBinding(", sessionResolution);
  const inactiveSession = source.indexOf('reason: "INACTIVE_SESSION"', sessionBinding);

  assert.ok(sessionResolution > 0 && sessionBinding > sessionResolution && inactiveSession > sessionBinding);
  assert.doesNotMatch(source.slice(sessionResolution, sessionBinding), /ignored:\s*true/);
  assert.match(source.slice(sessionBinding, inactiveSession + 200), /ignored:\s*true/);
  assert.match(source, /Webhook session could not be resolved/);
  assert.match(source, /validateEvolutionGoSessionBinding/);
  assert.match(source, /Webhook session binding failed/);
});

test("internal worker keeps its outer lease while direct callbacks claim locally", () => {
  assert.match(
    source,
    /authorization\.contract !== "internal_worker_lease"[\s\S]{0,1200}claimEvolutionMessageDelivery/,
  );
  assert.match(source, /completeEvolutionMessageDelivery/);
  assert.match(source, /retryEvolutionMessageDelivery/);
});

test("canonical message is terminal only after required effects and awaited AI", () => {
  const effects = source.indexOf("await updateConversationAfterMessage(");
  const autoReply = source.indexOf("await triggerAutoReply(", effects);
  const completion = source.indexOf("await completeStoredMessageEffects(", effects);
  assert.ok(effects > 0 && effects < autoReply && autoReply < completion);
  const cleanup = source.indexOf("await releaseConversationMessageEffect(", completion);
  assert.ok(completion < cleanup);
  assert.doesNotMatch(source, /scheduleAutoReply/);
  assert.match(source, /storedEvolutionGoEffectState/);
  assert.match(source, /no recoverable effect ledger/);
  assert.match(source, /effect ledger is saturated/);
});

test("conversation and inbound-log writes fail closed", () => {
  assert.match(source, /const \{ data, error \} = await updateQuery/);
  assert.match(source, /if \(error\) throw error;/);
  assert.match(
    source,
    /const \{ error \} = await supabase\.from\("whatsapp_inbound_logs"\)\.insert/,
  );
  assert.match(source, /whatsapp_inbound_logs_pkey/);
});

test("identity alias resolution quarantines conflicting cards and canonical identities", () => {
  const start = source.indexOf("async function findWhatsAppIdentityAlias(");
  const end = source.indexOf("async function upsertWhatsAppIdentityAliases(", start);
  assert.ok(start > 0 && end > start);

  const lookup = source.slice(start, end);
  assert.doesNotMatch(lookup, /order\("last_seen_at"/);
  assert.doesNotMatch(lookup, /\.limit\(1\)/);
  assert.doesNotMatch(lookup, /\.maybeSingle\(\)/);
  assert.match(lookup, /\.limit\(normalizedAliases\.length\)/);

  assert.match(source, /const leadIds = unique\(/);
  assert.match(source, /const canonicalJids = unique\(/);
  assert.match(source, /leadIds\.length > 1 \|\| canonicalJids\.length > 1/);
  assert.match(source, /quarantineReason: "whatsapp_identity_alias_ambiguous"/);
  assert.match(source, /conversationBindingSnapshot\.leadResolutionQuarantineReason/);
  assert.match(source, /__whatsapp_identity_alias_quarantine_reason/);
  assert.match(source, /if \(!existing && !intakeSplitRemoteJid && !leadResolutionQuarantineReason && !message\.isGroup/);
});

test("fresh identity routing ignores soft-deleted conversations", () => {
  const captureStart = source.indexOf("async function captureWhatsAppConversationBindingSnapshot(");
  const captureEnd = source.indexOf("async function ensureConversation(", captureStart);
  const ensureEnd = source.indexOf("async function activateWhatsAppConversationLeadBinding(", captureEnd);
  assert.ok(captureStart > 0 && captureEnd > captureStart && ensureEnd > captureEnd);

  const capture = source.slice(captureStart, captureEnd);
  const ensure = source.slice(captureEnd, ensureEnd);
  assert.equal((capture.match(/\.is\("deleted_at", null\)/g) || []).length, 2);
  assert.equal((ensure.match(/\.is\("deleted_at", null\)/g) || []).length, 2);
});

test("non-managed CTWA uses the immutable canonical queue and canonical distributor", () => {
  const ensureStart = source.indexOf("async function ensureLead(");
  const managedStart = source.indexOf("async function processManagedWhatsAppLeadEntry(", ensureStart);
  assert.ok(ensureStart > 0 && managedStart > ensureStart);

  const intake = source.slice(ensureStart, managedStart);
  assert.match(intake, /CANONICAL_INTAKE_PROOF_V1/);
  assert.match(intake, /nonmanaged_whatsapp_canonical_intake_snapshot_required/);
  assert.match(intake, /ingressRoutingSnapshot\?\.originRoundRobinId/);
  assert.match(intake, /assignedUserId = managedMessageDistribution \|\| targetRoundRobinId \? null : ownerUserId/);
  assert.match(intake, /distribution_deferred: true/);
  assert.match(intake, /processCanonicalNonManagedWhatsAppDistribution/);
  assert.match(intake, /\.rpc\("distribute_lead_from_backend"/);
  assert.match(intake, /p_preserve_assignee: preserveAssignee/);
  assert.match(intake, /p_round_robin_id: queueId/);
  assert.match(intake, /whatsapp-native:\$\{await sha256Hex\(stableKeyPayload\)\}/);
  assert.match(intake, /const expectedScopeKey = queueId \? `queue:\$\{queueId\}` : "unscoped"/);
  assert.match(intake, /persistedScopeKey !== expectedScopeKey/);
  assert.match(intake, /if \(!queueId\)/);
  assert.match(intake, /__lead_scope_compatibility_fallback: true/);
  const distributor = intake.slice(intake.indexOf("async function processCanonicalNonManagedWhatsAppDistribution("));
  assert.doesNotMatch(distributor, /queue\.is_active === false/);
});

test("leadless legacy retries are terminal no-ops without weakening immutable lead checks", () => {
  const start = source.indexOf("async function recoverPersistedNonManagedWhatsAppMessage(");
  const end = source.indexOf("async function", start + 1);
  assert.ok(start > 0 && end > start);

  const recovery = source.slice(start, end);
  assert.match(
    recovery,
    /if \(lookupLeadId && !storedLeadId\) \{[\s\S]*?legacy_whatsapp_retry_immutable_lead_missing/,
  );
  assert.match(recovery, /if \(!storedLeadId\) \{[\s\S]*?return;/);
  assert.match(recovery, /const leadId = storedLeadId;/);
  assert.doesNotMatch(recovery, /const leadId = lookupLeadId \|\| storedLeadId;/);
});

test("Evolution Go Info/Message envelopes remain recognized", () => {
  assert.match(source, /value\.Info/);
  assert.match(source, /value\.Message/);
  assert.match(source, /payload\?\.Message/);
  assert.match(source, /data\?\.Message/);
});

test("suppressed attendance rows are redacted before the first canonical insert", () => {
  const start = source.indexOf("async function insertMessage(");
  const end = source.indexOf("async function completeStoredMessageEffects(", start);
  assert.ok(start > 0 && end > start);

  const insert = source.slice(start, end);
  assert.match(insert, /content: captureSuppressed \? null : message\.content/);
  assert.match(
    insert,
    /const persistedMetadata = captureSuppressed[\s\S]*?redactedSuppressedMessageMetadata/,
  );
  assert.match(insert, /metadata: persistedMetadata/);
  assert.match(insert, /\.from\("whatsapp_messages"\)[\s\S]*?\.insert\(row\)/);
  assert.doesNotMatch(
    insert.slice(insert.indexOf("const persistedMetadata"), insert.indexOf("const row")),
    /captureSuppressed[\s\S]*?(?:raw: message\.raw|whatsapp_referral: message\.referral)/,
  );
});

test("attendance uses only a valid original provider occurrence timestamp", () => {
  const normalizeStart = source.indexOf("function normalizeMessage(");
  const normalizeEnd = source.indexOf("function previewForMessage(", normalizeStart);
  const resolverStart = source.indexOf("async function resolveWhatsAppAttendanceCapture(");
  const resolverEnd = source.indexOf("async function findStoredMessage(", resolverStart);
  assert.ok(normalizeStart > 0 && normalizeEnd > normalizeStart);
  assert.ok(resolverStart > 0 && resolverEnd > resolverStart);

  const normalize = source.slice(normalizeStart, normalizeEnd);
  const resolver = source.slice(resolverStart, resolverEnd);
  assert.match(normalize, /const providerOccurredAt = parseProviderTimestamp/);
  assert.match(normalize, /sentAt: timestamp,[\s\S]*?providerOccurredAt/);
  assert.match(resolver, /cleanText\(message\?\.providerOccurredAt\)/);
  assert.match(resolver, /reason: "provider_occurrence_time_missing"/);
  assert.match(resolver, /reason: "provider_occurrence_after_ingress"/);
  assert.match(
    resolver,
    /Date\.parse\(providerOccurredAt\)[\s\S]*?> Date\.parse\(inboxCreatedAt\)/,
  );
  assert.match(resolver, /\.lte\("joined_at", providerOccurredAt\)/);
  assert.doesNotMatch(resolver, /cleanText\(message\?\.sentAt\)/);
});

test("CTWA initial card joins attendance before its first message is classified", () => {
  const start = source.indexOf("async function resolveWhatsAppAttendanceCapture(");
  const end = source.indexOf("async function findStoredMessage(", start);
  assert.ok(start > 0 && end > start);
  const resolver = source.slice(start, end);
  const persisted = resolver.indexOf("const persistedState = persistedWhatsAppMessageCaptureState(storedMessage)");
  const binding = resolver.indexOf("const { data: activeBinding");
  const inbox = resolver.indexOf("const { data: inbox", binding);
  const bootstrap = resolver.indexOf('"auto_enter_whatsapp_ctwa_attendance"');
  const attendance = resolver.indexOf('const attendanceScope = () => supabase');
  assert.ok(persisted > 0 && persisted < binding && binding < inbox && inbox < bootstrap && bootstrap < attendance);
  assert.match(resolver, /initialProviderEventId === `\$\{session\.id\}:\$\{message\.messageId\}`/);
  assert.match(resolver, /isEligibleClickToWhatsAppLeadIntake\(message\)/);
  assert.match(resolver, /!message\.fromMe[\s\S]*?!message\.isGroup[\s\S]*?!message\.providerMessageIdSynthetic/);
  assert.match(resolver, /ingress\.contextKind === "contextual_intake"/);
  assert.match(resolver, /p_binding_id: bindingId/);
  assert.match(resolver, /p_ingress_sequence: ingress\.ingressSequence/);
  assert.match(resolver, /p_provider_occurred_at: providerOccurredAt/);
});

test("organic leadless ingress remains visible without crossing the lead attendance gate", () => {
  const parser = source.slice(
    source.indexOf("function ingressRoutingSnapshotForMessage("),
    source.indexOf("function orderMessagesByIngressRoutingSnapshot("),
  );
  assert.match(parser, /row\.unlinked_capture_policy/);
  assert.match(parser, /row\.expired_unlinked_conversation_id/);
  assert.match(parser, /row\.expired_unlinked_remote_jid/);
  assert.match(parser, /row\.intake_unlinked_conversation_id/);
  assert.match(parser, /row\.intake_unlinked_remote_jid/);
  assert.match(parser, /row\.captured_at/);
  const resolver = source.slice(
    source.indexOf("async function resolveWhatsAppAttendanceCapture("),
    source.indexOf("async function findStoredMessage("),
  );
  const persisted = resolver.indexOf("const persistedState = persistedWhatsAppMessageCaptureState(storedMessage)");
  const ephemeral = resolver.indexOf('"resolve_whatsapp_unlinked_history_capture"');
  const leadGate = resolver.indexOf("if (!eventBindingIsCurrent || !eventLeadId || !conversation?.id)");
  assert.ok(persisted > 0 && ephemeral > persisted && leadGate > ephemeral);
  assert.match(resolver, /ingress\?\.state === "unlinked"/);
  assert.match(resolver, /ingress\.unlinkedCapturePolicy === "v1"/);
  assert.match(resolver, /hasOrdinaryWhatsAppCaptureContext\(message, ingress\)/);
  const organicPolicy = source.slice(
    source.indexOf("function hasOrdinaryWhatsAppCaptureContext("),
    source.indexOf("function whatsappAttributionUtmSource("),
  );
  assert.match(organicPolicy, /ingress\.contextKind !== "organic"\) return false/);
  assert.match(organicPolicy, /!ingress\.contextProof\) return !isConfirmedClickToWhatsAppAd\(message\)/);
  assert.match(organicPolicy, /ingress\.contextProof === "post_form_followup_v1"[\s\S]*?isConfirmedClickToWhatsAppAd\(message\)[\s\S]*?isPostFormFollowUpWithoutLeadIntake\(message\)/);
  assert.match(resolver, /!ingress\.eventLeadId[\s\S]*?!ingress\.currentLeadId[\s\S]*?!ingress\.activeBindingId/);
  assert.match(resolver, /!managedOutbound[\s\S]*?!message\?\.isGroup/);
  assert.match(resolver, /Date\.parse\(providerOccurredAt\) <= Date\.parse\(inboxCreatedAt\)/);
  assert.match(resolver, /p_conversation_id: conversation\.id[\s\S]*?p_provider_message_id: message\.messageId[\s\S]*?p_inbox_event_key: ingress\.inboxEventKey/);
  assert.match(resolver, /captureState === "promoted_unlinked"[\s\S]*?historyLeadId/);
  assert.match(resolver, /organicBoundObservation[\s\S]*?ingress\.state === "bound"[\s\S]*?!managedOutbound/);

  const managedOrigin = source.slice(
    source.indexOf("async function whatsappOutboundHasManagedOrigin("),
    source.indexOf("async function resolveWhatsAppAttendanceCapture("),
  );
  assert.match(managedOrigin, /\.from\("whatsapp_outbox"\)/);
  assert.match(managedOrigin, /\.from\("outbox_messages"\)[\s\S]*?\.eq\("conversation_id", conversation\.id\)/);
  assert.match(managedOrigin, /\["sent_message_id", "client_message_id"\]/);

  const insert = source.slice(
    source.indexOf("async function insertMessage("),
    source.indexOf("async function completeStoredMessageEffects("),
  );
  assert.match(insert, /existingCaptureState === "unlinked_ephemeral"[\s\S]*?return \{ inserted: false, message: existing \}/);
  assert.match(insert, /existingCaptureState === "observed_unattended"[\s\S]*?return \{ inserted: false, message: existing \}/);
  assert.match(insert, /content: captureSuppressed \? null : message\.content/);
  assert.match(insert, /allowHistoricalMedia = captureState === "promoted_unlinked"/);
  assert.match(insert, /const isMedia = !captureSuppressed/);

  const handle = source.slice(source.indexOf("async function handleMessages("), source.indexOf("function statusFromProvider("));
  assert.match(handle, /if \(shouldPersistAttribution && attachedLead\?\.id && !isReactionEvent\)/);
  assert.match(handle, /&& eventLeadId[\s\S]*?await triggerAutoReply\(/);
  assert.match(handle, /await updateConversationAfterMessage\(session, conversation, eventLeadId, message\)/);
  assert.match(handle, /captureDecision\.captureState !== "unlinked_ephemeral"[\s\S]*?captureDecision\.captureState !== "observed_unattended"[\s\S]*?await logInbound\(/);
  assert.match(handle, /captureDecision\.captureState === "captured"[\s\S]*?await triggerAutoReply\(/);
  assert.match(handle, /promoted_unlinked"\)[\s\S]*?await completeStoredMessageEffects\(/);
  assert.match(handle, /!storedBeforeProcessing[\s\S]*?ingressRoutingSnapshot\?\.unlinkedCapturePolicy === "v1"[\s\S]*?processed \+= 1;[\s\S]*?continue;/);

  const ensure = source.slice(
    source.indexOf("async function ensureConversation("),
    source.indexOf("async function activateWhatsAppConversationLeadBinding("),
  );
  assert.match(ensure, /whatsapp_unlinked_ingress_age_exceeded/);
  assert.match(ensure, /retire_whatsapp_unlinked_conversation_epoch/);
  assert.match(ensure, /p_expected_conversation_id: oldConversationId/);
  assert.match(ensure, /p_remote_jid: ingress\.expiredUnlinkedRemoteJid/);
  assert.match(ensure, /\.is\("retired_at", null\)/);
  const reconcile = source.slice(
    source.indexOf("async function reconcileHandledWhatsAppMessageTransport("),
    source.indexOf("function normalizeMessage("),
  );
  assert.match(reconcile, /existingCaptureState === "unlinked_ephemeral"[\s\S]*?epoch\.retired_at[\s\S]*?7 \* 24 \* 60 \* 60 \* 1000/);
});

test("lead intake retires a marked no-lead epoch before routing the new card", () => {
  const split = source.slice(
    source.indexOf("async function splitUnlinkedLeadIntakeEpoch("),
    source.indexOf("function orderMessagesByIngressRoutingSnapshot("),
  );
  assert.match(split, /ingress\.intakeUnlinkedConversationId \|\| ingress\.conversationId/);
  assert.match(split, /\.eq\("id", oldConversationId\)/);
  assert.match(split, /"retire_whatsapp_unlinked_conversation_for_lead_intake"/);
  assert.match(split, /p_provider_message_id: message\.messageId[\s\S]*?p_inbox_event_key: ingress\.inboxEventKey[\s\S]*?p_lead_id: ingress\.eventLeadId/);
  assert.match(split, /outcome\.retired !== true[\s\S]*?outcome\.conversation_id/);
  const handle = source.slice(source.indexOf("async function handleMessages("), source.indexOf("function statusFromProvider("));
  const splitCall = handle.indexOf("await splitUnlinkedLeadIntakeEpoch(");
  const leadResolution = handle.indexOf("let rule: JsonRecord | null = null;");
  const ensure = handle.indexOf("let conversation = await ensureConversation(");
  assert.ok(splitCall > 0 && splitCall < leadResolution && leadResolution < ensure);
  assert.match(handle, /conversationId: null,[\s\S]*?intakeSplitRemoteJid/);
  const ensureConversation = source.slice(
    source.indexOf("async function ensureConversation("),
    source.indexOf("async function activateWhatsAppConversationLeadBinding("),
  );
  assert.match(ensureConversation, /remoteJid = intakeSplitRemoteJid/);
  assert.match(ensureConversation, /!intakeSplitRemoteJid\) \{[\s\S]*?findWhatsAppIdentityAlias/);
  assert.match(ensureConversation, /\.in\("remote_jid", intakeSplitRemoteJid \? \[intakeSplitRemoteJid\] : identityAliases\)/);
  assert.match(ensureConversation, /!intakeSplitRemoteJid && !leadResolutionQuarantineReason[\s\S]*?\.in\("contact_phone", phoneVariants\)/);
});

test("first organic lead match is observed only after the current binding and lead are proved", () => {
  const resolver = source.slice(
    source.indexOf("async function resolveWhatsAppAttendanceCapture("),
    source.indexOf("async function findStoredMessage("),
  );
  const bindingProof = resolver.indexOf("const bindingId = optionalUuid(activeBinding?.id)");
  const inboxTimeProof = resolver.indexOf("Date.parse(providerOccurredAt)", bindingProof);
  const leadMatch = resolver.indexOf("const organicFirstLeadMatchObservation =");
  assert.ok(bindingProof > 0 && inboxTimeProof > bindingProof && leadMatch > inboxTimeProof);
  const predicate = resolver.slice(leadMatch, resolver.indexOf("  return {", leadMatch));
  for (const required of [
    'ingress.state === "lead_match"',
    'ingress.targetMode === "snapshot"',
    'ingress.unlinkedCapturePolicy === "v1"',
    'Boolean(ingress.capturedAt)',
    'hasOrdinaryWhatsAppCaptureContext(message, ingress)',
    '!ingress.leadResolutionQuarantineReason',
    '!leadResolutionQuarantineReason',
    'ingress.eventLeadId === eventLeadId',
    '!ingress.currentLeadId',
    '!ingress.activeBindingId',
    '!ingress.conversationId',
    'optionalUuid(conversation.lead_id) === eventLeadId',
    '!ingress.managedMessageDistribution',
    '!ingress.managedEventPending',
    '!ingress.managedEventHandled',
    '!message.fromMe',
    '!message.isGroup',
    '!message.providerMessageIdSynthetic',
    '!isEligibleClickToWhatsAppLeadIntake(message)',
    'message.messageType !== "reaction"',
    'message.messageType !== "deleted"',
    '!managedOutbound',
  ]) assert.ok(predicate.includes(required), `missing lead-match guard: ${required}`);
  assert.match(resolver, /organicBoundObservation \|\| organicFirstLeadMatchObservation[\s\S]*?"observed_unattended"/);
  assert.match(resolver, /organic_first_lead_match_without_attendance/);
});

test("external outbound insert uses the direction required by visible capture", () => {
  const insert = source.slice(
    source.indexOf("async function insertMessage("),
    source.indexOf("async function completeStoredMessageEffects("),
  );
  assert.match(insert, /from_me: message\.fromMe,\s*direction: message\.fromMe \? "outbound" : "inbound"/);
  assert.match(insert, /status: message\.fromMe \? "sent" : "received"/);
  const updatePath = insert.slice(insert.indexOf("  if (existing) {"));
  assert.doesNotMatch(updatePath, /\bdirection\s*:/);
});

test("expired unlinked deletion callbacks finish without rewriting a scrubbed message", () => {
  const deletion = source.slice(
    source.indexOf("async function expiredUnlinkedDeletionTarget("),
    source.indexOf("async function updateConversationAfterMessage("),
  );
  assert.match(deletion, /conversation\.unlinked_retention_v1/);
  assert.match(deletion, /conversation\.retired_at[\s\S]*?createdAt \+ 7 \* 24 \* 60 \* 60 \* 1000/);
  const gate = deletion.indexOf("if (await expiredUnlinkedDeletionTarget(session, target)) return true;");
  const write = deletion.indexOf('.from("whatsapp_messages")', gate);
  assert.ok(gate > 0 && write > gate, "expired target must exit before the first write");
  assert.match(deletion, /expiredUnlinkedDeletionWriteRejection\(suppressedDeleteError\)/);
  assert.match(deletion, /expiredUnlinkedDeletionWriteRejection\(updateError\)/);
});

test("manual capture retains its cutoff and auto capture uses first-event provenance", () => {
  const start = source.indexOf("async function resolveWhatsAppAttendanceCapture(");
  const end = source.indexOf("async function findStoredMessage(", start);
  const resolver = source.slice(start, end);
  assert.match(resolver, /\.eq\("entry_source", "manual"\)[\s\S]*?\.lte\("joined_at", inboxCreatedAt\)[\s\S]*?\.lte\("joined_at", providerOccurredAt\)[\s\S]*?\.lt\("ingress_sequence_cutoff", ingress\.ingressSequence\)/);
  assert.match(resolver, /\.eq\("entry_source", "ctwa_auto"\)[\s\S]*?\.lte\("bootstrap_ingress_sequence", ingress\.ingressSequence\)[\s\S]*?\.lte\("bootstrap_provider_occurred_at", providerOccurredAt\)[\s\S]*?\.lte\("bootstrap_inbox_created_at", inboxCreatedAt\)/);
  assert.match(resolver, /Number\(autoEntry\?\.bootstrap_ingress_sequence\) < ingress\.ingressSequence/);
  assert.match(resolver, /Number\(autoEntry\?\.bootstrap_ingress_sequence\) === ingress\.ingressSequence[\s\S]*?cleanText\(autoEntry\?\.bootstrap_provider_message_id\) === message\.messageId/);
  assert.match(resolver, /ingress\.contextKind !== "contextual_intake"/);
});

test("attendance capture follows the current active session owner", () => {
  const start = source.indexOf("async function resolveWhatsAppAttendanceCapture(");
  const end = source.indexOf("async function findStoredMessage(", start);
  const resolver = source.slice(start, end);
  const currentSession = resolver.indexOf('.from("whatsapp_sessions")');
  const bootstrap = resolver.indexOf('"auto_enter_whatsapp_ctwa_attendance"');
  const attendance = resolver.indexOf('const attendanceScope = () => supabase');
  assert.ok(currentSession > 0 && currentSession < bootstrap && bootstrap < attendance);
  assert.match(resolver, /\.select\("owner_user_id, is_active, provider, status"\)/);
  assert.match(resolver, /resolveActiveSessionOwner\(\{ \.\.\.session, \.\.\.currentSession \}\)/);
  assert.match(resolver, /reason: "current_session_owner_inactive_or_missing"/);
  assert.match(resolver, /\.eq\("user_id", attendanceOwnerId\)/);
  assert.doesNotMatch(resolver, /currentSession\.status\s*===\s*"connected"/);
});

test("owner fallback uses only the active WhatsApp owner even after disconnect", () => {
  const start = source.indexOf("async function resolveActiveSessionOwner(");
  const end = source.indexOf("async function loadScopedWhatsAppLead(", start);
  const resolver = source.slice(start, end);
  assert.match(resolver, /optionalUuid\(session\.owner_user_id\)/);
  assert.match(resolver, /session\.is_active === false/);
  assert.match(resolver, /session\.provider[\s\S]*?"evolution_go"/);
  assert.match(resolver, /\["disabled", "deleted"\]\.includes\(normalizeText\(session\.status\)/);
  assert.match(resolver, /organization_members/);
  assert.doesNotMatch(resolver, /session\.created_by/);
  assert.doesNotMatch(resolver, /session\.status\s*===\s*"connected"/);
  const ensureLead = source.slice(
    source.indexOf("async function ensureLead("),
    source.indexOf("async function processManagedWhatsAppLeadEntry("),
  );
  assert.match(ensureLead, /if \(!ownerUserId\) \{[\s\S]*?ctwa_session_owner_unavailable/);
});

test("pre-attendance lead projections derive campaign and property only from referral", () => {
  const start = source.indexOf("async function ensureLead(");
  const end = source.indexOf("async function processManagedWhatsAppLeadEntry(", start);
  assert.ok(start > 0 && end > start);

  const intake = source.slice(start, end);
  assert.match(intake, /detectPropertyCode\(message, false\)/);
  assert.match(
    intake,
    /campaignLabelForMessage\([\s\S]*?managedMessageDistribution \? rule : null,[\s\S]*?false,/,
  );
  assert.match(source, /const propertyCode = detectPropertyCode\(message, false\);/);
});
