import assert from 'node:assert/strict'
import test from 'node:test'
import { getFinancialPaidAmount, getFinancialOutstandingAmount } from './entry-amount'

test('legacy fields describe one payment and a zero alias must not mask its recorded value', () => {
  for (const fields of [{paid_value: 0, paid_amount: 25}, {paid_value: 25, paid_amount: 25}, {paid_value: 25}]) {
    const entry = {amount: 100, status: 'partial', ...fields}
    assert.equal(getFinancialPaidAmount(entry), 25)
    assert.equal(getFinancialOutstandingAmount(entry), 75)
  }
})
test('partial unknown is never fully paid; legacy paid is supported and excess is clamped', () => {
  assert.equal(getFinancialPaidAmount({amount:100,status:'partial'}),0)
  assert.equal(getFinancialPaidAmount({amount:100,status:'paid'}),100)
  assert.equal(getFinancialPaidAmount({amount:100,status:'paga',paid_value:0,paid_amount:0}),100)
  assert.equal(getFinancialPaidAmount({amount:100,status:'partial',paid_value:150}),100)
  assert.equal(getFinancialPaidAmount({amount:100,status:'partial',paid_value:-50}),0)
})
