import assert from 'node:assert/strict'
import test from 'node:test'
import { countOverdueCadenceTasks, formatLeadCadenceDate, getPendingCadenceDeadlines } from './lead-cadence-presentation'

test('so tarefas pendentes com prazo valido entram na contagem local', () => {
  const due = '2026-10-18T12:00:00Z'
  const deadlines = getPendingCadenceDeadlines([
    { status: 'pending', is_done: false, due_at: due },
    { status: 'pending', is_done: true, due_at: due },
    { status: 'completed', is_done: true, due_at: due },
    { status: 'cancelled', is_done: false, due_at: due },
    { status: 'skipped', is_done: false, due_at: due },
    { status: 'pending', is_done: false, due_at: null },
    { status: 'pending', is_done: false, due_at: 'invalid' },
  ])
  assert.equal(deadlines.length, 1)
  assert.equal(countOverdueCadenceTasks(deadlines, Date.parse(due)), 0)
  assert.equal(countOverdueCadenceTasks(deadlines, Date.parse(due) + 1), 1)
})

test('fuso da organizacao muda horario exibido sem mudar o instante nem o vencimento', () => {
  const date = '2026-10-18T12:00:00Z'
  assert.match(formatLeadCadenceDate(date, 'America/Sao_Paulo'), /09:00/)
  assert.match(formatLeadCadenceDate(date, 'America/Manaus'), /08:00/)
  assert.match(formatLeadCadenceDate(date, 'Asia/Tokyo'), /21:00/)
  assert.match(formatLeadCadenceDate(date, 'America/Manaus', true), /18\/10\/2026.*08:00:00/)
})

test('API antiga, fuso invalido e datas ausentes nao derrubam o painel', () => {
  const date = '2026-10-18T12:00:00Z'
  assert.equal(formatLeadCadenceDate(date), formatLeadCadenceDate(date, 'Not/A_TimeZone'))
  assert.equal(formatLeadCadenceDate(null), 'Sem prazo')
  assert.equal(formatLeadCadenceDate('invalid'), 'Prazo indisponível')
})
