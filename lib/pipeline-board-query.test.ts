import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPipelineBoardQuery,
  buildPipelineLeadMetaFilterQuery,
  buildPipelineLeadMetaFilterQueryKey,
} from './pipeline-board-query';

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

test('filtro de equipe não exige corretor e mantém a escolha explícita de usuário', () => {
  const teamQuery = buildPipelineBoardQuery({ filters: { teamId: 'team-1' } });
  const brokerQuery = buildPipelineBoardQuery({
    filterUserId: 'broker-1',
    filters: { teamId: 'team-1' },
  });

  assert.equal(teamQuery.teamId, 'team-1');
  assert.equal(teamQuery.filterUserIds, undefined);
  assert.equal(teamQuery.filterUserId, undefined);
  assert.equal(brokerQuery.teamId, 'team-1');
  assert.equal(brokerQuery.filterUserId, 'broker-1');
  assert.equal(brokerQuery.filterUserIds, undefined);
});

test('serializa a pagina Meta como identidade opaca sem alterar o valor', () => {
  const query = buildPipelineBoardQuery({
    filters: {
      filterPage: '123456789012345',
      filterCampaign: 'campaign-1',
    },
  });

  assert.equal(query.filterPage, '123456789012345');
  assert.equal(query.filterCampaign, 'campaign-1');
});

test('opções da Pipeline usam o mesmo recorte de equipe, corretor, status, tags, busca, data e página do quadro', () => {
  const dateRange = {
    from: new Date('2026-09-01T00:00:00.000Z'),
    to: new Date('2026-09-07T23:59:59.999Z'),
  };
  const query = buildPipelineLeadMetaFilterQuery({
    scopeToBoard: true,
    pipelineId: 'pipeline-1',
    filterPage: 'page-1',
    dateRange,
    dateMode: 'origin',
    teamId: 'team-1',
    userId: 'user-1',
    dealStatus: 'lost',
    tagIds: ['tag-2', 'tag-1', 'tag-2'],
    searchQuery: 'Maria',
  });
  if (!('filterUserId' in query)) {
    throw new Error('As opções da Pipeline devem usar o contrato do quadro');
  }

  assert.equal(query.pipelineId, 'pipeline-1');
  assert.equal(query.filterPage, 'page-1');
  assert.equal(query.dateFrom, dateRange.from.toISOString());
  assert.equal(query.dateTo, dateRange.to.toISOString());
  assert.equal(query.dateMode, 'origin');
  assert.equal(query.teamId, 'team-1');
  assert.equal(query.filterUserId, 'user-1');
  assert.equal(query.filterDealStatus, 'lost');
  assert.equal(query.filterTags, 'tag-1,tag-2');
  assert.equal(query.search, 'Maria');
  assert.equal(query.filterSource, undefined);
  assert.equal(query.filterCampaign, undefined);
  assert.equal(query.filterAdSet, undefined);
  assert.equal(query.filterAd, undefined);
});

test('opções da Pipeline preservam sem responsável sem enviar sentinela no UUID', () => {
  const query = buildPipelineLeadMetaFilterQuery({
    scopeToBoard: true,
    teamId: 'team-1',
    userId: 'unassigned',
  });
  if (!('unassigned' in query)) {
    throw new Error('As opções da Pipeline devem preservar o filtro sem responsável');
  }

  assert.equal(query.teamId, 'team-1');
  assert.equal(query.unassigned, true);
  assert.equal(query.filterUserId, undefined);
});

test('opções de entrada da Dashboard conservam o contrato próprio', () => {
  const query = buildPipelineLeadMetaFilterQuery({
    entryMode: true,
    teamId: 'team-1',
    userId: 'user-1',
    dealStatus: 'won',
    tagIds: ['tag-2', 'tag-1'],
    searchQuery: 'Maria',
  });
  if (!('entryMode' in query)) {
    throw new Error('As opções da Dashboard devem usar o contrato de entradas');
  }

  assert.equal(query.entryMode, true);
  assert.equal(query.teamId, 'team-1');
  assert.equal(query.userId, 'user-1');
  assert.equal(query.dealStatus, 'won');
  assert.equal(query.tagIds, 'tag-2,tag-1');
  assert.equal(query.searchQuery, 'Maria');
  assert.equal('filterUserId' in query, false);
  assert.equal('filterDealStatus' in query, false);
  assert.equal('filterTags' in query, false);
  assert.equal('search' in query, false);
});

test('consumidores compartilhados sem escopo do quadro mantêm o contrato anterior', () => {
  const query = buildPipelineLeadMetaFilterQuery({
    pipelineId: 'pipeline-1',
    filterPage: 'page-1',
    teamId: 'team-1',
    userId: 'user-1',
    dealStatus: 'lost',
    tagIds: ['tag-1'],
    searchQuery: 'Maria',
  });

  assert.equal(query.pipelineId, 'pipeline-1');
  assert.equal(query.filterPage, 'page-1');
  assert.equal('teamId' in query, false);
  assert.equal('filterUserId' in query, false);
  assert.equal('filterDealStatus' in query, false);
  assert.equal('filterTags' in query, false);
  assert.equal('search' in query, false);
});

test('cache das opções da Pipeline separa usuário, escopo, busca e assinatura de acesso', () => {
  const base = {
    organizationId: 'org-1',
    pipelineId: 'pipeline-1',
    entryMode: false,
    scopeToBoard: true,
    accessSignature: 'leader-team-1',
    teamId: 'team-1',
    userId: 'user-1',
    dealStatus: 'open',
    tagIds: ['tag-1'],
    searchQuery: 'Maria',
  };
  const key = buildPipelineLeadMetaFilterQueryKey(base);

  for (const change of [
    { accessSignature: 'leader-team-2' },
    { teamId: 'team-2' },
    { userId: 'user-2' },
    { dealStatus: 'lost' },
    { tagIds: ['tag-2'] },
    { searchQuery: 'João' },
  ]) {
    assert.notDeepEqual(buildPipelineLeadMetaFilterQueryKey({ ...base, ...change }), key);
  }
  assert.deepEqual(
    buildPipelineLeadMetaFilterQueryKey({ ...base, tagIds: ['tag-1', 'tag-2'] }),
    buildPipelineLeadMetaFilterQueryKey({ ...base, tagIds: ['tag-2', 'tag-1'] }),
  );
});

test('cache legado permanece estável e não se mistura com Pipeline nem Dashboard', () => {
  const base = {
    organizationId: 'org-1',
    entryMode: false,
    scopeToBoard: false,
    accessSignature: 'admin',
    teamId: 'team-1',
  };
  const legacyKey = buildPipelineLeadMetaFilterQueryKey(base);

  assert.deepEqual(
    buildPipelineLeadMetaFilterQueryKey({ ...base, teamId: 'team-2', accessSignature: 'broker' }),
    legacyKey,
  );
  assert.notDeepEqual(buildPipelineLeadMetaFilterQueryKey({ ...base, scopeToBoard: true }), legacyKey);
  assert.notDeepEqual(buildPipelineLeadMetaFilterQueryKey({ ...base, entryMode: true }), legacyKey);
});
