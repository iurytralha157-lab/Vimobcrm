import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePipelineFilterScopeState } from './pipeline-filter-readiness';

test('filtro sem seleção dinâmica está pronto sem buscar opções', () => {
  assert.deepEqual(resolvePipelineFilterScopeState({
    hasSelection: false,
    loadEnabled: false,
    dataUpdatedAt: 0,
    selectionMatchesCachedOptions: false,
    queryError: null,
  }), { ready: true, error: null });
});

test('seleção persistida aguarda a consulta canônica antes de liberar o board', () => {
  assert.deepEqual(resolvePipelineFilterScopeState({
    hasSelection: true,
    loadEnabled: true,
    dataUpdatedAt: 0,
    selectionMatchesCachedOptions: false,
    queryError: null,
  }), { ready: false, error: null });
});

test('falha de refetch preserva uma seleção comprovada pelo cache', () => {
  assert.deepEqual(resolvePipelineFilterScopeState({
    hasSelection: true,
    loadEnabled: true,
    dataUpdatedAt: 123,
    selectionMatchesCachedOptions: true,
    queryError: new Error('offline'),
  }), { ready: true, error: null });
});

test('falha de refetch com cache incompatível vira erro recuperável, não loading infinito', () => {
  const queryError = new Error('offline');
  assert.deepEqual(resolvePipelineFilterScopeState({
    hasSelection: true,
    loadEnabled: true,
    dataUpdatedAt: 123,
    selectionMatchesCachedOptions: false,
    queryError,
  }), { ready: false, error: queryError });
});
