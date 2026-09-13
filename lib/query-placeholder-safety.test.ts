import assert from 'node:assert/strict';
import test from 'node:test';

import { reusePreviousDataWhenKeyPartsMatch } from './query-placeholder-safety';

test('nao reutiliza cards da pipeline entre tenants, pipelines ou escopos de autorizacao', () => {
  const data = [{ id: 'lead-org-a' }];
  const current = ['stages-with-leads', 'org-b', 'pipeline-b', 'user-b', 'date', null, null, null, null, null, null, null, null, 'user-b', 'operational'];
  const protectedIndexes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

  assert.equal(
    reusePreviousDataWhenKeyPartsMatch(data, ['stages-with-leads', 'org-a', 'pipeline-b', 'user-b', 'date', null, null, null, null, null, null, null, null, 'user-b'], current, protectedIndexes),
    undefined,
  );
  assert.equal(
    reusePreviousDataWhenKeyPartsMatch(data, ['stages-with-leads', 'org-b', 'pipeline-a', 'user-b', 'date', null, null, null, null, null, null, null, null, 'user-b'], current, protectedIndexes),
    undefined,
  );
  assert.equal(
    reusePreviousDataWhenKeyPartsMatch(data, ['stages-with-leads', 'org-b', 'pipeline-b', 'user-a', 'date', null, null, null, null, null, null, null, null, 'user-a'], current, protectedIndexes),
    undefined,
  );
});

test('nao reutiliza cards quando data, busca ou modo mudam no mesmo escopo', () => {
  const data = [{ id: 'lead-1' }];
  const previous = ['stages-with-leads', 'org-1', 'pipeline-1', undefined, 'old-date', null, null, null, 'old-search', null, null, null, null, 'user-1,user-2', 'operational'];
  const current = ['stages-with-leads', 'org-1', 'pipeline-1', undefined, 'new-date', null, null, null, 'new-search', null, null, null, null, 'user-1,user-2', 'origin'];

  assert.equal(
    reusePreviousDataWhenKeyPartsMatch(
      data,
      previous,
      current,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    ),
    undefined,
  );
});

test('nao reutiliza opcoes de meta-filtros de outra organizacao', () => {
  const options = { sources: ['meta'], campaigns: [], adsets: [], ads: [] };

  assert.equal(
    reusePreviousDataWhenKeyPartsMatch(
      options,
      ['shared-filter-lead-meta-filters', 'org-a', 'pipeline-1', 'from', 'to', 'operational'],
      ['shared-filter-lead-meta-filters', 'org-b', 'pipeline-1', 'from', 'to', 'operational'],
      [1],
    ),
    undefined,
  );
});
