import assert from 'node:assert/strict'
import test from 'node:test'

import type { PropertyChannelPublication } from '../../../../lib/validation/property-publications'
const publicationActionPath = './publication-action.ts'
const { publicationPublishBlockReason, publicationUnavailableReason } = await import(publicationActionPath)

function sitePublication(overrides: Partial<PropertyChannelPublication> = {}): PropertyChannelPublication {
  return {
    id: null,
    channel: 'site',
    channel_account_key: 'default',
    label: 'Site',
    available: true,
    desired_state: 'unpublished',
    observed_state: 'draft',
    readiness_state: 'ready',
    readiness_score: 100,
    checks: [],
    current_version: 0,
    published_version: null,
    is_outdated: false,
    public_url: null,
    preview: {},
    capabilities: { can_publish: true, can_unpublish: false, can_retry: false, can_preview: false },
    last_error: null,
    recent_jobs: [],
    ...overrides,
  }
}

test('explains unavailable Site even when all readiness checks say 100 percent', () => {
  const publication = sitePublication({
    available: false,
    capabilities: { can_publish: false, can_unpublish: false, can_retry: false, can_preview: false },
  })
  assert.match(publicationPublishBlockReason(publication) ?? '', /Site está indisponível no acesso/)
})

test('uses the specific failed module check when the API supplies it', () => {
  const publication = sitePublication({
    available: false,
    checks: [{ code: 'site_module', label: 'Módulo Site ativo', severity: 'error', resolved: false, message: 'Ative o módulo Site para esta organização.' }],
  })
  assert.equal(publicationUnavailableReason(publication), 'Ative o módulo Site para esta organização.')
})

test('reports required property data separately from channel configuration', () => {
  const publication = sitePublication({
    readiness_state: 'blocked',
    checks: [{ code: 'description', label: 'Descrição pública', severity: 'error', resolved: false }],
    capabilities: { can_publish: false, can_unpublish: false, can_retry: false, can_preview: false },
  })
  assert.match(publicationPublishBlockReason(publication) ?? '', /1 pendência/)
})

test('recognizes a ready channel and an already published version', () => {
  assert.equal(publicationPublishBlockReason(sitePublication()), null)
  assert.equal(publicationPublishBlockReason(sitePublication({
    desired_state: 'published',
    observed_state: 'published',
    published_version: 1,
    capabilities: { can_publish: false, can_unpublish: true, can_retry: false, can_preview: true },
  })), 'A versão atual já está publicada.')
})
