import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  PIPELINE_STAGE_RESTORE_LIMIT,
  buildPipelineStageRestorePlans,
  createPipelinePaginationStorageKey,
  getPipelineLeadPageCursor,
  getPipelineStagePaginationAfterPage,
  hasMorePipelineStageLeadsAfterPage,
  mergePipelineStageLoadedCounts,
  parsePipelineStageLoadedCounts,
} from './pipeline-pagination-state';

test('uma pagina vazia ou sem progresso encerra paginacao apesar de total antigo', () => {
  const baseline = { totalCount: 48, loadedCount: 12, requestedCount: 12 };
  assert.equal(hasMorePipelineStageLeadsAfterPage({
    ...baseline, receivedCount: 0, addedCount: 0,
  }), false);
  assert.equal(hasMorePipelineStageLeadsAfterPage({
    ...baseline, receivedCount: 12, addedCount: 0,
  }), false);
  assert.equal(hasMorePipelineStageLeadsAfterPage({
    ...baseline, receivedCount: 12, addedCount: 12,
  }), true);
});

test('continuacao da pagina prevalece sobre o total inicial e sobre uma pagina cheia', () => {
  const progress = { totalCount: 24, loadedCount: 24, receivedCount: 12, addedCount: 12, requestedCount: 12 };
  assert.equal(hasMorePipelineStageLeadsAfterPage({ ...progress, hasMore: true }), true);
  assert.equal(hasMorePipelineStageLeadsAfterPage({ ...progress, hasMore: false }), false);
  assert.equal(hasMorePipelineStageLeadsAfterPage(progress), true, 'API antiga cheia requer uma pagina de confirmacao');
  assert.equal(hasMorePipelineStageLeadsAfterPage({ ...progress, receivedCount: 1 }), false);
});

test('projecao mantem piso conhecido enquanto continua e reconcilia prefixo terminal', () => {
  const progress = { totalCount: 24, loadedCount: 24, receivedCount: 12, addedCount: 12, requestedCount: 12 };
  assert.deepEqual(getPipelineStagePaginationAfterPage({ ...progress, hasMore: true }), {
    has_more: true, total_lead_count: 25, pagination_count_is_estimate: true,
  });
  assert.deepEqual(getPipelineStagePaginationAfterPage(progress), {
    has_more: true, total_lead_count: 25, pagination_count_is_estimate: true,
  });
  assert.deepEqual(getPipelineStagePaginationAfterPage({ ...progress, totalCount: 100, hasMore: false }), {
    has_more: false, total_lead_count: 24, pagination_count_is_estimate: false,
  });
  assert.deepEqual(getPipelineStagePaginationAfterPage({ ...progress, totalCount: 25, loadedCount: 25,
    receivedCount: 1, addedCount: 1, hasMore: false }), {
    has_more: false, total_lead_count: 25, pagination_count_is_estimate: false,
  });
});

test('restauracao com continuacao nao e truncada pela contagem antiga', () => {
  const leads = Array.from({ length: 12 }, (_, index) => ({ id: `lead-${index}`,
    board_sort_at: `2026-10-20T10:00:00.${String(999999 - index).padStart(6, '0')}Z` }));
  assert.deepEqual(buildPipelineStageRestorePlans([
    { id: 'stage-grown', total_lead_count: 12, has_more: true, leads },
  ], { 'stage-grown': 9999 }), [{ stageId: 'stage-grown', offset: 12, limit: 48,
    cursorBefore: '2026-10-20T10:00:00.999988Z', cursorBeforeId: 'lead-11' }]);
  assert.deepEqual(buildPipelineStageRestorePlans([
    { id: 'stage-complete', total_lead_count: 100, has_more: false, leads },
  ], { 'stage-complete': 60 }), []);
});

test('cursor da coluna usa board_sort_at antes dos campos legados', () => {
  assert.deepEqual(
    getPipelineLeadPageCursor({
      id: 'lead-1',
      board_sort_at: '2026-09-12T10:00:00.000Z',
      board_order_at: '2026-09-11T10:00:00.000Z',
      stage_entered_at: '2026-09-10T10:00:00.000Z',
      created_at: '2026-09-09T10:00:00.000Z',
    }),
    {
      cursorBefore: '2026-09-12T10:00:00.000Z',
      cursorBeforeId: 'lead-1',
    },
  );
});

