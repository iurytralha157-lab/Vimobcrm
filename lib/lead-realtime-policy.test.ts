import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isWhatsAppOnlyLeadRealtimeBatch,
  shouldRefreshLeadMetaFilters,
} from './lead-realtime-policy'

test('mantém lotes exclusivamente de WhatsApp no caminho leve', () => {
  assert.equal(
    isWhatsAppOnlyLeadRealtimeBatch(['lead.whatsapp_activity', 'whatsapp.message.received']),
    true,
  )
  assert.equal(
    isWhatsAppOnlyLeadRealtimeBatch(['lead.whatsapp_activity', 'lead.updated']),
    false,
  )
  assert.equal(isWhatsAppOnlyLeadRealtimeBatch([]), false)
})

test('atualiza opções de campanha somente quando a atribuição pode ter mudado', () => {
  assert.equal(shouldRefreshLeadMetaFilters(['lead.created']), true)
  assert.equal(shouldRefreshLeadMetaFilters(['lead.assigned']), true)
  assert.equal(shouldRefreshLeadMetaFilters(['lead.deleted']), true)
  assert.equal(shouldRefreshLeadMetaFilters(['lead.redistributed']), true)
  assert.equal(shouldRefreshLeadMetaFilters(['lead.stage_moved']), true)
  assert.equal(shouldRefreshLeadMetaFilters(['lead.updated']), true)
  assert.equal(shouldRefreshLeadMetaFilters(['lead.tagged']), false)
  assert.equal(shouldRefreshLeadMetaFilters(['lead.whatsapp_activity']), false)
  assert.equal(shouldRefreshLeadMetaFilters([]), true)
})
