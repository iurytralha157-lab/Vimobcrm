import assert from "node:assert/strict";
import test from "node:test";
import {
  cardUpdateSessionStorageKey,
  checkoutCardRequestFingerprint,
  formatBoletoDueDate,
  isCheckoutActivated,
  normalizeBillingPeriods,
  normalizePublicCheckoutPlans,
  parsePersistedCardUpdateJob,
  validateCardInput,
} from "./checkout-domain";
import type { CheckoutInfo } from "./checkout-types";

const NOW = new Date("2026-09-06T12:00:00.000Z");
const NOW_MS = NOW.getTime();
const JOB_ID = "123e4567-e89b-42d3-a456-426614174000";

function checkoutInfo(overrides: Partial<CheckoutInfo> = {}): CheckoutInfo {
  return {
    organization: {
      id: "org-1",
      name: "Vimob",
      logo_url: null,
      primary_color: null,
      subscription_status: "active",
      plan_id: "plan-1",
      pending_plan_id: null,
    },
    plan: {
      id: "plan-1",
      name: "Profissional",
      price: 199,
      billing_cycle: "monthly",
      description: null,
      billing_periods: [1, 6, 12],
      display_features: [],
      max_users: null,
      max_whatsapp_sessions: null,
    },
    ...overrides,
  };
}

test("gera uma chave opaca e estável por identidade do checkout", async () => {
  const fingerprint = await checkoutCardRequestFingerprint(["checkout", "org-1"]);
  const repeated = await checkoutCardRequestFingerprint(["checkout", "org-1"]);
  const other = await checkoutCardRequestFingerprint(["checkout", "org-2"]);

  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(repeated, fingerprint);
  assert.notEqual(other, fingerprint);
  assert.equal(
    await cardUpdateSessionStorageKey("organization:org-1"),
    await cardUpdateSessionStorageKey("organization:org-1"),
  );
  assert.doesNotMatch(
    await cardUpdateSessionStorageKey("organization:org-1"),
    /organization|org-1/,
  );
});

test("restaura somente jobs íntegros, atuais e coerentes com o modo", () => {
  const valid = JSON.stringify({
    version: 1,
    jobId: JOB_ID,
    mode: "settled_payment",
    paymentId: "pay-1",
    subscriptionId: "sub-1",
    createdAt: NOW_MS,
  });

  assert.equal(parsePersistedCardUpdateJob(valid, NOW_MS)?.jobId, JOB_ID);
  assert.equal(
    parsePersistedCardUpdateJob(
      JSON.stringify({ ...JSON.parse(valid), paymentId: null }),
      NOW_MS,
    ),
    null,
  );
  assert.equal(
    parsePersistedCardUpdateJob(
      JSON.stringify({ ...JSON.parse(valid), createdAt: NOW_MS - 86_400_001 }),
      NOW_MS,
    ),
    null,
  );
  assert.equal(
    parsePersistedCardUpdateJob(
      JSON.stringify({ ...JSON.parse(valid), createdAt: NOW_MS + 60_001 }),
      NOW_MS,
    ),
    null,
  );
  assert.equal(parsePersistedCardUpdateJob("{", NOW_MS), null);
});

test("normaliza somente períodos e planos publicáveis", () => {
  assert.deepEqual(normalizeBillingPeriods([12, 1, 6, 1, 2, -1]), [1, 6, 12]);
  assert.deepEqual(normalizeBillingPeriods(null), []);

  const plans = normalizePublicCheckoutPlans([
    { id: "b", slug: "b", name: "B", price: 200, display_order: 2 },
    { id: "invalid", slug: "invalid", name: "Inválido", price: 0 },
    { id: "a", slug: "a", name: "A", price: 100, display_order: 1 },
  ]);
  assert.deepEqual(plans.map((plan) => plan.id), ["a", "b"]);
});

test("valida cartão sem depender do relógio real", () => {
  const validCard = {
    holderName: "Cliente Vimob",
    holderDocument: "529.982.247-25",
    number: "4111 1111 1111 1111",
    expiryMonth: "10",
    expiryYear: "2027",
    ccv: "123",
  };

  assert.equal(validateCardInput(validCard, NOW), null);
  assert.equal(
    validateCardInput({ ...validCard, number: "4111 1111 1111 1112" }, NOW),
    "Informe um número de cartão válido.",
  );
  assert.equal(
    validateCardInput({ ...validCard, expiryYear: "2025" }, NOW),
    "O cartão informado está vencido.",
  );
});

test("ativa apenas o plano efetivamente promovido e sem pendência", () => {
  assert.equal(isCheckoutActivated(checkoutInfo()), true);
  assert.equal(
    isCheckoutActivated(checkoutInfo({
      organization: {
        ...checkoutInfo().organization,
        pending_plan_id: "plan-2",
      },
    })),
    false,
  );
  assert.equal(
    isCheckoutActivated(checkoutInfo({
      checkout_access: {
        scope: "payment",
        can_change_plan: false,
        use_stored_billing_profile: false,
        payment_status: "PENDING",
        payment_settled: false,
      },
    })),
    false,
  );
  assert.equal(formatBoletoDueDate("2026-09-08"), "08/09/2026");
  assert.equal(formatBoletoDueDate("08/09/2026"), null);
});
