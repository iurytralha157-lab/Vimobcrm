import assert from "node:assert/strict";
import test from "node:test";

import type {
  ScreenConversation,
} from "./conversation-model";

const searchTextModulePath = "../../../../lib/search-text.ts";
const conversationModelModulePath = "./conversation-model.ts";
const { normalizeSearchText } = await import(searchTextModulePath);
const {
  filterWhatsAppConversations,
  formatConversationPreview,
  matchesConversationSearch,
  toScreenConversation,
} = await import(conversationModelModulePath);

const conversation = (overrides: Partial<ScreenConversation> = {}): ScreenConversation => ({
  id: "conversation-1",
  session_id: "session-1",
  lead_id: null,
  remote_jid: "5511999998888@s.whatsapp.net",
  contact_name: "João da Silva",
  contact_phone: "+55 (11) 99999-8888",
  contact_picture: null,
  contact_presence: null,
  presence_updated_at: null,
  last_message: "Quero visitar o imóvel",
  last_message_at: "2026-09-06T12:00:00.000Z",
  unread_count: 0,
  is_group: false,
  archived_at: null,
  deleted_at: null,
  created_at: "2026-09-06T11:00:00.000Z",
  updated_at: "2026-09-06T12:00:00.000Z",
  ...overrides,
});

test("busca conversa por texto normalizado e por dígitos", () => {
  const source = conversation();

  assert.equal(matchesConversationSearch(source, "joao", normalizeSearchText), true);
  assert.equal(matchesConversationSearch(source, "999998888", normalizeSearchText), true);
  assert.equal(matchesConversationSearch(source, "aluguel", normalizeSearchText), false);
  assert.equal(matchesConversationSearch(source, "   ", normalizeSearchText), true);
});

test("combina filtros de lead e resposta pendente sem mutar a origem", () => {
  const withoutLead = conversation({ id: "without-lead", unread_count: 2 });
  const withLead = conversation({
    id: "with-lead",
    lead_id: "lead-1",
    lead: { id: "lead-1", name: "Maria" },
    unread_count: 1,
  });
  const answeredLead = conversation({
    id: "answered-lead",
    lead_id: "lead-2",
    lead: { id: "lead-2", name: "Pedro" },
  });
  const source = [withoutLead, withLead, answeredLead];

  assert.deepEqual(
    filterWhatsAppConversations(source, {
      onlyLeads: true,
      withoutLeadOnly: false,
      pendingReplyOnly: true,
    }).map((item: ScreenConversation) => item.id),
    ["with-lead"],
  );
  assert.deepEqual(source.map(({ id }) => id), ["without-lead", "with-lead", "answered-lead"]);
});

test("adapta conversa Meta ao contrato visual da lista", () => {
  const adapted = toScreenConversation({
    id: "meta-1",
    organization_id: "org-1",
    lead_id: "lead-1",
    external_id: "recipient-1",
    platform: "instagram",
    contact_name: "Contato Instagram",
    contact_picture: "https://example.com/avatar.jpg",
    last_message: "Olá",
    last_message_at: "2026-09-06T12:00:00.000Z",
    unread_count: 3,
    is_archived: true,
    created_at: "2026-09-06T11:00:00.000Z",
    updated_at: "2026-09-06T12:00:00.000Z",
    lead: { id: "lead-1", name: "Lead Instagram" },
  });

  assert.equal(adapted.remote_jid, "recipient-1");
  assert.equal(adapted.platform, "instagram");
  assert.equal(adapted.archived_at, "2026-09-06T12:00:00.000Z");
  assert.equal(adapted.lead?.name, "Lead Instagram");
});

test("apresenta nomes de mídia sem expor o nome técnico na prévia", () => {
  assert.equal(formatConversationPreview(null), "Sem mensagens");
  assert.equal(formatConversationPreview("fachada.jpeg"), "Foto");
  assert.equal(formatConversationPreview("tour.mp4"), "Vídeo");
  assert.equal(formatConversationPreview("audio.opus"), "Áudio");
  assert.equal(formatConversationPreview("proposta.pdf"), "Documento");
  assert.equal(formatConversationPreview("Podemos conversar?"), "Podemos conversar?");
}
);
