import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canOperateLeadFromFreshRead,
  mergeLeadOperationCapability,
} from './lead-operation-capability';

const cachedLead = {
  id: 'lead-1',
  assigned_user_id: 'user-1',
  team_id: 'team-1',
  can_operate: true,
  name: 'Antes',
};

test('resposta de escrita sem capacidade preserva o GET quando o escopo não mudou', () => {
  const result = mergeLeadOperationCapability(cachedLead, {
    id: cachedLead.id,
    assigned_user_id: cachedLead.assigned_user_id,
    team_id: cachedLead.team_id,
    name: 'Depois',
  });

  assert.equal(result.can_operate, true);
  assert.equal(result.name, 'Depois');
});

test('troca de responsável ou equipe invalida a capacidade em cache', () => {
  for (const change of [
    { assigned_user_id: 'user-2' },
    { team_id: 'team-2' },
  ]) {
    const result = mergeLeadOperationCapability(cachedLead, {
      id: cachedLead.id,
      name: cachedLead.name,
      assigned_user_id: cachedLead.assigned_user_id,
      team_id: cachedLead.team_id,
      ...change,
    });
    assert.equal(result.can_operate, undefined);
  }
});

test('um GET com capacidade explícita prevalece, inclusive false', () => {
  const result = mergeLeadOperationCapability(cachedLead, {
    ...cachedLead,
    can_operate: false,
  });

  assert.equal(result.can_operate, false);
});

test('detalhe somente opera após GET fresco e autorização explícita', () => {
  const fetched = {
    isSuccess: true,
    isFetchedAfterMount: true,
    isFetching: false,
    data: { can_operate: true },
  };

  assert.equal(canOperateLeadFromFreshRead(true, fetched), true);
  assert.equal(canOperateLeadFromFreshRead(false, fetched), false);
  assert.equal(canOperateLeadFromFreshRead(true, { ...fetched, isFetchedAfterMount: false }), false);
  assert.equal(canOperateLeadFromFreshRead(true, { ...fetched, isFetching: true }), false);
  assert.equal(canOperateLeadFromFreshRead(true, { ...fetched, isSuccess: false }), false);
  assert.equal(canOperateLeadFromFreshRead(true, { ...fetched, data: { can_operate: false } }), false);
  assert.equal(canOperateLeadFromFreshRead(true, { ...fetched, data: {} }), false);
});
