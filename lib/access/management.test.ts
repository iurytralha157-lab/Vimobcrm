import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getAllowedManagementTabs,
  getSafeManagementTab,
  isManagementTab,
} from './management'

function permissions(...allowed: string[]) {
  return (permission: string) => allowed.includes(permission)
}

test('bloqueia gestao para usuario comum sem permissoes', () => {
  const allowedTabs = getAllowedManagementTabs({
    isAdmin: false,
    isTeamLeader: false,
    hasPermission: permissions(),
  })

  assert.deepEqual(allowedTabs, [])
  assert.equal(getSafeManagementTab('pipelines', allowedTabs), null)
})

test('admin acessa todas as abas de gestao', () => {
  const allowedTabs = getAllowedManagementTabs({
    isAdmin: true,
    isTeamLeader: false,
    hasPermission: permissions(),
  })

  assert.deepEqual(allowedTabs, ['teams', 'distribution', 'pipelines', 'tags'])
})

test('lider acessa somente equipes e distribuicao', () => {
  const allowedTabs = getAllowedManagementTabs({
    isAdmin: false,
    isTeamLeader: true,
    hasPermission: permissions(),
  })

  assert.deepEqual(allowedTabs, ['teams', 'distribution'])
  assert.equal(getSafeManagementTab('pipelines', allowedTabs), 'teams')
})

test('permissao de pipelines libera pipelines e tags', () => {
  const allowedTabs = getAllowedManagementTabs({
    isAdmin: false,
    isTeamLeader: false,
    hasPermission: permissions('settings_pipelines'),
  })

  assert.deepEqual(allowedTabs, ['pipelines', 'tags'])
  assert.equal(getSafeManagementTab('tags', allowedTabs), 'tags')
  assert.equal(getSafeManagementTab('teams', allowedTabs), 'pipelines')
})

test('valida nomes de abas conhecidas', () => {
  assert.equal(isManagementTab('distribution'), true)
  assert.equal(isManagementTab('finance'), false)
  assert.equal(isManagementTab(null), false)
})
