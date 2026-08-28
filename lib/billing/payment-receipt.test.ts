import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  getBillingPeriodLabel,
  getBillingTypeLabel,
  normalizeReceiptVerificationToken,
  parseCheckoutPaymentReceiptReference,
  parsePublicBillingPaymentReceipt,
} from "./payment-receipt";

const receipt = {
  found: true,
  valid: true,
  payment_state: "confirmed",
  current_payment_status: "RECEIVED",
  state_changed_at: "2026-08-03T18:00:01.000Z",
  receipt_number: "VIMOB-2026-000001",
  version: 1,
  issuer_name: "Vimob CRM",
  organization_name: "Imobiliária Exemplo",
  plan_name: "Pro",
  billing_period_months: 6,
  billing_type: "PIX",
  amount: 1782,
  currency: "BRL",
  paid_at: "2026-08-03T18:00:00.000Z",
  issued_at: "2026-08-03T18:00:01.000Z",
  snapshot_hash: "a".repeat(64),
};

test("aceita somente token UUID de verificação", () => {
  assert.equal(
    normalizeReceiptVerificationToken(" 550E8400-E29B-41D4-A716-446655440000 "),
    "550e8400-e29b-41d4-a716-446655440000",
  );
  assert.equal(normalizeReceiptVerificationToken("../admin"), null);
  assert.equal(normalizeReceiptVerificationToken("not-a-token"), null);
});

test("converte apenas a resposta pública sanitizada e íntegra", () => {
  assert.deepEqual(parsePublicBillingPaymentReceipt(receipt), receipt);
  assert.equal(
    parsePublicBillingPaymentReceipt({ ...receipt, payment_state: undefined }),
    null,
  );
  assert.equal(
    parsePublicBillingPaymentReceipt({ ...receipt, valid: false }),
    null,
  );
  assert.equal(
    parsePublicBillingPaymentReceipt({
      ...receipt,
      valid: false,
      payment_state: "refunded",
      current_payment_status: "REFUNDED",
    })?.payment_state,
    "refunded",
  );
  assert.equal(
    parsePublicBillingPaymentReceipt({
      ...receipt,
      valid: true,
      payment_state: "chargeback",
      current_payment_status: "CHARGEBACK_REQUESTED",
    }),
    null,
  );
  assert.equal(
    parsePublicBillingPaymentReceipt({ ...receipt, amount: -1 }),
    null,
  );
  assert.equal(
    parsePublicBillingPaymentReceipt({ ...receipt, snapshot_hash: "short" }),
    null,
  );

  const parsed = parsePublicBillingPaymentReceipt({
    ...receipt,
    payer_tax_id: "123",
  });
  assert.ok(parsed);
  assert.equal("payer_tax_id" in parsed, false);
});

test("padroniza período e meio de pagamento para a página pública", () => {
  assert.equal(getBillingPeriodLabel(1), "Mensal");
  assert.equal(getBillingPeriodLabel(6), "Semestral");
  assert.equal(getBillingPeriodLabel(12), "Anual");
  assert.equal(getBillingTypeLabel("PIX"), "Pix");
  assert.equal(getBillingTypeLabel("CREDIT_CARD"), "Cartão de crédito");
  assert.equal(getBillingTypeLabel("BOLETO"), "Boleto");
});

test("checkout accepts only the sanitized internal receipt reference", () => {
  const parsed = parseCheckoutPaymentReceiptReference({
    number: " VIMOB-202608-ABC123 ",
    verification_path: "/comprovantes/550E8400-E29B-41D4-A716-446655440000",
    payer_tax_id: "12345678900",
  });

  assert.deepEqual(parsed, {
    number: "VIMOB-202608-ABC123",
    verification_path: "/comprovantes/550e8400-e29b-41d4-a716-446655440000",
  });
  assert.equal("payer_tax_id" in (parsed ?? {}), false);
  assert.equal(
    parseCheckoutPaymentReceiptReference({
      number: "VIMOB-202608-ABC123",
      verification_path:
        "https://evil.example/comprovantes/550e8400-e29b-41d4-a716-446655440000",
    }),
    null,
  );
  assert.equal(
    parseCheckoutPaymentReceiptReference({
      number: "VIMOB-202608-ABC123",
      verification_path: "/comprovantes/../../admin",
    }),
    null,
  );
});

test("pÃ¡gina bearer do comprovante nÃ£o vaza token por referer nem cache", () => {
  const page = readFileSync(
    resolve(process.cwd(), "app/comprovantes/[token]/page.tsx"),
    "utf8",
  );
  const nextConfig = readFileSync(
    resolve(process.cwd(), "next.config.ts"),
    "utf8",
  );

  assert.match(page, /referrer:\s*['"]no-referrer['"]/);
  assert.match(nextConfig, /source:\s*['"]\/comprovantes\/:path\*['"]/);
  assert.match(nextConfig, /Referrer-Policy[\s\S]*no-referrer/);
  assert.match(nextConfig, /Cache-Control[\s\S]*private, no-store, max-age=0/);
});
