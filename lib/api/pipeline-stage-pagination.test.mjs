import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { pipelineStageLeadsResponseSchema } from '../validation/pipelines.ts';
import { validateDomainResponse } from '../validation/common.ts';
import { buildPipelineBoardQuery } from '../pipeline-board-query.ts';
import { evaluateProduction, productionDeclaration } from '../../hooks/leads/lead-request-runtime-fixture.mjs';

const source = productionDeclaration('lib/api/pipeline-board.ts', node => ts.isFunctionDeclaration(node)
  && node.name?.text === 'getPipelineStageLeads');
const org = '11111111-1111-4111-8111-111111111111';
const pipeline = '22222222-2222-4222-8222-222222222222';
const stage = '33333333-3333-4333-8333-333333333333';

for (const metadata of [{ hasMore: true }, { hasMore: false }, {}]) {
  test(`production page adapter preserves continuation ${JSON.stringify(metadata)} and captured access`, async () => {
    const calls = [], controller = new AbortController();
    const request = evaluateProduction(source, {
      vimobAPIRequest: async (...args) => { calls.push(args); return { stageId: stage, leads: [], ...metadata }; },
      buildPipelineBoardQuery, PIPELINE_READ_TIMEOUT_MS: 12000,
      validateDomainResponse, pipelineStageLeadsResponseSchema, normalizeQueuePoolLead: value => value,
    }, 'getPipelineStageLeads');
    const result = await request({ organizationId: org, pipelineId: pipeline, stageId: stage, offset: 24,
      cursorBefore: '2026-10-20T10:00:00.999976Z', cursorBeforeId: stage, limit: 12,
      intent: { expectedUserId: 'actor-a', expectedSessionId: 'sid-a' }, signal: controller.signal });
    assert.equal(result.hasMore, metadata.hasMore);
    assert.equal(Object.hasOwn(result, 'hasMore'), Object.hasOwn(metadata, 'hasMore'));
    assert.equal(calls[0][0], '/v1/pipeline-stage-leads');
    assert.equal(calls[0][1].signal, controller.signal);
    assert.equal(calls[0][1].expectedSessionId, 'sid-a');
    assert.equal(calls[0][1].expectedUserId, 'actor-a');
    assert.equal(calls[0][1].query.cursorBefore, '2026-10-20T10:00:00.999976Z');
    assert.equal(calls[0][1].query.cursorBeforeId, stage);
    assert.equal(calls[0][1].query.offset, 24);
    assert.equal(calls[0][1].retry, false);
  });
}

test('production page adapter rejects malformed continuation instead of treating strings as truthy', async () => {
  const request = evaluateProduction(source, {
    vimobAPIRequest: async () => ({ stageId: stage, leads: [], hasMore: 'false' }),
    buildPipelineBoardQuery, PIPELINE_READ_TIMEOUT_MS: 12000,
    validateDomainResponse, pipelineStageLeadsResponseSchema, normalizeQueuePoolLead: value => value,
  }, 'getPipelineStageLeads');
  await assert.rejects(request({ organizationId: org, pipelineId: pipeline, stageId: stage, offset: 12 }),
    /hasMore|boolean|resposta|contrato/i);
});
