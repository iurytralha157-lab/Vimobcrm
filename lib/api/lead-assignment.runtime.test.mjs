import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { evaluateProduction, productionDeclaration } from '../../hooks/leads/lead-request-runtime-fixture.mjs';
import { leadAssignInputSchema, apiLeadResponseSchema } from '../validation/leads.ts';
import { parseDomainInput, validateDomainResponse } from '../validation/common.ts';
import { apiConversationLeadDetailResponseSchema } from '../validation/auxiliary.ts';
import { VimobAPIError } from './vimob-error.ts';

const ID = '11111111-1111-4111-8111-111111111111', ORG = '22222222-2222-4222-8222-222222222222';
const revision = '2026-10-16T10:00:00.000001Z';
function fixture({ conflict = false } = {}) {
  const requests = [];
  const method = productionDeclaration('lib/api/leads.ts', node => ts.isMethodDeclaration(node) && node.name.getText() === 'assignLead');
  const assign = evaluateProduction('const api={' + method + '}', {
    captureCurrentLeadRequestIntent: intent => intent, leadAssignInputSchema, apiLeadResponseSchema, parseDomainInput, validateDomainResponse, toLegacyLead: data => data,
    vimobAPIRequest: async (...args) => {
      requests.push(args); if (conflict) throw new VimobAPIError('Changed lead', { status: 409, code: 'lead_changed' });
      return { data: { id: ID, organizationId: ORG, name: 'Synthetic', source: 'manual', status: 'new', dealStatus: 'open', priority: 'normal', reentryCount: 0, createdAt: revision, updatedAt: revision } };
    },
  }, 'api.assignLead');
  return { requests, assign };
}

test('the real API method carries the fifth revision argument unchanged and explicitly disables retries', async () => {
  const f = fixture(); await f.assign(ID, null, ORG, { expectedUserId: ID, expectedSessionId: 'sid-a' }, revision);
  assert.equal(f.requests.length, 1); const [url, options] = f.requests[0];
  assert.equal(url, `/v1/leads/${ID}/assign`); assert.equal(options.retry, false);
  assert.deepEqual(options.body, { assignedUserId: null, expectedUpdatedAt: revision }); assert.equal(options.expectedSessionId, 'sid-a');
});

test('a missing revision is rejected before transport and a 409 performs only one request', async () => {
  const f = fixture(); await assert.rejects(f.assign(ID, null, ORG, {}), /Contrato invalido/); assert.equal(f.requests.length, 0);
  const failed = fixture({ conflict: true }); await assert.rejects(failed.assign(ID, null, ORG, {}, revision), error => error.code === 'lead_changed');
  assert.equal(failed.requests.length, 1);
});

test('conversation detail accepts the previous read contract while preserving a new exact revision', () => {
  const data = { id: ID, name: 'Synthetic', phone: null, email: null, created_at: revision, deal_status: 'open', tags: [] };
  assert.equal(apiConversationLeadDetailResponseSchema.parse({ data }).data.updated_at, undefined);
  assert.equal(apiConversationLeadDetailResponseSchema.parse({ data: { ...data, updated_at: revision } }).data.updated_at, revision);
});
