import assert from 'node:assert/strict';
import test from 'node:test';

import { stageWithLeadsQueryKey } from './pipeline-query-key';

test('normaliza filtros vazios para uma unica chave canonica da pipeline', () => {
  const base = {
    organizationId: 'org-1',
    pipelineId: 'pipeline-1',
  };

  assert.deepEqual(
    stageWithLeadsQueryKey(base),
    stageWithLeadsQueryKey({
      ...base,
      filters: {
        filterTag: 'all',
        filterDealStatus: null,
        searchQuery: '',
        filterCampaign: 'all',
      },
    }),
  );
});

test('inclui datas, escopo e filtros efetivos na chave da pipeline', () => {
  const key = stageWithLeadsQueryKey({
    organizationId: 'org-1',
    pipelineId: 'pipeline-1',
    filterUserId: 'user-1',
    filters: {
      dateRange: {
        from: new Date('2026-07-01T00:00:00.000Z'),
        to: new Date('2026-07-31T23:59:59.000Z'),
      },
      filterTag: 'tag-1',
      filterUserIds: ['user-1', 'user-2'],
    },
  });

  assert.equal(key[4], '2026-07-01T00:00:00.000Z');
  assert.equal(key[5], '2026-07-31T23:59:59.000Z');
  assert.equal(key[6], 'tag-1');
  assert.equal(key[13], 'user-1,user-2');
});

test('nao duplica cache quando o mesmo escopo de usuarios muda de ordem', () => {
  const base = {
    organizationId: 'org-1',
    pipelineId: 'pipeline-1',
  };

  assert.deepEqual(
    stageWithLeadsQueryKey({
      ...base,
      filters: { filterUserIds: ['user-2', 'user-1', 'user-2'] },
    }),
    stageWithLeadsQueryKey({
      ...base,
      filters: { filterUserIds: ['user-1', 'user-2'] },
    }),
  );
});

test('separa cache irrestrito de um escopo explicitamente vazio', () => {
  const base = {
    organizationId: 'org-1',
    pipelineId: 'pipeline-1',
  };

  const unrestricted = stageWithLeadsQueryKey(base);
  const emptyScope = stageWithLeadsQueryKey({
    ...base,
    filters: { filterUserIds: [] },
  });

  assert.notDeepEqual(unrestricted, emptyScope);
  assert.equal(unrestricted[13], undefined);
  assert.equal(emptyScope[13], '__none__');
});

test('omite modo sem periodo e preserva compatibilidade operacional quando ha datas', () => {
  const base = {
    organizationId: 'org-1',
    pipelineId: 'pipeline-1',
  };

  const defaultMode = stageWithLeadsQueryKey(base);
  const modeWithoutDate = stageWithLeadsQueryKey({
    ...base,
    filters: { dateMode: 'operational' },
  });
  const dateRange = {
    from: new Date('2026-09-01T00:00:00.000Z'),
    to: new Date('2026-09-30T23:59:59.999Z'),
  };
  const operationalMode = stageWithLeadsQueryKey({
    ...base,
    filters: { dateRange, dateMode: 'operational' },
  });
  const originMode = stageWithLeadsQueryKey({
    ...base,
    filters: { dateRange, dateMode: 'origin' },
  });

  assert.deepEqual(defaultMode, modeWithoutDate);
  assert.equal(defaultMode[14], undefined);
  assert.equal(operationalMode[14], 'operational');
  assert.equal(originMode[14], 'origin');
  assert.notDeepEqual(operationalMode, originMode);
});
