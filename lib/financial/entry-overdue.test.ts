import assert from 'node:assert/strict'
import test from 'node:test'
import { getFinancialToday, isFinancialEntryOverdue } from './entry-overdue'

test('financial day follows Brasilia across midnight independently of browser timezone', () => {
  assert.equal(getFinancialToday(new Date('2026-11-15T02:59:59Z')), '2026-11-14')
  assert.equal(getFinancialToday(new Date('2026-11-15T03:00:00Z')), '2026-11-15')
})

test('overdue requires an open positive balance before the financial civil day for receiving and paying', () => {
  const entry = { type: 'receivable', amount: 100, paid_amount: 25, paid_value: 25, due_date: '2026-11-14', status: 'partial' }
  for (const type of ['receivable', 'payable']) {
    for (const status of ['pending', 'pendente', 'partial', 'parcial', 'overdue', 'vencido', ' PENDENTE ']) {
      assert.equal(isFinancialEntryOverdue({ ...entry, type, status }, '2026-11-15'), true)
    }
  }
  for (const status of ['paid', 'paga', 'cancelled', 'cancelada', '', 'unknown']) {
    assert.equal(isFinancialEntryOverdue({ ...entry, status }, '2026-11-15'), false)
  }
  for (const due_date of [null, '', 'invalid', '2026-02-31', '2026-11-15', '2026-11-16']) {
    assert.equal(isFinancialEntryOverdue({ ...entry, due_date }, '2026-11-15'), false)
  }
  assert.equal(isFinancialEntryOverdue({ ...entry, paid_amount: 100 }, '2026-11-15'), false)
  assert.equal(isFinancialEntryOverdue({ ...entry, paid_value: 150 }, '2026-11-15'), false)
  assert.equal(isFinancialEntryOverdue({ ...entry, type: 'unknown' }, '2026-11-15'), false)
  assert.equal(isFinancialEntryOverdue({ ...entry, amount: 0 }, '2026-11-15'), false)
})

test('an explicit overdue status still waits until the date is past in Brasilia', () => {
  const entry = { type: 'receivable', amount: 100, due_date: '2026-11-14', status: 'overdue' }
  assert.equal(isFinancialEntryOverdue(entry, getFinancialToday(new Date('2026-11-15T02:59:59Z'))), false)
  assert.equal(isFinancialEntryOverdue(entry, getFinancialToday(new Date('2026-11-15T03:00:00Z'))), true)
})
