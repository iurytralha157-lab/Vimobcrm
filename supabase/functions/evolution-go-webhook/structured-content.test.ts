import assert from "node:assert/strict";
import test from "node:test";
import { encryptedEditHasFrozenCaptureRoute, isEncryptedMessageEditControl, structuredMessageContent, structuredMessagePresentation } from "./structured-content.ts";

test("structured messages keep text representation without media, vCard or action payloads", () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ contactMessage: { displayName: "Contato da visita", vcard: "private contact data" } }, "Contato compartilhado: Contato da visita"],
    [{ contactMessage: { vcard: "private contact data" } }, "Contato compartilhado"],
    [{ contactsArrayMessage: { contacts: [{ vcard: "private" }] } }, "Contatos compartilhados"],
    [{ albumMessage: { expectedImageCount: 2 } }, "Álbum de fotos ou vídeos"],
    [{ liveLocationMessage: { degreesLatitude: -23 } }, "Localização em tempo real compartilhada"],
    [{ LiveLocationMessage: { Caption: "Ponto da visita" } }, "Ponto da visita"],
    [{ locationMessage: { name: "Portaria", degreesLongitude: -46 } }, "Portaria"],
    [{ interactiveMessage: { body: { text: "Escolha o horário" } } }, "Escolha o horário"],
    [{ interactiveMessage: { nativeFlowMessage: { buttons: [] } } }, "Mensagem interativa recebida. Abra o WhatsApp para interagir."],
    [{ templateMessage: { hydratedTemplate: { hydratedContentText: "Visita confirmada" } } }, "Visita confirmada"],
    [{ TemplateMessage: { HydratedFourRowTemplate: { HydratedContentText: "Confirmação" } } }, "Confirmação"],
    [{ buttonsResponseMessage: { selectedDisplayText: "Amanhã" } }, "Amanhã"],
    [{ templateButtonReplyMessage: { selectedID: "horario-2" } }, "horario-2"],
  ];
  for (const [node, expected] of cases) assert.equal(structuredMessageContent(node), expected);
  for (const node of [{ unknownFutureMessage: { body: "unknown" } }, { contactMessage: {} }, { secretEncryptedMessage: { encPayload: "ciphertext" } }]) {
    assert.equal(structuredMessageContent(node), "");
  }
});

const remoteJid = "5511999991234@s.whatsapp.net";
const options = { providerIdSynthetic: false, hasCampaignSignal: false, remoteJid };
const control = () => ({ secretEncryptedMessage: { secretEncType: 2, encPayload: "c3ludGhldGlj", encIV: "Zml4dHVyZQ==", targetMessageKey: { ID: "original-fixture", remoteJid } }, messageContextInfo: { messageSecret: "fixture-context" } });

test("only the exact undecrypted message-edit envelope can be a technical control", () => {
  assert.equal(isEncryptedMessageEditControl(control(), options), true);
  for (const field of ["secretEncType", "encPayload", "encIV", "targetMessageKey"]) {
    const node: Record<string, unknown> = structuredClone(control());
    delete (node.secretEncryptedMessage as Record<string, unknown>)[field];
    assert.equal(isEncryptedMessageEditControl(node, options), false, field);
  }
  for (const subtype of [0, 1, 2.1, 3, 4, "POLL_EDIT", "future"]) {
    const node = control();
    assert.equal(isEncryptedMessageEditControl({ ...node, secretEncryptedMessage: { ...node.secretEncryptedMessage, secretEncType: subtype } }, options), false);
  }
  assert.equal(isEncryptedMessageEditControl({ ...control(), conversation: "real reply" }, options), false);
  assert.equal(isEncryptedMessageEditControl({ ...control(), imageMessage: { url: "synthetic" } }, options), false);
  assert.equal(isEncryptedMessageEditControl(control(), { ...options, providerIdSynthetic: true }), false);
  assert.equal(isEncryptedMessageEditControl(control(), { ...options, hasCampaignSignal: true }), false);
  assert.equal(isEncryptedMessageEditControl(control(), { ...options, unsupportedIdentity: true }), false);
  assert.equal(isEncryptedMessageEditControl(control(), { ...options, hasCustomerContent: true }), false);
  const malformedTarget = control();
  assert.equal(isEncryptedMessageEditControl({
    ...malformedTarget,
    secretEncryptedMessage: { ...malformedTarget.secretEncryptedMessage, targetMessageKey: { ID: "original-fixture", remoteJid: { unknown: true } } },
  }, options), false);
  assert.equal(isEncryptedMessageEditControl(control(), { ...options, remoteJid: "5511777777777@s.whatsapp.net" }), false);
});

