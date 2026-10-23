import assert from "node:assert/strict";
import { test } from "node:test";
import { filterQuickReplies, getQuickReplyTrigger, insertQuickReply, insertQuickReplyAtSelection,
  suggestQuickReplyShortcut } from "@/lib/whatsapp-quick-reply-input";

test("slash suggestions track the caret at a word boundary without treating URLs as commands", () => {
  assert.deepEqual(getQuickReplyTrigger("Olá /ABE depois", 8), { start: 4, end: 8, query: "ABE" });
  assert.deepEqual(getQuickReplyTrigger("/", 1), { start: 0, end: 1, query: "" });
  assert.deepEqual(getQuickReplyTrigger("Oi\n/ação", 8), { start: 3, end: 8, query: "ação" });
  for (const value of ["https://abc", "https://site/aba", "texto/aba", "/ab!", "\\/aba"]) {
    assert.equal(getQuickReplyTrigger(value, value.length), null);
  }
  assert.equal(getQuickReplyTrigger("/aba", -1), null);
  assert.equal(getQuickReplyTrigger("/aba", 9), null);
});

test("A, AB, ABA and ABE progressively filter shortcut and phrase prefixes without mutating saved replies", () => {
  const items = [{ shortcut: "aba", content: "Abatido o valor." }, { shortcut: "abe", content: "Aberto para visita." },
    { shortcut: "oi", content: "Abraço!" }, { shortcut: "visita", content: "Vamos agendar?" }];
  const before = structuredClone(items);
  assert.deepEqual(filterQuickReplies(items, "A").map(x => x.shortcut), ["aba", "abe", "oi"]);
  assert.deepEqual(filterQuickReplies(items, "AB").map(x => x.shortcut), ["aba", "abe", "oi"]);
  assert.deepEqual(filterQuickReplies(items, "ABA").map(x => x.shortcut), ["aba"]);
  assert.deepEqual(filterQuickReplies(items, "ABE").map(x => x.shortcut), ["abe"]);
  assert.equal(filterQuickReplies(items, "inexistente").length, 0);
  assert.deepEqual(items, before);
  assert.equal(filterQuickReplies([{ shortcut: "acao", content: "Ação" }], "ação").length, 1);
});

test("insertion replaces only the slash token, retaining suffix, multiline and literal template characters", () => {
  const value = "Olá 👋 /abe depois";
  const caret = value.indexOf(" depois");
  const trigger = getQuickReplyTrigger(value, caret)!;
  assert.deepEqual(insertQuickReply(value, trigger, "Aberto\n{nome} $&"), {
    value: "Olá 👋 Aberto\n{nome} $& depois", caret: "Olá 👋 Aberto\n{nome} $&".length,
  });
  assert.equal(insertQuickReply("Oi /outro", trigger, "NÃO").value, "Oi /outro");
  assert.equal(insertQuickReply("texto/abe", { start: 5, end: 9, query: "abe" }, "NÃO").value, "texto/abe");
});

test("manager insertion uses the selection and multiple replies can be composed without sending", () => {
  assert.deepEqual(insertQuickReplyAtSelection("Olá nome!", 4, 8, "Marina"), { value: "Olá Marina!", caret: 10 });
  assert.equal(insertQuickReplyAtSelection("preservar", 8, 2, "NÃO").value, "preservar");
  const first = insertQuickReply("/oi", getQuickReplyTrigger("/oi", 3)!, "Olá!");
  const secondDraft = `${first.value}\n/visita`;
  assert.equal(insertQuickReply(secondDraft, getQuickReplyTrigger(secondDraft, secondDraft.length)!, "Vamos agendar?").value,
    "Olá!\nVamos agendar?");
});

test("save shortcut suggestion is bounded and ASCII while message content remains untouched", () => {
  assert.equal(suggestQuickReplyShortcut("  Olá, tudo bem?"), "ola");
  assert.equal(suggestQuickReplyShortcut("👋 Árvore nova"), "arvore");
  assert.equal(suggestQuickReplyShortcut("\n!!!"), "mensagem");
  assert.equal(suggestQuickReplyShortcut("a".repeat(80)).length, 40);
});
