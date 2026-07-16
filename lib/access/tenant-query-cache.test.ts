import assert from 'node:assert/strict'
import test from 'node:test'

import { createTenantQueryAccessSignature } from './tenant-query-cache'

const baseContext = {
  userId: 'user-a',
  organizationId: 'organization-a',
  memberRole: 'user',
  permissions: ['lead_view_team', 'lead_operate'],
  enabledModules: ['crm', 'dashboard'],
  isTeamLeader: true,
  ledTeamIds: ['team-b', 'team-a'],
  ledUserIds: ['user-b', 'user-a'],
  ledPipelineIds: ['pipeline-b', 'pipeline-a'],
  isSuperAdmin: false,
}

test('assinatura nao depende da ordem de listas de acesso', () => {
  const first = createTenantQueryAccessSignature(baseContext)
  const second = createTenantQueryAccessSignature({
    ...baseContext,
    permissions: [...baseContext.permissions].reverse(),
    enabledModules: [...baseContext.enabledModules].reverse(),
    ledTeamIds: [...baseContext.ledTeamIds].reverse(),
    ledUserIds: [...baseContext.ledUserIds].reverse(),
    ledPipelineIds: [...baseContext.ledPipelineIds].reverse(),
  })

  assert.equal(first, second)
})

test('assinatura muda ao trocar organizacao, permissao ou escopo liderado', () => {
  const signature = createTenantQueryAccessSignature(baseContext)

  assert.notEqual(signature, createTenantQueryAccessSignature({ ...baseContext, organizationId: 'organization-b' }))
  assert.notEqual(signature, createTenantQueryAccessSignature({ ...baseContext, permissions: ['lead_view_own'] }))
  assert.notEqual(signature, createTenantQueryAccessSignature({ ...baseContext, ledTeamIds: ['team-a'] }))
})
