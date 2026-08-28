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
