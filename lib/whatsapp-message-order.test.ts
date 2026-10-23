import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isWhatsAppMessageCursorRebaseRequired,
  isWhatsAppUTC6Timestamp,
  sortWhatsAppMessages,
  sortWhatsAppTimelineItems,
} from './whatsapp-message-order'

test('preserva microssegundos ao intercalar mensagens e eventos da timeline', () => {
  const items = [
    { id: 'later-message', timestamp: '2026-10-11T12:00:00.123456Z' },
    { id: 'earlier-message', timestamp: '2026-10-11T12:00:00.123454Z' },
    { id: 'attendance', timestamp: '2026-10-11T12:00:00.123455Z' },
  ]
  assert.deepEqual(sortWhatsAppTimelineItems(items).map(({ id }) => id),
    ['earlier-message', 'attendance', 'later-message'])
  assert.equal(items[0].id, 'later-message')
})

test('normaliza timezone e precisao sem desempatar mensagens canonicas por UUID', () => {
  const rows = [
    { id: 'z', sent_at: '2026-10-11T12:00:00Z' },
    { id: 'b', sent_at: '2026-10-11T09:00:00.000000-03:00' },
    { id: 'a', sent_at: '2026-10-11T12:00:00.000Z' },
  ]
  assert.deepEqual(sortWhatsAppMessages(rows).map(({ id }) => id), ['z', 'b', 'a'])
  assert.deepEqual(sortWhatsAppMessages(sortWhatsAppMessages(rows)), rows)
})

test('mantem null e horario invalido na posicao do feed legado', () => {
  const rows = [
    { id: 'first', sent_at: '2026-10-11T12:00:00Z' },
    { id: 'legacy-null', sent_at: null },
    { id: 'second', sent_at: '2026-10-11T12:01:00Z' },
    { id: 'legacy-invalid', sent_at: 'not-a-date' },
    { id: 'third', sent_at: '2026-10-11T12:02:00Z' },
  ]
  assert.deepEqual(sortWhatsAppMessages(rows), rows)
})

test('valida UTC6 real e identifica apenas o erro especifico de rebase', () => {
  assert.equal(isWhatsAppUTC6Timestamp('2026-10-11T12:00:00.123456Z'), true)
  assert.equal(isWhatsAppUTC6Timestamp('2026-02-30T12:00:00.123456Z'), false)
  assert.equal(isWhatsAppUTC6Timestamp('2026-10-11T12:00:00.123Z'), false)
  assert.equal(isWhatsAppMessageCursorRebaseRequired({ status: 409, code: 'whatsapp_message_cursor_rebase_required' }), true)
  assert.equal(isWhatsAppMessageCursorRebaseRequired({ status: 403, code: 'whatsapp_message_cursor_rebase_required' }), false)
  assert.equal(isWhatsAppMessageCursorRebaseRequired({ status: 409, code: 'binding_changed' }), false)
})
