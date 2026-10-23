import assert from "node:assert/strict";
import test from "node:test";
import { getMessageAuthorPresentation } from "@/components/features/whatsapp/message-bubble/message-author-model";

const viewer = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";

test("personal-account sender is the viewer only when persisted CRM author ID matches", () => {
  assert.deepEqual(getMessageAuthorPresentation({ fromMe: true, senderName: "Ana", senderUserId: viewer, viewerUserId: viewer }), {
    directionLabel: "Enviada", senderLabel: "Ana (você)", bubbleSenderLabel: "Ana (você)", isViewerAuthor: true,
  });
});
test("another broker on a shared account keeps the registered sender without viewer attribution", () => {
  assert.deepEqual(getMessageAuthorPresentation({ fromMe: true, senderName: "Bruno", senderUserId: other, viewerUserId: viewer }), {
    directionLabel: "Enviada", senderLabel: "Bruno", bubbleSenderLabel: "Bruno", isViewerAuthor: false,
  });
});
test("matching display names never identify the viewer when author IDs differ", () => {
  const presentation = getMessageAuthorPresentation({ fromMe: true, senderName: "Ana", senderUserId: other, viewerUserId: viewer });
  assert.equal(presentation.senderLabel, "Ana"); assert.equal(presentation.isViewerAuthor, false);
});
test("historical sender name is preserved without author ID and never proves the viewer", () => {
  const presentation = getMessageAuthorPresentation({ fromMe: true, senderName: "Ana", viewerUserId: viewer });
  assert.equal(presentation.senderLabel, "Ana"); assert.equal(presentation.isViewerAuthor, false);
});
test("manual device or missing author remains account-side with honest unavailable identity", () => {
  for (const senderName of [null, undefined, "", " ", "Você", "Voce", "You"]) {
    const presentation = getMessageAuthorPresentation({ fromMe: true, senderName, viewerUserId: viewer });
    assert.equal(presentation.senderLabel, "Autor não identificado");
    assert.equal(presentation.bubbleSenderLabel, "Conta do WhatsApp"); assert.equal(presentation.isViewerAuthor, false);
  }
});
test("a literal Você name of another identified broker never becomes the viewer", () => {
  assert.equal(getMessageAuthorPresentation({ fromMe: true, senderName: "Você", senderUserId: other, viewerUserId: viewer }).senderLabel, "Outro usuário do CRM");
});
test("known author without a viewer identity is a CRM user without a relative attribution", () => {
  assert.equal(getMessageAuthorPresentation({ fromMe: true, senderUserId: other }).senderLabel, "Usuário do CRM");
});
test("received sender is not the viewer even if inconsistent IDs match", () => {
  const presentation = getMessageAuthorPresentation({ fromMe: false, senderName: "Bruno", senderUserId: viewer, viewerUserId: viewer });
  assert.equal(presentation.directionLabel, "Recebida"); assert.equal(presentation.senderLabel, "Bruno"); assert.equal(presentation.isViewerAuthor, false);
});
test("null, blank or malformed equal IDs never establish viewer authorship", () => {
  for (const id of [null, undefined, "", " ", "viewer", "00000000-0000-0000-0000-000000000000"]) {
    assert.equal(getMessageAuthorPresentation({ fromMe: true, senderName: "Ana", senderUserId: id, viewerUserId: id }).isViewerAuthor, false);
  }
});
test("viewer changes recompute attribution while historical message author stays the same", () => {
  const message = { fromMe: true, senderName: "Bruno", senderUserId: other };
  assert.equal(getMessageAuthorPresentation({ ...message, viewerUserId: viewer }).senderLabel, "Bruno");
  assert.equal(getMessageAuthorPresentation({ ...message, viewerUserId: other }).senderLabel, "Bruno (você)");
});
test("received unknown or legacy relative names remain contact fallback", () => {
  for (const name of [null, "", "Você"]) assert.equal(getMessageAuthorPresentation({ fromMe: false, senderName: name }).senderLabel, "Contato");
});
test("registered author names remain text and are bounded for bubble and details presentation", () => {
  const name = '<img src=x onerror="window.injected=true">';
  assert.equal(getMessageAuthorPresentation({ fromMe: true, senderName: name }).senderLabel, name);
  assert.equal(getMessageAuthorPresentation({ fromMe: true, senderName: "A".repeat(500) }).senderLabel.length, 160);
});
