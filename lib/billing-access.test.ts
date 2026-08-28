import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasBillingAccess,
  isBillingAccessBlocked,
  isLocalBillingAccessBypassEnabled,
  isBillingPlanPromotionConfirmed,
  isBillingAccessRoute,
  type BillingAccessState,
} from './billing-access';

const NOW = Date.parse('2026-07-28T18:00:00.000Z');
const BEFORE = '2026-07-28T17:59:59.999Z';
const AT_BOUNDARY = '2026-07-28T18:00:00.000Z';
const AFTER = '2026-07-28T18:00:00.001Z';

test('libera somente os estados de faturamento válidos', () => {
  const allowed: Array<[string, BillingAccessState]> = [
    ['assinatura paga ativa', {
      subscription_type: 'paid',
      subscription_status: 'active',
    }],
    ['assinatura gratuita ativa', {
      subscription_type: 'free',
      subscription_status: 'active',
    }],
    ['valores normalizados', {
      subscription_type: ' PAID ',
      subscription_status: ' ACTIVE ',
    }],
    ['API legada ativa sem tipo de assinatura', {
      subscription_status: 'active',
    }],
    ['API legada em trial sem tipo de assinatura', {
      subscription_status: 'trial',
    }],
    ['trial vigente', {
      subscription_type: 'trial',
      subscription_status: 'trial',
      trial_ends_at: AFTER,
    }],
    ['inadimplência dentro da carência', {
      subscription_type: 'paid',
      subscription_status: 'overdue',
      billing_grace_until: AFTER,
    }],
    ['past due dentro da carência', {
      subscription_type: 'paid',
      subscription_status: 'past_due',
      billing_grace_until: AFTER,
    }],
  ];

  for (const [name, state] of allowed) {
    assert.equal(hasBillingAccess(state, NOW), true, name);
    assert.equal(isBillingAccessBlocked(state, NOW), false, name);
  }
});

test('bloqueia estados ausentes, inconsistentes ou desconhecidos', () => {
  const blocked: Array<[string, BillingAccessState | null | undefined]> = [
    ['estado ausente', undefined],
    ['organização nula', null],
    ['estado legado sem status', {}],
    ['estado legado desconhecido', { subscription_status: 'processing' }],
    ['pagamento pendente legado', { subscription_status: 'pending_payment' }],
    ['vencimento legado', { subscription_status: 'overdue' }],
    ['inadimplência legada', { subscription_status: 'past_due' }],
    ['bloqueio legado', { subscription_status: 'blocked' }],
    ['cancelamento legado', { subscription_status: 'cancelled' }],
    ['grafia de cancelamento legada', { subscription_status: 'canceled' }],
    ['tipo legado malformado', {
      subscription_type: 42,
      subscription_status: 'active',
    }],
    ['status ausente', { subscription_type: 'paid' }],
    ['tipo desconhecido', {
      subscription_type: 'enterprise',
      subscription_status: 'active',
    }],
    ['status desconhecido', {
      subscription_type: 'paid',
      subscription_status: 'processing',
    }],
    ['free inconsistente', {
      subscription_type: 'free',
      subscription_status: 'trial',
      trial_ends_at: AFTER,
    }],
    ['trial com status ativo', {
      subscription_type: 'trial',
      subscription_status: 'active',
      trial_ends_at: AFTER,
    }],
    ['paid com status trial', {
      subscription_type: 'paid',
      subscription_status: 'trial',
      trial_ends_at: AFTER,
    }],
    ['pagamento pendente', {
      subscription_type: 'paid',
      subscription_status: 'pending_payment',
      billing_grace_until: AFTER,
    }],
    ['bloqueado', {
      subscription_type: 'paid',
      subscription_status: 'blocked',
      billing_grace_until: AFTER,
    }],
    ['suspenso', {
      subscription_type: 'paid',
      subscription_status: 'suspended',
      billing_grace_until: AFTER,
    }],
    ['cancelado', {
      subscription_type: 'paid',
      subscription_status: 'cancelled',
      billing_grace_until: AFTER,
    }],
    ['grafia cancelada legada', {
      subscription_type: 'paid',
      subscription_status: 'canceled',
      billing_grace_until: AFTER,
    }],
  ];

  for (const [name, state] of blocked) {
    assert.equal(hasBillingAccess(state, NOW), false, name);
    assert.equal(isBillingAccessBlocked(state, NOW), true, name);
  }
});

test('trial e carência bloqueiam exatamente no vencimento', () => {
  for (const [name, trialEndsAt] of [
    ['sem vencimento', undefined],
    ['data inválida', 'invalid'],
    ['vencido', BEFORE],
    ['no limite', AT_BOUNDARY],
  ] as const) {
    assert.equal(hasBillingAccess({
      subscription_type: 'trial',
      subscription_status: 'trial',
      trial_ends_at: trialEndsAt,
    }, NOW), false, `trial ${name}`);
  }

  for (const status of ['overdue', 'past_due']) {
    for (const [name, graceUntil] of [
      ['sem carência', undefined],
      ['data inválida', 'invalid'],
      ['vencida', BEFORE],
      ['no limite', AT_BOUNDARY],
    ] as const) {
      assert.equal(hasBillingAccess({
        subscription_type: 'paid',
        subscription_status: status,
        billing_grace_until: graceUntil,
      }, NOW), false, `${status} ${name}`);
    }
  }
});

test('mantém apenas as rotas de recuperação financeira como acesso de cobrança', () => {
  assert.equal(isBillingAccessRoute('/checkout/token'), true);
  assert.equal(isBillingAccessRoute('/assinatura'), true);
  assert.equal(isBillingAccessRoute('/settings', '?tab=subscription'), true);
  assert.equal(isBillingAccessRoute('/settings', 'tab=account'), false);
  assert.equal(isBillingAccessRoute('/dashboard'), false);
});

test('bypass de faturamento funciona somente no desenvolvimento local', () => {
  assert.equal(isLocalBillingAccessBypassEnabled('development', 'true'), true);
  assert.equal(isLocalBillingAccessBypassEnabled('development', ' TRUE '), true);
  assert.equal(isLocalBillingAccessBypassEnabled('production', 'true'), false);
  assert.equal(isLocalBillingAccessBypassEnabled('test', 'true'), false);
  assert.equal(isLocalBillingAccessBypassEnabled('development', 'false'), false);
});

test('confirma checkout somente depois de promover exatamente o plano pendente', () => {
  const expectedPlanId = '11111111-1111-4111-8111-111111111111';
  const otherPlanId = '22222222-2222-4222-8222-222222222222';

  assert.equal(isBillingPlanPromotionConfirmed({
    subscription_status: 'active',
    plan_id: expectedPlanId,
    pending_plan_id: expectedPlanId,
  }, expectedPlanId), false, 'conta ativa com plano ainda pendente');

  assert.equal(isBillingPlanPromotionConfirmed({
    subscription_status: 'active',
    plan_id: otherPlanId,
    pending_plan_id: null,
  }, expectedPlanId), false, 'plano ativo diferente do checkout');

  assert.equal(isBillingPlanPromotionConfirmed({
    subscription_status: 'overdue',
    plan_id: expectedPlanId,
    pending_plan_id: null,
  }, expectedPlanId), false, 'plano promovido sem pagamento ativo');

  assert.equal(isBillingPlanPromotionConfirmed({
    subscription_status: 'active',
    plan_id: expectedPlanId,
    pending_plan_id: null,
  }, expectedPlanId), true);
});
