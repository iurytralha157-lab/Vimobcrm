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
  assert.match(source, /if \(!existing && !leadResolutionQuarantineReason && !message\.isGroup/);
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

test("new received history requires explicit scope and never rehydrates a suppressed retry", () => {
  const resolverStart = source.indexOf("async function resolveWhatsAppAttendanceCapture(");
  const resolverEnd = source.indexOf("async function findStoredMessage(", resolverStart);
  const resolver = source.slice(resolverStart, resolverEnd);
  const persisted = resolver.indexOf("const persistedState = persistedWhatsAppMessageCaptureState(storedMessage)");
  const flag = resolver.indexOf("const recordInbound = inboundRecordingEnabledForSession(session)");
  const inbox = resolver.indexOf('const { data: inbox');
  const leadless = resolver.indexOf('reason: "inbound_contact_history"');

  assert.match(source, /Deno\.env\.get\("WHATSAPP_INBOUND_RECORDING_SESSION_IDS"\) \|\| ""/);
  assert.match(source, /function inboundRecordingEnabledForSession\(session: JsonRecord\)/);
  assert.ok(persisted > 0 && flag > persisted && leadless > inbox);
  assert.match(resolver, /if \(!eventBindingIsCurrent \|\| !conversation\?\.id/);
  assert.match(resolver, /!ingress\?\.inboxEventKey/);
  assert.match(resolver, /captureState: attendanceEntryId \? "captured" : \(recordInbound \? "recorded" : "suppressed"\)/);
  assert.match(source, /eventBindingIsCurrent && !leadResolutionQuarantineReason/);
});

test("recorded history cannot newly trigger AI or managed lead plaintext projection", () => {
  const handleStart = source.indexOf("async function handleMessages(");
  const handleEnd = source.indexOf("function statusFromProvider(", handleStart);
  const handle = source.slice(handleStart, handleEnd);
  assert.equal((handle.match(/captureDecision\.captureState === "captured"/g) || []).length, 2);
  assert.match(handle, /processManagedWhatsAppLeadEntry\([\s\S]*?captureDecision\.captureState !== "captured"/);
  assert.match(handle, /if \(!captureSuppressed\) \{[\s\S]*?updateConversationAfterMessage/);
});

test("unclocked CTWA exits before Edge can look up or create a lead", () => {
  const handleStart = source.indexOf("async function handleMessages(");
  const handleEnd = source.indexOf("function statusFromProvider(", handleStart);
  const handle = source.slice(handleStart, handleEnd);
  const guard = handle.indexOf("isConfirmedClickToWhatsAppAd(message) && !message.providerOccurredAt");
  const firstDatabaseRead = handle.indexOf("await wasNonleadWhatsAppEventPurged(");
  const leadCreation = handle.indexOf("lead = await ensureLead(");
  assert.ok(guard > 0 && guard < firstDatabaseRead && firstDatabaseRead < leadCreation);
  assert.match(handle.slice(guard, firstDatabaseRead), /processed \+= 1;\s*continue;/);
});

test("a recorded pre-lead retry cannot acquire a later lead or rewrite its ingress log", () => {
  const insertStart = source.indexOf("async function insertMessage(");
  const insertEnd = source.indexOf("async function completeStoredMessageEffects(", insertStart);
  const insert = source.slice(insertStart, insertEnd);
  const logStart = source.indexOf("async function logInbound(");
  const logEnd = source.indexOf("async function triggerAutoReply(", logStart);
  const log = source.slice(logStart, logEnd);
  const handleStart = source.indexOf("async function handleMessages(");
  const handleEnd = source.indexOf("function statusFromProvider(", handleStart);
  const handle = source.slice(handleStart, handleEnd);
  const transportStart = source.indexOf("async function reconcileHandledWhatsAppMessageTransport(");
  const transportEnd = source.indexOf("function normalizeMessage(", transportStart);
  const transport = source.slice(transportStart, transportEnd);

  assert.match(insert, /existingCaptureState === "recorded" && !existingLeadId && eventLeadId/);
  assert.match(insert, /return \{ inserted: false, message: existing \};/);
  assert.match(insert, /const persistedLeadId = existingCaptureState === "recorded" \|\| existingCaptureState === "suppressed"/);
  assert.equal((insert.match(/lead_id: persistedLeadId/g) || []).length, 2);
  assert.doesNotMatch(insert, /lead_id: existingLeadId \|\| eventLeadId/);
  assert.match(log, /if \(existingLeadId !== eventLeadId\)/);
  assert.doesNotMatch(log, /lead_id: existingLeadId \|\| eventLeadId/);
  const historicalReplay = handle.indexOf('persistedWhatsAppMessageCaptureState(storedBeforeProcessing) === "recorded"');
  const mediaRecovery = handle.indexOf("const mediaReady = await reconcileHandledWhatsAppMessageTransport(", historicalReplay);
  const completed = handle.indexOf("await completeStoredMessageEffects(session, storedBeforeProcessing", historicalReplay);
  const providerBindingLookup = handle.indexOf("await findWhatsAppProviderEventBinding(session, message)");
  const leadResolution = handle.indexOf("lead = await ensureLead(");
  const ingressLog = handle.indexOf("await logInbound(", historicalReplay);
  assert.ok(historicalReplay > 0 && mediaRecovery > historicalReplay && completed > mediaRecovery);
  assert.ok(completed < providerBindingLookup && providerBindingLookup < leadResolution && leadResolution < ingressLog);
  assert.match(handle.slice(historicalReplay, providerBindingLookup), /if \(optionalUuid\(recordedConversation\.lead_id\)\)[\s\S]*?processed \+= 1;\s*continue;/);
  assert.match(transport, /await findMessageByProviderIdentity\([\s\S]*?existing\.id !== expectedMessage\.id/);
  assert.match(transport, /optionalUuid\(existing\.conversation_id\) !== optionalUuid\(expectedMessage\.conversation_id\)/);
  assert.match(transport, /optionalUuid\(existing\.lead_id\) !== optionalUuid\(expectedMessage\.lead_id\)/);
  assert.match(transport, /\.eq\("conversation_id", existing\.conversation_id\)[\s\S]*?\.eq\("from_me", false\)/);
  assert.match(transport, /updateQuery\.is\("lead_id", null\)/);
  assert.match(transport, /media_status: "pending"[\s\S]*?return false;/);
  assert.match(handle.slice(historicalReplay, providerBindingLookup), /if \(!mediaReady\) \{\s*throw new Error\("whatsapp_recorded_prelead_media_pending"\);\s*\}[\s\S]*?await completeStoredMessageEffects/);
});

test("new recorded media keeps its delivery retryable until Storage is ready", () => {
  const handleStart = source.indexOf("async function handleMessages(");
  const handleEnd = source.indexOf("function statusFromProvider(", handleStart);
  const handle = source.slice(handleStart, handleEnd);
  const finalMediaGuard = handle.lastIndexOf('persistedWhatsAppMessageCaptureState(result.message) === "recorded"');
  const completedLedger = handle.lastIndexOf("await completeStoredMessageEffects(");
  const completedDelivery = handle.lastIndexOf("await completeEvolutionMessageDelivery(");
  assert.ok(finalMediaGuard > 0 && finalMediaGuard < completedLedger && completedLedger < completedDelivery);
  assert.match(handle.slice(finalMediaGuard, completedLedger), /result\.message\.media_status !== "ready" \|\| !normalizeText\(result\.message\.media_storage_path\)\.trim\(\)/);
  assert.match(handle.slice(finalMediaGuard, completedLedger), /throw new Error\("whatsapp_recorded_media_pending"\)/);
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
  const inbox = resolver.indexOf("const { data: inbox");
  const bootstrap = resolver.indexOf('"auto_enter_whatsapp_ctwa_attendance"');
  const attendance = resolver.indexOf('const attendanceScope = () => supabase');
  assert.ok(persisted > 0 && persisted < binding && binding < inbox && inbox < bootstrap && bootstrap < attendance);
  assert.match(resolver, /initialProviderEventId === `\$\{session\.id\}:\$\{message\.messageId\}`/);
  assert.match(resolver, /isConfirmedClickToWhatsAppAd\(message\)/);
  assert.match(resolver, /!message\.fromMe[\s\S]*?!message\.isGroup[\s\S]*?!message\.providerMessageIdSynthetic/);
  assert.match(resolver, /ingress\.contextKind === "contextual_intake"/);
  assert.match(resolver, /p_binding_id: bindingId/);
  assert.match(resolver, /p_ingress_sequence: ingress\.ingressSequence/);
  assert.match(resolver, /p_provider_occurred_at: providerOccurredAt/);
});

test("manual capture retains its cutoff and auto capture uses first-event provenance", () => {
  const start = source.indexOf("async function resolveWhatsAppAttendanceCapture(");
  const end = source.indexOf("async function findStoredMessage(", start);
  const resolver = source.slice(start, end);
  assert.match(resolver, /\.in\("entry_source", \["manual", "implicit"\]\)[\s\S]*?\.lte\("joined_at", inboxCreatedAt\)[\s\S]*?\.lte\("joined_at", providerOccurredAt\)[\s\S]*?\.lt\("ingress_sequence_cutoff", ingress\.ingressSequence\)/);
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
  assert.match(resolver, /: "current_session_owner_inactive_or_missing"/);
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
