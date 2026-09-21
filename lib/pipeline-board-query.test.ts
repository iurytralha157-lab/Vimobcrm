import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPipelineBoardQuery } from './pipeline-board-query';

test('serializa o contrato legado de data operacional quando ha periodo sem modo', () => {
  const query = buildPipelineBoardQuery({
    pipelineId: 'pipeline-1',
    filters: {
      dateRange: {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-31T23:59:59.999Z'),
      },
    },
  });

  assert.equal(query.dateFrom, '2026-08-01T00:00:00.000Z');
  assert.equal(query.dateTo, '2026-08-31T23:59:59.999Z');
  assert.equal(query.dateMode, 'operational');
});

test('serializa modo de origem e preserva escopo vazio explicito', () => {
  const query = buildPipelineBoardQuery({
    filters: {
      dateMode: 'origin',
      dateRange: {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-31T23:59:59.999Z'),
      },
      filterUserIds: [],
    },
  });

  assert.equal(query.dateMode, 'origin');
  assert.equal(query.filterUserIds, '__none__');
});

test('serializa tags selecionadas de forma estavel e omite selecao vazia', () => {
  const query = buildPipelineBoardQuery({
    filters: { filterTags: ['tag-2', 'tag-1', 'tag-2'] },
  });
  const emptyQuery = buildPipelineBoardQuery({ filters: { filterTags: [] } });

  assert.equal(query.filterTags, 'tag-1,tag-2');
  assert.equal(emptyQuery.filterTags, undefined);
});

test('estado inicial omite completamente o recorte temporal e nao transforma escopo ausente', () => {
  const query = buildPipelineBoardQuery({ filters: { dateMode: 'operational' } });

  assert.equal(query.dateFrom, undefined);
  assert.equal(query.dateTo, undefined);
  assert.equal(query.dateMode, undefined);
  assert.equal(query.filterUserIds, undefined);
});

test('omite cursor incompleto e preserva o fallback compativel por offset', () => {
  const query = buildPipelineBoardQuery({
    pipelineId: 'pipeline-1',
    stageId: 'stage-1',
    offset: 50,
    cursorBefore: '2026-09-08T10:30:00.000Z',
  });

  assert.equal(query.offset, 50);
  assert.equal(query.cursorBefore, undefined);
  assert.equal(query.cursorBeforeId, undefined);
});

test('envia cursor keyset completo e preserva offset como fallback', () => {
  const query = buildPipelineBoardQuery({
    pipelineId: 'pipeline-1',
    stageId: 'stage-1',
    offset: 24,
    cursorBefore: '2026-09-08T10:30:00.000Z',
    cursorBeforeId: '11111111-1111-4111-8111-111111111111',
  });

  assert.equal(query.offset, 24);
  assert.equal(query.cursorBefore, '2026-09-08T10:30:00.000Z');
  assert.equal(query.cursorBeforeId, '11111111-1111-4111-8111-111111111111');
});

test('serializa o filtro sem responsavel sem ocupar o campo UUID do usuario', () => {
  const query = buildPipelineBoardQuery({
    filters: { unassigned: true, teamId: 'team-1' },
  });
  const inactiveQuery = buildPipelineBoardQuery({
    filters: { unassigned: false },
  });

  assert.equal(query.filterUserId, undefined);
  assert.equal(query.unassigned, true);
  assert.equal(query.teamId, 'team-1');
  assert.equal(inactiveQuery.unassigned, undefined);
});