test("a retained eligible or unknown routing snapshot requires explicit recovery", () => {
  const payload = (route: Record<string, unknown>) => ({ __vimob_ingress: { routing_snapshot: { version: 1, messages: [route] } } });
  assert.equal(encryptedEditHasFrozenCaptureRoute(payload({ provider_message_id: "edit", binding_eligible: true }), "edit"), true);
  assert.equal(encryptedEditHasFrozenCaptureRoute(payload({ provider_message_id: "edit" }), "edit"), true);
  assert.equal(encryptedEditHasFrozenCaptureRoute(payload({ provider_message_id: "edit", binding_eligible: false }), "edit"), false);
  for (const eligibility of ["false", 0, null, { unknown: true }]) {
    assert.equal(encryptedEditHasFrozenCaptureRoute(payload({ provider_message_id: "edit", binding_eligible: eligibility }), "edit"), true);
  }
  assert.equal(encryptedEditHasFrozenCaptureRoute({ __vimob_ingress: { routing_snapshot: { messages: [
    { provider_message_id: "edit", binding_eligible: false }, { provider_message_id: "edit", binding_eligible: true },
  ] } } }, "edit"), true);
  assert.equal(encryptedEditHasFrozenCaptureRoute(payload({ provider_message_id: "other", binding_eligible: true }), "edit"), false);
  assert.equal(encryptedEditHasFrozenCaptureRoute({}, "edit"), false);
});

test("current reply context survives text, audio, image and supported structured message kinds", () => {
  for (const kind of ["extendedTextMessage", "ExtendedTextMessage", "imageMessage", "ImageMessage", "audioMessage", "AudioMessage", "documentMessage", "DocumentMessage", "contactMessage", "ContactMessage", "contactsArrayMessage", "ContactsArrayMessage", "locationMessage", "LocationMessage", "liveLocationMessage", "LiveLocationMessage", "interactiveMessage", "InteractiveMessage", "interactiveResponseMessage", "InteractiveResponseMessage", "buttonsResponseMessage", "ButtonsResponseMessage", "templateButtonReplyMessage", "TemplateButtonReplyMessage", "albumMessage", "AlbumMessage", "templateMessage", "TemplateMessage"]) {
    const metadata = structuredMessagePresentation({ [kind]: { contextInfo: {
      stanzaId: "synthetic-parent", participant: "forged-participant", quotedMessage: { conversation: "private-inline-body" },
    } } }, {}, {});
    assert.equal(metadata.quoted_message_id, "synthetic-parent", kind);
    assert.equal(JSON.stringify(metadata).includes("private-inline-body"), false);
    assert.equal(JSON.stringify(metadata).includes("forged-participant"), false);
  }
});

test("reply extraction accepts current aliases and rejects controls, excessive IDs or nested historical quotes", () => {
  assert.equal(structuredMessagePresentation({}, { context_info: { StanzaID: "current-raw" } }, {}).quoted_message_id, "current-raw");
  for (const stanzaId of ["bad\u0000-parent", "x".repeat(201), "é".repeat(101)]) {
    assert.equal(structuredMessagePresentation({ extendedTextMessage: { contextInfo: { stanzaId } } }, {}, {}).quoted_message_id, undefined);
  }
  assert.equal(structuredMessagePresentation({ extendedTextMessage: { contextInfo: {
    quotedMessage: { extendedTextMessage: { contextInfo: { stanzaId: "historical-parent" } } },
  } } }, {}, {}).quoted_message_id, undefined);
});

test("reply reference accepts the actual whatsmeow protobuf JSON stanzaID spelling", () => {
  for (const kind of ["extendedTextMessage", "imageMessage", "audioMessage"]) {
    assert.equal(structuredMessagePresentation({ [kind]: { contextInfo: { stanzaID: "wire-parent" } } }, {}, {}).quoted_message_id, "wire-parent", kind);
  }
});
