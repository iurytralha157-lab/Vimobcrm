import assert from "node:assert/strict";
import test from "node:test";
import { formatWhatsAppPersonName } from "@/lib/whatsapp-person-name";

test("conversation person names normalize case and spacing without losing accents", () => {
  assert.equal(formatWhatsAppPersonName("  GUSTAVO   JUAN SOUZA CORREIA  "), "Gustavo Juan Souza Correia");
  assert.equal(formatWhatsAppPersonName("ana beatriz"), "Ana Beatriz");
  assert.equal(formatWhatsAppPersonName("JOSÉ ÁLVARO"), "José Álvaro");
});

test("compound names preserve their punctuation and their own word initials", () => {
  assert.equal(formatWhatsAppPersonName("ANA-MARIA D’ÁVILA"), "Ana-Maria D’Ávila");
  assert.equal(formatWhatsAppPersonName("jean-luc d'ávila"), "Jean-Luc D'Ávila");
});

test("missing names, phone labels and email fallbacks keep their meanings", () => {
  assert.equal(formatWhatsAppPersonName(null), "");
  assert.equal(formatWhatsAppPersonName(undefined), "");
  assert.equal(formatWhatsAppPersonName("  "), "");
  assert.equal(formatWhatsAppPersonName("+55 (11) 99999-0000"), "+55 (11) 99999-0000");
  assert.equal(formatWhatsAppPersonName("User.Name@Example.test"), "User.Name@Example.test");
  assert.equal(formatWhatsAppPersonName("wa-session-quoted-1791942631759688200"), "wa-session-quoted-1791942631759688200");
  assert.equal(formatWhatsAppPersonName('<img src=x onerror="window.injected=true">'), '<img src=x onerror="window.injected=true">');
});
