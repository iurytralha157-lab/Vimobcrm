import assert from "node:assert/strict";
import test from "node:test";
import {
  openBillingCardCredential,
  openBillingSubscriptionCardCredential,
  sealBillingCardCredential,
  sealBillingSubscriptionCardCredential,
} from "./asaas-card-credential.ts";

const key = "11".repeat(32);
const paymentId = "11111111-1111-4111-8111-111111111111";
const providerPaymentId = "pay_provider_one";

test("card credential is sealed with local and provider payment-bound authenticated encryption", async () => {
  const ciphertext = await sealBillingCardCredential({
    paymentId,
    providerPaymentId,
    creditCardToken: "76496073-536f-4835-80db-c45d00f33695",
    remoteIp: "203.0.113.7",
  }, key);
  assert.match(ciphertext, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(ciphertext.includes("76496073"), false);
  assert.equal(ciphertext.includes("203.0.113.7"), false);
  assert.deepEqual(
    await openBillingCardCredential({
      paymentId,
      providerPaymentId,
      ciphertext,
    }, key),
    {
      creditCardToken: "76496073-536f-4835-80db-c45d00f33695",
      remoteIp: "203.0.113.7",
    },
  );
  await assert.rejects(() =>
    openBillingCardCredential({
      paymentId: "22222222-2222-4222-8222-222222222222",
      providerPaymentId,
      ciphertext,
    }, key)
  );
  await assert.rejects(() =>
    openBillingCardCredential({
      paymentId,
      providerPaymentId: "pay_provider_two",
      ciphertext,
    }, key)
  );
});

test("subscription card credential is sealed to one durable update job and subscription", async () => {
  const key = "a1".repeat(32);
  const input = {
    jobId: "2fd7ec10-4de2-4dfb-b932-39838cb6bf83",
    providerSubscriptionId: "sub_exact_subscription",
    creditCardToken: "76496073-536f-4835-80db-c45d00f33695",
    remoteIp: "203.0.113.9",
  };
  const ciphertext = await sealBillingSubscriptionCardCredential(input, key);
  assert.match(ciphertext, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(
    await openBillingSubscriptionCardCredential(
      { ...input, ciphertext },
      key,
    ),
    {
      creditCardToken: input.creditCardToken,
      remoteIp: input.remoteIp,
    },
  );

  await assert.rejects(
    () =>
      openBillingSubscriptionCardCredential(
        {
          ...input,
          jobId: "c6eff53a-f97b-49a0-a17a-65ac02d48185",
          ciphertext,
        },
        key,
      ),
  );
  await assert.rejects(
    () =>
      openBillingSubscriptionCardCredential(
        {
          ...input,
          providerSubscriptionId: "sub_other_subscription",
          ciphertext,
        },
        key,
      ),
  );
});
