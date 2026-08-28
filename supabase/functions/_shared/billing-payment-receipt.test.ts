import assert from "node:assert/strict";
import test from "node:test";

import { publicBillingPaymentReceiptReference } from "./billing-payment-receipt.ts";

test("checkout receives only the receipt number and verification path", () => {
  const reference = publicBillingPaymentReceiptReference({
    receipt_number: " VIMOB-202608-ABC123 ",
    verification_token: "550E8400-E29B-41D4-A716-446655440000",
    payer_name: "Must not leave the function",
    payer_tax_id: "12345678900",
    billing_email: "private@example.com",
  });

  assert.deepEqual(reference, {
    number: "VIMOB-202608-ABC123",
    verification_path: "/comprovantes/550e8400-e29b-41d4-a716-446655440000",
  });
  assert.deepEqual(Object.keys(reference ?? {}).sort(), ["number", "verification_path"]);
});

test("invalid receipt capabilities are never exposed", () => {
  assert.equal(
    publicBillingPaymentReceiptReference({
      receipt_number: "VIMOB-202608-ABC123",
      verification_token: "../../admin",
    }),
    null,
  );
  assert.equal(
    publicBillingPaymentReceiptReference({
      receipt_number: "",
      verification_token: "550e8400-e29b-41d4-a716-446655440000",
    }),
    null,
  );
});
