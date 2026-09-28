import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canEditStageOperationalRules,
  canManagePipeline,
  canManageStageAutomations,
  canViewStageAutomations,
} from './pipeline-settings-access'

const profiles = [
  {
    name: 'sem permissão de configuração',
    permissions: [],
    module: true,
    expected: [false, false, false, false],
  },
  {
    name: 'gerente da pipeline sem acesso às automações',
    permissions: ['pipeline_manage'],
    module: true,
    expected: [true, true, false, false],
  },
  {
    name: 'leitor de automações',
    permissions: ['automations_view'],
    module: true,
    expected: [false, false, true, false],
  },
  {
    name: 'gerente de automações sem permissão de leitura',
    permissions: ['automations_manage'],
    module: true,
    expected: [false, true, false, false],
  },
  {
    name: 'editor de automações com leitura',
    permissions: ['automations_view', 'automations_manage'],
    module: true,
    expected: [false, true, true, true],
  },
  {
    name: 'editor de automações com módulo desativado',
    permissions: ['automations_view', 'automations_manage'],
    module: false,
    expected: [false, true, false, false],
  },
  {
    name: 'administrador',
    permissions: ['*'],
    module: true,
    expected: [true, true, true, true],
  },
] as const

for (const profile of profiles) {
  test(`capacidades de configuração: ${profile.name}`, () => {
    const hasPermission = (permission: string) => (
      profile.permissions.some((granted) => granted === '*' || granted === permission)
    )

    assert.deepEqual([
      canManagePipeline(hasPermission),
      canEditStageOperationalRules(hasPermission),
      canViewStageAutomations(hasPermission, profile.module),
      canManageStageAutomations(hasPermission, profile.module),
    ], profile.expected)
  })
}
