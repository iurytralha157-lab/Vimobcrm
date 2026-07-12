import assert from 'node:assert/strict'
import test from 'node:test'

import {
  filterNavigationItems,
  type NavigationAccess,
  type NavigationAccessItem,
} from './navigation'

const baseAccess: NavigationAccess = {
  isSuperAdmin: false,
  canAccessAdminItems: false,
  canAccessFinancialModule: false,
  isTeamLeader: false,
  hasModule: () => true,
  hasPermission: () => false,
}

test('remove recursos desligados da navegacao', () => {
  const items: NavigationAccessItem[] = [
    { path: '/dashboard' },
    { path: '/attention', feature: 'ENABLE_ATTENTION_CENTER' },
  ]

  assert.deepEqual(
    filterNavigationItems(items, baseAccess).map((item) => item.path),
    ['/dashboard'],
  )
})

test('libera somente as areas de gestao permitidas ao lider de equipe', () => {
  const items: NavigationAccessItem[] = [{
    path: '/crm/management',
    anyPermissions: ['settings_teams', 'settings_pipelines'],
    children: [
      { path: '/crm/management?tab=teams', anyPermissions: ['settings_teams'] },
      { path: '/crm/management?tab=pipelines', permission: 'settings_pipelines' },
    ],
  }]

  const result = filterNavigationItems(items, { ...baseAccess, isTeamLeader: true })
  assert.equal(result.length, 1)
  assert.deepEqual(result[0].children?.map((item) => item.path), [
    '/crm/management?tab=teams',
  ])
})

test('mantem modulos e itens administrativos sob suas regras atuais', () => {
  const items: NavigationAccessItem[] = [
    { path: '/properties', module: 'properties' },
    { path: '/financeiro', module: 'financial', adminOnly: true },
  ]

  const result = filterNavigationItems(items, {
    ...baseAccess,
    canAccessAdminItems: true,
    canAccessFinancialModule: true,
    hasModule: () => true,
  })

  assert.deepEqual(result.map((item) => item.path), ['/properties', '/financeiro'])
})
