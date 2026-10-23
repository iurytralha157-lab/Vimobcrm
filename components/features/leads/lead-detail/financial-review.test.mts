import assert from 'node:assert/strict';
import test from 'node:test';
import { getLeadStatusFinancialReviewMessage, LEAD_STATUS_FINANCIAL_REVIEW_MESSAGE, requiresWonLeadFinancialReview } from './financial-review';

const won = { deal_status: 'won', valor_interesse: 100, commission_percentage: 5 };
test('won-value and commission changes require financial review including clearing and zero', () => {
  for (const patch of [{ valor_interesse: 200 }, { valor_interesse: 0 }, { valor_interesse: null },
    { commission_percentage: 6 }, { commission_percentage: 0 }, { commission_percentage: null }]) {
    assert.equal(requiresWonLeadFinancialReview(won, { ...won, ...patch }), true);
  }
});
test('ordinary contact edits and terminal transitions do not claim a financial recalculation', () => {
  assert.equal(requiresWonLeadFinancialReview(won, { ...won }), false);
  assert.equal(requiresWonLeadFinancialReview({ ...won, deal_status: 'open' }, won), false);
  assert.equal(requiresWonLeadFinancialReview(won, { ...won, deal_status: 'open' }), false);
  assert.equal(requiresWonLeadFinancialReview({ ...won, deal_status: 'lost' }, { ...won, deal_status: 'lost', valor_interesse: 200 }), false);
});
test('null and unloaded monetary fields stay equivalent', () => {
  assert.equal(requiresWonLeadFinancialReview({ deal_status: 'won' }, { deal_status: 'won', valor_interesse: null }), false);
  assert.equal(requiresWonLeadFinancialReview(won, { deal_status: 'won' }), false);
  assert.equal(requiresWonLeadFinancialReview({ deal_status: 'won' }, won), false);
});

test('leaving a won lead explains that its existing financial records are preserved', () => {
  for (const deal_status of ['open', 'lost']) {
    assert.equal(getLeadStatusFinancialReviewMessage(won, { ...won, deal_status }), LEAD_STATUS_FINANCIAL_REVIEW_MESSAGE);
  }
});

test('a new win warns only with the server signal for records that predate the mutation', () => {
  for (const deal_status of ['open', 'lost']) {
    for (const financial_review_required of [undefined, false]) {
      assert.equal(getLeadStatusFinancialReviewMessage({ ...won, deal_status }, { ...won, financial_review_required }), null);
    }
    assert.equal(getLeadStatusFinancialReviewMessage({ ...won, deal_status }, { ...won, financial_review_required: true }), LEAD_STATUS_FINANCIAL_REVIEW_MESSAGE);
  }
});

test('ordinary states and a stale flag on a non-winning read do not produce a status warning', () => {
  assert.equal(getLeadStatusFinancialReviewMessage(won, won), null);
  assert.equal(getLeadStatusFinancialReviewMessage({ deal_status: 'open' }, { deal_status: 'lost', financial_review_required: true }), null);
  assert.equal(getLeadStatusFinancialReviewMessage({ deal_status: 'lost' }, { deal_status: 'open', financial_review_required: true }), null);
});