test('cursor preserva fallback legado quando board_sort_at ainda nao existe', () => {
  assert.deepEqual(
    getPipelineLeadPageCursor({
      id: 'lead-1',
      board_order_at: '2026-09-11T10:00:00.000Z',
      stage_entered_at: '2026-09-10T10:00:00.000Z',
      created_at: '2026-09-09T10:00:00.000Z',
    }),
    {
      cursorBefore: '2026-09-11T10:00:00.000Z',
      cursorBeforeId: 'lead-1',
    },
  );
});

test('estado persistido ignora lixo e limita a profundidade por coluna', () => {
  assert.deepEqual(
    parsePipelineStageLoadedCounts(JSON.stringify({
      'stage-small': 12,
      'stage-loaded': 36.9,
      'stage-huge': 9999,
      'stage-invalid': 'not-a-number',
    })),
    {
      'stage-loaded': 36,
      'stage-huge': PIPELINE_STAGE_RESTORE_LIMIT,
    },
  );
  assert.deepEqual(parsePipelineStageLoadedCounts('{invalid'), {});
});

test('plano restaura somente colunas previamente expandidas e nunca carrega tudo', () => {
  const stages = [
    {
      id: 'stage-1',
      total_lead_count: 80,
      leads: Array.from({ length: 12 }, (_, index) => ({
        id: `lead-${index}`,
        board_sort_at: `2026-09-${String(12 - index).padStart(2, '0')}T10:00:00.000Z`,
      })),
    },
    {
      id: 'stage-2',
      total_lead_count: 500,
      leads: Array.from({ length: 12 }, (_, index) => ({ id: `other-${index}` })),
    },
  ];

  assert.deepEqual(
    buildPipelineStageRestorePlans(stages, {
      'stage-1': 36,
      'stage-2': 12,
    }),
    [{
      stageId: 'stage-1',
      offset: 12,
      limit: 24,
      cursorBefore: '2026-09-01T10:00:00.000Z',
      cursorBeforeId: 'lead-11',
    }],
  );
});

test('nao tenta restaurar coluna que o backend marcou sem proxima pagina', () => {
  assert.deepEqual(
    buildPipelineStageRestorePlans([
      {
        id: 'stage-completa',
        total_lead_count: 60,
        has_more: false,
        leads: Array.from({ length: 12 }, (_, index) => ({ id: `lead-${index}` })),
      },
    ], { 'stage-completa': 60 }),
    [],
  );
});

test('mescla cache atual com sessao sem reduzir profundidade ja carregada', () => {
  assert.deepEqual(
    mergePipelineStageLoadedCounts(
      { 'stage-1': 24 },
      { 'stage-1': 36, 'stage-2': 24 },
    ),
    { 'stage-1': 36, 'stage-2': 24 },
  );
});

test('chave persistida e estavel por usuario e escopo sem expor filtros', () => {
  const queryKey = ['stages-with-leads', 'org-1', 'pipeline-1', undefined, undefined, undefined, undefined, undefined, 'nome privado'];
  const first = createPipelinePaginationStorageKey('user-1', queryKey);
  const second = createPipelinePaginationStorageKey('user-1', [...queryKey]);
  const otherUser = createPipelinePaginationStorageKey('user-2', queryKey);

  assert.equal(first, second);
  assert.notEqual(first, otherUser);
  assert.equal(first.includes('nome privado'), false);
});

test('hook entrega a primeira pagina antes de restaurar profundidade em background', () => {
  const source = readFileSync(resolve(process.cwd(), 'hooks/use-stages.ts'), 'utf8');
  const hookStart = source.indexOf('export function useStagesWithLeads');
  const hookEnd = source.indexOf('export function useLeadMetaFilters', hookStart);
  assert.ok(hookStart >= 0 && hookEnd > hookStart, 'useStagesWithLeads nao encontrado');

  const hookSource = source.slice(hookStart, hookEnd);
  const queryFnStart = hookSource.indexOf('queryFn: async');
  const queryFnEnd = hookSource.indexOf('retry: shouldRetryPipelineQuery', queryFnStart);
  assert.ok(queryFnStart >= 0 && queryFnEnd > queryFnStart, 'queryFn do board nao encontrado');

  const initialQuerySource = hookSource.slice(queryFnStart, queryFnEnd);
  assert.match(initialQuerySource, /return \(await getPipelineBoard\(/);
  assert.doesNotMatch(initialQuerySource, /buildPipelineStageRestorePlans|getPipelineStageLeads/);

  const backgroundRestoreSource = hookSource.slice(queryFnEnd);
  assert.match(backgroundRestoreSource, /buildPipelineStageRestorePlans\(/);
  assert.match(backgroundRestoreSource, /for \(const plan of restorePlans\)/);
  assert.doesNotMatch(backgroundRestoreSource, /Promise\.all\(/);
});
