import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { whatsappCTWAConfirmationMethod } from "../_shared/whatsapp-ctwa.ts";
import { isEncryptedWhatsAppMediaURL } from "./media-security.ts";
import * as structuredContent from "./structured-content.ts";
import { guardStoredContactIdentity, isStoredContactPNConflict } from "./stored-contact-identity.ts";

// Execute the production parser and its local helpers, without loading Deno's
// server, environment, privileged Supabase client or any network operation.
const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true);
const functions = parsed.statements.filter(ts.isFunctionDeclaration).map((node) => node.getText(parsed));
const compiled = ts.transpileModule(functions.join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const context = vm.createContext({
  ...structuredContent,
  whatsappCTWAConfirmationMethod,
  isEncryptedWhatsAppMediaURL,
  guardStoredContactIdentity,
  isStoredContactPNConflict,
  TextEncoder,
});
vm.runInContext(compiled, context);
const normalizeMessage = context.normalizeMessage;

test('contradictory contact PNs are quarantined before any Edge lookup or write', async () => {
  const conflict = {
    Info: { ID: 'conflicting-pn', Chat: '5511988881111@s.whatsapp.net', SenderPN: '5511977772222@s.whatsapp.net' },
    Message: { conversation: 'must-not-reach-lead-B' },
  };
  const identity = context.whatsappIdentityForMessage(normalizeMessage(conflict));
  assert.equal(identity.pnConflict, true);
  assert.equal(identity.remoteAliases.includes('5511977772222@s.whatsapp.net'), false);
  let calls = 0;
  context.findStoredMessage = async () => { calls++; throw new Error('unexpected_database_boundary'); };
  const result = await context.handleMessages({ id: 'fixture-session', organization_id: 'fixture-org' },
    { event: 'message', data: conflict }, 'message', { contract: 'internal_worker_lease' }, null);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { processed: 0, duplicates: 0, inProgress: 0, quarantined: 1 });
  assert.equal(calls, 0);
});

test('contact PN barrier preserves LID mapping, BR variants, and outbound owner identity', () => {
  for (const info of [
    { Chat: '123456789@lid', SenderPN: '5511988881111@s.whatsapp.net' },
    { Chat: '5511988881111@s.whatsapp.net', SenderPN: '551188881111@c.us' },
    { Chat: '5511988881111@s.whatsapp.net', RecipientPN: '5511988881111@s.whatsapp.net', SenderPN: '5511977772222@s.whatsapp.net', IsFromMe: true },
  ]) {
    const identity = context.whatsappIdentityForMessage(normalizeMessage({ Info: { ID: 'valid-pn', ...info }, Message: { conversation: 'valid' } }));
    assert.equal(identity.pnConflict, false);
  }
  const international = normalizeMessage({ Info: { ID: 'international', Chat: '14155552671@s.whatsapp.net', SenderPN: '14155552671@s.whatsapp.net' }, phone: '14155552671', Message: { conversation: 'valid country' } });
  const identity = context.whatsappIdentityForMessage(international);
  assert.equal(identity.pnConflict, false);
  assert.equal(identity.remoteJid, '14155552671@s.whatsapp.net');
  assert.equal(context.phoneMatchVariantsForWhatsApp('14155552671', '14155552671@s.whatsapp.net').includes('5514155552671'), false);
});

test('a contradictory PN sibling does not block the valid Edge batch part', async () => {
  const conflict = { Info: { ID: 'conflict-batch', Chat: '5511988881111@s.whatsapp.net', SenderPN: '5511977772222@s.whatsapp.net' }, Message: { conversation: 'quarantine' } };
  const valid = fixture({ conversation: 'valid sibling' });
  valid.Info.ID = 'valid-sibling';
  const reached = [];
  context.findStoredMessage = async (_session, message) => {
    reached.push(message.messageId);
    throw new Error('fixture_valid_database_boundary');
  };
  await assert.rejects(context.handleMessages(session, batch([conflict, valid], [route(valid.Info.ID, 1)]),
    'message', authorization, null), /fixture_valid_database_boundary/);
  assert.deepEqual(reached, [valid.Info.ID]);
});

