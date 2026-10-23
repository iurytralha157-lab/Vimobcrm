import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient } from '@tanstack/react-query';

import { canRetainPipelineLeadDraft, handlePipelineSelectedLeadAccessFailure } from './pipeline-selected-lead-access';

test('403 remove dados sensíveis em cache e fecha o detalhe', () => {
  const queryClient = new QueryClient();
  const key = ['lead', 'org-1', 'lead-1'];
  queryClient.setQueryData(key, { name: 'Lead restrito' });
  let closed = false;

  const revoked = handlePipelineSelectedLeadAccessFailure({
    queryClient,
    organizationId: 'org-1',
    leadId: 'lead-1',
    status: 403,
    closeDetail: () => { closed = true; },
  });

  assert.equal(revoked, true);
  assert.equal(closed, true);
  assert.equal(queryClient.getQueryData(key), undefined);
  queryClient.clear();
});

test('falha temporária preserva a instância e leitura anterior sem autorizar exibição', () => {
  const queryClient = new QueryClient();
  const key = ['lead', 'org-1', 'lead-1'];
  const previousLead = { name: 'Lead restrito' };
  queryClient.setQueryData(key, previousLead);
  let closed = false;

  const revoked = handlePipelineSelectedLeadAccessFailure({
    queryClient,
    organizationId: 'org-1',
    leadId: 'lead-1',
    status: 503,
    closeDetail: () => { closed = true; },
  });

  assert.equal(revoked, false);
  assert.equal(closed, false);
  assert.deepEqual(queryClient.getQueryData(key), previousLead);
  queryClient.clear();
});

test('só uma leitura já verificada pode preservar a instância; recusas definitivas nunca preservam', () => {
  assert.equal(canRetainPipelineLeadDraft(false, 503), false);
  assert.equal(canRetainPipelineLeadDraft(true, 503), true);
  for (const status of [401, 403, 404]) assert.equal(canRetainPipelineLeadDraft(true, status), false);
});
