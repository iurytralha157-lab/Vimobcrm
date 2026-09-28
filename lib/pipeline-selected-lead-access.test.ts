import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient } from '@tanstack/react-query';

import { handlePipelineSelectedLeadAccessFailure } from './pipeline-selected-lead-access';

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

test('falha temporária fecha o detalhe sem apagar a leitura anterior', () => {
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
  assert.equal(closed, true);
  assert.deepEqual(queryClient.getQueryData(key), previousLead);
  queryClient.clear();
});