test('selected-route PN quarantine trusts only fenced canonical RPC IDs and preserves the valid sibling', async () => {
  const selected = fixture({ conversation: 'quarantined selected route' });
  selected.Info.ID = 'selected-conflict';
  const valid = fixture({ conversation: 'valid selected sibling' });
  valid.Info.ID = 'selected-valid';
  const payload = batch([selected, valid], [route(valid.Info.ID, 1)]);
  payload.__vimob_ingress.identity_quarantine_reason = 'whatsapp_contact_pn_route_conflict';
  payload.__vimob_ingress.identity_quarantined_provider_message_ids = [selected.Info.ID];
  const fence = { inboxId: 'canonical-inbox', executionId: 'active-execution' };
  let calls = 0;
  context.supabase = { rpc: async () => { calls++; return { data: null, error: null }; } };
  for (const [auth, scope] of [[{ contract: 'dedicated_secret' }, fence], [authorization, null]]) {
    await assert.rejects(context.loadTrustedPNRouteQuarantineIDs(session, payload, auth, scope), /quarantine_untrusted/);
  }
  assert.equal(calls, 0);
  await assert.rejects(context.loadTrustedPNRouteQuarantineIDs(session, payload, authorization, fence), /quarantine_untrusted/);
  context.supabase.rpc = async () => ({ data: [valid.Info.ID], error: null });
  await assert.rejects(context.loadTrustedPNRouteQuarantineIDs(session, payload, authorization, fence), /quarantine_untrusted/);
  context.supabase.rpc = async () => ({ data: [selected.Info.ID], error: null });
  const trusted = await context.loadTrustedPNRouteQuarantineIDs(session, payload, authorization, fence);
  const reached = [];
  context.findStoredMessage = async (_session, message) => {
    reached.push(message.messageId);
    throw new Error('fixture_selected_valid_boundary');
  };
  await assert.rejects(context.handleMessages(session, payload, 'message', authorization, fence.executionId, trusted), /fixture_selected_valid_boundary/);
  assert.deepEqual(reached, [valid.Info.ID]);
});

test('late persisted PN conflict records only fenced technical evidence and reaches its valid sibling', async () => {
  const rejected = fixture({ conversation: 'late identity conflict' });
  rejected.Info.ID = 'late-conflict';
  const valid = fixture({ conversation: 'valid late sibling' });
  valid.Info.ID = 'late-valid';
  const payload = batch([rejected, valid], [route(rejected.Info.ID, 1), route(valid.Info.ID, 2)]);
  const fence = { inboxId: 'canonical-inbox', executionId: 'active-execution' };
  const reached = [];
  const calls = [];
  context.findStoredMessage = async (_session, message) => {
    reached.push(message.messageId);
    if (message.messageId === rejected.Info.ID) throw { code: '23514', message: 'whatsapp_contact_pn_conflict' };
    throw new Error('fixture_valid_late_boundary');
  };
  context.supabase = { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: true, error: null };
  } };
  await assert.rejects(context.handleMessages(session, payload, 'message', authorization, fence.executionId), /quarantine_untrusted/);
  assert.equal(calls.length, 0);
  reached.length = 0;
  await assert.rejects(context.handleMessages(session, payload, 'message', authorization, fence.executionId, [], fence), /fixture_valid_late_boundary/);
  assert.deepEqual(reached, [rejected.Info.ID, valid.Info.ID]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'record_whatsapp_webhook_contact_pn_quarantine');
  assert.equal(calls[0].args.p_provider_message_id, rejected.Info.ID);
  assert.equal(calls[0].args.p_inbox_id, fence.inboxId);
  assert.equal(calls[0].args.p_execution_id, fence.executionId);
  assert.equal(calls[0].args.p_organization_id, session.organization_id);
  assert.equal(calls[0].args.p_session_id, session.id);
});

test('Edge presentation uses the native metadata whitelist and never imports quote body or raw vCard', () => {
  const message = normalizeMessage(fixture({
    documentMessage: { fileName: '../../Proposta.pdf', contextInfo: { stanzaId: 'target-captured', quotedMessage: { conversation: 'before-attendance-private' } } },
    contactMessage: { displayName: 'Portaria', vcard: 'BEGIN:VCARD\nTEL;TYPE=CELL:+55 (11) 9999-9999\nEMAIL:private@example.test\nNOTE:secret\nEND:VCARD' },
    locationMessage: { degreesLatitude: -23.5, degreesLongitude: -46.6, name: 'Visita' },
  }));
  assert.deepEqual(JSON.parse(JSON.stringify(message.presentationMetadata)), {
    media_filename: 'Proposta.pdf',
    message_contacts: [{ display_name: 'Portaria', phones: ['+551199999999'] }],
    message_location: { latitude: -23.5, longitude: -46.6, name: 'Visita' },
    quoted_message_id: 'target-captured',
  });
  assert.equal(JSON.stringify(message.presentationMetadata).includes('secret'), false);
  assert.equal(JSON.stringify(message.presentationMetadata).includes('before-attendance'), false);
  const invalid = normalizeMessage(fixture({ locationMessage: { degreesLatitude: 91, degreesLongitude: 0 }, extendedTextMessage: { text: 'hi', contextInfo: { stanzaId: 'x'.repeat(201) } } }));
  assert.deepEqual(JSON.parse(JSON.stringify(invalid.presentationMetadata)), {});
});

const remoteJid = "5511999991234@s.whatsapp.net";
const fixture = (node) => ({
  Info: { ID: "structured-runtime", Chat: remoteJid, Sender: remoteJid, Timestamp: "2026-10-11T12:00:00Z" },
  Message: node,
});
const control = () => fixture({
  secretEncryptedMessage: {
    secretEncType: 2, encPayload: "c3ludGhldGlj", encIV: "Zml4dHVyZQ==",
    targetMessageKey: { ID: "original-runtime", remoteJid },
  },
  messageContextInfo: { messageSecret: "synthetic-context" },
});

