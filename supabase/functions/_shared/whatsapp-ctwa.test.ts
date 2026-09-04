import assert from "node:assert/strict";
import test from "node:test";

import {
  validWhatsAppCTWAClickIdentifier,
  whatsappCTWAConfirmationMethod,
} from "./whatsapp-ctwa";

test("accepts Meta's explicit CTWA entry point", () => {
  assert.equal(whatsappCTWAConfirmationMethod({
    entryPointConversionSource: "ctwa_ad",
    explicitSourceType: "ad",
    providerMessageIdSynthetic: false,
  }), "entry_point_ctwa_ad");
  assert.equal(whatsappCTWAConfirmationMethod({
    entryPointConversionSource: " CTWA_AD ",
    providerMessageIdSynthetic: false,
  }), "entry_point_ctwa_ad");
  assert.equal(whatsappCTWAConfirmationMethod({
    entryPointConversionSource: "ctwa_ad",
    explicitSourceType: "ad",
    showAdAttributionInvalid: true,
    providerMessageIdSynthetic: false,
  }), null);
});

test("accepts Evolution's explicit ad context when the entry point is omitted", () => {
  for (const showAdAttribution of [undefined, null, true]) {
    assert.equal(whatsappCTWAConfirmationMethod({
      explicitSourceType: "ad",
      ctwaClid: "AfjGD28_TndSXnbFSjURxTw0",
      showAdAttribution,
      providerMessageIdSynthetic: false,
    }), "evolution_ctwa_clid_v1");
  }
});

test("fails closed for contradictory, inferred, synthetic or non-current signals", () => {
  const validFallback = {
    explicitSourceType: "ad",
    ctwaClid: "AfjGD28_TndSXnbFSjURxTw0",
    providerMessageIdSynthetic: false,
  };
  const rejected = [
    { ...validFallback, entryPointConversionSource: "qr_code" },
    { ...validFallback, explicitSourceType: "" },
    { ...validFallback, providerMessageIdSynthetic: true },
    { ...validFallback, showAdAttribution: false },
    { ...validFallback, showAdAttribution: "" },
    { ...validFallback, showAdAttribution: "true" },
    { ...validFallback, showAdAttribution: "banana" },
    { ...validFallback, showAdAttribution: 1 },
    { ...validFallback, showAdAttribution: 2 },
    { ...validFallback, showAdAttributionInvalid: true },
    { ...validFallback, showAdAttributionInvalid: "true" },
    { ...validFallback, proofConflict: true },
    { ...validFallback, proofConflict: "true" },
    { ...validFallback, fromMe: true },
    { ...validFallback, isGroup: true },
    { ...validFallback, ctwaClid: "short" },
    { ...validFallback, ctwaClid: "valid-id\u0000forged" },
  ];
  for (const input of rejected) {
    assert.equal(whatsappCTWAConfirmationMethod(input), null);
  }
});

test("treats the click id as a bounded opaque token", () => {
  assert.equal(validWhatsAppCTWAClickIdentifier("abcdefgh"), true);
  assert.equal(validWhatsAppCTWAClickIdentifier("x".repeat(512)), true);
  assert.equal(validWhatsAppCTWAClickIdentifier("x".repeat(513)), false);
  assert.equal(validWhatsAppCTWAClickIdentifier("abcdefg"), false);
  assert.equal(validWhatsAppCTWAClickIdentifier(12345678), false);
});
