import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  existingAsaasCustomerUpdatePayload,
  suppressExistingAsaasCustomerNotifications,
} from "./asaas-customer.ts";

test("legacy customers disable Asaas notifications without persisting checkout PII", () => {
  const profile = {
    name: "Cliente Financeiro",
    email: "financeiro@example.com",
    cpfCnpj: "12345678901",
    mobilePhone: "5511999999999",
    notificationDisabled: true,
  };

  assert.deepEqual(existingAsaasCustomerUpdatePayload(profile, false), {
    notificationDisabled: true,
  });
  assert.deepEqual(existingAsaasCustomerUpdatePayload(profile, true), profile);
});

test("existing customer suppression is a fail-closed preflight", async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  let paymentMutations = 0;
  const runCheckout = async (confirmed: boolean) => {
    await suppressExistingAsaasCustomerNotifications({
      customerId: "cus_legacy",
      profile: {
        email: "private@example.com",
        cpfCnpj: "12345678901",
        notificationDisabled: true,
      },
      updateExistingProfile: false,
      request: (path, init) => {
        calls.push({ path, body: JSON.parse(init.body) });
        return Promise.resolve({
          id: "cus_legacy",
          notificationDisabled: confirmed,
        });
      },
    });
    paymentMutations += 1;
  };

  await assert.rejects(() => runCheckout(false), /were not disabled/);
  assert.equal(paymentMutations, 0, "payment mutation must not run");
  assert.deepEqual(calls[0], {
    path: "/customers/cus_legacy",
    body: { notificationDisabled: true },
  });

  await runCheckout(true);
  assert.equal(paymentMutations, 1);
});

test("payment-scoped checkout awaits suppression before every provider mutation", () => {
  const source = readFileSync(
    new URL("../asaas-create-charge/index.ts", import.meta.url),
    "utf8",
  );
  const preflight = source.indexOf(
    "await suppressAsaasCustomerNotifications(customerId)",
  );
  const pixBranch = source.indexOf(
    'if (input.billingMethod === "PIX")',
    preflight,
  );
  const boletoBranch = source.indexOf(
    'if (input.billingMethod === "BOLETO")',
    preflight,
  );
  const cardMutation = source.indexOf("/payWithCreditCard", preflight);

  assert.ok(preflight > 0);
  assert.ok(pixBranch > preflight);
  assert.ok(boletoBranch > preflight);
  assert.ok(cardMutation > preflight);
});
