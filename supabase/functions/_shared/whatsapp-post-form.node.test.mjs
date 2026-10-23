import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isWhatsAppPostFormFollowUp } from "./whatsapp-post-form.ts";

const portuguesePrefix =
  "Olá! Preenchi seu formulário e gostaria de saber mais sobre sua empresa.";
const englishPrefix =
  "Hi! I filled out your form and would like to learn more about your business.";
const englishFields = "Phone number: +5500000000000\nFull name: Pessoa Sintética";
const portugueseFields =
  "Número de telefone: +5500000000000\nNome completo: Pessoa Sintética";

const sharedCases = JSON.parse(readFileSync(new URL(
  "../../../apps/api/internal/whatsapp/testdata/post_form_followup.json",
  import.meta.url,
), "utf8"));

for (const { name, content, want } of sharedCases) {
  test(`Go/Edge shared envelope: ${name}`, () => {
    assert.equal(isWhatsAppPostFormFollowUp(content), want);
  });
}

test("recognizes Portuguese and English form follow-up envelopes", () => {
  for (const prefix of [portuguesePrefix, englishPrefix]) {
    for (const fields of [portugueseFields, englishFields]) {
      assert.equal(isWhatsAppPostFormFollowUp(`${prefix}\n\n${fields}`), true);
    }
  }
});

test("accepts custom form answers between structured phone and name fields", () => {
  assert.equal(isWhatsAppPostFormFollowUp([
    portuguesePrefix,
    "",
    "Phone number: +5500000000000",
    "Quando pretende comprar?: Mais adiante",
    "Possui entrada?: Sim",
    "Full name: Pessoa Sintética",
  ].join("\n")), true);
});

test("normalizes case, accents, repeated whitespace, CRLF and wrapped prefixes", () => {
  const content = [
    "  OLA!  PREENCHI\tSEU FORMULA\u0301RIO E GOSTARIA DE SABER",
    "MAIS SOBRE SUA EMPRESA.  ",
    "",
    "  NU\u0301MERO\tDE  TELEFONE \t: \t+5500000000000  ",
    "  NOME\u00a0COMPLETO : Pessoa Sintética  ",
  ].join("\r\n");
  assert.equal(isWhatsAppPostFormFollowUp(content), true);
  assert.equal(isWhatsAppPostFormFollowUp(
    `${englishPrefix.toUpperCase()}\r${englishFields.toUpperCase()}`,
  ), true);
});

test("does not depend on the order of the structured fields", () => {
  assert.equal(isWhatsAppPostFormFollowUp(
    `${portuguesePrefix}\nNome completo: Pessoa Sintética\nPhone number: +5500000000000`,
  ), true);
});

test("rejects duplicate identities including translated labels", () => {
  for (const repeated of [
    "Phone number: +5500000000001",
    "Número de telefone: +5500000000001",
    "Full name: Outra Pessoa Sintética",
    "Nome completo: Outra Pessoa Sintética",
  ]) {
    assert.equal(isWhatsAppPostFormFollowUp(
      `${portuguesePrefix}\n${englishFields}\n${repeated}`,
    ), false, repeated);
  }
});

test("rejects narration among answers and malformed additional fields", () => {
  for (const extraLine of [
    "Este texto é um exemplo do formulário.",
    "Resposta:",
    ": Resposta",
    ":",
  ]) {
    assert.equal(isWhatsAppPostFormFollowUp(
      `${portuguesePrefix}\n${englishFields}\n${extraLine}`,
    ), false, extraLine);
  }
  assert.equal(isWhatsAppPostFormFollowUp(
    `${portuguesePrefix}\nPhone number: +5500000000000\nEste é um exemplo.\nFull name: Pessoa Sintética`,
  ), false);
});

test("preserves genuine CTWA enquiries and casual references to forms", () => {
  for (const content of [
    "Olá! Tenho interesse nos apartamentos e gostaria de mais informações.",
    "Preenchi seu formulário, mas queria tirar uma dúvida sobre o apartamento.",
    "Olá! Quero conhecer sua empresa.\nPhone number: +5500000000000\nFull name: Pessoa Sintética",
    "Hi! I filled out a form and would like more information about the property.",
  ]) {
    assert.equal(isWhatsAppPostFormFollowUp(content), false, content);
  }
});

test("requires the known prefix at the beginning, excluding quoted or forwarded text", () => {
  const envelope = `${portuguesePrefix}\n\n${englishFields}`;
  for (const content of [
    `A mensagem recebida foi:\n${envelope}`,
    `> ${envelope}`,
    `\"${envelope}\"`,
    `“${envelope}”`,
    `Encaminhada\n${envelope}`,
    `Forwarded\n${envelope}`,
    `Comentário: ${envelope}`,
  ]) {
    assert.equal(isWhatsAppPostFormFollowUp(content), false, content);
  }
});

test("does not classify the prefix or text mentioning field labels alone", () => {
  for (const content of [
    portuguesePrefix,
    englishPrefix,
    `${portuguesePrefix}\nTenho os campos Phone number e Full name no formulário.`,
    `${portuguesePrefix} Phone number: +5500000000000 Full name: Pessoa Sintética`,
    `${portuguesePrefix}\n> Phone number: +5500000000000\n> Full name: Pessoa Sintética`,
    `${portuguesePrefix}Outro texto\n${englishFields}`,
  ]) {
    assert.equal(isWhatsAppPostFormFollowUp(content), false, content);
  }
});

test("requires both structured fields with nonempty values on their own lines", () => {
  for (const fields of [
    "Phone number: +5500000000000",
    "Full name: Pessoa Sintética",
    "Phone number:\nFull name: Pessoa Sintética",
    "Phone number: +5500000000000\nFull name: \t ",
    "Número de telefone: \t\nNome completo: Pessoa Sintética",
    "Número de telefone: +5500000000000\nNome completo:",
    "Phone number: \t\n+5500000000000\nFull name: Pessoa Sintética",
    "Seu Phone number: +5500000000000\nSeu Full name: Pessoa Sintética",
    "Phone number = +5500000000000\nFull name = Pessoa Sintética",
  ]) {
    assert.equal(isWhatsAppPostFormFollowUp(`${portuguesePrefix}\n${fields}`), false, fields);
  }
});

test("rejects non-string values without coercion or external dependencies", () => {
  for (const content of [
    null, undefined, true, false, 0, 1, [], {},
    { text: `${portuguesePrefix}\n${englishFields}` },
    new String(`${portuguesePrefix}\n${englishFields}`),
  ]) {
    assert.equal(isWhatsAppPostFormFollowUp(content), false);
  }
});