test("production Edge parser preserves structured customer content and avoids invented media", () => {
  const cases = [
    [{ contactMessage: { displayName: "Visita", vcard: "private vcard" } }, "Contato compartilhado: Visita"],
    [{ contactsArrayMessage: { contacts: [{ vcard: "private" }] } }, "Contatos compartilhados"],
    [{ locationMessage: { name: "Portaria", degreesLongitude: -46 } }, "Portaria"],
    [{ liveLocationMessage: { caption: "Encontro", degreesLatitude: -23 } }, "Encontro"],
    [{ LiveLocationMessage: { Caption: "Ponto da visita" } }, "Ponto da visita"],
    [{ albumMessage: { expectedImageCount: 2 } }, "Álbum de fotos ou vídeos"],
    [{ interactiveMessage: { body: { text: "Escolha o horário" }, header: { imageMessage: { url: "synthetic" } } } }, "Escolha o horário"],
    [{ interactiveResponseMessage: { body: { text: "Amanhã" } } }, "Amanhã"],
    [{ templateMessage: { hydratedTemplate: { hydratedContentText: "Confirmado" } } }, "Confirmado"],
    [{ TemplateMessage: { HydratedFourRowTemplate: { HydratedContentText: "Confirmado" } } }, "Confirmado"],
    [{ buttonsResponseMessage: { selectedDisplayText: "Manhã" } }, "Manhã"],
    [{ templateButtonReplyMessage: { selectedID: "horario-2" } }, "horario-2"],
  ];
  for (const [node, expected] of cases) {
    const message = normalizeMessage(fixture(node));
    assert.equal(message?.content, expected);
    assert.equal(message?.messageType, "text");
    assert.equal(message?.remoteJid, remoteJid);
    assert.equal(message?.mediaUrl, null);
    assert.equal(message?.mediaBase64, null);
    assert.equal(message?.isEncryptedEditControl, false);
  }
});

test("production Edge parser never ignores mixed outer text or promoted media", () => {
  assert.equal(normalizeMessage(control())?.isEncryptedEditControl, true);
  const text = { ...control(), text: "resposta real fora do Message" };
  assert.equal(normalizeMessage(text)?.content, text.text);
  assert.equal(normalizeMessage(text)?.isEncryptedEditControl, false);
  for (const fields of [
    { mediaType: "image", mediaUrl: "https://synthetic.invalid/plain-image" },
    { base64: "c3ludGhldGljLW1lZGlh" },
    { text: { unknownFormat: "resposta real" } },
    { file: { unknownFormat: "synthetic-media" } },
    { buttonId: "opaque-customer-answer" },
  ]) {
    assert.equal(normalizeMessage({ ...control(), ...fields })?.isEncryptedEditControl, false);
  }
});

const session = {
  id: "af000000-0000-4000-8000-000000000001",
  organization_id: "af000000-0000-4000-8000-000000000002",
};
const authorization = { contract: "internal_worker_lease" };
const route = (id, sequence) => ({
  version: 1, organization_id: session.organization_id, session_id: session.id,
  provider_message_id: id, state: "unlinked", context_kind: "organic", inbox_event_key: "batch-fixture",
  processing_lane: "live", routing_key: `phone:${remoteJid.split("@")[0]}`, binding_eligible: true,
  managed_message_distribution: false, managed_event_pending: false, managed_event_handled: false,
  target_mode: "snapshot", ingress_sequence: sequence,
});
const batch = (messages, routes) => ({
  event: "message", data: { messages },
  __vimob_ingress: { routing_snapshot: { version: 1, messages: routes } },
});

test("production Edge handler keeps uncaptured controls out of real-message batch ordering", async () => {
  const first = fixture({ conversation: "primeira resposta" });
  first.Info.ID = "real-first";
  const second = fixture({ conversation: "segunda resposta" });
  second.Info.ID = "real-second";
  const edit = control();
  edit.Info.ID = "edit-batch";
  const reachedMessages = [];
  context.findStoredMessage = async (_session, message) => {
    reachedMessages.push(message.messageId);
    throw new Error("fixture_stop_before_database");
  };
  await assert.rejects(context.handleMessages(session, batch([second, edit, first], [
    route(first.Info.ID, 1), route(second.Info.ID, 2),
  ]), "message", authorization, null), /fixture_stop_before_database/);
  assert.deepEqual(reachedMessages, [first.Info.ID]);
});

test("production Edge handler stops a retained eligible or unknown control before any real-message effect", async () => {
  const business = fixture({ conversation: "resposta real" });
  business.Info.ID = "real-with-retained-edit";
  const edit = control();
  edit.Info.ID = "retained-edit";
  for (const eligibility of [true, undefined, "false", 0]) {
    let databaseBoundaryCalls = 0;
    context.findStoredMessage = async () => {
      databaseBoundaryCalls += 1;
      throw new Error("fixture_stop_before_database");
    };
    await assert.rejects(context.handleMessages(session, batch([business, edit], [
      route(business.Info.ID, 1), { ...route(edit.Info.ID, 2), binding_eligible: eligibility },
    ]), "message", authorization, null), /whatsapp_encrypted_edit_requires_explicit_recovery/);
    assert.equal(databaseBoundaryCalls, 0);
  }
});
