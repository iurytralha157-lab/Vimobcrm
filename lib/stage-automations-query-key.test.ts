import assert from 'node:assert/strict'
import test from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import { createTenantQueryAccessSignature } from './access/tenant-query-cache'
import { stageAutomationsQueryKey } from './stage-automations-query-key'

test('automacoes de outro usuario ou permissao nao reaproveitam o cache anterior', () => {
  const organizationId = 'organization-a'
  const stageId = 'stage-a'
  const managerSignature = createTenantQueryAccessSignature({
    userId: 'manager',
    organizationId,
    permissions: ['automations_view', 'automations_manage'],
    enabledModules: ['automations'],
  })
  const readerSignature = createTenantQueryAccessSignature({
    userId: 'reader',
    organizationId,
    permissions: ['automations_view'],
    enabledModules: ['automations'],
  })
  const revokedSignature = createTenantQueryAccessSignature({
    userId: 'manager',
    organizationId,
    permissions: [],
    enabledModules: ['automations'],
  })
  const managerKey = stageAutomationsQueryKey(stageId, organizationId, 'manager', managerSignature)
  const readerKey = stageAutomationsQueryKey(stageId, organizationId, 'reader', readerSignature)
  const revokedKey = stageAutomationsQueryKey(stageId, organizationId, 'manager', revokedSignature)
  const client = new QueryClient()

  client.setQueryData(managerKey, [{ id: 'private-automation' }])
  assert.deepEqual(client.getQueryData(managerKey), [{ id: 'private-automation' }])
  assert.equal(client.getQueryData(readerKey), undefined)
  assert.equal(client.getQueryData(revokedKey), undefined)
  assert.equal(managerKey[0], 'stage-automations')
  assert.equal(managerKey[1], stageId)
})
