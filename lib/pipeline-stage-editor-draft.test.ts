import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveStageEditorDraft,
  pinStageEditorDraft,
  updateStageEditorDraft,
} from './pipeline-stage-editor-draft'

test('mantém rascunho e versão original após atualização de outra sessão', () => {
  const original = [{ id: 'stage-a', name: 'Entrada', updated_at: 't1' }]
  const edited = [{ id: 'stage-a', name: 'Contato', updated_at: 't1' }]
  const changedRemotely = [{ id: 'stage-a', name: 'Novo', updated_at: 't2' }]
  const draft = updateStageEditorDraft(null, 'pipeline-a', 'version-t1', original, edited, true)
  const view = resolveStageEditorDraft(draft, 'pipeline-a', 'version-t2', changedRemotely)

  assert.equal(view.isStale, true)
  assert.deepEqual(view.stages, edited)
  assert.deepEqual(view.sourceStages, original)

  const editedAgain = [{ ...edited[0], name: 'Contato prioritário' }]
  const later = updateStageEditorDraft(draft, 'pipeline-a', 'version-t2', changedRemotely, editedAgain, true)
  assert.equal(later.sourceKey, 'version-t1')
  assert.deepEqual(later.sourceStages, original)
})

test('descarta rascunho de outro funil e usa dados atuais', () => {
  const draft = updateStageEditorDraft(null, 'pipeline-a', 'v1', ['antigo'], ['alterado'], true)
  const view = resolveStageEditorDraft(draft, 'pipeline-b', 'v1', ['atual'])
  assert.deepEqual(view.stages, ['atual'])
  assert.equal(view.hasChanges, false)
  assert.equal(view.isStale, false)
})

test('digitação em andamento mantém a revisão anterior ao refetch', () => {
  const before = [{ id: 'stage-a', name: 'Entrada', updated_at: '2026-10-16T12:00:00.123456Z' }]
  const after = [{ ...before[0], name: 'Outro gestor', updated_at: '2026-10-16T12:00:00.123457Z' }]
  const pinned = pinStageEditorDraft(null, 'pipeline-a', 'old', before)
  const view = resolveStageEditorDraft(pinned, 'pipeline-a', 'new', after)
  assert.equal(view.isStale, true)
  assert.deepEqual(view.sourceStages, before)
  const edited = updateStageEditorDraft(pinned, 'pipeline-a', 'new', after, [{ ...before[0], name: 'Meu rascunho' }], true)
  assert.deepEqual(edited.sourceStages, before)
  assert.equal(edited.sourceKey, 'old')
})
