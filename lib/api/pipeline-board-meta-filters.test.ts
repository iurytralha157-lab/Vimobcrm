import assert from 'node:assert/strict'
import test from 'node:test'

import { sanitizeLeadMetaFiltersEnvelope } from './pipeline-board-meta-filters'
import { leadMetaFiltersResponseSchema } from '../validation/pipelines'

test('remove apenas opções meta vazias ou órfãs e preserva origens e campanhas válidas', () => {
  const sanitized = sanitizeLeadMetaFiltersEnvelope({
    data: {
      sources: ['manual', '', 'meta'],
      campaigns: [
        { id: 'campaign-1', name: 'Campanha válida' },
        { id: '', name: 'Campanha sem id' },
      ],
      adsets: [
        { id: 'adset-1', name: 'Conjunto válido', campaignId: 'campaign-1' },
        { id: 'adset-orphan', name: 'Conjunto órfão', campaignId: '' },
        { id: 'adset-missing-parent', name: 'Pai ausente', campaignId: 'campaign-missing' },
      ],
      ads: [
        { id: 'ad-1', name: 'Anúncio válido', adsetId: 'adset-1', campaignId: 'campaign-1' },
        { id: 'ad-orphan-1', name: 'Sem conjunto', adsetId: '', campaignId: 'campaign-1' },
        { id: 'ad-orphan-2', name: 'Sem pais', adsetId: '', campaignId: '' },
        { id: 'ad-orphan-3', name: 'Conjunto ausente', adsetId: 'adset-missing', campaignId: 'campaign-1' },
      ],
    },
  })

  assert.deepEqual(sanitized, {
    data: {
      sources: ['manual', 'meta'],
      campaigns: [{ id: 'campaign-1', name: 'Campanha válida' }],
      adsets: [{ id: 'adset-1', name: 'Conjunto válido', campaignId: 'campaign-1' }],
      ads: [{ id: 'ad-1', name: 'Anúncio válido', adsetId: 'adset-1', campaignId: 'campaign-1' }],
    },
  })
  assert.equal(leadMetaFiltersResponseSchema.safeParse(sanitized).success, true)
})

test('não mascara tipos inválidos que o contrato Zod deve rejeitar', () => {
  const sanitized = sanitizeLeadMetaFiltersEnvelope({
    data: {
      sources: ['manual'],
      campaigns: [{ id: 123, name: 'Tipo inválido' }],
      adsets: [],
      ads: [],
    },
  })

  assert.equal(leadMetaFiltersResponseSchema.safeParse(sanitized).success, false)
})
