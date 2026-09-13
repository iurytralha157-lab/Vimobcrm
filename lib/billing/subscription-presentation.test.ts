import assert from "node:assert/strict";
import test from "node:test";

import {
  filterPaymentHistory,
  formatBillingFrequency,
  getBillingPage,
  getPaymentStatus,
  normalizeBillingPeriodMonths,
  type PaymentHistoryPresentationItem,
} from "./subscription-presentation";

function payment(
  overrides: Partial<PaymentHistoryPresentationItem> = {},
): PaymentHistoryPresentationItem {
  return {
    id: "payment-1",
    asaas_payment_id: "pay_123",
    asaas_subscription_id: "sub_123",
    billing_type: "PIX",
    status: "PENDING",
    value: 199.9,
    bank_slip_registration_cancelled: false,
    sync_state: "current",
    ...overrides,
  };
}

test("normaliza navegação e frequência sem alterar os fallbacks legados", () => {
  assert.equal(getBillingPage("plans"), "plans");
  assert.equal(getBillingPage("invalid"), "payments");
  assert.equal(normalizeBillingPeriodMonths(null, "annual"), 12);
  assert.equal(normalizeBillingPeriodMonths(6, "monthly"), 6);
  assert.equal(formatBillingFrequency(6), "A cada 6 meses");
});

test("preserva a distinção visual entre status pendente, processando e pago", () => {
  assert.deepEqual(getPaymentStatus(payment()), {
    label: "Pendente",
    variant: "outline",
  });
  assert.deepEqual(getPaymentStatus(payment({ status: "PROCESSING" })), {
    label: "Processando",
    variant: "secondary",
  });
  assert.deepEqual(getPaymentStatus(payment({ status: "CONFIRMED" })), {
    label: "Pago",
    variant: "default",
  });
});

test("nunca apresenta status em cache ou com refresh falho como confirmado", () => {
  assert.deepEqual(
    getPaymentStatus(payment({ status: "CONFIRMED", sync_state: "cached" })),
    { label: "Conferindo", variant: "secondary" },
  );
  assert.deepEqual(getPaymentStatus(payment({ status: "CONFIRMED" }), true), {
    label: "Não confirmado",
    variant: "secondary",
  });
});

test("pesquisa usa os mesmos campos, status traduzido e moeda da listagem", () => {
  const history = [payment()];
  assert.equal(filterPaymentHistory(history, "pendente", {}).length, 1);
  assert.equal(filterPaymentHistory(history, "199,90", {}).length, 1);
  assert.equal(filterPaymentHistory(history, "cartão", {}).length, 0);
});
