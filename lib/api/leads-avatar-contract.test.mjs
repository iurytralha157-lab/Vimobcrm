import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import yaml from 'js-yaml'

const clientSource = readFileSync('lib/api/leads.ts', 'utf8')
const openAPI = yaml.load(readFileSync('packages/contracts/openapi/v1.yaml', 'utf8'))

test('o adaptador de leads preserva o avatar retornado pela API', () => {
  assert.match(clientSource, /whatsappAvatarUrl\?: string/)
  assert.match(clientSource, /whatsappAvatarSyncedAt\?: string/)
  assert.match(
    clientSource,
    /whatsapp_avatar_url: lead\.whatsappAvatarUrl \?\? null/,
  )
  assert.match(
    clientSource,
    /whatsapp_avatar_synced_at: lead\.whatsappAvatarSyncedAt \?\? null/,
  )
  assert.doesNotMatch(clientSource, /whatsapp_avatar_url: null/)
  assert.doesNotMatch(clientSource, /whatsapp_avatar_synced_at: null/)
})

test('o OpenAPI documenta o avatar nas respostas de lead e do board', () => {
  const lead = openAPI.components.schemas.Lead
  const boardLead = openAPI.components.schemas.PipelineBoardLead

  assert.equal(lead.properties.whatsappAvatarUrl.format, 'uri')
  assert.equal(lead.properties.whatsappAvatarSyncedAt.format, 'date-time')
  assert.deepEqual(boardLead.properties.whatsapp_avatar_url.type, ['string', 'null'])
  assert.equal(boardLead.properties.whatsapp_avatar_url.format, 'uri')
})
